// ═══════════════════════════════════════════════
//  TELOCONSIGO + TOP SHOP — Panel de Control
//  v4 — con login y administración de usuarios
// ═══════════════════════════════════════════════

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;


// ═══════════════════════════════════════════════
//  ESTADOS PERSISTENTES DE BANDEJA
//  Guarda leído/no leído, pendientes, descartados y reclamos en JSON.
// ═══════════════════════════════════════════════
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'inbox-state.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit-log.json');
const ADS_CACHE_FILE = path.join(DATA_DIR, 'meli-ads-cache.json');

const MODULES = {
  meliads: { label: 'MeLi ADS', pages: ['/meliads.html'], api: ['/api/meli', '/api/chat'] },
  inbox: { label: 'Bandeja MeLi', pages: ['/inbox.html'], api: ['/api/inbox', '/api/state'] },
  prices: { label: 'Lista de Precios', pages: ['/precios.html'], api: ['/api/precios'] },
  publications: { label: 'Crear Publicaciones', pages: ['/publicaciones.html'], api: [] },
  analytics: { label: 'Analytics General', pages: ['/analytics.html'], api: [] },
  automation: { label: 'Alertas & Automatización', pages: ['/automatizacion.html'], api: [] },
  config: { label: 'Configuración', pages: ['/configuracion.html'], api: [] },
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultInboxState() {
  return {
    messages: {},
    claims: {},
    questions: {},
    updatedAt: new Date().toISOString(),
  };
}

function loadInboxState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) {
    const initial = defaultInboxState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      ...defaultInboxState(),
      ...data,
      messages: data.messages || {},
      claims: data.claims || {},
      questions: data.questions || {},
    };
  } catch (e) {
    const backup = STATE_FILE + '.broken-' + Date.now();
    try { fs.copyFileSync(STATE_FILE, backup); } catch {}
    const initial = defaultInboxState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}

function saveInboxState(data) {
  ensureDataDir();
  const clean = {
    messages: data.messages || {},
    claims: data.claims || {},
    questions: data.questions || {},
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(clean, null, 2));
  return clean;
}

function loadAuditLog() {
  ensureDataDir();
  if (!fs.existsSync(AUDIT_FILE)) {
    fs.writeFileSync(AUDIT_FILE, JSON.stringify({ actions: [] }, null, 2));
    return { actions: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
    return { actions: Array.isArray(data.actions) ? data.actions : [] };
  } catch {
    return { actions: [] };
  }
}

function saveAuditLog(data) {
  ensureDataDir();
  const actions = (data.actions || []).slice(-1000);
  fs.writeFileSync(AUDIT_FILE, JSON.stringify({ actions }, null, 2));
}

function audit(session, action, detail = {}) {
  try {
    const data = loadAuditLog();
    data.actions.push({
      id: crypto.randomBytes(8).toString('hex'),
      at: new Date().toISOString(),
      user: session?.username || 'system',
      name: session?.name || '',
      role: session?.role || '',
      action,
      detail,
    });
    saveAuditLog(data);
  } catch (e) {
    console.error('Error guardando auditoria:', e.message);
  }
}

function normalizePermissions(user) {
  if (!user) return [];
  if (user.role === 'admin') return ['all'];
  if (Array.isArray(user.permissions) && user.permissions.length) return user.permissions;
  // Compatibilidad con usuarios viejos: hasta que el admin los limite, entran a todo.
  return Object.keys(MODULES);
}

function hasPermission(session, moduleKey) {
  if (!session) return false;
  if (session.role === 'admin') return true;
  const perms = normalizePermissions(session);
  return perms.includes('all') || perms.includes(moduleKey);
}

function moduleForPath(pathName) {
  for (const [key, cfg] of Object.entries(MODULES)) {
    if ((cfg.pages || []).includes(pathName) || (cfg.api || []).includes(pathName)) return key;
  }
  return null;
}

function publicUser(user) {
  return {
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChange: !!user.mustChange,
    createdAt: user.createdAt,
    permissions: normalizePermissions(user),
  };
}

function cleanExpiredInboxState(data) {
  const now = Date.now();
  let changed = false;
  for (const [key, st] of Object.entries(data.messages || {})) {
    if (!st || !st.dismissedUntil) continue;
    const until = new Date(st.dismissedUntil).getTime();
    if (Number.isNaN(until) || now >= until) {
      delete data.messages[key];
      changed = true;
    }
  }
  if (changed) saveInboxState(data);
  return data;
}


// Webhooks de n8n (uno por cuenta)
const WEBHOOKS = {
  tlc:     'https://teloconsigo.app.n8n.cloud/webhook/meli-ads-live',
  topshop: 'https://teloconsigo.app.n8n.cloud/webhook/meli-ads-topshop',
};

// Webhooks de n8n: INBOX (preguntas, mensajes y reclamos)
const INBOX_WEBHOOKS = {
  tlc:     'https://teloconsigo.app.n8n.cloud/webhook/meli-inbox-tlc',
  topshop: 'https://teloconsigo.app.n8n.cloud/webhook/meli-inbox-topshop',
};

// Cache persistente simple para MeLi Ads.
// En Railway esto mantiene los datos durante la vida del deploy y evita que el panel quede vacío
// si n8n tarda, devuelve vacío o falla momentáneamente.
function defaultAdsCache() {
  return {
    tlc: { campaigns: [], ads: {}, orders: [], totalSales: 0, totalOrdersCount: 0, sellerId: null, metricsSummary: null, dateFrom: null, dateTo: null, updatedAt: null },
    topshop: { campaigns: [], ads: {}, orders: [], totalSales: 0, totalOrdersCount: 0, sellerId: null, metricsSummary: null, dateFrom: null, dateTo: null, updatedAt: null },
  };
}

function loadAdsCache() {
  ensureDataDir();
  if (!fs.existsSync(ADS_CACHE_FILE)) {
    const initial = defaultAdsCache();
    fs.writeFileSync(ADS_CACHE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(ADS_CACHE_FILE, 'utf8'));
    const base = defaultAdsCache();
    return {
      tlc: { ...base.tlc, ...(raw.tlc || {}) },
      topshop: { ...base.topshop, ...(raw.topshop || {}) },
    };
  } catch (e) {
    const backup = ADS_CACHE_FILE + '.broken-' + Date.now();
    try { fs.copyFileSync(ADS_CACHE_FILE, backup); } catch {}
    const initial = defaultAdsCache();
    fs.writeFileSync(ADS_CACHE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}

function saveAdsCache(cache) {
  ensureDataDir();
  fs.writeFileSync(ADS_CACHE_FILE, JSON.stringify(cache, null, 2));
}

function asArrayResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.body?.results)) return data.body.results;
  if (Array.isArray(data?.data?.results)) return data.data.results;
  if (Array.isArray(data?.body)) return data.body;
  return [];
}

function getMetricsSummary(data) {
  return data?.metrics_summary || data?.body?.metrics_summary || data?.data?.metrics_summary || null;
}

function getPagingTotal(data) {
  return Number(data?.paging?.total ?? data?.body?.paging?.total ?? data?.data?.paging?.total ?? 0);
}

function updateAdsCacheFromResponse(cuenta, action, params, data) {
  try {
    const cache = loadAdsCache();
    const c = cache[cuenta] || cache.tlc;
    const results = asArrayResponse(data);
    const now = new Date().toISOString();

    c.dateFrom = params.date_from || c.dateFrom;
    c.dateTo = params.date_to || c.dateTo;
    c.updatedAt = now;

    if (action === 'campaigns') {
      // No pisar cache bueno con una respuesta vacía ocasional.
      if (results.length) {
        c.campaigns = results;
        c.metricsSummary = getMetricsSummary(data);
      }
    } else if (action === 'ads') {
      const campaignId = params.campaign_id;
      if (campaignId) {
        c.ads = c.ads || {};
        c.ads[String(campaignId)] = results;
      }
    } else if (action === 'orders') {
      if (results.length) {
        const paid = results.filter(o => !o.status || o.status === 'paid');
        const previous = Array.isArray(c.orders) ? c.orders : [];
        const byId = new Map(previous.map(o => [String(o.id || o.order_id || JSON.stringify(o).slice(0,80)), o]));
        paid.forEach(o => byId.set(String(o.id || o.order_id || JSON.stringify(o).slice(0,80)), o));
        c.orders = Array.from(byId.values());
        c.totalSales = c.orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
        c.totalOrdersCount = Math.max(getPagingTotal(data), c.orders.length);
      }
    } else if (action === 'user') {
      const sellerId = data?.id || data?.body?.id || data?.data?.id;
      if (sellerId) c.sellerId = sellerId;
    }

    cache[cuenta] = c;
    saveAdsCache(cache);
  } catch (e) {
    console.error('No se pudo actualizar cache MeLi Ads:', e.message);
  }
}

function cachedMeliResponse(cuenta) {
  const cache = loadAdsCache();
  return { ok: true, cached: true, cuenta, ...(cache[cuenta] || defaultAdsCache()[cuenta]) };
}


// ═══════════════════════════════════════════════
//  USUARIOS
// ═══════════════════════════════════════════════
const USERS_FILE = path.join(__dirname, 'users.json');

function hashPassword(pw, salt) {
  return crypto.pbkdf2Sync(pw, salt, 10000, 64, 'sha512').toString('hex');
}

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    // Primera vez: crea admin con contraseña por defecto
    const salt = crypto.randomBytes(16).toString('hex');
    const initial = {
      users: [
        {
          username: 'admin',
          name: 'Administrador',
          email: 'admin@teloconsigo.com.uy',
          role: 'admin',
          salt: salt,
          hash: hashPassword('admin1234', salt),
          mustChange: true,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    fs.writeFileSync(USERS_FILE, JSON.stringify(initial, null, 2));
    console.log('');
    console.log('  ⚠️  Se creó el usuario admin por primera vez');
    console.log('  Usuario: admin');
    console.log('  Contraseña: admin1234');
    console.log('  CAMBIALA AL PRIMER LOGIN');
    console.log('');
    return initial;
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function findUser(username) {
  const data = loadUsers();
  return data.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
}

function checkPassword(username, pw) {
  const u = findUser(username);
  if (!u) return null;
  const computed = hashPassword(pw, u.salt);
  if (computed === u.hash) return u;
  return null;
}

// ═══════════════════════════════════════════════
//  SESIONES (en memoria, se pierden al reiniciar)
// ═══════════════════════════════════════════════
const SESSIONS = new Map(); // token → { username, role, createdAt }
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  SESSIONS.set(token, {
    username: user.username,
    name: user.name,
    role: user.role,
    permissions: normalizePermissions(user),
    createdAt: Date.now(),
  });
  return token;
}

function validateSession(token) {
  if (!token) return null;
  const s = SESSIONS.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_DURATION_MS) {
    SESSIONS.delete(token);
    return null;
  }
  return s;
}

function getCookieToken(req) {
  const cookies = req.headers.cookie || '';
  const m = cookies.match(/auth=([a-f0-9]{64})/);
  return m ? m[1] : null;
}

// ═══════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════
function jsonResp(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type':                'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'*',
    ...extraHeaders,
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
  });
}

// ═══════════════════════════════════════════════
//  SERVIDOR
// ═══════════════════════════════════════════════
const server = http.createServer((req, res) => {

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }

  const u = new URL(req.url, `http://localhost:${PORT}`);
  const pathName = u.pathname;
  // LOGIN ACTIVO:
  // Solo entra quien tenga una sesión válida creada por /api/login.
  const session = validateSession(getCookieToken(req));

  // ───────────────────────────────────────────────
  //  RUTAS PÚBLICAS (sin login)
  // ───────────────────────────────────────────────


  // HEALTH CHECK para verificar deploy activo
  if (pathName === '/api/health') {
    jsonResp(res, 200, {
      ok: true,
      service: 'tlc-panel-control',
      login: 'activo',
      chat: 'api_chat_activo',
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'
    });
    return;
  }

  // PING
  if (pathName === '/api/ping') {
    jsonResp(res, 200, { ok: true });
    return;
  }

  // LOGIN
  if (req.method === 'POST' && pathName === '/api/login') {
    (async () => {
      const body = await readBody(req);
      const { username, password } = body;
      const user = checkPassword(username, password);
      if (!user) {
        jsonResp(res, 401, { error: 'Usuario o contraseña incorrectos' });
        return;
      }
      const token = createSession(user);
      audit({ username: user.username, name: user.name, role: user.role }, 'login', { ok: true });
      jsonResp(res, 200, {
        ok: true,
        user: publicUser(user),
      }, {
        'Set-Cookie': `auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7*24*60*60}`,
      });
    })();
    return;
  }

  // LOGOUT
  if (req.method === 'POST' && pathName === '/api/logout') {
    const token = getCookieToken(req);
    if (session) audit(session, 'logout', {});
    if (token) SESSIONS.delete(token);
    jsonResp(res, 200, { ok: true }, {
      'Set-Cookie': 'auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    });
    return;
  }

  // CHECK SESIÓN ACTUAL
  if (pathName === '/api/me') {
    if (!session) { jsonResp(res, 401, { error: 'No autenticado' }); return; }
    jsonResp(res, 200, { user: session });
    return;
  }

  // PANTALLA DE LOGIN
  if (pathName === '/login.html' || pathName === '/login') {
    serveStatic(res, 'login.html');
    return;
  }

  // ───────────────────────────────────────────────
  //  TODO LO DE ABAJO REQUIERE LOGIN
  // ───────────────────────────────────────────────
  if (!session) {
    // Si pide HTML o es la raíz → redirigir a login
    if (pathName === '/' || pathName.endsWith('.html')) {
      res.writeHead(302, { 'Location': '/login.html' });
      res.end();
      return;
    }
    // Si pide API → 401
    jsonResp(res, 401, { error: 'No autenticado' });
    return;
  }


  const requestedModule = moduleForPath(pathName);
  if (requestedModule && !hasPermission(session, requestedModule)) {
    if (pathName.endsWith('.html')) {
      res.writeHead(302, { 'Location': '/index.html' });
      res.end();
      return;
    }
    jsonResp(res, 403, { error: 'No tenés permiso para acceder a este módulo' });
    return;
  }

  // ── ESTADOS PERSISTENTES DE BANDEJA ───────────────────
  if (pathName === '/api/state') {
    if (req.method === 'GET') {
      const data = cleanExpiredInboxState(loadInboxState());
      jsonResp(res, 200, data);
      return;
    }
    if (req.method === 'POST') {
      (async () => {
        const body = await readBody(req);
        const data = loadInboxState();
        const section = ['messages', 'claims', 'questions'].includes(body.section) ? body.section : null;
        const key = String(body.key || '');
        if (!section || !key) {
          jsonResp(res, 400, { error: 'Falta section o key' });
          return;
        }
        const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
        if (body.replace === true) {
          data[section][key] = patch;
        } else {
          data[section][key] = {
            ...(data[section][key] || {}),
            ...patch,
            updatedAt: new Date().toISOString(),
            updatedBy: session.username,
            updatedByName: session.name || session.username,
          };
        }
        if (body.removeFields && Array.isArray(body.removeFields)) {
          for (const f of body.removeFields) delete data[section][key][f];
        }
        if (body.delete === true) {
          delete data[section][key];
        }
        const saved = cleanExpiredInboxState(saveInboxState(data));
        audit(session, 'inbox_state_update', { section, key, actionLabel: patch.actionLabel || '', item: patch.item_id || patch.question_id || patch._packId || patch._id || '', delete: body.delete === true, removeFields: body.removeFields || [] });
        jsonResp(res, 200, { ok: true, state: saved[section][key] || null });
      })();
      return;
    }
  }

  // ── CAMBIAR CONTRASEÑA PROPIA ───────────────────
  if (req.method === 'POST' && pathName === '/api/change-password') {
    (async () => {
      const body = await readBody(req);
      const { currentPassword, newPassword } = body;
      if (!newPassword || newPassword.length < 6) {
        jsonResp(res, 400, { error: 'La nueva contraseña debe tener al menos 6 caracteres' });
        return;
      }
      const user = checkPassword(session.username, currentPassword);
      if (!user) {
        jsonResp(res, 401, { error: 'Contraseña actual incorrecta' });
        return;
      }
      const data = loadUsers();
      const idx = data.users.findIndex(x => x.username === session.username);
      const newSalt = crypto.randomBytes(16).toString('hex');
      data.users[idx].salt = newSalt;
      data.users[idx].hash = hashPassword(newPassword, newSalt);
      data.users[idx].mustChange = false;
      saveUsers(data);
      jsonResp(res, 200, { ok: true });
    })();
    return;
  }

  // ── ADMIN: LISTAR USUARIOS ───────────────────
  if (pathName === '/api/admin/users') {
    if (session.role !== 'admin') { jsonResp(res, 403, { error: 'No autorizado' }); return; }
    const data = loadUsers();
    const safe = data.users.map(publicUser);
    jsonResp(res, 200, { users: safe });
    return;
  }

  // ── ADMIN: CREAR USUARIO ───────────────────
  if (req.method === 'POST' && pathName === '/api/admin/create-user') {
    if (session.role !== 'admin') { jsonResp(res, 403, { error: 'No autorizado' }); return; }
    (async () => {
      const body = await readBody(req);
      const { username, name, email, password, role } = body;
      const permissions = Array.isArray(body.permissions) ? body.permissions.filter(p => MODULES[p]) : Object.keys(MODULES);
      if (!username || !name || !password) {
        jsonResp(res, 400, { error: 'Faltan datos (usuario, nombre, contraseña)' });
        return;
      }
      if (password.length < 6) {
        jsonResp(res, 400, { error: 'La contraseña debe tener al menos 6 caracteres' });
        return;
      }
      const data = loadUsers();
      if (data.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        jsonResp(res, 400, { error: 'Ya existe un usuario con ese nombre' });
        return;
      }
      const salt = crypto.randomBytes(16).toString('hex');
      data.users.push({
        username, name, email: email || '',
        role: role === 'admin' ? 'admin' : 'user',
        permissions: role === 'admin' ? ['all'] : permissions,
        salt, hash: hashPassword(password, salt),
        mustChange: true,
        createdAt: new Date().toISOString(),
      });
      saveUsers(data);
      audit(session, 'admin_create_user', { username, role: role === 'admin' ? 'admin' : 'user', permissions });
      jsonResp(res, 200, { ok: true });
    })();
    return;
  }

  // ── ADMIN: RESETEAR CONTRASEÑA DE OTRO USUARIO ───────────────────
  if (req.method === 'POST' && pathName === '/api/admin/reset-password') {
    if (session.role !== 'admin') { jsonResp(res, 403, { error: 'No autorizado' }); return; }
    (async () => {
      const body = await readBody(req);
      const { username, newPassword } = body;
      if (!username || !newPassword || newPassword.length < 6) {
        jsonResp(res, 400, { error: 'Datos inválidos (mínimo 6 caracteres)' });
        return;
      }
      const data = loadUsers();
      const idx = data.users.findIndex(u => u.username === username);
      if (idx < 0) { jsonResp(res, 404, { error: 'Usuario no encontrado' }); return; }
      const salt = crypto.randomBytes(16).toString('hex');
      data.users[idx].salt = salt;
      data.users[idx].hash = hashPassword(newPassword, salt);
      data.users[idx].mustChange = true;
      saveUsers(data);
      audit(session, 'admin_reset_password', { username });
      jsonResp(res, 200, { ok: true });
    })();
    return;
  }

  // ── ADMIN: EDITAR DATOS DE USUARIO ───────────────────
  if (req.method === 'POST' && pathName === '/api/admin/update-user') {
    if (session.role !== 'admin') { jsonResp(res, 403, { error: 'No autorizado' }); return; }
    (async () => {
      const body = await readBody(req);
      const { username, newUsername, name, email, role } = body;
      const permissions = Array.isArray(body.permissions) ? body.permissions.filter(p => MODULES[p]) : null;
      if (!username) { jsonResp(res, 400, { error: 'Falta username' }); return; }

      const data = loadUsers();
      const idx = data.users.findIndex(u => u.username === username);
      if (idx < 0) { jsonResp(res, 404, { error: 'Usuario no encontrado' }); return; }

      // Si quiere cambiar el username, validar que no exista
      if (newUsername && newUsername !== username) {
        if (data.users.some(u => u.username.toLowerCase() === newUsername.toLowerCase())) {
          jsonResp(res, 400, { error: 'Ya existe un usuario con ese nombre' });
          return;
        }
        data.users[idx].username = newUsername;
        // Si el usuario está cambiando su propio nombre, actualizar la sesión activa
        if (username === session.username) {
          for (const [token, s] of SESSIONS.entries()) {
            if (s.username === username) {
              s.username = newUsername;
              s.name = name || s.name;
            }
          }
        }
      }
      if (name !== undefined) data.users[idx].name = name;
      if (email !== undefined) data.users[idx].email = email;
      if (permissions) data.users[idx].permissions = permissions;
      if (role) {
        // Validar que no se quede sin admins
        const newRole = role === 'admin' ? 'admin' : 'user';
        if (data.users[idx].role === 'admin' && newRole === 'user') {
          const otherAdmins = data.users.filter((u, i) => i !== idx && u.role === 'admin').length;
          if (otherAdmins === 0) {
            jsonResp(res, 400, { error: 'No podés quitarle el rol admin: es el único administrador' });
            return;
          }
        }
        data.users[idx].role = newRole;
        // Actualizar rol en sesión activa si está logueado
        for (const [token, s] of SESSIONS.entries()) {
          if (s.username === (newUsername || username)) {
            s.role = newRole;
              s.permissions = newRole === 'admin' ? ['all'] : normalizePermissions(data.users[idx]);
          }
        }
      }
      for (const [token, s] of SESSIONS.entries()) {
        if (s.username === (newUsername || username)) {
          s.permissions = normalizePermissions(data.users[idx]);
        }
      }
      saveUsers(data);
      audit(session, 'admin_update_user', { username, newUsername, role, permissions });
      jsonResp(res, 200, { ok: true });
    })();
    return;
  }

  // ── ADMIN: ELIMINAR USUARIO ───────────────────
  if (req.method === 'POST' && pathName === '/api/admin/delete-user') {
    if (session.role !== 'admin') { jsonResp(res, 403, { error: 'No autorizado' }); return; }
    (async () => {
      const body = await readBody(req);
      const { username } = body;
      if (username === session.username) {
        jsonResp(res, 400, { error: 'No podés eliminar tu propio usuario' });
        return;
      }
      const data = loadUsers();
      const before = data.users.length;
      data.users = data.users.filter(u => u.username !== username);
      if (data.users.length === before) { jsonResp(res, 404, { error: 'Usuario no encontrado' }); return; }
      saveUsers(data);
      audit(session, 'admin_delete_user', { username });
      jsonResp(res, 200, { ok: true });
    })();
    return;
  }

  // ── ADMIN: AUDITORIA ───────────────────
  if (pathName === '/api/admin/audit') {
    if (session.role !== 'admin') { jsonResp(res, 403, { error: 'No autorizado' }); return; }
    const limit = Math.min(Number(u.searchParams.get('limit') || 200), 1000);
    const data = loadAuditLog();
    jsonResp(res, 200, { actions: data.actions.slice(-limit).reverse() });
    return;
  }

  // ── PROXY ADS a n8n + CACHE PERSISTENTE ──────────────────────────
  if (pathName === '/api/meli') {
    (async () => {
      let cuenta = u.searchParams.get('cuenta') || 'tlc';
      if (!WEBHOOKS[cuenta]) cuenta = 'tlc';
      const paramsObj = Object.fromEntries(u.searchParams.entries());
      const action = paramsObj.action || '';
      const forceRefresh = ['1', 'true', 'yes', 'si'].includes(String(paramsObj.refresh || paramsObj.force || '').toLowerCase());

      try {
        if (action === 'cache') {
          jsonResp(res, 200, cachedMeliResponse(cuenta));
          return;
        }

        // IMPORTANTE:
        // Por defecto NO llamamos a n8n/Mercado Libre si ya hay datos guardados.
        // Esto evita gastar tokens/cuotas cada vez que entrás o salís del panel.
        // Solo se vuelve a consultar n8n cuando el frontend manda refresh=1
        // desde el botón "Actualizar datos".
        const cache = cachedMeliResponse(cuenta);
        if (!forceRefresh) {
          if (action === 'campaigns' && Array.isArray(cache.campaigns) && cache.campaigns.length) {
            jsonResp(res, 200, {
              ...cache,
              ok: true,
              cached: true,
              cacheOnly: true,
              results: cache.campaigns,
              campaigns: cache.campaigns,
            });
            return;
          }

          if (action === 'ads') {
            const campaignId = String(paramsObj.campaign_id || '');
            const cachedAds = campaignId && cache.ads ? cache.ads[campaignId] : null;
            if (Array.isArray(cachedAds) && cachedAds.length) {
              jsonResp(res, 200, {
                ok: true,
                cached: true,
                cacheOnly: true,
                cuenta,
                campaign_id: campaignId,
                results: cachedAds,
                ads: cachedAds,
              });
              return;
            }
          }

          if (action === 'orders' && Array.isArray(cache.orders) && cache.orders.length) {
            jsonResp(res, 200, {
              ok: true,
              cached: true,
              cacheOnly: true,
              cuenta,
              results: cache.orders,
              orders: cache.orders,
              totalSales: cache.totalSales || 0,
              totalOrdersCount: cache.totalOrdersCount || cache.orders.length,
              paging: { total: cache.totalOrdersCount || cache.orders.length },
            });
            return;
          }

          if (action === 'user' && cache.sellerId) {
            jsonResp(res, 200, { ok: true, cached: true, cacheOnly: true, id: cache.sellerId });
            return;
          }
        }

        const webhook = WEBHOOKS[cuenta] || WEBHOOKS.tlc;
        u.searchParams.delete('cuenta');
        u.searchParams.delete('refresh');
        u.searchParams.delete('force');
        const target = `${webhook}?${u.searchParams.toString()}`;
        console.log(`[MELI ADS ${cuenta.toUpperCase()}] (${session.username}) ${forceRefresh ? 'REFRESH' : 'LIVE'} → ${target.substring(0, 140)}...`);

        const opts = {
          method: req.method,
          headers: { 'Accept': 'application/json' },
        };

        if (req.method === 'POST') {
          opts.headers['Content-Type'] = 'application/json';
          opts.body = JSON.stringify(await readBody(req));
        }

        const r = await fetch(target, opts);
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); }
        catch { data = { error: { message: 'n8n devolvió respuesta vacía o no-JSON', raw: text.slice(0, 400) } }; }

        const hasError = !r.ok || data?.error || data?.message?.toString().toLowerCase().includes('error');
        if (!hasError) updateAdsCacheFromResponse(cuenta, action, paramsObj, data);

        audit(session, 'meli_ads_api', { cuenta, method: req.method, status: r.status, action, forceRefresh, params: paramsObj });

        // Si n8n falla o viene vacío justo al entrar/salir, no dejamos el panel en blanco.
        if (hasError) {
          const fallback = cachedMeliResponse(cuenta);
          jsonResp(res, 200, { ...fallback, warning: data?.error?.message || data?.message || `n8n respondió HTTP ${r.status}` });
          return;
        }

        jsonResp(res, r.status, data);
      } catch (e) {
        console.error('Error proxy MeLi ADS:', e.message);
        const fallback = cachedMeliResponse(cuenta);
        if ((fallback.campaigns || []).length) {
          jsonResp(res, 200, { ...fallback, warning: e.message });
        } else {
          jsonResp(res, 500, { error: { message: e.message } });
        }
      }
    })();
    return;
  }

  // ── PROXY INBOX a n8n ────────────────────────
  // /api/inbox?cuenta=tlc&action=questions|messages_unread|claims|answer|messages_pack|send_message
  if (pathName === '/api/inbox') {
    (async () => {
      try {
        const cuenta = u.searchParams.get('cuenta') || 'tlc';
        const webhook = INBOX_WEBHOOKS[cuenta] || INBOX_WEBHOOKS.tlc;
        u.searchParams.delete('cuenta');
        const target = `${webhook}?${u.searchParams.toString()}`;
        console.log(`[MELI INBOX ${cuenta.toUpperCase()}] (${session.username}) ${req.method} → ${target.substring(0, 160)}...`);

        // IMPORTANTE:
        // Los workflows de INBOX en n8n estan registrados como GET.
        // El frontend puede llamar POST para acciones como responder preguntas o enviar mensajes,
        // pero aca convertimos esos datos a querystring y llamamos al webhook por GET.
        // Esto evita el error: "webhook is not registered for POST requests".
        let targetFinal = target;
        const opts = {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        };

        if (req.method === 'POST') {
          const body = await readBody(req);
          const params = new URLSearchParams(u.searchParams);
          for (const [k, v] of Object.entries(body || {})) {
            if (v !== undefined && v !== null) params.set(k, String(v));
          }
          targetFinal = `${webhook}?${params.toString()}`;
          console.log(`[MELI INBOX ${cuenta.toUpperCase()}] POST convertido a GET -> ${targetFinal.substring(0, 180)}...`);
        }

        const r = await fetch(targetFinal, opts);
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); }
        catch { data = { error: { message: 'n8n devolvió respuesta vacía o no-JSON', raw: text.slice(0, 400) } }; }
        audit(session, 'meli_inbox_api', { cuenta, method: req.method, status: r.status, action: u.searchParams.get('action') || '', params: Object.fromEntries(u.searchParams.entries()) });
        jsonResp(res, r.status, data);
      } catch (e) {
        console.error('Error proxy MeLi INBOX:', e.message);
        jsonResp(res, 500, { error: { message: e.message } });
      }
    })();
    return;
  }

  // ── CHAT con Claude (Anthropic) ───────────────
  if (req.method === 'POST' && pathName === '/api/chat') {
    (async () => {
      try {
        const data = await readBody(req);
        const apiKey = process.env.ANTHROPIC_API_KEY || data.apiKey;
        if (!apiKey) {
          jsonResp(res, 400, { error: { message: 'Falta configurar ANTHROPIC_API_KEY en Railway' } });
          return;
        }

        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type':       'application/json',
            'x-api-key':          apiKey,
            'anthropic-version':  '2023-06-01',
          },
          body: JSON.stringify({
            model:      data.model || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
            max_tokens: data.max_tokens || 1500,
            system:     data.system || '',
            messages:   data.messages || [],
          }),
        });
        const text = await r.text();
        let out;
        try { out = JSON.parse(text); }
        catch { out = { error: { message: 'Anthropic devolvió una respuesta no-JSON', raw: text.slice(0, 400) } }; }
        if (!r.ok && !out.error) out.error = { message: `Anthropic respondió HTTP ${r.status}` };
        jsonResp(res, r.status, out);
      } catch (e) {
        jsonResp(res, 500, { error: { message: e.message } });
      }
    })();
    return;
  }


  // ── LISTA DE PRECIOS: proxy Railway -> Google Apps Script ───────────────
  // Requiere variable de entorno en Railway:
  // PRECIOS_API_URL = URL del Web App de Apps Script.
  if (req.method === 'POST' && pathName === '/api/precios') {
    (async () => {
      try {
        const apiUrl = process.env.PRECIOS_API_URL;
        if (!apiUrl) {
          jsonResp(res, 500, {
            ok: false,
            message: 'Falta configurar PRECIOS_API_URL en Railway. Publicá codigo.gs como Web App y pegá esa URL en Variables.'
          });
          return;
        }

        const body = await readBody(req);

        const r = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const raw = await r.text();
        let data;
        try { data = JSON.parse(raw); }
        catch (e) {
          jsonResp(res, 502, {
            ok: false,
            message: 'Apps Script devolvió una respuesta no JSON.',
            raw: raw.slice(0, 500)
          });
          return;
        }

        jsonResp(res, r.ok ? 200 : r.status, data);
      } catch (e) {
        console.error('Error /api/precios:', e);
        jsonResp(res, 500, {
          ok: false,
          message: e.message || 'Error interno en /api/precios'
        });
      }
    })();
    return;
  }

  if (req.method === 'GET' && pathName === '/api/precios/health') {
    jsonResp(res, 200, {
      ok: true,
      configured: !!process.env.PRECIOS_API_URL,
      service: 'lista-precios-proxy'
    });
    return;
  }

  // ── ARCHIVOS ESTÁTICOS ────────────────────────
  // Bloquear acceso directo a users.json y .bat
  if (pathName.includes('users.json') || pathName.includes('/data/') || pathName.endsWith('.bat') || pathName.endsWith('.js')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  // Restringir admin.html solo a admins
  if (pathName === '/admin.html' && session.role !== 'admin') {
    res.writeHead(302, { 'Location': '/index.html' });
    res.end();
    return;
  }

  const file = pathName === '/' ? 'index.html' : decodeURIComponent(pathName).slice(1);
  serveStatic(res, file);
});

function serveStatic(res, file) {
  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const mime = {
      '.html': 'text/html',
      '.js':   'application/javascript',
      '.css':  'text/css',
      '.json': 'application/json',
    }[path.extname(file)] || 'text/plain';
    res.writeHead(200, {
      'Content-Type':                mime + '; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

server.listen(PORT, '0.0.0.0', () => {
  loadUsers(); // crea admin si es primera vez
  loadInboxState(); // crea data/inbox-state.json si es primera vez
  loadAuditLog(); // crea data/audit-log.json si es primera vez
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TELOCONSIGO + TOP SHOP — Panel v4 (login activo)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`  ✓ Servidor activo: http://localhost:${PORT}`);
  console.log(`  ✓ TELOCONSIGO:     ${WEBHOOKS.tlc}`);
  console.log(`  ✓ ADS TOP SHOP:    ${WEBHOOKS.topshop}`);
  console.log(`  ✓ INBOX TLC:       ${INBOX_WEBHOOKS.tlc}`);
  console.log(`  ✓ INBOX TOP SHOP:  ${INBOX_WEBHOOKS.topshop}`);
  console.log('');
  console.log('  Railway usa process.env.PORT || 8080');
  console.log('');
  console.log('  Para detener: Ctrl+C');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});
