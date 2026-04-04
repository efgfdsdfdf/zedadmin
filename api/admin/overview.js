import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cenplbwpjycxotctvjmz.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_DASHBOARD_KEY = process.env.ADMIN_DASHBOARD_KEY || '';

function hasAdminSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

// Ensure fetch is available (Node 18+ has it globally, Vercel provides it)
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
    if (String(error.message || '').includes('42P01')) return []; // Table doesn't exist
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

async function listAllAuthUsers(maxPages = 5, perPage = 500) {
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

export default async function handler(req, res) {
  // CORS check (allow all for admin api or configure appropriately)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-admin-key, Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!ADMIN_DASHBOARD_KEY) {
    return res.status(503).json({
      error: 'ADMIN_DASHBOARD_KEY is not configured on the server'
    });
  }
  const provided = req.headers['x-admin-key'];
  if (!provided || provided !== ADMIN_DASHBOARD_KEY) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }

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
      readTableSafe('profiles?select=id,first_name,last_name,age,gender,blood_group,updated_at&limit=500'),
      listAllAuthUsers(3, 500), 
      readTableSafe('chat_sessions?select=id,user_id,title,created_at,updated_at&order=updated_at.desc&limit=500'),
      readTableSafe('chat_messages?select=id,session_id,role,created_at&order=created_at.desc&limit=500'),
      readTableSafe('vitals_log?select=id,user_id,recorded_at&order=recorded_at.desc&limit=500'),
      readTableSafe('symptom_checks?select=id,user_id,area,severity,created_at&order=created_at.desc&limit=500'),
      readTableSafe('medical_reports?select=id,user_id,file_name,analysis_type,analyzed_at&order=analyzed_at.desc&limit=500'),
      readTableSafe('health_tips?select=id,user_id,category,generated_at&order=generated_at.desc&limit=500'),
      readAppointmentsOverviewSafe(500),
      readTableSafe('notifications?select=id,user_id,read,created_at&order=created_at.desc&limit=500'),
      readTableSafe('medicine_scans?select=id,user_id,drug_name,scanned_at&order=scanned_at.desc&limit=500'),
      readTableSafe('zed_activity_logs?select=id,user_id,event_type,event_label,page,metadata,created_at&order=created_at.desc&limit=1000')
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

    res.status(200).json({
      mode: 'server',
      generatedAt: new Date().toISOString(),
      metrics,
      users,
      recentActivity
    });
  } catch (error) {
    console.error('❌ Admin overview error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to build admin overview',
      details: error.toString(),
      hint: 'Check Vercel environment variables and Supabase connection. For large datasets, this endpoint may timeout.'
    });
  }
}
