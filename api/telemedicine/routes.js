import express from 'express';
import doctorService from './doctor.service.js';
import bookingService from './booking.service.js';
import chatService from './chat.service.js';
import paymentService from './payment.service.js';
import supabaseAdminService from './supabase-admin.js';
import { authenticateUser, requireDoctor, requireAdmin } from './middleware.js';
import { validateDoctorSignup, validateBooking, validateMessage } from './validators.js';

const router = express.Router();

// Public routes
router.get('/doctors', async (req, res) => {
  try {
    const doctors = await doctorService.getDoctors();
    res.json(doctors);
  } catch (error) {
    console.error('Error fetching doctors:', error);
    res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

router.post('/doctors/signup', async (req, res) => {
  try {
    const validation = validateDoctorSignup(req.body);
    if (!validation.isValid) {
      return res.status(400).json({ error: validation.errors.join(', ') });
    }

    const doctor = await doctorService.createDoctor(req.body);
    res.status(201).json(doctor);
  } catch (error) {
    console.error('Error creating doctor:', error);
    res.status(500).json({ error: 'Failed to create doctor account' });
  }
});

// Protected routes
router.use(authenticateUser);

// Doctor routes
router.get('/doctors/me', requireDoctor, async (req, res) => {
  try {
    res.json(req.doctor);
  } catch (error) {
    console.error('Error fetching doctor profile:', error);
    res.status(500).json({ error: 'Failed to fetch doctor profile' });
  }
});

router.get('/doctors/me/dashboard', requireDoctor, async (req, res) => {
  try {
    const dashboard = await doctorService.getDoctorDashboard(req.user.id);
    res.json(dashboard);
  } catch (error) {
    console.error('Error fetching doctor dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// Booking routes
router.get('/bookings/my', async (req, res) => {
  try {
    const bookings = await bookingService.getBookingsByPatient(req.user.id);
    res.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

router.post('/bookings', async (req, res) => {
  try {
    const validation = validateBooking(req.body);
    if (!validation.isValid) {
      return res.status(400).json({ error: validation.errors.join(', ') });
    }

    const bookingData = {
      ...req.body,
      patient_id: req.user.id,
      status: 'pending'
    };

    const booking = await bookingService.createBooking(bookingData);
    res.status(201).json(booking);
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

router.post('/bookings/:id/pay', async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_reference } = req.body;

    // Verify payment (mock implementation)
    const paymentVerification = await paymentService.verifyPayment(payment_reference);
    if (!paymentVerification.success) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    const booking = await bookingService.payForBooking(id, payment_reference);
    res.json(booking);
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

router.post('/bookings/:id/complete', requireDoctor, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await bookingService.completeBooking(id);
    res.json(booking);
  } catch (error) {
    console.error('Error completing booking:', error);
    res.status(500).json({ error: 'Failed to complete booking' });
  }
});

router.post('/bookings/:id/rate', async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, review } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const booking = await bookingService.rateBooking(id, rating, review);
    res.json(booking);
  } catch (error) {
    console.error('Error rating booking:', error);
    res.status(500).json({ error: 'Failed to rate booking' });
  }
});

// Chat routes
router.get('/messages/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const messages = await chatService.getMessages(bookingId);
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

router.post('/messages', async (req, res) => {
  try {
    const validation = validateMessage(req.body);
    if (!validation.isValid) {
      return res.status(400).json({ error: validation.errors.join(', ') });
    }

    const messageData = {
      ...req.body,
      created_at: new Date().toISOString()
    };

    const message = await chatService.sendMessage(messageData);
    res.status(201).json(message);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Admin routes
router.use('/admin', requireAdmin);

router.get('/admin/doctors', async (req, res) => {
  try {
    const doctors = await supabaseAdminService.getAllDoctors();
    res.json(doctors);
  } catch (error) {
    console.error('Error fetching all doctors:', error);
    res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

router.post('/admin/doctors/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const doctor = await supabaseAdminService.approveDoctor(id);
    res.json(doctor);
  } catch (error) {
    console.error('Error approving doctor:', error);
    res.status(500).json({ error: 'Failed to approve doctor' });
  }
});

router.post('/admin/doctors/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const doctor = await supabaseAdminService.rejectDoctor(id);
    res.json(doctor);
  } catch (error) {
    console.error('Error rejecting doctor:', error);
    res.status(500).json({ error: 'Failed to reject doctor' });
  }
});

export default router;