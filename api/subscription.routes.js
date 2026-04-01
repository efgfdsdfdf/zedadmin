import express from 'express';
import subscriptionService from './subscription.service.js';
import { requireAuth } from './middleware.js';

const router = express.Router();

// Get available subscription plans
router.get('/plans', (req, res) => {
  const plans = [
    {
      id: 'basic',
      name: 'Basic Health',
      price: 999, // ₦9.99
      interval: 'monthly',
      features: [
        'Basic symptom checker (3/week)',
        'Limited AI chat (5/day)',
        'Basic vitals tracking',
        'Emergency access'
      ]
    },
    {
      id: 'premium',
      name: 'Premium Health',
      price: 1499, // ₦14.99
      interval: 'monthly',
      features: [
        'Unlimited symptom analysis',
        'Unlimited AI medical assistant',
        'Advanced vitals analytics',
        'Priority emergency response',
        'Personalized health coaching',
        'Family health management'
      ]
    },
    {
      id: 'family',
      name: 'Family Health Hub',
      price: 2999, // ₦29.99
      interval: 'monthly',
      features: [
        'Up to 6 family members',
        'Shared health calendar',
        'Family health history tracking',
        'Bulk appointment booking',
        'Emergency family coordination',
        'All Premium features'
      ]
    }
  ];

  res.json({ plans });
});

// Initialize subscription
router.post('/initialize', requireAuth, async (req, res) => {
  try {
    const { planId } = req.body;
    const userId = req.user.id;

    // Get user email from database
    const { data: profile } = await req.supabase
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();

    if (!profile?.email) {
      return res.status(400).json({ error: 'User email not found' });
    }

    // Map plan IDs to Paystack plan codes
    const planCodes = {
      basic: process.env.PAYSTACK_BASIC_PLAN_CODE,
      premium: process.env.PAYSTACK_PREMIUM_PLAN_CODE,
      family: process.env.PAYSTACK_FAMILY_PLAN_CODE
    };

    const planCode = planCodes[planId];
    if (!planCode) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const callbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/subscription/success`;

    const subscriptionData = await subscriptionService.initializeSubscription(
      profile.email,
      planCode,
      callbackUrl
    );

    // Store subscription attempt in database
    await req.supabase.from('subscription_attempts').insert({
      user_id: userId,
      plan_id: planId,
      paystack_reference: subscriptionData.reference,
      status: 'pending',
      created_at: new Date().toISOString()
    });

    res.json({
      authorization_url: subscriptionData.authorization_url,
      reference: subscriptionData.reference
    });

  } catch (error) {
    console.error('Subscription initialization error:', error);
    res.status(500).json({ error: 'Failed to initialize subscription' });
  }
});

// Verify subscription payment
router.get('/verify/:reference', requireAuth, async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;

    // Verify with Paystack
    const verificationData = await subscriptionService.verifySubscription(reference);

    if (verificationData.status === 'success') {
      // Update subscription status in database
      await req.supabase.from('subscription_attempts')
        .update({
          status: 'completed',
          paystack_subscription_code: verificationData.subscription_code,
          updated_at: new Date().toISOString()
        })
        .eq('paystack_reference', reference)
        .eq('user_id', userId);

      // Create or update user subscription
      const subscriptionEnd = new Date();
      subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1); // Monthly subscription

      await req.supabase.from('user_subscriptions').upsert({
        user_id: userId,
        plan_id: verificationData.plan,
        paystack_subscription_code: verificationData.subscription_code,
        status: 'active',
        current_period_start: new Date().toISOString(),
        current_period_end: subscriptionEnd.toISOString(),
        updated_at: new Date().toISOString()
      });

      res.json({
        success: true,
        message: 'Subscription activated successfully',
        subscription: {
          plan: verificationData.plan,
          status: 'active',
          period_end: subscriptionEnd.toISOString()
        }
      });
    } else {
      res.status(400).json({ error: 'Payment verification failed' });
    }

  } catch (error) {
    console.error('Subscription verification error:', error);
    res.status(500).json({ error: 'Failed to verify subscription' });
  }
});

// Get user subscription status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: subscription } = await req.supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (subscription) {
      res.json({
        hasActiveSubscription: true,
        plan: subscription.plan_id,
        status: subscription.status,
        current_period_end: subscription.current_period_end,
        cancel_at_period_end: subscription.cancel_at_period_end || false
      });
    } else {
      res.json({
        hasActiveSubscription: false,
        plan: null,
        status: null
      });
    }

  } catch (error) {
    console.error('Subscription status error:', error);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

// Cancel subscription
router.post('/cancel', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: subscription } = await req.supabase
      .from('user_subscriptions')
      .select('paystack_subscription_code')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (!subscription?.paystack_subscription_code) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    // Cancel with Paystack
    await subscriptionService.cancelSubscription(subscription.paystack_subscription_code);

    // Update local database
    await req.supabase.from('user_subscriptions')
      .update({
        status: 'canceled',
        cancel_at_period_end: true,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    res.json({ message: 'Subscription canceled successfully' });

  } catch (error) {
    console.error('Subscription cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Webhook handler for Paystack events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const hash = require('crypto').createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(400).send('Invalid signature');
    }

    const event = req.body;

    switch (event.event) {
      case 'subscription.create':
        // Handle subscription creation
        await handleSubscriptionCreated(event.data);
        break;

      case 'subscription.disable':
        // Handle subscription cancellation
        await handleSubscriptionDisabled(event.data);
        break;

      case 'invoice.payment_succeeded':
        // Handle successful payment
        await handlePaymentSucceeded(event.data);
        break;

      default:
        console.log('Unhandled webhook event:', event.event);
    }

    res.sendStatus(200);

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Webhook processing failed');
  }
});

// Webhook event handlers
async function handleSubscriptionCreated(data) {
  // Update subscription status when Paystack confirms creation
  await req.supabase.from('user_subscriptions')
    .update({
      paystack_subscription_code: data.subscription_code,
      status: 'active',
      updated_at: new Date().toISOString()
    })
    .eq('paystack_reference', data.reference);
}

async function handleSubscriptionDisabled(data) {
  // Mark subscription as canceled
  await req.supabase.from('user_subscriptions')
    .update({
      status: 'canceled',
      updated_at: new Date().toISOString()
    })
    .eq('paystack_subscription_code', data.subscription_code);
}

async function handlePaymentSucceeded(data) {
  // Update subscription period on successful payment
  const nextPeriodEnd = new Date();
  nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + 1);

  await req.supabase.from('user_subscriptions')
    .update({
      current_period_end: nextPeriodEnd.toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('paystack_subscription_code', data.subscription_code);
}

export default router;