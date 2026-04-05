import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.envv', override: false });

import express from 'express';
import cors from 'cors';
// Use global fetch in Node 18+ for Vercel compatibility
// import fetch from 'node-fetch';

import anthropicRouter from './backend/anthropic.js';
import telemedicineRouter from './backend/telemedicine/routes.js';
import subscriptionRouter from './backend/subscription.routes.js';

// Debug: check if key is loaded
console.log('🔑 OPENAI_API_KEY loaded:', process.env.OPENAI_API_KEY ? 'YES' : 'NO');
if (process.env.OPENAI_API_KEY) {
  console.log('   Prefix:', process.env.OPENAI_API_KEY.substring(0, 15) + '...');
}

const app = express();
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cenplbwpjycxotctvjmz.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_DASHBOARD_KEY = process.env.ADMIN_DASHBOARD_KEY || '';

// Enhanced startup logging for Vercel debugging
console.log('🌐 SUPABASE_URL:', SUPABASE_URL);
console.log('🔑 SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? 'Set (' + SUPABASE_SERVICE_ROLE_KEY.substring(0, 8) + '...)' : 'MISSING');
console.log('🔑 ADMIN_DASHBOARD_KEY:', ADMIN_DASHBOARD_KEY ? 'Set (' + ADMIN_DASHBOARD_KEY.substring(0, 3) + '...)' : 'MISSING');


app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY)
  });
});

// OpenAI proxy endpoint – matches the URL expected by ZedAI
app.post('/api/openai', async (req, res) => {
  try {
    console.log('➡️  Received request for /api/openai');
    console.log('🤖 AI Model requested:', req.body.model || 'gpt-4o');

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: 'OPENAI_API_KEY is missing on the server'
      });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(req.body)  // Forward the entire body as-is
    });

    console.log('⬅️  OpenAI status:', response.status);

    const data = await response.json().catch(() => ({}));
    console.log('   Response data:', JSON.stringify(data).substring(0, 200) + '...');

    res.status(response.status).json(data);
  } catch (error) {
    console.error('❌ Proxy error:', error);
    res.status(500).json({ error: error.message || 'Failed to reach OpenAI API' });
  }
});

function hasAdminSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function adminGuard(req, res, next) {
  if (!ADMIN_DASHBOARD_KEY) {
    return res.status(503).json({
      error: 'ADMIN_DASHBOARD_KEY is not configured on the server'
    });
  }
  const provided = req.header('x-admin-key');
  if (!provided || provided !== ADMIN_DASHBOARD_KEY) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }
  next();
}

async function supabaseRest(path, options = {}) {
  const method = options.method || 'GET';
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Supabase REST error ${response.status}: ${errBody || 'Unknown error'}`);
  }

  return response.json().catch(() => []);
}

async function supabaseAuthAdmin(path, options = {}) {
  const method = options.method || 'GET';
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.msg || data?.message || `Supabase auth admin error ${response.status}`);
  }
  return data;
}

async function readTableSafe(path) {
  try {
    return await supabaseRest(path);
  } catch (error) {
    if (String(error.message || '').includes('42P01')) return [];
    throw error;
  }
}

async function readAppointmentsOverviewSafe(limit = 1000) {

  const datePath = `appointments?select=id,user_id,status,appointment_date,created_at&order=created_at.desc&limit=${limit}`;
  const atPath = `appointments?select=id,user_id,status,appointment_at,created_at&order=created_at.desc&limit=${limit}`;

  try {
    return await readTableSafe(datePath);
  } catch (error) {
    const msg = String(error?.message || '');
    if (msg.includes('42703') && msg.includes('appointment_date')) {
      return await readTableSafe(atPath);
    }
    throw error;
  }
}

async function listAllAuthUsers(maxPages = 10, perPage = 1000) {
  const users = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await supabaseAuthAdmin(`users?page=${page}&per_page=${perPage}`);
    const batch = Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);
    if (batch.length < perPage) break;
  }
  return users;
}

async function getAuthUserById(userId) {
  if (!userId) return null;
  try {
    const data = await supabaseAuthAdmin(`users/${encodeURIComponent(userId)}`);
    return data?.user || data || null;
  } catch (_) {
    return null;
  }
}

function authNameParts(user) {
  const meta = user?.user_metadata || {};
  const first = meta.first_name || meta.given_name || null;
  const last = meta.last_name || meta.family_name || null;
  if (first || last) return { first_name: first, last_name: last };

  const full = meta.full_name || meta.name || null;
  if (typeof full === 'string' && full.trim()) {
    const parts = full.trim().split(/\s+/);
    return {
      first_name: parts[0] || null,
      last_name: parts.slice(1).join(' ') || null
    };
  }
  return { first_name: null, last_name: null };
}

function countBy(rows, key) {
  const map = {};
  (rows || []).forEach((row) => {
    const id = row?.[key];
    if (!id) return;
    map[id] = (map[id] || 0) + 1;
  });
  return map;
}

app.get('/api/admin/overview', adminGuard, async (req, res) => {
  try {
    if (!hasAdminSupabaseConfig()) {
      return res.status(503).json({
        error: 'SUPABASE_SERVICE_ROLE_KEY is missing. Set SUPABASE_SERVICE_ROLE_KEY to enable admin overview.'
      });
    }

    const [
      profiles,
      authUsers,
      chatSessions,
      chatMessages,
      vitals,
      symptoms,
      reports,
      tips,
      appointments,
      notifications,
      medicineScans,
      activityLogs
    ] = await Promise.all([
      // Reduced limits for Vercel/Serverless performance
      readTableSafe('profiles?select=id,first_name,last_name,age,gender,blood_group,updated_at&limit=1000'),
      listAllAuthUsers(5, 500), // Max 2500 users for overview
      readTableSafe('chat_sessions?select=id,user_id,title,created_at,updated_at&order=updated_at.desc&limit=1000'),
      readTableSafe('chat_messages?select=id,session_id,role,created_at&order=created_at.desc&limit=1000'),
      readTableSafe('vitals_log?select=id,user_id,recorded_at&order=recorded_at.desc&limit=1000'),
      readTableSafe('symptom_checks?select=id,user_id,area,severity,created_at&order=created_at.desc&limit=1000'),
      readTableSafe('medical_reports?select=id,user_id,file_name,analysis_type,analyzed_at&order=analyzed_at.desc&limit=1000'),
      readTableSafe('health_tips?select=id,user_id,category,generated_at&order=generated_at.desc&limit=1000'),
      readAppointmentsOverviewSafe(1000),
      readTableSafe('notifications?select=id,user_id,read,created_at&order=created_at.desc&limit=1000'),
      readTableSafe('medicine_scans?select=id,user_id,drug_name,scanned_at&order=scanned_at.desc&limit=1000'),
      readTableSafe('zed_activity_logs?select=id,user_id,event_type,event_label,page,metadata,created_at&order=created_at.desc&limit=2000')
    ]);


    const sessionOwner = {};
    chatSessions.forEach((s) => { if (s?.id) sessionOwner[s.id] = s.user_id; });

    const chatMessageByUser = {};
    chatMessages.forEach((m) => {
      const uid = sessionOwner[m.session_id];
      if (!uid) return;
      chatMessageByUser[uid] = (chatMessageByUser[uid] || 0) + 1;
    });

    const bySession = countBy(chatSessions, 'user_id');
    const byVitals = countBy(vitals, 'user_id');
    const bySymptoms = countBy(symptoms, 'user_id');
    const byReports = countBy(reports, 'user_id');
    const byTips = countBy(tips, 'user_id');
    const byAppointments = countBy(appointments, 'user_id');
    const byNotifications = countBy(notifications, 'user_id');
    const byMedicineScans = countBy(medicineScans, 'user_id');
    const byEvents = countBy(activityLogs, 'user_id');

    const userLastEvent = {};
    activityLogs.forEach((evt) => {
      if (!evt?.user_id || userLastEvent[evt.user_id]) return;
      userLastEvent[evt.user_id] = evt.created_at;
    });

    const profileById = {};
    (profiles || []).forEach((p) => { profileById[p.id] = p; });
    const authUserById = {};
    (authUsers || []).forEach((u) => { if (u?.id) authUserById[u.id] = u; });

    const allUserIds = new Set([
      ...Object.keys(profileById),
      ...Object.keys(byEvents),
      ...Object.keys(bySession),
      ...Object.keys(chatMessageByUser),
      ...Object.keys(byVitals),
      ...Object.keys(bySymptoms),
      ...Object.keys(byReports),
      ...Object.keys(byTips),
      ...Object.keys(byAppointments),
      ...Object.keys(byNotifications),
      ...Object.keys(byMedicineScans)
    ]);

    let users = Array.from(allUserIds).map((userId) => {
      const p = profileById[userId] || {};
      const auth = authUserById[userId] || {};
      const authNames = authNameParts(auth);
      const first_name = p.first_name || authNames.first_name || null;
      const last_name = p.last_name || authNames.last_name || null;
      return {
        id: userId,
        email: auth.email || null,
        first_name,
        last_name,
        age: p.age || null,
        gender: p.gender || null,
        blood_group: p.blood_group || null,
        updated_at: p.updated_at || null,
        last_event_at: userLastEvent[userId] || null,
        last_seen: userLastEvent[userId] || p.updated_at || null,
        stats: {
          events: byEvents[userId] || 0,
          chat_sessions: bySession[userId] || 0,
          chat_messages: chatMessageByUser[userId] || 0,
          vitals: byVitals[userId] || 0,
          symptoms: bySymptoms[userId] || 0,
          reports: byReports[userId] || 0,
          tips: byTips[userId] || 0,
          appointments: byAppointments[userId] || 0,
          notifications: byNotifications[userId] || 0,
          medicine_scans: byMedicineScans[userId] || 0
        }
      };
    });

    // Fallback: fetch missing auth users one-by-one so email is populated whenever possible.
    const missingEmailUsers = users.filter((u) => !u.email && u.id);
    if (missingEmailUsers.length) {
      const fetched = await Promise.all(
        missingEmailUsers.map((u) => getAuthUserById(u.id))
      );
      const fetchedById = {};
      fetched.forEach((u) => { if (u?.id) fetchedById[u.id] = u; });
      users = users.map((u) => {
        if (u.email) return u;
        const auth = fetchedById[u.id] || {};
        const names = authNameParts(auth);
        return {
          ...u,
          email: auth.email || null,
          first_name: u.first_name || names.first_name || null,
          last_name: u.last_name || names.last_name || null
        };
      });
    }

    const userIdentityById = {};
    users.forEach((u) => {
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || null;
      userIdentityById[u.id] = {
        user_name: name,
        user_email: u.email || null
      };
    });

    const recentActivity = (activityLogs || []).slice(0, 300).map((evt) => {
      const identity = userIdentityById[evt.user_id] || {};
      return {
        ...evt,
        user_name: identity.user_name || null,
        user_email: identity.user_email || null
      };
    });

    const metrics = {
      users: users.length,
      events: activityLogs.length,
      chat_sessions: chatSessions.length,
      chat_messages: chatMessages.length,
      vitals: vitals.length,
      symptoms: symptoms.length,
      reports: reports.length,
      tips: tips.length,
      appointments: appointments.length,
      notifications: notifications.length,
      medicine_scans: medicineScans.length,
      profiles: profiles.length
    };

    res.json({
      mode: 'server',
      generatedAt: new Date().toISOString(),
      metrics,
      users,
      recentActivity
    });
  } catch (error) {
    console.error('❌ Admin overview error:', error);
    // Be more specific in the error response to help debugging
    const errorMessage = error.message || 'Failed to build admin overview';
    res.status(500).json({ 
      error: errorMessage,
      details: error.toString(),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      hint: 'Check Vercel environment variables and Supabase connection. For large datasets, this endpoint may timeout.'
    });
  }
});


app.get('/api/admin/user/:userId', adminGuard, async (req, res) => {
  try {
    if (!hasAdminSupabaseConfig()) {
      return res.status(503).json({
        error: 'SUPABASE_SERVICE_ROLE_KEY is missing. Set SUPABASE_SERVICE_ROLE_KEY to enable admin detail.'
      });
    }

    const userId = encodeURIComponent(req.params.userId);
    const [
      profile,
      sessions,
      vitals,
      symptoms,
      reports,
      tips,
      appointments,
      scans,
      events
    ] = await Promise.all([
      readTableSafe(`profiles?select=*&id=eq.${userId}&limit=1`),
      readTableSafe(`chat_sessions?select=*&user_id=eq.${userId}&order=updated_at.desc&limit=100`),
      readTableSafe(`vitals_log?select=*&user_id=eq.${userId}&order=recorded_at.desc&limit=100`),
      readTableSafe(`symptom_checks?select=*&user_id=eq.${userId}&order=created_at.desc&limit=100`),
      readTableSafe(`medical_reports?select=*&user_id=eq.${userId}&order=analyzed_at.desc&limit=100`),
      readTableSafe(`health_tips?select=*&user_id=eq.${userId}&order=generated_at.desc&limit=100`),
      readTableSafe(`appointments?select=*&user_id=eq.${userId}&order=created_at.desc&limit=100`),
      readTableSafe(`medicine_scans?select=*&user_id=eq.${userId}&order=scanned_at.desc&limit=100`),
      readTableSafe(`zed_activity_logs?select=*&user_id=eq.${userId}&order=created_at.desc&limit=300`)
    ]);

    res.json({
      generatedAt: new Date().toISOString(),
      userId: req.params.userId,
      profile: Array.isArray(profile) ? profile[0] || null : null,
      sessions,
      vitals,
      symptoms,
      reports,
      tips,
      appointments,
      scans,
      events
    });
  } catch (error) {
    console.error('Admin user detail error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch user detail' });
  }
});

app.post('/api/admin/users/:userId/ban', adminGuard, async (req, res) => {
  try {
    if (!hasAdminSupabaseConfig()) {
      return res.status(503).json({
        error: 'SUPABASE_SERVICE_ROLE_KEY is missing. Set SUPABASE_SERVICE_ROLE_KEY to ban users.'
      });
    }

    const rawDuration = String(req.body?.duration || '').trim();
    const duration = rawDuration || '876000h';
    const userId = encodeURIComponent(req.params.userId);
    const user = await supabaseAuthAdmin(`users/${userId}`, {
      method: 'PUT',
      body: { ban_duration: duration }
    });

    res.json({
      message: `User banned for ${duration}`,
      duration,
      user
    });
  } catch (error) {
    console.error('Admin ban user error:', error);
    res.status(500).json({ error: error.message || 'Failed to ban user' });
  }
});

app.post('/api/admin/users/:userId/unban', adminGuard, async (req, res) => {
  try {
    if (!hasAdminSupabaseConfig()) {
      return res.status(503).json({
        error: 'SUPABASE_SERVICE_ROLE_KEY is missing. Set SUPABASE_SERVICE_ROLE_KEY to unban users.'
      });
    }

    const userId = encodeURIComponent(req.params.userId);
    const user = await supabaseAuthAdmin(`users/${userId}`, {
      method: 'PUT',
      body: { ban_duration: 'none' }
    });

    res.json({
      message: 'User unbanned',
      user
    });
  } catch (error) {
    console.error('Admin unban user error:', error);
    res.status(500).json({ error: error.message || 'Failed to unban user' });
  }
});

app.delete('/api/admin/users/:userId', adminGuard, async (req, res) => {
  try {
    if (!hasAdminSupabaseConfig()) {
      return res.status(503).json({
        error: 'SUPABASE_SERVICE_ROLE_KEY is missing. Set SUPABASE_SERVICE_ROLE_KEY to delete users.'
      });
    }

    const shouldSoftDelete = String(req.query.soft || '').toLowerCase() === 'true';
    const userId = encodeURIComponent(req.params.userId);
    const authPath = shouldSoftDelete
      ? `users/${userId}?should_soft_delete=true`
      : `users/${userId}`;

    await supabaseAuthAdmin(authPath, { method: 'DELETE' });

    res.json({
      message: shouldSoftDelete ? 'User soft-deleted' : 'User deleted',
      soft: shouldSoftDelete
    });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete user' });
  }
});

// Anthropic proxy endpoint
app.use('/api/anthropic', anthropicRouter);
app.use('/api/telemedicine', telemedicineRouter);
app.use('/api/subscription', subscriptionRouter);

// Serve static files from public directory
app.use(express.static('public'));

// Debug: check if Anthropic key is loaded
console.log('🔑 ANTHROPIC_API_KEY loaded:', process.env.ANTHROPIC_API_KEY ? 'YES' : 'NO');
if (process.env.ANTHROPIC_API_KEY) {
  console.log('   Prefix:', process.env.ANTHROPIC_API_KEY.substring(0, 15) + '...');
}

// For Vercel deployment, export the app
export default app;

// For local development
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Proxy server running on http://localhost:${PORT}`);
  });
}
