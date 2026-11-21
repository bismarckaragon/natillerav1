const path = require('path');
const crypto = require('crypto');
const express = require('express');
const store = require('./db');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSION_COOKIE = 'natillera_admin_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUBLIC_DIR, { index: false }));

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

function signSession(exp) {
  const payload = `admin.${exp}`;
  const sig = crypto
    .createHmac('sha256', store.getSessionSecret())
    .update(payload)
    .digest('hex');
  return `${payload}.${sig}`;
}

function isAdminAuthenticated(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'admin') return false;

  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;

  const expected = signSession(exp);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function setSessionCookie(req, res) {
  const exp = Date.now() + SESSION_MAX_AGE_MS;
  const token = signSession(exp);
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const maxAgeSec = Math.floor(SESSION_MAX_AGE_MS / 1000);
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`
  ];
  if (isSecure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireAdmin(req, res, next) {
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ error: 'Acceso restringido. Inicia sesión como administrador.' });
  }
  next();
}

function handle(fn) {
  return (req, res) => {
    try {
      const result = fn(req, res);
      if (!res.headersSent) {
        res.json(result !== undefined ? result : store.getFullState());
      }
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[API Error]', err);
      res.status(status).json({ error: err.message || 'Error interno del servidor' });
    }
  };
}

// Healthcheck for Coolify
app.get('/api/health', (req, res) => {
  try {
    store.db.prepare('SELECT 1').get();
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ========================
// AUTH ENDPOINTS (ADMIN)
// ========================
app.get('/api/auth/status', handle((req) => {
  const info = store.getAuthInfo();
  return {
    authenticated: isAdminAuthenticated(req),
    configured: info.configured,
    envManaged: info.envManaged
  };
}));

app.post('/api/auth/setup', handle((req, res) => {
  const info = store.getAuthInfo();
  if (info.configured || info.envManaged) {
    const err = new Error('La contraseña de administrador ya está configurada.');
    err.status = 409;
    throw err;
  }
  store.setAdminPassword(req.body?.password);
  setSessionCookie(req, res);
  return { authenticated: true, configured: true, envManaged: false };
}));

app.post('/api/auth/login', handle((req, res) => {
  const info = store.getAuthInfo();
  if (!info.configured) {
    const err = new Error('Aún no se ha configurado una contraseña de administrador.');
    err.status = 400;
    throw err;
  }
  const ok = store.verifyAdminPassword(req.body?.password);
  if (!ok) {
    const err = new Error('Contraseña o PIN incorrecto.');
    err.status = 401;
    throw err;
  }
  setSessionCookie(req, res);
  return { authenticated: true, configured: true, envManaged: info.envManaged };
}));

app.post('/api/auth/logout', handle((req, res) => {
  clearSessionCookie(res);
  return { authenticated: false };
}));

app.post('/api/auth/change-password', requireAdmin, handle((req) => {
  const info = store.getAuthInfo();
  if (info.envManaged) {
    const err = new Error('La contraseña está controlada por la variable de entorno ADMIN_PASSWORD.');
    err.status = 400;
    throw err;
  }
  const currentPassword = req.body?.currentPassword;
  const newPassword = req.body?.newPassword;
  if (!store.verifyAdminPassword(currentPassword)) {
    const err = new Error('La contraseña actual es incorrecta.');
    err.status = 401;
    throw err;
  }
  store.setAdminPassword(newPassword);
  return { ok: true };
}));

// ========================
// PUBLIC MEMBER ENDPOINTS
// ========================
app.post('/api/public/members', handle((req) => {
  return store.createPublicMember(req.body || {});
}));

app.get('/api/public/raffle', handle(() => {
  return store.getPublicRaffleState();
}));

app.post('/api/public/raffle/picks', handle((req) => {
  return store.assignPublicPicks(req.body || {});
}));

// ========================
// ADMIN ENDPOINTS (PROTECTED)
// ========================
app.get('/api/state', requireAdmin, handle(() => store.getFullState()));

app.put('/api/settings', requireAdmin, handle((req) => {
  store.updateSettings(req.body || {});
  return store.getFullState();
}));

app.post('/api/members', requireAdmin, handle((req) => {
  store.createMember(req.body || {});
  return store.getFullState();
}));

app.delete('/api/members/:id', requireAdmin, handle((req) => {
  store.deleteMember(req.params.id);
  return store.getFullState();
}));

app.post('/api/members/:id/pay-tickets', requireAdmin, handle((req) => {
  store.payMemberTickets(req.params.id, req.body || {});
  return store.getFullState();
}));

app.post('/api/raffles', requireAdmin, handle((req) => {
  store.createRaffle(req.body || {});
  return store.getFullState();
}));

app.post('/api/raffles/:id/close', requireAdmin, handle((req) => {
  store.closeRaffle(req.params.id);
  return store.getFullState();
}));

app.delete('/api/raffles/:id', requireAdmin, handle((req) => {
  store.deleteRaffle(req.params.id);
  return store.getFullState();
}));

app.post('/api/raffles/:id/picks', requireAdmin, handle((req) => {
  store.assignPicks(req.params.id, req.body || {});
  return store.getFullState();
}));

app.patch('/api/raffles/:id/picks/:code', requireAdmin, handle((req) => {
  store.togglePickPaid(req.params.id, req.params.code);
  return store.getFullState();
}));

app.delete('/api/raffles/:id/picks/:code', requireAdmin, handle((req) => {
  store.releasePick(req.params.id, req.params.code);
  return store.getFullState();
}));

app.post('/api/loans', requireAdmin, handle((req) => {
  store.createLoan(req.body || {});
  return store.getFullState();
}));

app.patch('/api/loans/:id/rate', requireAdmin, handle((req) => {
  store.updateLoanRate(req.params.id, req.body?.interestRate);
  return store.getFullState();
}));

app.post('/api/loans/:id/payments', requireAdmin, handle((req) => {
  store.recordLoanPayment(req.params.id, req.body || {});
  return store.getFullState();
}));

app.delete('/api/loans/:id', requireAdmin, handle((req) => {
  store.deleteLoan(req.params.id);
  return store.getFullState();
}));

app.delete('/api/history', requireAdmin, handle(() => {
  store.clearHistory();
  return store.getFullState();
}));

app.get('/api/backup', requireAdmin, handle((req, res) => {
  const data = store.getFullState();
  const filename = `respaldo-fondo-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(data);
}));

app.post('/api/backup/import', requireAdmin, handle((req) => {
  store.importBackup(req.body);
  return store.getFullState();
}));

// ========================
// FRONTEND PAGE ROUTES
// ========================
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'portal.html'));
});

app.get('/registro', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'registro.html'));
});

app.get('/rifa', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'rifa.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

// Unknown API routes return 404 JSON
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado.' });
});

// Fallback to Member Portal
app.get('*', (req, res) => {
  res.redirect('/');
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Natillera server listening on http://0.0.0.0:${PORT}`);
  console.log(`SQLite database: ${store.DB_PATH}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    store.closeDb();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
