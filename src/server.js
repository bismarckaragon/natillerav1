const path = require('path');
const express = require('express');
const store = require('./db');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

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

// Full state
app.get('/api/state', handle(() => store.getFullState()));

// Settings
app.put('/api/settings', handle((req) => {
  store.updateSettings(req.body || {});
  return store.getFullState();
}));

// Members
app.post('/api/members', handle((req) => {
  store.createMember(req.body || {});
  return store.getFullState();
}));

app.delete('/api/members/:id', handle((req) => {
  store.deleteMember(req.params.id);
  return store.getFullState();
}));

app.post('/api/members/:id/pay-tickets', handle((req) => {
  store.payMemberTickets(req.params.id, req.body || {});
  return store.getFullState();
}));

// Raffles
app.post('/api/raffles', handle((req) => {
  store.createRaffle(req.body || {});
  return store.getFullState();
}));

app.post('/api/raffles/:id/close', handle((req) => {
  store.closeRaffle(req.params.id);
  return store.getFullState();
}));

app.delete('/api/raffles/:id', handle((req) => {
  store.deleteRaffle(req.params.id);
  return store.getFullState();
}));

// Raffle picks
app.post('/api/raffles/:id/picks', handle((req) => {
  store.assignPicks(req.params.id, req.body || {});
  return store.getFullState();
}));

app.patch('/api/raffles/:id/picks/:code', handle((req) => {
  store.togglePickPaid(req.params.id, req.params.code);
  return store.getFullState();
}));

app.delete('/api/raffles/:id/picks/:code', handle((req) => {
  store.releasePick(req.params.id, req.params.code);
  return store.getFullState();
}));

// Loans
app.post('/api/loans', handle((req) => {
  store.createLoan(req.body || {});
  return store.getFullState();
}));

app.patch('/api/loans/:id/rate', handle((req) => {
  store.updateLoanRate(req.params.id, req.body?.interestRate);
  return store.getFullState();
}));

app.post('/api/loans/:id/payments', handle((req) => {
  store.recordLoanPayment(req.params.id, req.body || {});
  return store.getFullState();
}));

app.delete('/api/loans/:id', handle((req) => {
  store.deleteLoan(req.params.id);
  return store.getFullState();
}));

// History
app.delete('/api/history', handle(() => {
  store.clearHistory();
  return store.getFullState();
}));

// Backup Export / Import
app.get('/api/backup', handle((req, res) => {
  const data = store.getFullState();
  const filename = `respaldo-fondo-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(data);
}));

app.post('/api/backup/import', handle((req) => {
  store.importBackup(req.body);
  return store.getFullState();
}));

// Fallback to SPA index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
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
