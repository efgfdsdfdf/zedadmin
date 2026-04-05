// ═══════════════════════════════════════════════════════════════
//  ZED CORE  v3  —  Supabase + Anthropic via backend proxy
//  🔐 API key stays on the server for dev + deployment
// ═══════════════════════════════════════════════════════════════

// ── 0. CONFIGURATION (set ZED_API_BASE before loading this script) ──
// Example: <script>const ZED_API_BASE = 'https://your-vercel-app.vercel.app';</script>
// If not set, the script will try to detect the API endpoint automatically.

// ── 1. SUPABASE CONFIG ──────────────────────────────────────────
const SUPABASE_URL  = 'https://cenplbwpjycxotctvjmz.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlbnBsYndwanljeG90Y3R2am16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MDE0NDgsImV4cCI6MjA4ODQ3NzQ0OH0.6lDMcolkeHre8VE7R823pMcx3uA6Rvw2C9XTiWtUvD8';

// Fallback: try to get from environment (for server-side rendering)
if (typeof window === 'undefined' && process?.env) {
  SUPABASE_URL = process.env.SUPABASE_URL || SUPABASE_URL;
  SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || SUPABASE_ANON;
}

// ── 2. SUPABASE CLIENT ──────────────────────────────────────────
if (typeof supabase === 'undefined') {
  console.error('❌ Supabase library not loaded. Make sure to include the Supabase script before zed-core.js');
  throw new Error('Supabase library missing');
}

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: true,
    storageKey:         'zed-auth'
  }
});

const _localAuth = (typeof window !== 'undefined' && window.LocalAuth) ? window.LocalAuth : null;
let _forceLocalAuth = false;

function zedAuthShouldFallback(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return (
    _forceLocalAuth ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('cors') ||
    msg.includes('econnreset') ||
    msg.includes('connection') ||
    msg.includes('fetch')
  );
}

// Test connection (logs only)
_supabase.from('profiles').select('*').limit(1).then(() => {
  console.log('✅ Supabase connection successful');
}).catch((error) => {
  console.warn('⚠️ Supabase connection test failed:', error.message);
  console.log('🔧 If this persists, check CORS settings in Supabase dashboard (add your localhost origin).');
  if (_localAuth) {
    _forceLocalAuth = true;
    console.log('🧪 Switching auth to local fallback mode');
  }
});

// ── 3. ACTIVITY TRACKING ───────────────────────────────────────
const ZedActivity = {
  storageKey: 'zed-activity-local',
  maxLocalEvents: 500,
  _pageTracked: false,

  _safeJsonParse(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  },

  _readLocal() {
    const raw = localStorage.getItem(this.storageKey);
    const parsed = this._safeJsonParse(raw, []);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
    return [];
  },

  _writeLocal(events) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(events.slice(0, this.maxLocalEvents)));
    } catch (_) {}
  },

  _normalizePage(pathname) {
    return (pathname || '').split('/').pop() || 'dashboard.html';
  },

  _sanitizeMetadata(metadata = {}) {
    const copy = { ...metadata };
    if (typeof copy.content === 'string') copy.content = copy.content.slice(0, 140);
    if (typeof copy.prompt === 'string') copy.prompt = '[redacted]';
    if (typeof copy.base64 === 'string') copy.base64 = '[redacted]';
    return copy;
  },

  async track(eventType, eventLabel, metadata = {}, userId = null) {
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      user_id: userId || null,
      event_type: eventType || 'unknown',
      event_label: eventLabel || 'Event',
      page: this._normalizePage(window.location.pathname),
      metadata: this._sanitizeMetadata(metadata),
      created_at: new Date().toISOString()
    };

    const localEvents = this._readLocal();
    localEvents.unshift(event);
    this._writeLocal(localEvents);

    let resolvedUserId = userId;
    if (!resolvedUserId) {
      try {
        const currentUser = await ZedAuth.getUser();
        resolvedUserId = currentUser?.id || null;
      } catch (_) {}
    }

    if (!resolvedUserId) return { local: true };

    try {
      await _supabase.from('zed_activity_logs').insert({
        user_id: resolvedUserId,
        event_type: event.event_type,
        event_label: event.event_label,
        page: event.page,
        metadata: event.metadata,
        created_at: event.created_at
      });
    } catch (_) {
      // Ignore cloud logging errors and keep local logging available.
    }

    return { local: true };
  },

  getLocalEvents(limit = 200) {
    const events = this._readLocal();
    return Array.isArray(events) ? events.slice(0, limit) : [];
  },

  clearLocalEvents() {
    try { localStorage.removeItem(this.storageKey); } catch (_) {}
  },

  async trackPageView() {
    if (this._pageTracked) return;
    this._pageTracked = true;
    const page = this._normalizePage(window.location.pathname);
    await this.track('page_view', `Viewed ${page}`, { href: window.location.href, page });
  }
};

// ── 4. AUTH ─────────────────────────────────────────────────────
const ZedAuth = {
  async getSession() {
    if (_forceLocalAuth && _localAuth) {
      const user = await _localAuth.getUser();
      return { session: user ? { user } : null, error: null };
    }
    const { data, error } = await _supabase.auth.getSession();
    return { session: data?.session || null, error: error || null };
  },

  async getUser() {
    if (_forceLocalAuth && _localAuth) {
      return _localAuth.getUser();
    }

    try {
      const { data, error } = await _supabase.auth.getUser();
      if (data?.user) return data.user;

      const { session } = await this.getSession();
      if (session?.user) return session.user;

      if (error) {
        if (_localAuth && zedAuthShouldFallback(error)) {
          _forceLocalAuth = true;
          return _localAuth.getUser();
        }
        console.warn('Auth getUser failed:', error.message);
      }
      return null;
    } catch (error) {
      if (_localAuth && zedAuthShouldFallback(error)) {
        _forceLocalAuth = true;
        return _localAuth.getUser();
      }
      throw error;
    }
  },

  async requireAuth() {
    const user = await this.getUser();
    if (!user) { window.location.href = 'login.html'; return null; }
    return user;
  },

  async signIn(email, password) {
    let result;
    try {
      result = await _supabase.auth.signInWithPassword({ email, password });
      if (result?.error && _localAuth && zedAuthShouldFallback(result.error)) {
        _forceLocalAuth = true;
        result = await _localAuth.signIn(email, password);
      }
    } catch (error) {
      if (_localAuth && zedAuthShouldFallback(error)) {
        _forceLocalAuth = true;
        result = await _localAuth.signIn(email, password);
      } else {
        throw error;
      }
    }
    if (result?.data?.user && !result?.error) {
      ZedActivity.track('auth_signin', 'User signed in', { email }, result.data.user.id);
    }
    return result;
  },

  async signUp(email, password, meta = {}) {
    let result;
    try {
      result = await _supabase.auth.signUp({ email, password, options: { data: meta } });
      if (result?.error && _localAuth && zedAuthShouldFallback(result.error)) {
        _forceLocalAuth = true;
        result = await _localAuth.signUp(email, password, meta);
      }
    } catch (error) {
      if (_localAuth && zedAuthShouldFallback(error)) {
        _forceLocalAuth = true;
        result = await _localAuth.signUp(email, password, meta);
      } else {
        throw error;
      }
    }
    if (result?.data?.user && !result?.error) {
      ZedActivity.track('auth_signup', 'New user signed up', { email }, result.data.user.id);
    }
    return result;
  },

  async signOut() {
    const user = await this.getUser().catch(() => null);
    if (user?.id) {
      ZedActivity.track('auth_signout', 'User signed out', {}, user.id);
    }
    if (_forceLocalAuth && _localAuth) {
      await _localAuth.signOut();
      return;
    }
    await _supabase.auth.signOut();
    window.location.href = 'login.html';
  },

  async oAuth(provider) {
    return _supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin + '/dashboard.html',
        queryParams: { access_type: 'offline', prompt: 'consent' }
      }
    });
  },

  async resetPassword(email) {
    if (_forceLocalAuth && _localAuth) {
      return _localAuth.resetPassword(email);
    }
    return _supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/verify-otp.html'
    });
  },

  async verifyRecoveryOtp(email, token) {
    if (_forceLocalAuth && _localAuth) {
      return { error: { message: 'OTP verification not available in local mode' } };
    }
    return _supabase.auth.verifyOtp({
      email,
      token,
      type: 'recovery'
    });
  },

  async updatePassword(newPassword) {
    if (_forceLocalAuth && _localAuth) {
      return _localAuth.updatePassword(newPassword);
    }
    return _supabase.auth.updateUser({ password: newPassword });
  },

  onAuthChange(callback) {
    return _supabase.auth.onAuthStateChange(callback);
  }
};

// ── 4. PROFILE ──────────────────────────────────────────────────
const ZedProfile = {
  async get(userId) {
    const { data, error } = await _supabase
      .from('profiles').select('*').eq('id', userId).maybeSingle();
    return { data, error };
  },

  async upsert(userId, fields) {
    return _supabase
      .from('profiles')
      .upsert({ id: userId, ...fields, updated_at: new Date().toISOString() })
      .select().single();
  },

  displayName(profile, user) {
    if (profile) {
      const full = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
      if (full.trim()) return full;
    }
    return user?.user_metadata?.first_name
        || user?.user_metadata?.full_name
        || user?.email?.split('@')[0]
        || 'there';
  },

  requiredSections: {
    basic: ['first_name', 'last_name', 'age', 'gender', 'blood_group', 'height', 'weight'],
    medical: ['allergies', 'conditions', 'medications'],
    lifestyle: ['smoking', 'alcohol', 'exercise'],
    emergency: ['ec_name', 'ec_phone', 'ec_relationship']
  },

  isFilled(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    return true;
  },

  evaluateCompleteness(profile) {
    const allFields = Object.values(this.requiredSections).flat();
    if (!profile) {
      return {
        isComplete: false,
        percent: 0,
        missingFields: allFields,
        missingBySection: this.requiredSections
      };
    }

    const missingBySection = {};
    Object.entries(this.requiredSections).forEach(([section, fields]) => {
      const missing = fields.filter((f) => !this.isFilled(profile[f]));
      if (missing.length) missingBySection[section] = missing;
    });

    const missingFields = Object.values(missingBySection).flat();
    const filledCount = allFields.length - missingFields.length;
    const percent = Math.max(0, Math.min(100, Math.round((filledCount / allFields.length) * 100)));

    return {
      isComplete: missingFields.length === 0,
      percent,
      missingFields,
      missingBySection
    };
  }
};

// ── 5. CHAT SESSIONS & MESSAGES ─────────────────────────────────
const ZedChats = {
  async list(userId, limit = 20) {
    return _supabase
      .from('chat_sessions').select('id, title, created_at, updated_at')
      .eq('user_id', userId).order('updated_at', { ascending: false }).limit(limit);
  },

  async create(userId, title = 'New Consultation') {
    const result = await _supabase.from('chat_sessions')
      .insert({ user_id: userId, title }).select().single();
    if (result?.data && !result?.error) {
      ZedActivity.track('chat_session_create', 'Created chat session', {
        title,
        sessionId: result.data.id
      }, userId);
    }
    return result;
  },

  async rename(sessionId, title) {
    return _supabase.from('chat_sessions').update({ title }).eq('id', sessionId);
  },

  async delete(sessionId) {
    const result = await _supabase.from('chat_sessions').delete().eq('id', sessionId);
    ZedActivity.track('chat_session_delete', 'Deleted chat session', { sessionId });
    return result;
  },

  async getMessages(sessionId) {
    return _supabase.from('chat_messages')
      .select('id, role, content, created_at').eq('session_id', sessionId)
      .order('created_at', { ascending: true });
  },

  async addMessage(sessionId, role, content) {
    const result = await _supabase.from('chat_messages').insert({ session_id: sessionId, role, content });
    ZedActivity.track('chat_message', 'Sent chat message', { sessionId, role, content });
    return result;
  }
};

// ── 6. VITALS LOG ───────────────────────────────────────────────
const ZedVitals = {
  async latest(userId) {
    return _supabase
      .from('vitals_log').select('*').eq('user_id', userId)
      .order('recorded_at', { ascending: false }).limit(1).maybeSingle();
  },

  async history(userId, limit = 14) {
    return _supabase
      .from('vitals_log').select('heart_rate, bp_systolic, bp_diastolic, temperature, spo2, recorded_at')
      .eq('user_id', userId).order('recorded_at', { ascending: false }).limit(limit);
  },

  async save(userId, readings) {
    const result = await _supabase.from('vitals_log')
      .insert({ user_id: userId, source: 'manual', ...readings })
      .select().single();
    if (result?.data && !result?.error) {
      ZedActivity.track('vitals_save', 'Logged vitals', {
        heart_rate: readings.heart_rate || null,
        bp_systolic: readings.bp_systolic || null,
        bp_diastolic: readings.bp_diastolic || null,
        temperature: readings.temperature || null,
        spo2: readings.spo2 || null
      }, userId);
    }
    return result;
  }
};

// ── 7. APPOINTMENTS ─────────────────────────────────────────────
const ZedAppointments = {
  async upcoming(userId, limit = 5) {
    return _supabase
      .from('appointments').select('*').eq('user_id', userId)
      .in('status', ['confirmed', 'pending'])
      .gte('appointment_date', new Date().toISOString())
      .order('appointment_date', { ascending: true }).limit(limit);
  },

  async save(userId, payload) {
    const result = await _supabase.from('appointments').insert({ user_id: userId, ...payload }).select().single();
    if (result?.data && !result?.error) {
      ZedActivity.track('appointment_create', 'Created appointment', {
        doctor_name: payload.doctor_name || null,
        appointment_date: payload.appointment_date || payload.appointment_at || null,
        status: payload.status || null
      }, userId);

    }
    return result;
  },

  async update(id, fields) {
    const result = await _supabase.from('appointments').update(fields).eq('id', id);
    ZedActivity.track('appointment_update', 'Updated appointment', { appointmentId: id, fields });
    return result;
  }
};


// ── 8. SYMPTOM CHECKS ───────────────────────────────────────────
const ZedSymptoms = {
  async list(userId, limit = 10) {
    return _supabase.from('symptom_checks')
      .select('id, area, symptoms, severity, duration, result, created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  },

  async save(userId, payload) {
    const result = await _supabase.from('symptom_checks').insert({ user_id: userId, ...payload });
    if (!result?.error) {
      ZedActivity.track('symptom_check', 'Ran symptom check', {
        area: payload.area || null,
        severity: payload.severity || null,
        duration: payload.duration || null
      }, userId);
    }
    return result;
  }
};

// ── 9. MEDICAL REPORTS ──────────────────────────────────────────
const ZedReports = {
  async list(userId, limit = 10) {
    return _supabase.from('medical_reports')
      .select('id, file_name, analysis_type, result, analyzed_at')
      .eq('user_id', userId).order('analyzed_at', { ascending: false }).limit(limit);
  },

  async save(userId, payload) {
    const result = await _supabase.from('medical_reports')
      .insert({ user_id: userId, analyzed_at: new Date().toISOString(), ...payload });
    if (!result?.error) {
      ZedActivity.track('medical_report', 'Uploaded report for analysis', {
        file_name: payload.file_name || null,
        analysis_type: payload.analysis_type || null
      }, userId);
    }
    return result;
  }
};

// ── 10. HEALTH TIPS CACHE ───────────────────────────────────────
const ZedTips = {
  async get(userId, category = 'all') {
    return _supabase.from('health_tips')
      .select('tips, generated_at').eq('user_id', userId)
      .eq('category', category).maybeSingle();
  },

  async save(userId, category, tips) {
    const result = await _supabase.from('health_tips').upsert(
      { user_id: userId, category, tips, generated_at: new Date().toISOString() },
      { onConflict: 'user_id,category' }
    );
    if (!result?.error) {
      ZedActivity.track('tips_generate', 'Generated health tips', {
        category,
        count: Array.isArray(tips) ? tips.length : 0
      }, userId);
    }
    return result;
  }
};

// ── 11. NOTIFICATIONS ───────────────────────────────────────────
const ZedNotifications = {
  async unreadCount(userId) {
    const { count } = await _supabase.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('read', false);
    return count || 0;
  },

  async list(userId, limit = 20) {
    return _supabase.from('notifications')
      .select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(limit);
  },

  async markAllRead(userId) {
    return _supabase.from('notifications')
      .update({ read: true }).eq('user_id', userId).eq('read', false);
  }
};

// ── 12. ZED AI — BACKEND PROXY (with custom URL support) ────────
function zedCandidateApiUrls(path) {
  const { protocol, hostname, port, origin } = window.location;
  const urls = [];

  if (protocol !== 'file:' && origin && origin !== 'null') {
    urls.push(`${origin}${path}`);
  }

  if (
    protocol === 'file:' ||
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === ''
  ) {
    if (port === '3000' && origin && origin !== 'null') {
      urls.unshift(`${origin}${path}`);
    }
    urls.push(`http://localhost:3000${path}`);
    urls.push(`http://127.0.0.1:3000${path}`);
  }

  return [...new Set(urls)];
}

const ZedAI = {
  _apiUrls: [],
  _apiUrl: null,

  _initUrls() {
    const base = typeof ZED_API_BASE !== 'undefined' ? ZED_API_BASE : null;
    const path = '/api/anthropic';

    if (base) {
      // Use custom base URL exclusively
      this._apiUrls = [`${base}${path}`];
      console.log(`🔧 Using custom API endpoint: ${this._apiUrls[0]}`);
    } else {
      // Fallback to auto-detection (original logic)
      this._apiUrls = zedCandidateApiUrls(path);
      console.log('🔍 Auto-detected API endpoints:', this._apiUrls);
    }
  },

  async _post(body) {
    if (this._apiUrls.length === 0) this._initUrls();

    let lastError = null;
    for (const url of this._apiUrls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));

        // Log response for debugging (remove in production)
        console.log(`Response from ${url}:`, { status: res.status, data });

        if (!res.ok) {
          const errorMsg = data?.error?.message || data?.error || data?.message || `API error ${res.status}`;
          lastError = new Error(`API error: ${errorMsg}`);
          continue;
        }

        this._apiUrl = url;
        return data;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(lastError?.message || 'Failed to fetch from Zed backend.');
  },

  // Standard chat completion (text only) — Anthropic format
  async chat(messages, opts = {}) {
    const aiMessages = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

    const body = {
      // Use a valid Anthropic model (update if you have a different one)
      model: opts.model || 'claude-sonnet-4-5-20250929',
      max_tokens: opts.max_tokens || 1000,
      messages: aiMessages,
      temperature: 0.7,
      ...(opts.system && { system: opts.system })
    };

    const data = await this._post(body);
    // Anthropic response format: content[0].text
    return data.content?.[0]?.text || '';
  },

  // Vision + text analysis (image as base64) — Anthropic format
  async analyzeImage(base64, mimeType, prompt) {
    const content = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: base64
        }
      },
      {
        type: 'text',
        text: prompt
      }
    ];

    const body = {
      model: 'claude-sonnet-4-5-20250929', // valid model
      messages: [
        { role: 'user', content }
      ],
      max_tokens: 1400
    };

    const data = await this._post(body);
    return data.content?.[0]?.text || '';
  },

  // Simple connection test
  async testConnection() {
    try {
      const result = await this.chat([
        { role: 'user', content: 'Say "API connection successful" if you receive this.' }
      ], { max_tokens: 20 });
      return { success: true, message: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

// ── 13. TOAST (queued — toasts never overlap) ────────────────────
const _toastQ  = [];
let _toastBusy = false;

function zedToast(msg, type = 'success', duration = 3400) {
  _toastQ.push({ msg, type, duration });
  if (!_toastBusy) _runToast();
}

function _runToast() {
  if (!_toastQ.length) { _toastBusy = false; return; }
  _toastBusy = true;
  const { msg, type, duration } = _toastQ.shift();

  let el = document.getElementById('zed-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'zed-toast';
    el.style.cssText =
      'position:fixed;bottom:1.75rem;left:50%;transform:translateX(-50%) translateY(28px);' +
      'z-index:9999;padding:.85rem 1.4rem;border-radius:14px;font-size:.9rem;' +
      "font-family:'DM Sans',sans-serif;font-weight:500;" +
      'display:flex;align-items:center;gap:.6rem;' +
      'backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);' +
      'opacity:0;transition:opacity .3s ease,transform .3s ease;' +
      'pointer-events:none;max-width:calc(100vw - 2.5rem);' +
      'white-space:nowrap;box-shadow:0 10px 40px rgba(0,0,0,.4);';
    document.body.appendChild(el);
  }

  const MAP = {
    success: { bg:'rgba(0,212,160,.16)',  bc:'rgba(0,212,160,.38)',  c:'#00d4a0', i:'✓' },
    error:   { bg:'rgba(255,92,122,.16)', bc:'rgba(255,92,122,.38)', c:'#ff5c7a', i:'✕' },
    warn:    { bg:'rgba(255,170,68,.16)', bc:'rgba(255,170,68,.35)', c:'#ffaa44', i:'⚠' },
    info:    { bg:'rgba(0,180,166,.16)',  bc:'rgba(0,180,166,.32)',  c:'#00d4c4', i:'ℹ' }
  };
  const s = MAP[type] || MAP.success;
  el.style.background = s.bg;
  el.style.border     = `1.5px solid ${s.bc}`;
  el.style.color      = s.c;
  el.innerHTML = `<span style="font-size:1.05rem;flex-shrink:0">${s.i}</span>`
               + `<span style="overflow:hidden;text-overflow:ellipsis">${msg}</span>`;

  requestAnimationFrame(() => {
    el.style.opacity   = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });

  setTimeout(() => {
    el.style.opacity   = '0';
    el.style.transform = 'translateX(-50%) translateY(14px)';
    setTimeout(_runToast, 340);
  }, duration);
}

// ── 14. LOADER ──────────────────────────────────────────────────
function zedHideLoader(delay = 1200) {
  const hide = () => setTimeout(() => {
    const l = document.getElementById('loader');
    if (l) l.classList.add('hide');
  }, delay);
  document.readyState === 'complete' ? hide() : window.addEventListener('load', hide);
}

// ── 15. MOBILE SIDEBAR TOGGLE ───────────────────────────────────
function zedMobileNav() {
  const sb = document.querySelector('.sidebar');
  const ov = document.getElementById('nav-overlay');
  if (!sb) return;
  const open = sb.classList.toggle('open');
  if (ov) { ov.style.display = open ? 'block' : 'none'; if (open) ov.onclick = zedMobileNav; }
  document.body.style.overflow = open ? 'hidden' : '';
}

// ── 16. AUTO-HIGHLIGHT ACTIVE NAV LINK ──────────────────────────
(function () {
  const page = window.location.pathname.split('/').pop() || 'dashboard.html';
  document.querySelectorAll('.nav-item').forEach(el => {
    const href = el.getAttribute('href') || '';
    if (href && href.split('/').pop() === page) el.classList.add('active');
  });
})();

// ── 17. RELATIVE TIME HELPER ────────────────────────────────────
function zedRelTime(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60)     return 'just now';
  if (s < 3600)   return Math.floor(s / 60) + 'm ago';
  if (s < 86400)  return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── 18. HEALTH SCORE ────────────────────────────────────────────
function zedHealthScore(p) {
  if (!p) return null;
  let s = 52;
  if (p.age) { s += p.age < 35 ? 10 : p.age < 50 ? 6 : 2; }
  if (p.smoking === 'Non-smoker')     s += 10;
  else if (p.smoking === 'Ex-smoker') s += 5;
  if (/daily|4x|5x/i.test(p.exercise  || '')) s += 10;
  else if (/3x|3-4/i.test(p.exercise  || '')) s += 7;
  else if (/1-2|1x|2x/i.test(p.exercise|| '')) s += 3;
  if (!p.conditions || /^none$/i.test(p.conditions.trim())) s += 8;
  if (p.alcohol === 'None')            s += 5;
  else if (p.alcohol === 'Occasionally') s += 3;
  if (p.weight && p.height) {
    const bmi = p.weight / Math.pow(p.height / 100, 2);
    if (bmi >= 18.5 && bmi < 25) s += 5;
  }
  if (p.ec_name) s += 2;
  return Math.min(Math.max(s, 20), 99);
}

// ── 19. VITALS ASSESSMENT HELPERS ───────────────────────────────
const ZedVitalRanges = {
  heartRate(bpm) {
    if (bpm < 40)        return { status:'high',   label:'Dangerously low', color:'var(--error)' };
    if (bpm < 60)        return { status:'warn',   label:'Below normal',   color:'var(--warn)'  };
    if (bpm <= 100)      return { status:'ok',     label:'Normal',         color:'var(--success)'};
    if (bpm <= 120)      return { status:'warn',   label:'Elevated',       color:'var(--warn)'  };
    return               { status:'high',   label:'High — seek care', color:'var(--error)' };
  },
  bloodPressure(sys, dia) {
    if (sys < 90 || dia < 60) return { status:'warn',  label:'Low BP',       color:'var(--warn)'  };
    if (sys < 120 && dia < 80) return { status:'ok',   label:'Optimal',      color:'var(--success)'};
    if (sys < 130)             return { status:'ok',   label:'Normal',       color:'var(--success)'};
    if (sys < 140 || dia < 90) return { status:'warn', label:'Elevated',     color:'var(--warn)'  };
    return                     { status:'high', label:'High — monitor', color:'var(--error)' };
  },
  temperature(f) {
    if (f < 96)   return { status:'high', label:'Hypothermia risk', color:'var(--error)' };
    if (f < 97.6) return { status:'warn', label:'Below normal',     color:'var(--warn)'  };
    if (f <= 99)  return { status:'ok',   label:'Normal',           color:'var(--success)'};
    if (f <= 100.4) return { status:'warn', label:'Low-grade fever', color:'var(--warn)'  };
    return          { status:'high', label:'Fever',            color:'var(--error)' };
  },
  spo2(pct) {
    if (pct >= 96) return { status:'ok',   label:'Excellent',   color:'var(--success)'};
    if (pct >= 94) return { status:'warn', label:'Low normal',  color:'var(--warn)'  };
    if (pct >= 90) return { status:'warn', label:'Low — rest',  color:'var(--warn)'  };
    return          { status:'high', label:'Critical',     color:'var(--error)' };
  }
};

// ── 20. SUBSCRIPTION MANAGEMENT ─────────────────────────────
const ZedSubscription = {
  _cache: null,
  _cacheExpiry: 0,

  async getStatus(force = false) {
    const now = Date.now();
    if (!force && this._cache && now < this._cacheExpiry) {
      return this._cache;
    }

    try {
      const response = await fetch('/api/subscription/status');
      const data = await response.json();

      if (response.ok) {
        this._cache = data;
        this._cacheExpiry = now + (5 * 60 * 1000); // Cache for 5 minutes
        return data;
      }
    } catch (error) {
      console.warn('Subscription status check failed:', error);
    }

    return { hasActiveSubscription: false, plan: null, status: null };
  },

  async hasFeature(featureKey) {
    const status = await this.getStatus();

    if (!status.hasActiveSubscription) {
      // Check if it's a free feature
      return ['symptom_checker_basic', 'ai_chat_limited', 'vitals_basic', 'emergency_basic'].includes(featureKey);
    }

    // Define features by plan
    const planFeatures = {
      basic: [
        'symptom_checker_basic', 'ai_chat_limited', 'vitals_basic', 'emergency_basic'
      ],
      premium: [
        'symptom_checker_unlimited', 'ai_chat_unlimited', 'vitals_advanced',
        'emergency_priority', 'health_coaching', 'family_basic'
      ],
      family: [
        'symptom_checker_unlimited', 'ai_chat_unlimited', 'vitals_advanced',
        'emergency_priority', 'health_coaching', 'family_full', 'health_history',
        'bulk_booking'
      ]
    };

    return planFeatures[status.plan]?.includes(featureKey) || false;
  },

  async checkFeatureAccess(featureKey, showUpgrade = true) {
    const hasAccess = await this.hasFeature(featureKey);

    if (!hasAccess && showUpgrade) {
      this.showUpgradePrompt(featureKey);
    }

    return hasAccess;
  },

  showUpgradePrompt(featureKey) {
    const featureNames = {
      'symptom_checker_unlimited': 'Unlimited Symptom Analysis',
      'ai_chat_unlimited': 'Unlimited AI Medical Assistant',
      'vitals_advanced': 'Advanced Vitals Analytics',
      'emergency_priority': 'Priority Emergency Response',
      'health_coaching': 'Personalized Health Coaching',
      'family_full': 'Family Health Management'
    };

    const featureName = featureNames[featureKey] || 'Premium Feature';

    // Create upgrade modal
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.8); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      padding: 1rem;
    `;

    modal.innerHTML = `
      <div style="
        background: var(--card); border: 2px solid var(--teal);
        border-radius: 20px; padding: 2rem; max-width: 400px;
        text-align: center; position: relative;
      ">
        <button onclick="this.closest('div').parentElement.remove()"
          style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.5rem; cursor: pointer;">×</button>

        <div style="font-size: 3rem; margin-bottom: 1rem;">🔓</div>
        <h3 style="color: var(--teal); margin-bottom: 1rem;">Unlock ${featureName}</h3>
        <p style="margin-bottom: 2rem; color: rgba(255,255,255,0.7);">
          Upgrade to Premium to access this advanced feature and many more health insights.
        </p>

        <div style="display: flex; gap: 1rem; justify-content: center;">
          <button onclick="window.location.href='subscription.html'"
            style="background: var(--teal); color: #000; border: none; padding: 0.8rem 1.5rem; border-radius: 10px; cursor: pointer; font-weight: 600;">
            View Plans
          </button>
          <button onclick="this.closest('div').parentElement.remove()"
            style="background: transparent; color: var(--teal); border: 2px solid var(--teal); padding: 0.8rem 1.5rem; border-radius: 10px; cursor: pointer;">
            Maybe Later
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  },

  async trackUsage(featureKey) {
    // Track feature usage for analytics
    const user = await ZedAuth.getUser();
    if (user?.id) {
      ZedActivity.track('feature_used', `Used ${featureKey}`, { feature: featureKey }, user.id);
    }
  }
};

// Track one page-view event per page load.
setTimeout(() => {
  ZedActivity.trackPageView().catch(() => {});
}, 0);
