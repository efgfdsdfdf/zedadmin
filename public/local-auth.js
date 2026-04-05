// Local authentication fallback for development
// This provides basic auth functionality when Supabase is not available

class LocalAuth {
  constructor() {
    this.currentUser = null;
    this.storageKey = 'zed-local-auth';
    this.loadAuth();
  }

  loadAuth() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        this.currentUser = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load local auth:', e);
    }
  }

  saveAuth() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.currentUser));
    } catch (e) {
      console.warn('Failed to save local auth:', e);
    }
  }

  async getUser() {
    return this.currentUser;
  }

  async requireAuth() {
    const user = await this.getUser();
    if (!user) {
      window.location.href = 'login.html';
      return null;
    }
    return user;
  }

  async signIn(email, password) {
    // Simulate authentication
    const users = JSON.parse(localStorage.getItem('zed-users') || '{}');
    
    if (!users[email]) {
      return { error: { message: 'Invalid login credentials' } };
    }

    if (users[email].password !== password) {
      return { error: { message: 'Invalid login credentials' } };
    }

    this.currentUser = {
      id: users[email].id,
      email: email,
      user_metadata: {
        first_name: users[email].first_name,
        last_name: users[email].last_name
      }
    };

    this.saveAuth();
    return { data: { user: this.currentUser } };
  }

  async signUp(email, password, meta = {}) {
    const users = JSON.parse(localStorage.getItem('zed-users') || '{}');
    
    if (users[email]) {
      return { error: { message: 'Email already registered' } };
    }

    const newUser = {
      id: this.generateId(),
      email: email,
      password: password,
      first_name: meta.first_name || '',
      last_name: meta.last_name || '',
      created_at: new Date().toISOString()
    };

    users[email] = newUser;
    localStorage.setItem('zed-users', JSON.stringify(users));

    this.currentUser = {
      id: newUser.id,
      email: email,
      user_metadata: {
        first_name: newUser.first_name,
        last_name: newUser.last_name
      }
    };

    this.saveAuth();
    return { data: { user: this.currentUser } };
  }

  async signOut() {
    this.currentUser = null;
    localStorage.removeItem(this.storageKey);
    window.location.href = 'login.html';
  }

  async oAuth(provider) {
    return { error: { message: 'OAuth not available in local mode' } };
  }

  async resetPassword(email) {
    return { error: { message: 'Password reset not available in local mode' } };
  }

  async updatePassword(newPassword) {
    if (!this.currentUser) {
      return { error: { message: 'No user logged in' } };
    }

    const users = JSON.parse(localStorage.getItem('zed-users') || '{}');
    if (users[this.currentUser.email]) {
      users[this.currentUser.email].password = newPassword;
      localStorage.setItem('zed-users', JSON.stringify(users));
      return { data: { user: this.currentUser } };
    }

    return { error: { message: 'User not found' } };
  }

  onAuthChange(callback) {
    // Simulate auth state changes
    setTimeout(() => {
      callback('SIGNED_IN', this.currentUser);
    }, 100);
    return () => {};
  }

  generateId() {
    return 'local-' + Math.random().toString(36).substr(2, 9);
  }
}

// Local data storage for development
class LocalData {
  constructor() {
    this.storagePrefix = 'zed-local-';
  }

  async get(table, userId) {
    const data = this.loadTable(table);
    const result = data.find(item => item.user_id === userId);
    return { data: result || null, error: null };
  }

  async upsert(table, record) {
    const data = this.loadTable(table);
    const existingIndex = data.findIndex(item => item.id === record.id);
    
    if (existingIndex >= 0) {
      data[existingIndex] = { ...data[existingIndex], ...record };
    } else {
      record.id = this.generateId();
      data.push(record);
    }

    this.saveTable(table, data);
    return { data: record, error: null };
  }

  async insert(table, record) {
    const data = this.loadTable(table);
    record.id = this.generateId();
    record.created_at = new Date().toISOString();
    data.push(record);
    this.saveTable(table, data);
    return { data: record, error: null };
  }

  async select(table, userId, options = {}) {
    let data = this.loadTable(table);
    
    if (userId) {
      data = data.filter(item => item.user_id === userId);
    }

    if (options.order) {
      data.sort((a, b) => {
        const field = options.order.field;
        const direction = options.order.ascending ? 1 : -1;
        return (a[field] > b[field] ? 1 : -1) * direction;
      });
    }

    if (options.limit) {
      data = data.slice(0, options.limit);
    }

    return { data: data, error: null };
  }

  loadTable(table) {
    try {
      const saved = localStorage.getItem(this.storagePrefix + table);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  }

  saveTable(table, data) {
    try {
      localStorage.setItem(this.storagePrefix + table, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save table:', table, e);
    }
  }

  generateId() {
    return 'local-' + Math.random().toString(36).substr(2, 9);
  }
}

// Create local instances
const localAuth = new LocalAuth();
const localData = new LocalData();

// Export for use in zed-core.js
window.LocalAuth = localAuth;
window.LocalData = localData;

console.log('🔧 Local authentication fallback loaded');
console.log('⚠️  This is for development only - Supabase is not available');