// Subscription service for Paystack integration
import fetch from 'node-fetch';

class SubscriptionService {
  constructor() {
    this.paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    this.paystackPublic = process.env.PAYSTACK_PUBLIC_KEY;
    this.baseUrl = 'https://api.paystack.co';
  }

  // Create subscription plan
  async createPlan(planData) {
    const response = await fetch(`${this.baseUrl}/plan`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.paystackSecret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: planData.name,
        interval: planData.interval, // 'monthly', 'yearly'
        amount: planData.amount * 100, // Convert to kobo
        currency: 'NGN',
        description: planData.description
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    return data.data;
  }

  // Initialize subscription
  async initializeSubscription(userEmail, planCode, callbackUrl) {
    const response = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.paystackSecret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: userEmail,
        plan: planCode,
        callback_url: callbackUrl
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    return data.data;
  }

  // Verify subscription
  async verifySubscription(reference) {
    const response = await fetch(`${this.baseUrl}/transaction/verify/${reference}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.paystackSecret}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    return data.data;
  }

  // Cancel subscription
  async cancelSubscription(subscriptionCode) {
    const response = await fetch(`${this.baseUrl}/subscription/${subscriptionCode}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.paystackSecret}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    return data.data;
  }

  // Get subscription details
  async getSubscription(subscriptionCode) {
    const response = await fetch(`${this.baseUrl}/subscription/${subscriptionCode}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.paystackSecret}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    return data.data;
  }

  // List user subscriptions
  async listUserSubscriptions(customerId) {
    const response = await fetch(`${this.baseUrl}/subscription?customer=${customerId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.paystackSecret}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    return data.data;
  }
}

export default new SubscriptionService();