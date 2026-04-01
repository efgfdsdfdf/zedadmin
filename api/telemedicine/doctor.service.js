// Doctor service for telemedicine functionality
import { createClient } from '@supabase/supabase-js';

class DoctorService {
  get supabase() {
    if (!this._supabase) {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      console.log('Creating supabase client - URL:', supabaseUrl);
      this._supabase = createClient(supabaseUrl, supabaseServiceKey);
    }
    return this._supabase;
  }

  async getDoctors() {
    const { data, error } = await this.supabase
      .from('doctors')
      .select('*')
      .eq('verified', true)
      .order('rating', { ascending: false });

    if (error) throw error;
    return data;
  }

  async getDoctorById(id) {
    const { data, error } = await this.supabase
      .from('doctors')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  }

  async getDoctorByUserId(userId) {
    const { data, error } = await this.supabase
      .from('doctors')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    return data;
  }

  async createDoctor(doctorData) {
    // Create the user account first
    const { data: user, error: userError } = await this.supabase.auth.admin.createUser({
      email: doctorData.email,
      password: doctorData.password,
      user_metadata: {
        full_name: doctorData.full_name
      }
    });

    if (userError) throw userError;

    // Prepare doctor data without password
    const doctorInsertData = {
      user_id: user.user.id,
      full_name: doctorData.full_name,
      email: doctorData.email,
      specialty: doctorData.specialty,
      license_number: doctorData.license_number,
      price_per_session: doctorData.price_per_session,
      bio: doctorData.bio,
      availability: doctorData.availability || {},
      license_document_url: doctorData.license_document_url
    };

    const { data, error } = await this.supabase
      .from('doctors')
      .insert(doctorInsertData)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async updateDoctor(id, updates) {
    const { data, error } = await this.supabase
      .from('doctors')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getDoctorDashboard(userId) {
    const doctor = await this.getDoctorByUserId(userId);

    // Get stats
    const { data: bookings, error: bookingsError } = await this.supabase
      .from('bookings')
      .select('*')
      .eq('doctor_id', doctor.id);

    if (bookingsError) throw bookingsError;

    const stats = {
      total_patients: new Set(bookings.map(b => b.patient_id)).size,
      total_bookings: bookings.length,
      active_bookings: bookings.filter(b => b.status === 'active').length,
      completed_bookings: bookings.filter(b => b.status === 'completed').length,
      total_earnings: bookings.reduce((sum, b) => sum + (b.doctor_earnings || 0), 0),
      rating: doctor.rating,
      rating_count: doctor.rating_count,
      score_points: doctor.score_points
    };

    return { doctor, stats, bookings: bookings.slice(0, 10) }; // Return recent bookings
  }
}

export default new DoctorService();