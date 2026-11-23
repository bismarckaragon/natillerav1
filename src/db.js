const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'natillera.db');

// Ensure parent directory exists (critical for fresh Coolify volumes)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      interest_rate REAL NOT NULL DEFAULT 0,
      base_cash REAL NOT NULL DEFAULT 0,
      max_loan_ratio REAL NOT NULL DEFAULT 80,
      max_single_loan REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS raffles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
      closed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS raffle_picks (
      raffle_id TEXT NOT NULL,
      number_code TEXT NOT NULL,
      member_id TEXT NOT NULL,
      paid INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (raffle_id, number_code),
      FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      sponsor_member_id TEXT NOT NULL,
      borrower_type TEXT NOT NULL CHECK (borrower_type IN ('member', 'external')),
      borrower_name TEXT NOT NULL,
      borrower_doc TEXT NOT NULL DEFAULT '',
      borrower_phone TEXT NOT NULL DEFAULT '',
      borrower_address TEXT NOT NULL DEFAULT '',
      initial_amount REAL NOT NULL,
      balance REAL NOT NULL,
      interest_rate REAL NOT NULL,
      interest_paid REAL NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      member_name TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS movements (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      category TEXT NOT NULL DEFAULT 'General',
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      member_id TEXT NOT NULL DEFAULT '',
      raffle_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Initialize clean default settings row if absent (no dummy data)
  db.prepare(`
    INSERT OR IGNORE INTO settings (id, interest_rate, base_cash, max_loan_ratio, max_single_loan)
    VALUES (1, 0, 0, 80, 0)
  `).run();

  // Safe schema migrations for existing SQLite databases
  const settingsCols = db.prepare('PRAGMA table_info(settings)').all().map(c => c.name);
  if (!settingsCols.includes('admin_password_hash')) {
    db.exec("ALTER TABLE settings ADD COLUMN admin_password_hash TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsCols.includes('session_secret')) {
    db.exec("ALTER TABLE settings ADD COLUMN session_secret TEXT NOT NULL DEFAULT ''");
  }

  // Ensure a persistent session secret exists
  const row = db.prepare('SELECT session_secret FROM settings WHERE id = 1').get();
  if (!row || !row.session_secret) {
    const secret = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE settings SET session_secret = ? WHERE id = 1').run(secret);
  }

  // Standardize existing member names to Title Case
  const existingMembers = db.prepare('SELECT id, name FROM members').all();
  const updName = db.prepare('UPDATE members SET name = ? WHERE id = ?');
  for (const m of existingMembers) {
    const normalized = normalizePersonName(m.name);
    if (normalized && normalized !== m.name) {
      updName.run(normalized, m.id);
    }
  }
}

function normalizePersonName(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toLocaleUpperCase('es-CO') + word.slice(1).toLocaleLowerCase('es-CO'))
    .join(' ');
}

initSchema();

function todayCO() {
  return new Date().toLocaleDateString('es-CO');
}

function formatMoney(val) {
  return '$' + Number(val || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function getMemberName(id) {
  const row = db.prepare('SELECT name FROM members WHERE id = ?').get(id);
  return row ? row.name : 'Desconocido';
}

function addHistory(date, memberName, type, amount, note = '') {
  db.prepare(`
    INSERT INTO history (date, member_name, type, amount, note)
    VALUES (?, ?, ?, ?, ?)
  `).run(date, memberName, type, Number(amount || 0), String(note || ''));
}

function getFullState() {
  const settingsRow = db.prepare('SELECT interest_rate, base_cash, max_loan_ratio, max_single_loan FROM settings WHERE id = 1').get();
  const membersRows = db.prepare('SELECT id, name, phone FROM members ORDER BY rowid ASC').all();
  const rafflesRows = db.prepare('SELECT id, name, price, status, closed_at FROM raffles ORDER BY rowid ASC').all();
  const picksRows = db.prepare('SELECT raffle_id, number_code, member_id, paid FROM raffle_picks').all();
  const loansRows = db.prepare(`
    SELECT id, sponsor_member_id, borrower_type, borrower_name, borrower_doc,
           borrower_phone, borrower_address, initial_amount, balance,
           interest_rate, interest_paid, date, notes
    FROM loans ORDER BY rowid ASC
  `).all();
  const historyRows = db.prepare('SELECT id, date, member_name, type, amount, note FROM history ORDER BY id ASC').all();
  const movementsRows = db.prepare(`
    SELECT id, date, direction, category, amount, description, member_id, raffle_id
    FROM movements ORDER BY date DESC, rowid DESC
  `).all();

  const picksByRaffle = new Map();
  for (const p of picksRows) {
    if (!picksByRaffle.has(p.raffle_id)) picksByRaffle.set(p.raffle_id, {});
    picksByRaffle.get(p.raffle_id)[p.number_code] = {
      memberId: p.member_id,
      paid: Boolean(p.paid)
    };
  }

  return {
    settings: {
      interestRate: settingsRow ? Number(settingsRow.interest_rate) : 0,
      baseCash: settingsRow ? Number(settingsRow.base_cash) : 0,
      maxLoanRatio: settingsRow ? Number(settingsRow.max_loan_ratio) : 80,
      maxSingleLoan: settingsRow ? Number(settingsRow.max_single_loan) : 0
    },
    members: membersRows.map(m => ({
      id: m.id,
      name: m.name,
      phone: m.phone || ''
    })),
    raffles: rafflesRows.map(r => ({
      id: r.id,
      name: r.name,
      price: Number(r.price),
      status: r.status,
      ...(r.closed_at ? { closedAt: r.closed_at } : {}),
      picks: picksByRaffle.get(r.id) || {}
    })),
    loans: loansRows.map(l => ({
      id: l.id,
      sponsorMemberId: l.sponsor_member_id,
      borrowerType: l.borrower_type,
      borrowerName: l.borrower_name,
      borrowerDoc: l.borrower_doc || '',
      borrowerPhone: l.borrower_phone || '',
      borrowerAddress: l.borrower_address || '',
      initialAmount: Number(l.initial_amount),
      balance: Number(l.balance),
      interestRate: Number(l.interest_rate),
      interestPaid: Number(l.interest_paid),
      date: l.date,
      notes: l.notes || ''
    })),
    history: historyRows.map(h => ({
      id: h.id,
      date: h.date,
      memberName: h.member_name,
      type: h.type,
      amount: Number(h.amount),
      note: h.note || ''
    })),
    movements: movementsRows.map(mv => ({
      id: mv.id,
      date: mv.date,
      direction: mv.direction,
      category: mv.category || 'General',
      amount: Number(mv.amount),
      description: mv.description,
      memberId: mv.member_id || '',
      raffleId: mv.raffle_id || ''
    }))
  };
}

function updateSettings(payload) {
  const current = getFullState().settings;
  const interestRate = payload.interestRate !== undefined ? Math.max(0, Number(payload.interestRate) || 0) : current.interestRate;
  const baseCash = payload.baseCash !== undefined ? Math.max(0, Number(payload.baseCash) || 0) : current.baseCash;
  const maxLoanRatio = payload.maxLoanRatio !== undefined
    ? Math.min(100, Math.max(1, Number(payload.maxLoanRatio) || 80))
    : current.maxLoanRatio;
  const maxSingleLoan = payload.maxSingleLoan !== undefined ? Math.max(0, Number(payload.maxSingleLoan) || 0) : current.maxSingleLoan;

  db.prepare(`
    UPDATE settings
    SET interest_rate = ?, base_cash = ?, max_loan_ratio = ?, max_single_loan = ?
    WHERE id = 1
  `).run(interestRate, baseCash, maxLoanRatio, maxSingleLoan);
}

function createMember({ name, phone = '' }) {
  const cleanName = normalizePersonName(name);
  if (!cleanName) {
    const err = new Error('El nombre del miembro es obligatorio.');
    err.status = 400;
    throw err;
  }
  const existing = db.prepare('SELECT id, name FROM members WHERE LOWER(TRIM(name)) = LOWER(?)').get(cleanName);
  if (existing) {
    const err = new Error(`Ya existe un miembro registrado con el nombre "${existing.name}".`);
    err.status = 409;
    throw err;
  }
  const id = 'm_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const cleanPhone = String(phone || '').trim();
  db.prepare('INSERT INTO members (id, name, phone) VALUES (?, ?, ?)').run(id, cleanName, cleanPhone);
  return { id, name: cleanName, phone: cleanPhone };
}

function updateMember(id, { name, phone = '' }) {
  const existing = db.prepare('SELECT id, name FROM members WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('Miembro no encontrado.');
    err.status = 404;
    throw err;
  }
  const cleanName = normalizePersonName(name);
  if (!cleanName) {
    const err = new Error('El nombre del miembro es obligatorio.');
    err.status = 400;
    throw err;
  }
  const duplicate = db.prepare('SELECT id, name FROM members WHERE LOWER(TRIM(name)) = LOWER(?) AND id != ?').get(cleanName, id);
  if (duplicate) {
    const err = new Error(`Ya existe otro miembro con el nombre "${duplicate.name}".`);
    err.status = 409;
    throw err;
  }
  const cleanPhone = String(phone || '').trim();
  db.prepare('UPDATE members SET name = ?, phone = ? WHERE id = ?').run(cleanName, cleanPhone, id);
  return { id, name: cleanName, phone: cleanPhone };
}

const deleteMember = db.transaction((id) => {
  const activeRaffle = db.prepare("SELECT id FROM raffles WHERE status = 'active' LIMIT 1").get();
  if (activeRaffle) {
    db.prepare('DELETE FROM raffle_picks WHERE raffle_id = ? AND member_id = ?').run(activeRaffle.id, id);
  }
  db.prepare('DELETE FROM members WHERE id = ?').run(id);
});

const createRaffle = db.transaction(({ name, price }) => {
  const existing = db.prepare("SELECT name FROM raffles WHERE status = 'active' LIMIT 1").get();
  if (existing) {
    const err = new Error(`Ya existe una rifa activa ("${existing.name}"). Ciérrala antes de crear una nueva.`);
    err.status = 409;
    throw err;
  }

  const cleanName = String(name || '').trim();
  const numPrice = Number(price) || 0;
  if (!cleanName || numPrice <= 0) {
    const err = new Error('Nombre y precio válido son obligatorios.');
    err.status = 400;
    throw err;
  }

  const id = 'r_' + Date.now();
  db.prepare("INSERT INTO raffles (id, name, price, status) VALUES (?, ?, ?, 'active')").run(id, cleanName, numPrice);
  addHistory(todayCO(), 'Administrador', `Inicio Nueva Rifa (${cleanName})`, numPrice, 'Talonario 00–99 habilitado');
  return { id, name: cleanName, price: numPrice, status: 'active', picks: {} };
});

const closeRaffle = db.transaction((id) => {
  const raffle = db.prepare('SELECT * FROM raffles WHERE id = ?').get(id);
  if (!raffle || raffle.status !== 'active') {
    const err = new Error('La rifa no existe o ya está cerrada.');
    err.status = 404;
    throw err;
  }

  const picks = db.prepare('SELECT paid FROM raffle_picks WHERE raffle_id = ?').all(id);
  const assigned = picks.length;
  const paid = picks.filter(p => p.paid).length;
  const unpaid = assigned - paid;
  const collected = paid * Number(raffle.price);
  const pendingMoney = unpaid * Number(raffle.price);
  const closedAt = todayCO();

  db.prepare("UPDATE raffles SET status = 'closed', closed_at = ? WHERE id = ?").run(closedAt, id);
  addHistory(
    closedAt,
    'Administrador',
    `Cierre de Rifa (${raffle.name})`,
    collected,
    `Recaudado: ${formatMoney(collected)} | Pendiente: ${formatMoney(pendingMoney)}`
  );
});

const updateRaffle = db.transaction((id, { name, price }) => {
  const raffle = db.prepare('SELECT * FROM raffles WHERE id = ?').get(id);
  if (!raffle) {
    const err = new Error('Rifa no encontrada.');
    err.status = 404;
    throw err;
  }
  const cleanName = String(name || '').trim();
  const numPrice = Number(price) || 0;
  if (!cleanName || numPrice <= 0) {
    const err = new Error('Nombre y precio válido son obligatorios.');
    err.status = 400;
    throw err;
  }
  db.prepare('UPDATE raffles SET name = ?, price = ? WHERE id = ?').run(cleanName, numPrice, id);
});

const deleteRaffle = db.transaction((id) => {
  const raffle = db.prepare('SELECT status FROM raffles WHERE id = ?').get(id);
  if (!raffle) return;
  if (raffle.status === 'active') {
    const err = new Error('No puedes eliminar una rifa activa directamente; primero debes cerrarla.');
    err.status = 400;
    throw err;
  }
  db.prepare('DELETE FROM raffles WHERE id = ?').run(id);
});

const assignPicks = db.transaction((raffleId, { memberId, numbers }) => {
  const raffle = db.prepare("SELECT * FROM raffles WHERE id = ? AND status = 'active'").get(raffleId);
  if (!raffle) {
    const err = new Error('No hay una rifa activa válida.');
    err.status = 404;
    throw err;
  }

  const member = db.prepare('SELECT id, name FROM members WHERE id = ?').get(memberId);
  if (!member) {
    const err = new Error('El miembro seleccionado no existe.');
    err.status = 400;
    throw err;
  }

  if (!Array.isArray(numbers) || numbers.length === 0) {
    const err = new Error('Debes seleccionar al menos un número.');
    err.status = 400;
    throw err;
  }

  const uniqueNums = [...new Set(numbers.map(n => String(n).padStart(2, '0')))].sort();
  for (const code of uniqueNums) {
    if (!/^\d{2}$/.test(code)) {
      const err = new Error(`Número inválido: ${code}`);
      err.status = 400;
      throw err;
    }
    const taken = db.prepare('SELECT 1 FROM raffle_picks WHERE raffle_id = ? AND number_code = ?').get(raffleId, code);
    if (taken) {
      const err = new Error(`El número ${code} ya fue tomado.`);
      err.status = 409;
      throw err;
    }
  }

  const insertPick = db.prepare('INSERT INTO raffle_picks (raffle_id, number_code, member_id, paid) VALUES (?, ?, ?, 0)');
  for (const code of uniqueNums) {
    insertPick.run(raffleId, code, member.id);
  }

  addHistory(
    todayCO(),
    member.name,
    `Escogió Boletas (${raffle.name})`,
    uniqueNums.length * Number(raffle.price),
    `Números: ${uniqueNums.join(', ')}`
  );
});

const togglePickPaid = db.transaction((raffleId, code) => {
  const raffle = db.prepare('SELECT * FROM raffles WHERE id = ?').get(raffleId);
  const pick = db.prepare('SELECT * FROM raffle_picks WHERE raffle_id = ? AND number_code = ?').get(raffleId, code);
  if (!raffle || !pick) {
    const err = new Error('Boleta no encontrada.');
    err.status = 404;
    throw err;
  }

  const newPaid = pick.paid ? 0 : 1;
  db.prepare('UPDATE raffle_picks SET paid = ? WHERE raffle_id = ? AND number_code = ?').run(newPaid, raffleId, code);

  if (newPaid === 1) {
    addHistory(
      todayCO(),
      getMemberName(pick.member_id),
      `Pago Boleta #${code} (${raffle.name})`,
      Number(raffle.price),
      'Marcada como pagada desde talonario'
    );
  }
});

const updatePick = db.transaction((raffleId, code, { memberId, paid }) => {
  const raffle = db.prepare('SELECT * FROM raffles WHERE id = ?').get(raffleId);
  const pick = db.prepare('SELECT * FROM raffle_picks WHERE raffle_id = ? AND number_code = ?').get(raffleId, code);
  if (!raffle || !pick) {
    const err = new Error('Boleta no encontrada.');
    err.status = 404;
    throw err;
  }
  const nextMemberId = memberId ? String(memberId) : pick.member_id;
  const member = db.prepare('SELECT id, name FROM members WHERE id = ?').get(nextMemberId);
  if (!member) {
    const err = new Error('El miembro seleccionado no existe.');
    err.status = 400;
    throw err;
  }
  const nextPaid = paid !== undefined ? (paid ? 1 : 0) : pick.paid;
  db.prepare('UPDATE raffle_picks SET member_id = ?, paid = ? WHERE raffle_id = ? AND number_code = ?')
    .run(member.id, nextPaid, raffleId, code);

  if (nextPaid === 1 && pick.paid === 0) {
    addHistory(
      todayCO(),
      member.name,
      `Pago Boleta #${code} (${raffle.name})`,
      Number(raffle.price),
      'Actualizada desde talonario'
    );
  }
});

const releasePick = db.transaction((raffleId, code) => {
  const raffle = db.prepare("SELECT id FROM raffles WHERE id = ? AND status = 'active'").get(raffleId);
  if (!raffle) {
    const err = new Error('Solo se pueden liberar números de la rifa activa.');
    err.status = 400;
    throw err;
  }
  db.prepare('DELETE FROM raffle_picks WHERE raffle_id = ? AND number_code = ?').run(raffleId, code);
});

const payMemberTickets = db.transaction((memberId, { raffleId, count, note = '' }) => {
  const member = db.prepare('SELECT id, name FROM members WHERE id = ?').get(memberId);
  const raffle = db.prepare('SELECT * FROM raffles WHERE id = ?').get(raffleId);
  const qty = parseInt(count, 10) || 0;

  if (!member || !raffle || qty <= 0) {
    const err = new Error('Datos inválidos para registrar el pago de boletas.');
    err.status = 400;
    throw err;
  }

  const unpaid = db.prepare(`
    SELECT number_code FROM raffle_picks
    WHERE raffle_id = ? AND member_id = ? AND paid = 0
    ORDER BY number_code ASC
  `).all(raffleId, memberId);

  if (unpaid.length === 0) {
    const err = new Error('Este miembro no tiene boletas pendientes en esta rifa.');
    err.status = 400;
    throw err;
  }

  const toPay = unpaid.slice(0, Math.min(unpaid.length, qty));
  const markPaid = db.prepare('UPDATE raffle_picks SET paid = 1 WHERE raffle_id = ? AND number_code = ?');
  for (const row of toPay) {
    markPaid.run(raffleId, row.number_code);
  }

  addHistory(
    todayCO(),
    member.name,
    `Pago Boletas (${raffle.name})`,
    toPay.length * Number(raffle.price),
    `Boletas pagadas: #${toPay.map(x => x.number_code).join(', #')}. ${String(note || '').trim()}`.trim()
  );
});

const createLoan = db.transaction((payload) => {
  const sponsor = db.prepare('SELECT id, name FROM members WHERE id = ?').get(payload.sponsorMemberId);
  if (!sponsor) {
    const err = new Error('El miembro responsable no existe.');
    err.status = 400;
    throw err;
  }

  const borrowerType = payload.borrowerType === 'external' ? 'external' : 'member';
  const borrowerName = normalizePersonName(payload.borrowerName);
  const borrowerDoc = String(payload.borrowerDoc || '').trim();
  const borrowerPhone = String(payload.borrowerPhone || '').trim();
  const borrowerAddress = String(payload.borrowerAddress || '').trim();
  const amount = Number(payload.amount) || 0;
  const interestRate = Number(payload.interestRate);
  const date = String(payload.date || new Date().toISOString().slice(0, 10));
  const notes = String(payload.notes || '').trim();

  if (!borrowerName || amount <= 0 || Number.isNaN(interestRate) || interestRate < 0) {
    const err = new Error('Completa todos los campos obligatorios del préstamo.');
    err.status = 400;
    throw err;
  }

  const id = 'l_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  db.prepare(`
    INSERT INTO loans (
      id, sponsor_member_id, borrower_type, borrower_name, borrower_doc,
      borrower_phone, borrower_address, initial_amount, balance,
      interest_rate, interest_paid, date, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id, sponsor.id, borrowerType, borrowerName, borrowerDoc,
    borrowerPhone, borrowerAddress, amount, amount,
    interestRate, date, notes
  );

  const labelType = borrowerType === 'external'
    ? `Préstamo a Externo (${borrowerName})`
    : `Préstamo a Miembro (${borrowerName})`;

  addHistory(
    date,
    sponsor.name,
    labelType,
    amount,
    `Tasa: ${interestRate}% mes | CC: ${borrowerDoc} | Tel: ${borrowerPhone}. ${notes}`.trim()
  );

  return id;
});

function updateLoanRate(loanId, rate) {
  const numRate = Number(rate);
  if (Number.isNaN(numRate) || numRate < 0) {
    const err = new Error('Ingresa una tasa válida.');
    err.status = 400;
    throw err;
  }
  const info = db.prepare('UPDATE loans SET interest_rate = ? WHERE id = ?').run(numRate, loanId);
  if (info.changes === 0) {
    const err = new Error('Préstamo no encontrado.');
    err.status = 404;
    throw err;
  }
}

const recordLoanPayment = db.transaction((loanId, { action, amount, note = '' }) => {
  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
  const numAmount = Number(amount) || 0;
  if (!loan || numAmount <= 0) {
    const err = new Error('Préstamo o monto inválido.');
    err.status = 400;
    throw err;
  }

  const sponsorName = getMemberName(loan.sponsor_member_id);
  const cleanNote = String(note || '').trim();
  const today = todayCO();

  if (action === 'interest') {
    db.prepare('UPDATE loans SET interest_paid = interest_paid + ? WHERE id = ?').run(numAmount, loanId);
    addHistory(today, sponsorName, `Cobro Interés ${Number(loan.interest_rate)}% (${loan.borrower_name})`, numAmount, cleanNote);
  } else if (action === 'principal') {
    const abono = Math.min(Number(loan.balance), numAmount);
    const newBalance = Number(loan.balance) - abono;
    db.prepare('UPDATE loans SET balance = ? WHERE id = ?').run(newBalance, loanId);
    addHistory(
      today,
      sponsorName,
      `Abono Capital Préstamo (${loan.borrower_name})`,
      abono,
      `Saldo restante: ${formatMoney(newBalance)}. ${cleanNote}`.trim()
    );
  } else {
    const err = new Error('Tipo de pago inválido.');
    err.status = 400;
    throw err;
  }
});

function deleteLoan(loanId) {
  db.prepare('DELETE FROM loans WHERE id = ?').run(loanId);
}

const updateLoan = db.transaction((loanId, payload) => {
  const existing = db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
  if (!existing) {
    const err = new Error('Préstamo no encontrado.');
    err.status = 404;
    throw err;
  }

  const sponsor = db.prepare('SELECT id, name FROM members WHERE id = ?').get(payload.sponsorMemberId || existing.sponsor_member_id);
  if (!sponsor) {
    const err = new Error('El miembro responsable no existe.');
    err.status = 400;
    throw err;
  }

  const borrowerType = payload.borrowerType === 'external' ? 'external' : 'member';
  const borrowerName = normalizePersonName(payload.borrowerName);
  const borrowerDoc = String(payload.borrowerDoc || '').trim();
  const borrowerPhone = String(payload.borrowerPhone || '').trim();
  const borrowerAddress = String(payload.borrowerAddress || '').trim();
  const initialAmount = Number(payload.initialAmount ?? payload.amount) || 0;
  const balance = payload.balance !== undefined && payload.balance !== '' ? Math.max(0, Number(payload.balance)) : Number(existing.balance);
  const interestRate = Number(payload.interestRate);
  const date = String(payload.date || existing.date);
  const notes = String(payload.notes || '').trim();

  if (!borrowerName || initialAmount <= 0 || Number.isNaN(balance) || Number.isNaN(interestRate) || interestRate < 0) {
    const err = new Error('Completa todos los campos obligatorios del préstamo.');
    err.status = 400;
    throw err;
  }

  db.prepare(`
    UPDATE loans
    SET sponsor_member_id = ?, borrower_type = ?, borrower_name = ?, borrower_doc = ?,
        borrower_phone = ?, borrower_address = ?, initial_amount = ?, balance = ?,
        interest_rate = ?, date = ?, notes = ?
    WHERE id = ?
  `).run(
    sponsor.id, borrowerType, borrowerName, borrowerDoc,
    borrowerPhone, borrowerAddress, initialAmount, balance,
    interestRate, date, notes, loanId
  );
});

const createMovement = db.transaction((payload) => {
  const direction = payload.direction === 'out' ? 'out' : (payload.direction === 'in' ? 'in' : null);
  const amount = Number(payload.amount) || 0;
  const description = String(payload.description || '').trim();
  const category = String(payload.category || 'General').trim() || 'General';
  const date = String(payload.date || new Date().toISOString().slice(0, 10));
  const memberId = String(payload.memberId || '').trim();
  const raffleId = String(payload.raffleId || '').trim();

  if (!direction) {
    const err = new Error('Selecciona si el movimiento es un Ingreso o una Salida.');
    err.status = 400;
    throw err;
  }
  if (amount <= 0) {
    const err = new Error('El monto del movimiento debe ser mayor a 0.');
    err.status = 400;
    throw err;
  }
  if (!description) {
    const err = new Error('La descripción del movimiento es obligatoria.');
    err.status = 400;
    throw err;
  }

  const id = 'mv_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  db.prepare(`
    INSERT INTO movements (id, date, direction, category, amount, description, member_id, raffle_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, date, direction, category, amount, description, memberId, raffleId);

  const actorName = memberId ? getMemberName(memberId) : 'Fondo / Administrador';
  const opLabel = direction === 'in' ? `Ingreso (${category})` : `Salida / Egreso (${category})`;
  addHistory(date, actorName, opLabel, direction === 'in' ? amount : -amount, description);

  return id;
});

const updateMovement = db.transaction((id, payload) => {
  const existing = db.prepare('SELECT * FROM movements WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('Movimiento no encontrado.');
    err.status = 404;
    throw err;
  }

  const direction = payload.direction === 'out' ? 'out' : (payload.direction === 'in' ? 'in' : null);
  const amount = Number(payload.amount) || 0;
  const description = String(payload.description || '').trim();
  const category = String(payload.category || 'General').trim() || 'General';
  const date = String(payload.date || existing.date);
  const memberId = String(payload.memberId || '').trim();
  const raffleId = String(payload.raffleId || '').trim();

  if (!direction || amount <= 0 || !description) {
    const err = new Error('Completa tipo, monto válido y descripción del movimiento.');
    err.status = 400;
    throw err;
  }

  db.prepare(`
    UPDATE movements
    SET date = ?, direction = ?, category = ?, amount = ?, description = ?, member_id = ?, raffle_id = ?
    WHERE id = ?
  `).run(date, direction, category, amount, description, memberId, raffleId, id);
});

function deleteMovement(id) {
  const info = db.prepare('DELETE FROM movements WHERE id = ?').run(id);
  if (info.changes === 0) {
    const err = new Error('Movimiento no encontrado.');
    err.status = 404;
    throw err;
  }
}

function updateHistoryEntry(id, payload) {
  const existing = db.prepare('SELECT * FROM history WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('Registro de historial no encontrado.');
    err.status = 404;
    throw err;
  }
  const date = String(payload.date || existing.date).trim();
  const memberName = String(payload.memberName || existing.member_name).trim();
  const type = String(payload.type || existing.type).trim();
  const amount = Number(payload.amount ?? existing.amount);
  const note = String(payload.note ?? existing.note).trim();

  if (!date || !memberName || !type || Number.isNaN(amount)) {
    const err = new Error('Datos inválidos para actualizar el registro de historial.');
    err.status = 400;
    throw err;
  }
  db.prepare('UPDATE history SET date = ?, member_name = ?, type = ?, amount = ?, note = ? WHERE id = ?')
    .run(date, memberName, type, amount, note, id);
}

function deleteHistoryEntry(id) {
  db.prepare('DELETE FROM history WHERE id = ?').run(id);
}

function clearHistory() {
  db.prepare('DELETE FROM history').run();
}

const importBackup = db.transaction((data) => {
  if (!data || typeof data !== 'object') {
    const err = new Error('Archivo de respaldo inválido.');
    err.status = 400;
    throw err;
  }

  db.prepare('DELETE FROM raffle_picks').run();
  db.prepare('DELETE FROM raffles').run();
  db.prepare('DELETE FROM loans').run();
  db.prepare('DELETE FROM history').run();
  db.prepare('DELETE FROM movements').run();
  db.prepare('DELETE FROM members').run();

  const s = data.settings || {};
  db.prepare(`
    UPDATE settings
    SET interest_rate = ?, base_cash = ?, max_loan_ratio = ?, max_single_loan = ?
    WHERE id = 1
  `).run(
    Number(s.interestRate) || 0,
    Number(s.baseCash) || 0,
    Math.min(100, Math.max(1, Number(s.maxLoanRatio) || 80)),
    Number(s.maxSingleLoan) || 0
  );

  const insertMember = db.prepare('INSERT INTO members (id, name, phone) VALUES (?, ?, ?)');
  for (const m of (Array.isArray(data.members) ? data.members : [])) {
    if (!m || !m.id || !m.name) continue;
    insertMember.run(String(m.id), normalizePersonName(m.name), String(m.phone || ''));
  }

  let foundActive = false;
  const insertRaffle = db.prepare('INSERT INTO raffles (id, name, price, status, closed_at) VALUES (?, ?, ?, ?, ?)');
  const insertPick = db.prepare('INSERT INTO raffle_picks (raffle_id, number_code, member_id, paid) VALUES (?, ?, ?, ?)');

  for (const r of (Array.isArray(data.raffles) ? data.raffles : [])) {
    if (!r || !r.id || !r.name) continue;
    let status = r.status === 'closed' ? 'closed' : 'active';
    if (status === 'active') {
      if (!foundActive) foundActive = true;
      else status = 'closed';
    }
    insertRaffle.run(String(r.id), String(r.name), Number(r.price) || 0, status, r.closedAt || null);
    if (r.picks && typeof r.picks === 'object') {
      for (const [code, pick] of Object.entries(r.picks)) {
        if (!pick || !pick.memberId) continue;
        insertPick.run(String(r.id), String(code).padStart(2, '0'), String(pick.memberId), pick.paid ? 1 : 0);
      }
    }
  }

  const defaultRate = Number(s.interestRate) || 0;
  const insertLoan = db.prepare(`
    INSERT INTO loans (
      id, sponsor_member_id, borrower_type, borrower_name, borrower_doc,
      borrower_phone, borrower_address, initial_amount, balance,
      interest_rate, interest_paid, date, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const l of (Array.isArray(data.loans) ? data.loans : [])) {
    if (!l || !l.id) continue;
    insertLoan.run(
      String(l.id),
      String(l.sponsorMemberId || ''),
      l.borrowerType === 'external' ? 'external' : 'member',
      String(l.borrowerName || ''),
      String(l.borrowerDoc || ''),
      String(l.borrowerPhone || ''),
      String(l.borrowerAddress || ''),
      Number(l.initialAmount) || 0,
      Number(l.balance) || 0,
      l.interestRate !== undefined && l.interestRate !== null ? Number(l.interestRate) : defaultRate,
      Number(l.interestPaid) || 0,
      String(l.date || todayCO()),
      String(l.notes || '')
    );
  }

  const insertHistory = db.prepare('INSERT INTO history (date, member_name, type, amount, note) VALUES (?, ?, ?, ?, ?)');
  for (const h of (Array.isArray(data.history) ? data.history : [])) {
    if (!h) continue;
    insertHistory.run(
      String(h.date || ''),
      String(h.memberName || ''),
      String(h.type || ''),
      Number(h.amount) || 0,
      String(h.note || '')
    );
  }

  const insertMovement = db.prepare(`
    INSERT INTO movements (id, date, direction, category, amount, description, member_id, raffle_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const mv of (Array.isArray(data.movements) ? data.movements : [])) {
    if (!mv || !mv.id || !mv.description) continue;
    const dir = mv.direction === 'out' ? 'out' : 'in';
    insertMovement.run(
      String(mv.id),
      String(mv.date || todayCO()),
      dir,
      String(mv.category || 'General'),
      Math.abs(Number(mv.amount) || 0),
      String(mv.description),
      String(mv.memberId || ''),
      String(mv.raffleId || '')
    );
  }
});

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPasswordHash(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  const derived = crypto.scryptSync(String(password), salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function getAuthInfo() {
  const envPassword = (process.env.ADMIN_PASSWORD || '').trim();
  if (envPassword) {
    return { configured: true, envManaged: true };
  }
  const row = db.prepare('SELECT admin_password_hash FROM settings WHERE id = 1').get();
  return {
    configured: Boolean(row && row.admin_password_hash),
    envManaged: false
  };
}

function setAdminPassword(password) {
  const clean = String(password || '').trim();
  if (clean.length < 4) {
    const err = new Error('La contraseña o PIN debe tener al menos 4 caracteres.');
    err.status = 400;
    throw err;
  }
  const hash = hashPassword(clean);
  db.prepare('UPDATE settings SET admin_password_hash = ? WHERE id = 1').run(hash);
}

function verifyAdminPassword(password) {
  const envPassword = (process.env.ADMIN_PASSWORD || '').trim();
  if (envPassword) {
    const a = Buffer.from(String(password || ''));
    const b = Buffer.from(envPassword);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const row = db.prepare('SELECT admin_password_hash FROM settings WHERE id = 1').get();
  if (!row || !row.admin_password_hash) return false;
  return verifyPasswordHash(String(password || ''), row.admin_password_hash);
}

function getSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim()) {
    return process.env.SESSION_SECRET.trim();
  }
  const row = db.prepare('SELECT session_secret FROM settings WHERE id = 1').get();
  return row ? row.session_secret : 'natillera-fallback-secret';
}

function getPublicRaffleState() {
  const membersRows = db.prepare('SELECT id, name FROM members ORDER BY name COLLATE NOCASE ASC').all();
  const memberNameById = new Map(membersRows.map(m => [m.id, m.name]));

  const activeRaffle = db.prepare("SELECT id, name, price FROM raffles WHERE status = 'active' LIMIT 1").get();
  let raffle = null;
  if (activeRaffle) {
    const picksRows = db.prepare('SELECT number_code, member_id, paid FROM raffle_picks WHERE raffle_id = ?').all(activeRaffle.id);
    const picks = {};
    for (const p of picksRows) {
      const fullName = memberNameById.get(p.member_id) || 'Ocupado';
      picks[p.number_code] = {
        memberId: p.member_id,
        firstName: fullName.split(' ')[0],
        paid: Boolean(p.paid)
      };
    }
    raffle = {
      id: activeRaffle.id,
      name: activeRaffle.name,
      price: Number(activeRaffle.price),
      picks
    };
  }

  return {
    raffle,
    members: membersRows.map(m => ({ id: m.id, name: m.name }))
  };
}

const createPublicMember = db.transaction(({ name, phone = '' }) => {
  const cleanName = normalizePersonName(name);
  const cleanPhone = String(phone || '').trim();
  if (!cleanName || cleanName.length < 2) {
    const err = new Error('Por favor ingresa tu nombre completo.');
    err.status = 400;
    throw err;
  }

  const existing = db.prepare('SELECT id, name FROM members WHERE LOWER(TRIM(name)) = LOWER(?)').get(cleanName);
  if (existing) {
    const err = new Error(`Ya existe un miembro registrado con el nombre "${existing.name}". Si ya te registraste, puedes ir directo a escoger tus números.`);
    err.status = 409;
    throw err;
  }

  const member = createMember({ name: cleanName, phone: cleanPhone });
  addHistory(
    todayCO(),
    member.name,
    'Auto-registro de Miembro',
    0,
    cleanPhone ? `Tel: ${cleanPhone} (vía enlace público)` : 'Registrado vía enlace público'
  );

  const activeRaffle = db.prepare("SELECT id, name, price FROM raffles WHERE status = 'active' LIMIT 1").get();
  return {
    member: { id: member.id, name: member.name },
    activeRaffle: activeRaffle
      ? { id: activeRaffle.id, name: activeRaffle.name, price: Number(activeRaffle.price) }
      : null
  };
});

function assignPublicPicks({ memberId, numbers }) {
  const activeRaffle = db.prepare("SELECT id FROM raffles WHERE status = 'active' LIMIT 1").get();
  if (!activeRaffle) {
    const err = new Error('En este momento no hay ninguna rifa activa.');
    err.status = 404;
    throw err;
  }
  assignPicks(activeRaffle.id, { memberId, numbers });
  return getPublicRaffleState();
}

function closeDb() {
  db.close();
}

module.exports = {
  DB_PATH,
  db,
  normalizePersonName,
  getFullState,
  updateSettings,
  createMember,
  updateMember,
  deleteMember,
  createRaffle,
  updateRaffle,
  closeRaffle,
  deleteRaffle,
  assignPicks,
  togglePickPaid,
  updatePick,
  releasePick,
  payMemberTickets,
  createLoan,
  updateLoan,
  updateLoanRate,
  recordLoanPayment,
  deleteLoan,
  createMovement,
  updateMovement,
  deleteMovement,
  updateHistoryEntry,
  deleteHistoryEntry,
  clearHistory,
  importBackup,
  getAuthInfo,
  setAdminPassword,
  verifyAdminPassword,
  getSessionSecret,
  getPublicRaffleState,
  createPublicMember,
  assignPublicPicks,
  closeDb
};
