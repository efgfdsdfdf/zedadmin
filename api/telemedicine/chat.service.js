// Chat service for telemedicine messaging
import { createClient } from '@supabase/supabase-js';

class ChatService {
  get supabase() {
    if (!this._supabase) {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      this._supabase = createClient(supabaseUrl, supabaseServiceKey);
    }
    return this._supabase;
  }

  async getMessages(bookingId) {
    const { data, error } = await this.supabase
      .from('messages')
      .select(`
        *,
        sender:sender_id (
          id,
          full_name
        )
      `)
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data;
  }

  async sendMessage(messageData) {
    const { data, error } = await this.supabase
      .from('messages')
      .insert(messageData)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

export default new ChatService();