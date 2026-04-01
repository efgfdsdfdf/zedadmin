// Supabase admin service for telemedicine
import { createClient } from '@supabase/supabase-js';

class SupabaseAdminService {
  get supabase() {
    if (!this._supabase) {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      this._supabase = createClient(supabaseUrl, supabaseServiceKey);
    }
    return this._supabase;
  }

  async getAllDoctors() {
    const { data, error } = await this.supabase
      .from('doctors')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async approveDoctor(doctorId) {
    const { data, error } = await this.supabase
      .from('doctors')
      .update({ verified: true })
      .eq('id', doctorId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async rejectDoctor(doctorId) {
    const { data, error } = await this.supabase
      .from('doctors')
      .delete()
      .eq('id', doctorId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

export default new SupabaseAdminService();