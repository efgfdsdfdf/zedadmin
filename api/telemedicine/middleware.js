// Middleware for telemedicine routes
import { createClient } from '@supabase/supabase-js';

export const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const token = authHeader.substring(7);
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

export const requireDoctor = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: doctor, error } = await supabase
      .from('doctors')
      .select('*')
      .eq('user_id', req.user.id)
      .single();

    if (error || !doctor) {
      return res.status(403).json({ error: 'Doctor access required' });
    }

    req.doctor = doctor;
    next();
  } catch (error) {
    console.error('Doctor middleware error:', error);
    res.status(500).json({ error: 'Authorization failed' });
  }
};

export const requireAdmin = (req, res, next) => {
  // Simple admin check - in production, implement proper admin role checking
  const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
  const expectedKey = process.env.ADMIN_DASHBOARD_KEY;

  if (!adminKey || adminKey !== expectedKey) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
};