// Booking service for telemedicine functionality
import { createClient } from '@supabase/supabase-js';

class BookingService {
  get supabase() {
    if (!this._supabase) {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      this._supabase = createClient(supabaseUrl, supabaseServiceKey);
    }
    return this._supabase;
  }

  async createBooking(bookingData) {
    const { data, error } = await this.supabase
      .from('bookings')
      .insert(bookingData)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getBookingsByPatient(patientId) {
    const { data, error } = await this.supabase
      .from('bookings')
      .select(`
        *,
        doctor:doctor_id (
          id,
          full_name,
          specialty,
          price_per_session
        )
      `)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async getBookingsByDoctor(doctorId) {
    const { data, error } = await this.supabase
      .from('bookings')
      .select(`
        *,
        patient:patient_id (
          id,
          full_name,
          age,
          gender
        )
      `)
      .eq('doctor_id', doctorId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async getBookingById(id) {
    const { data, error } = await this.supabase
      .from('bookings')
      .select(`
        *,
        doctor:doctor_id (
          id,
          full_name,
          specialty
        ),
        patient:patient_id (
          id,
          full_name
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  }

  async updateBooking(id, updates) {
    const { data, error } = await this.supabase
      .from('bookings')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async payForBooking(id, paymentReference) {
    const { data, error } = await this.supabase
      .from('bookings')
      .update({
        status: 'active',
        payment_reference: paymentReference,
        paid_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async completeBooking(id) {
    const { data, error } = await this.supabase
      .from('bookings')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async rateBooking(id, rating, review) {
    const { data, error } = await this.supabase
      .from('bookings')
      .update({
        patient_rating: rating,
        patient_review: review,
        rated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

export default new BookingService();