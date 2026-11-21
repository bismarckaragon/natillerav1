let state = {
  settings: {
    interestRate: 0,
    baseCash: 0,
    maxLoanRatio: 80,
    maxSingleLoan: 0
  },
  raffles: [],
  members: [],
  loans: [],
  history: []
};

let tempSelectedNumbers = new Set();

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function apiRequest(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Error HTTP ${res.status}`);
  }
  return data;
}

function applyState(newState) {
  state = newState;
  document.getElementById('interestRateInput').value = state.settings.interestRate ?? 0;
  document.getElementById('baseCashInput').value = state.settings.baseCash ?? 0;
  document.getElementById('maxLoanRatioInput').value = state.settings.maxLoanRatio ?? 80;
  document.getElementById('maxSingleLoanInput').value = state.settings.maxSingleLoan ?? 0;
  renderAll();
}

async function loadState() {
  try {
    const data = await apiRequest('/api/state');
    applyState(data);
  } catch (err) {
    console.error(err);
    alert('No se pudo cargar los datos desde el servidor: ' + err.message);
  }
}

function getActiveRaffle() {
  return state.raffles.find(r => r.status === 'active') || null;
}

function formatMoney(val) {
  return '$' + Number(val || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function pad2(n) {
  return n.toString().padStart(2, '0');
}

function switchTab(tab, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('sec-' + tab).classList.add('active');
  btn.classList.add('active');
  if (tab === 'talonario') renderBoard();
}

async function updateSettings() {
  const interestRate = parseFloat(document.getElementById('interestRateInput').value) || 0;
  try {
    const data = await apiRequest('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ interestRate })
    });
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

async function updateLoanPolicies() {
  const baseCash = parseFloat(document.getElementById('baseCashInput').value) || 0;
  const maxLoanRatio = Math.min(100, Math.max(1, parseFloat(document.getElementById('maxLoanRatioInput').value) || 80));
  const maxSingleLoan = parseFloat(document.getElementById('maxSingleLoanInput').value) || 0;
  try {
    const data = await apiRequest('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ baseCash, maxLoanRatio, maxSingleLoan })
    });
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

function getMemberName(id) {
  const m = state.members.find(x => x.id === id);
  return m ? m.name : 'Desconocido';
}

// Cálculo financiero centralizado: incluye el recaudo histórico de rifas cerradas + rifa activa
function computeFinancials() {
  let totalRaffleCollected = 0;
  let totalRafflePending = 0;

  state.raffles.forEach(r => {
    const entries = Object.values(r.picks || {});
    const paid = entries.filter(x => x.paid).length;
    const assigned = entries.length;
    totalRaffleCollected += paid * r.price;
    totalRafflePending += (assigned - paid) * r.price;
  });

  let activeLoanBalance = 0;
  let totalInterestPaid = 0;
  let monthlyInterestExpected = 0;

  state.loans.forEach(l => {
    const bal = Number(l.balance || 0);
    const loanRate = Number(l.interestRate ?? state.settings.interestRate) / 100;
    activeLoanBalance += bal;
    totalInterestPaid += Number(l.interestPaid || 0);
    monthlyInterestExpected += bal * loanRate;
  });

  const baseCash = Number(state.settings.baseCash || 0);
  const totalCapital = baseCash + totalRaffleCollected + totalInterestPaid;
  const maxLoanAllowedFromCapital = totalCapital * ((state.settings.maxLoanRatio || 80) / 100);
  const availableCapitalForLoans = Math.max(0, maxLoanAllowedFromCapital - activeLoanBalance);
  const unallocatedCapital = totalCapital - activeLoanBalance;

  return {
    baseCash,
    totalRaffleCollected,
    totalRafflePending,
    activeLoanBalance,
    totalInterestPaid,
    monthlyInterestExpected,
    totalCapital,
    maxLoanAllowedFromCapital,
    availableCapitalForLoans,
    unallocatedCapital
  };
}

function getMemberRaffleStats(memberId) {
  let pendingMoney = 0;
  let paidMoney = 0;
  state.raffles.forEach(r => {
    Object.values(r.picks || {}).forEach(p => {
      if (p.memberId === memberId) {
        if (p.paid) paidMoney += r.price;
        else pendingMoney += r.price;
      }
    });
  });
  return { pendingMoney, paidMoney };
}

function getMemberLoanStats(memberId) {
  let activeBalance = 0;
  let monthlyInterest = 0;
  let interestPaid = 0;
  let count = 0;

  state.loans.forEach(l => {
    if (l.sponsorMemberId === memberId) {
      const bal = Number(l.balance || 0);
      const lRate = Number(l.interestRate ?? state.settings.interestRate) / 100;
      activeBalance += bal;
      monthlyInterest += bal * lRate;
      interestPaid += Number(l.interestPaid || 0);
      if (bal > 0) count++;
    }
  });
  return { activeBalance, monthlyInterest, interestPaid, count };
}

function renderAll() {
  const fin = computeFinancials();
  const activeRaffle = getActiveRaffle();

  // Control de botones "Nueva Rifa" según exista una activa o no
  const topBtn = document.getElementById('topNewRaffleBtn');
  const secBtn = document.getElementById('secRifasNewBtn');
  const ruleBanner = document.getElementById('raffleRuleBanner');

  if (activeRaffle) {
    topBtn.disabled = true;
    topBtn.title = 'Cierra primero la rifa activa antes de crear una nueva';
    secBtn.disabled = true;
    ruleBanner.className = 'alert-box alert-warn';
    ruleBanner.innerHTML = `🔒 Actualmente está habilitada la rifa <strong>"${escapeHtml(activeRaffle.name)}"</strong>. Para crear una nueva rifa, primero debes cerrar o terminar la rifa activa.`;
  } else {
    topBtn.disabled = false;
    topBtn.title = 'Crear una nueva rifa';
    secBtn.disabled = false;
    ruleBanner.className = 'alert-box alert-ok';
    ruleBanner.innerHTML = `✓ No hay ninguna rifa activa en curso. Puedes crear una nueva rifa ahora mismo.`;
  }

  const raffleStats = state.raffles.map(r => {
    const entries = Object.values(r.picks || {});
    const assigned = entries.length;
    const paid = entries.filter(x => x.paid).length;
    const missing = 100 - assigned;
    const collected = paid * r.price;
    const pending = (assigned - paid) * r.price;
    return { ...r, assigned, paid, missing, collected, pending };
  });

  // 1. KPIs Resumen General
  document.getElementById('kpiContainer').innerHTML = `
    <div class="kpi-card mint">
      <div class="kpi-title">Capital Total del Fondo</div>
      <div class="kpi-value" style="color:var(--primary)">${formatMoney(fin.totalCapital)}</div>
      <div class="kpi-sub">Disponible p/ prestar: ${formatMoney(fin.availableCapitalForLoans)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Cartera Prestada Activa</div>
      <div class="kpi-value">${formatMoney(fin.activeLoanBalance)}</div>
      <div class="kpi-sub">Capital libre sin prestar: ${formatMoney(fin.unallocatedCapital)}</div>
    </div>
    <div class="kpi-card peach">
      <div class="kpi-title">Por Cobrar en Boletas</div>
      <div class="kpi-value">${formatMoney(fin.totalRafflePending)}</div>
      <div class="kpi-sub">Recaudado total rifas: ${formatMoney(fin.totalRaffleCollected)}</div>
    </div>
    <div class="kpi-card rose">
      <div class="kpi-title">Interés Mensual Proyectado</div>
      <div class="kpi-value">${formatMoney(fin.monthlyInterestExpected)}</div>
      <div class="kpi-sub">Intereses cobrados hist.: ${formatMoney(fin.totalInterestPaid)}</div>
    </div>
  `;

  // 2. Resumen Rifa Activa en Sección 1
  const actionArea = document.getElementById('summaryRaffleActionArea');
  if (activeRaffle) {
    const actStat = raffleStats.find(x => x.id === activeRaffle.id);
    actionArea.innerHTML = `<button class="btn btn-warn btn-sm" onclick="closeActiveRaffle('${escapeHtml(activeRaffle.id)}')">Cerrar / Terminar Rifa Activa</button>`;
    document.getElementById('activeRaffleSummaryBody').innerHTML = `
      <tr>
        <td class="font-bold">${escapeHtml(actStat.name)}</td>
        <td><span class="badge badge-ok">Activa</span></td>
        <td class="text-right">${formatMoney(actStat.price)}</td>
        <td class="text-right font-bold">${actStat.assigned} / 100</td>
        <td class="text-right" style="color:var(--primary); font-weight:700;">${actStat.missing} libres</td>
        <td class="text-right">${actStat.paid}</td>
        <td class="text-right font-bold" style="color:var(--status-green-text)">${formatMoney(actStat.collected)}</td>
        <td class="text-right font-bold" style="color:var(--status-orange-text)">${formatMoney(actStat.pending)}</td>
      </tr>
    `;
  } else {
    actionArea.innerHTML = `<button class="btn btn-primary btn-sm" onclick="tryOpenNewRaffleModal()">+ Crear Nueva Rifa</button>`;
    document.getElementById('activeRaffleSummaryBody').innerHTML = `
      <tr><td colspan="8" class="empty-row">No hay ninguna rifa activa en este momento. Crea una nueva rifa para habilitar el talonario.</td></tr>
    `;
  }

  // 3. Consolidado por Miembro Responsable
  document.getElementById('summaryAlertsBody').innerHTML = state.members.length
    ? state.members.map(m => {
      const rStats = getMemberRaffleStats(m.id);
      const lStats = getMemberLoanStats(m.id);
      const totalDue = rStats.pendingMoney + lStats.activeBalance + lStats.monthlyInterest;
      return `
        <tr>
          <td class="font-bold">${escapeHtml(m.name)}</td>
          <td class="text-right">${formatMoney(rStats.pendingMoney)}</td>
          <td class="text-right">${formatMoney(lStats.activeBalance)} <small style="color:var(--muted)">(${lStats.count} act.)</small></td>
          <td class="text-right">${formatMoney(lStats.monthlyInterest)}</td>
          <td class="text-right font-bold">${formatMoney(totalDue)}</td>
        </tr>
      `;
    }).join('')
    : `<tr><td colspan="5" class="empty-row">No hay miembros registrados aún. Agrégalos en la pestaña "Registro por Miembro".</td></tr>`;

  // 4. Tabla Detallada de Miembros
  const query = (document.getElementById('searchMember')?.value || '').toLowerCase();
  const filtered = state.members.filter(m => m.name.toLowerCase().includes(query));

  document.getElementById('membersTableBody').innerHTML = filtered.length
    ? filtered.map(m => {
      const rStats = getMemberRaffleStats(m.id);
      const lStats = getMemberLoanStats(m.id);

      const raffleChips = state.raffles.map(r => {
        const myNums = Object.entries(r.picks || {})
          .filter(([_, data]) => data.memberId === m.id)
          .sort((a, b) => a[0].localeCompare(b[0]));

        if (myNums.length === 0) return '';
        const paidCount = myNums.filter(([_, d]) => d.paid).length;
        if (r.status === 'closed' && paidCount === myNums.length) return '';

        const pills = myNums.map(([num, d]) =>
          `<span class="num-pill ${d.paid ? 'paid' : 'unpaid'}" title="${d.paid ? 'Pagada' : 'Pendiente'}">#${escapeHtml(num)}</span>`
        ).join('');

        const statusLabel = r.status === 'active'
          ? `<span class="badge badge-ok" style="font-size:0.68rem;">Activa</span>`
          : `<span class="badge badge-closed" style="font-size:0.68rem;">Cerrada (Saldo pendiente)</span>`;

        return `
          <div class="raffle-chip">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem; gap:0.4rem;">
              <span><strong>${escapeHtml(r.name)}</strong> (${formatMoney(r.price)}) ${statusLabel}</span>
              <span>${paidCount}/${myNums.length} pagadas</span>
            </div>
            <div>${pills}</div>
          </div>
        `;
      }).join('') || `<span style="color:var(--muted); font-size:0.82rem;">Sin boletas activas o pendientes</span>`;

      return `
        <tr>
          <td>
            <div class="font-bold">${escapeHtml(m.name)}</div>
            <small style="color:var(--muted)">${escapeHtml(m.phone || '')}</small>
          </td>
          <td>${raffleChips}</td>
          <td class="text-right font-bold" style="color:${rStats.pendingMoney > 0 ? 'var(--status-orange-text)' : 'var(--status-green-text)'}">
            ${formatMoney(rStats.pendingMoney)}
          </td>
          <td class="text-right font-bold">${formatMoney(lStats.activeBalance)}</td>
          <td class="text-right" style="color:var(--primary); font-weight:700;">${formatMoney(lStats.monthlyInterest)}</td>
          <td class="text-right">${formatMoney(lStats.interestPaid)}</td>
          <td>
            <button class="btn btn-accent btn-sm" onclick="openActionModal('${escapeHtml(m.id)}')">Pagar Boletas</button>
            <button class="btn btn-outline btn-sm" onclick="deleteMember('${escapeHtml(m.id)}')">Eliminar</button>
          </td>
        </tr>
      `;
    }).join('')
    : `<tr><td colspan="7" class="empty-row">${state.members.length ? 'No se encontraron miembros con ese criterio.' : 'No hay miembros registrados aún. Haz clic en "+ Nuevo Miembro" para comenzar.'}</td></tr>`;

  // 5. SECCIÓN 4: CONTROL DE PRÉSTAMOS Y CAPITAL
  renderLoansSection(fin);

  // 6. Tabla de gestión e historial de rifas (Sección 5)
  document.getElementById('rafflesManageBody').innerHTML = raffleStats.length
    ? raffleStats.slice().reverse().map(r => {
      const isAct = r.status === 'active';
      const badge = isAct
        ? `<span class="badge badge-ok">Activa en Curso</span>`
        : `<span class="badge badge-closed">Cerrada ${r.closedAt ? '(' + escapeHtml(r.closedAt) + ')' : ''}</span>`;
      const actionBtn = isAct
        ? `<button class="btn btn-warn btn-sm" onclick="closeActiveRaffle('${escapeHtml(r.id)}')">Cerrar / Terminar Rifa</button>`
        : `<button class="btn btn-danger btn-sm" onclick="deleteRaffle('${escapeHtml(r.id)}')">Eliminar Historial</button>`;

      return `
        <tr>
          <td class="font-bold">${escapeHtml(r.name)}</td>
          <td>${badge}</td>
          <td class="text-right">${formatMoney(r.price)}</td>
          <td class="text-right">${r.assigned} / 100</td>
          <td class="text-right">${r.paid}</td>
          <td class="text-right font-bold" style="color:var(--status-green-text)">${formatMoney(r.collected)}</td>
          <td class="text-right font-bold" style="color:${r.pending > 0 ? 'var(--status-orange-text)' : 'var(--muted)'}">${formatMoney(r.pending)}</td>
          <td>${actionBtn}</td>
        </tr>
      `;
    }).join('')
    : `<tr><td colspan="8" class="empty-row">No hay rifas registradas aún. Crea tu primera rifa para habilitar el talonario.</td></tr>`;

  // 7. Historial
  document.getElementById('historyTableBody').innerHTML = state.history.length
    ? state.history.slice().reverse().map(h => `
      <tr>
        <td>${escapeHtml(h.date)}</td>
        <td class="font-bold">${escapeHtml(h.memberName)}</td>
        <td>${escapeHtml(h.type)}</td>
        <td class="text-right font-bold">${formatMoney(h.amount)}</td>
        <td>${escapeHtml(h.note || '-')}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="5" class="empty-row">No hay movimientos registrados aún.</td></tr>`;

  syncBoardSelectors();
  renderBoard();
}

// --- CONTROL DE RIFA ÚNICA ACTIVA ---
function tryOpenNewRaffleModal() {
  const active = getActiveRaffle();
  if (active) {
    return alert(`Ya existe una rifa activa ("${active.name}").\n\nDebes cerrar o terminar la rifa actual antes de poder crear una nueva.`);
  }
  openModal('raffleModal');
}

async function saveNewRaffle(e) {
  e.preventDefault();
  if (getActiveRaffle()) {
    closeModal('raffleModal');
    return alert('Ya hay una rifa activa en curso. Ciérrala primero.');
  }
  const name = document.getElementById('rName').value.trim();
  const price = parseFloat(document.getElementById('rPrice').value) || 0;
  if (!name || price <= 0) return;

  try {
    const data = await apiRequest('/api/raffles', {
      method: 'POST',
      body: JSON.stringify({ name, price })
    });
    tempSelectedNumbers.clear();
    e.target.reset();
    closeModal('raffleModal');
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

async function closeActiveRaffle(id) {
  const raffle = state.raffles.find(r => r.id === id);
  if (!raffle || raffle.status !== 'active') return;

  const entries = Object.values(raffle.picks || {});
  const assigned = entries.length;
  const paid = entries.filter(x => x.paid).length;
  const unpaid = assigned - paid;
  const collected = paid * raffle.price;
  const pendingMoney = unpaid * raffle.price;

  const msg = `¿Confirmas CERRAR y TERMINAR la rifa "${raffle.name}"?\n\n` +
    `• Números escogidos: ${assigned} de 100\n` +
    `• Boletas pagadas: ${paid} (${formatMoney(collected)})\n` +
    `• Boletas pendientes de pago: ${unpaid} (${formatMoney(pendingMoney)})\n\n` +
    `Al cerrarla, no se podrán escoger más números en esta rifa y quedará habilitada la creación de la siguiente rifa.`;

  if (!confirm(msg)) return;

  try {
    const data = await apiRequest(`/api/raffles/${encodeURIComponent(id)}/close`, { method: 'POST' });
    tempSelectedNumbers.clear();
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteRaffle(id) {
  const r = state.raffles.find(x => x.id === id);
  if (!r) return;
  if (r.status === 'active') return alert('No puedes eliminar una rifa activa directamente; primero debes cerrarla.');
  if (!confirm(`¿Eliminar "${r.name}" del historial? Esto descontará su recaudo del Capital Total.`)) return;

  try {
    const data = await apiRequest(`/api/raffles/${encodeURIComponent(id)}`, { method: 'DELETE' });
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

// --- LÓGICA DEL TALONARIO 00 AL 99 (SOLO RIFA ACTIVA) ---
function syncBoardSelectors() {
  const mSel = document.getElementById('boardMemberSelect');
  const prevM = mSel.value;
  if (state.members.length === 0) {
    mSel.innerHTML = `<option value="">-- Primero registra un miembro --</option>`;
    return;
  }
  mSel.innerHTML = state.members.map(m =>
    `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`
  ).join('');
  if (state.members.some(m => m.id === prevM)) mSel.value = prevM;
}

function renderBoard() {
  const raffle = getActiveRaffle();
  const infoBanner = document.getElementById('boardActiveRaffleInfo');
  const wrapper = document.getElementById('boardInteractiveWrapper');
  const jpgBtn = document.getElementById('downloadJpgBtn');
  const grid = document.getElementById('numberGrid');
  const missingList = document.getElementById('missingNumbersList');
  const missingHeader = document.getElementById('missingHeader');
  const confirmBtn = document.getElementById('confirmSelectionBtn');

  if (!raffle) {
    jpgBtn.disabled = true;
    wrapper.style.display = 'none';
    infoBanner.innerHTML = `
      <div>
        <strong style="color:var(--primary); font-size:1rem;">No hay ninguna rifa activa en este momento</strong>
        <p style="font-size:0.85rem; color:var(--muted);">Crea una nueva rifa para habilitar el talonario del 00 al 99.</p>
      </div>
      <button class="btn btn-primary" onclick="tryOpenNewRaffleModal()">+ Crear Nueva Rifa Activa</button>
    `;
    return;
  }

  jpgBtn.disabled = false;
  wrapper.style.display = 'block';

  const picks = raffle.picks || {};
  const takenCount = Object.keys(picks).length;
  const paidCount = Object.values(picks).filter(x => x.paid).length;

  infoBanner.innerHTML = `
    <div>
      <span class="badge badge-ok" style="margin-bottom:0.25rem;">RIFA ACTIVA EN CURSO</span>
      <h4 style="font-size:1.08rem; color:var(--text);">${escapeHtml(raffle.name)}</h4>
      <span style="font-size:0.84rem; color:var(--muted);">Valor por boleta: <strong>${formatMoney(raffle.price)}</strong> | Escogidos: <strong>${takenCount}/100</strong> | Pagados: <strong>${paidCount}</strong></span>
    </div>
    <button class="btn btn-warn btn-sm" onclick="closeActiveRaffle('${escapeHtml(raffle.id)}')">Cerrar / Terminar Rifa</button>
  `;

  let html = '';
  const missingNums = [];

  for (let i = 0; i < 100; i++) {
    const code = pad2(i);
    const taken = picks[code];

    if (taken) {
      const ownerName = getMemberName(taken.memberId);
      const statusClass = taken.paid ? 'taken-paid' : 'taken-unpaid';
      html += `
        <div class="num-cell ${statusClass}" onclick="openNumberDetail('${code}')" title="#${code} - ${escapeHtml(ownerName)} (${taken.paid ? 'Pagado' : 'Pendiente'})">
          <span class="n-code">${code}</span>
          <span class="n-owner">${escapeHtml(ownerName.split(' ')[0])}</span>
        </div>
      `;
    } else {
      missingNums.push(code);
      const isSelected = tempSelectedNumbers.has(code);
      html += `
        <div class="num-cell ${isSelected ? 'selected-now' : 'free'}" onclick="toggleSelectFreeNumber('${code}')">
          <span class="n-code">${code}</span>
          <span class="n-owner">${isSelected ? 'Elegido' : 'Libre'}</span>
        </div>
      `;
    }
  }

  grid.innerHTML = html;

  const totalCost = tempSelectedNumbers.size * raffle.price;
  confirmBtn.textContent = `Confirmar Selección (${tempSelectedNumbers.size} boletas = ${formatMoney(totalCost)})`;

  missingHeader.textContent = `Vista Administrador — Faltan ${missingNums.length} de 100 números por escoger en "${raffle.name}":`;
  missingList.innerHTML = missingNums.length
    ? missingNums.map(n => `<span class="missing-tag">${n}</span>`).join('')
    : `<span class="badge badge-ok">¡Talonario completo! Los 100 números ya fueron escogidos.</span>`;
}

function toggleSelectFreeNumber(code) {
  if (tempSelectedNumbers.has(code)) {
    tempSelectedNumbers.delete(code);
  } else {
    tempSelectedNumbers.add(code);
  }
  renderBoard();
}

async function confirmSelectedNumbers() {
  const raffle = getActiveRaffle();
  const mId = document.getElementById('boardMemberSelect').value;
  const member = state.members.find(m => m.id === mId);

  if (!raffle) return alert('No hay ninguna rifa activa.');
  if (!member) return alert('Primero registra y selecciona un miembro.');
  if (tempSelectedNumbers.size === 0) return alert('Haz clic en uno o más números libres del talonario para seleccionarlos.');

  const chosenList = Array.from(tempSelectedNumbers).sort();

  try {
    const data = await apiRequest(`/api/raffles/${encodeURIComponent(raffle.id)}/picks`, {
      method: 'POST',
      body: JSON.stringify({ memberId: mId, numbers: chosenList })
    });
    tempSelectedNumbers.clear();
    applyState(data);
  } catch (err) {
    alert(err.message);
    tempSelectedNumbers.clear();
    await loadState();
  }
}

// --- DESCARGAR IMAGEN JPG DEL TALONARIO DE LA RIFA ACTIVA ---
function downloadRaffleJPG() {
  const raffle = getActiveRaffle();
  if (!raffle) return alert('No hay una rifa activa para descargar.');

  const picks = raffle.picks || {};
  const canvas = document.createElement('canvas');
  const width = 900;
  const height = 1040;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#faf7fc';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#8e7aa6';
  ctx.fillRect(0, 0, width, 135);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(raffle.name.toUpperCase(), width / 2, 62);

  const takenCount = Object.keys(picks).length;
  const freeCount = 100 - takenCount;
  ctx.fillStyle = '#f2ecf9';
  ctx.font = '600 20px "Segoe UI", Arial, sans-serif';
  ctx.fillText(`Valor Boleta: ${formatMoney(raffle.price)}   |   Disponibles: ${freeCount} de 100`, width / 2, 104);

  const startX = 45;
  const startY = 165;
  const cols = 10;
  const gap = 10;
  const cellW = (width - startX * 2 - gap * (cols - 1)) / cols;
  const cellH = 72;

  for (let i = 0; i < 100; i++) {
    const code = pad2(i);
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = startX + col * (cellW + gap);
    const y = startY + row * (cellH + gap);
    const isTaken = Boolean(picks[code]);

    ctx.beginPath();
    ctx.roundRect(x, y, cellW, cellH, 10);

    if (isTaken) {
      ctx.fillStyle = '#ede7f3';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#cbbad9';
      ctx.stroke();

      ctx.fillStyle = '#9b8ea8';
      ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(code, x + cellW / 2, y + cellH / 2);

      ctx.strokeStyle = '#e07a5f';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + 12, y + cellH - 14);
      ctx.lineTo(x + cellW - 12, y + 14);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x + 12, y + 14);
      ctx.lineTo(x + cellW - 12, y + cellH - 14);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#84a59d';
      ctx.stroke();

      ctx.fillStyle = '#2d3748';
      ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(code, x + cellW / 2, y + cellH / 2);
    }
  }

  ctx.fillStyle = '#6d597a';
  ctx.font = '600 17px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Números sin tachar están DISPONIBLES — ¡Escoge el tuyo!', width / 2, height - 24);

  const link = document.createElement('a');
  const safeName = raffle.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  link.download = `talonario-${safeName}.jpg`;
  link.href = canvas.toDataURL('image/jpeg', 0.95);
  link.click();
}

function openNumberDetail(code) {
  const raffle = getActiveRaffle();
  if (!raffle || !raffle.picks[code]) return;

  const pick = raffle.picks[code];
  const ownerName = getMemberName(pick.memberId);

  document.getElementById('numModalCode').value = code;
  document.getElementById('numModalTitle').textContent = `Boleta #${code} — ${raffle.name}`;
  document.getElementById('numModalInfo').innerHTML = `
    <strong>Responsable:</strong> ${escapeHtml(ownerName)}<br>
    <strong>Valor Boleta:</strong> ${formatMoney(raffle.price)}<br>
    <strong>Estado actual:</strong> ${pick.paid ? '<span class="badge badge-ok">Pagada</span>' : '<span class="badge badge-pending">Pendiente de Pago</span>'}
  `;
  document.getElementById('togglePaidNumberBtn').textContent = pick.paid ? 'Marcar como Pendiente' : 'Marcar como Pagada';
  openModal('numberDetailModal');
}

async function toggleNumberPaid() {
  const raffle = getActiveRaffle();
  const code = document.getElementById('numModalCode').value;
  if (!raffle || !raffle.picks[code]) return;

  try {
    const data = await apiRequest(`/api/raffles/${encodeURIComponent(raffle.id)}/picks/${encodeURIComponent(code)}`, {
      method: 'PATCH'
    });
    closeModal('numberDetailModal');
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

async function releaseNumber() {
  const raffle = getActiveRaffle();
  const code = document.getElementById('numModalCode').value;
  if (!raffle || !raffle.picks[code]) return;

  if (!confirm(`¿Liberar el número #${code} para que quede disponible nuevamente?`)) return;

  try {
    const data = await apiRequest(`/api/raffles/${encodeURIComponent(raffle.id)}/picks/${encodeURIComponent(code)}`, {
      method: 'DELETE'
    });
    closeModal('numberDetailModal');
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

function copyMissingNumbers() {
  const raffle = getActiveRaffle();
  if (!raffle) return;
  const picks = raffle.picks || {};
  const free = [];
  for (let i = 0; i < 100; i++) {
    const code = pad2(i);
    if (!picks[code]) free.push(code);
  }
  const text = `Números disponibles (${raffle.name} - ${formatMoney(raffle.price)}):\n${free.join(', ')}`;
  navigator.clipboard?.writeText(text);
  alert('Lista de números disponibles copiada al portapapeles.');
}

// --- RENDERIZADO SECCIÓN 4: CONTROL DE PRÉSTAMOS Y CAPITAL ---
function renderLoansSection(fin) {
  const usedPct = fin.maxLoanAllowedFromCapital > 0
    ? Math.min(100, Math.round((fin.activeLoanBalance / fin.maxLoanAllowedFromCapital) * 100))
    : 0;

  document.getElementById('loanCashKpiContainer').innerHTML = `
    <div class="kpi-card mint">
      <div class="kpi-title">Capital Total del Fondo</div>
      <div class="kpi-value" style="color:var(--primary)">${formatMoney(fin.totalCapital)}</div>
      <div class="kpi-sub">Base (${formatMoney(fin.baseCash)}) + Rifas + Intereses</div>
    </div>
    <div class="kpi-card sky">
      <div class="kpi-title">Disponible del Capital p/ Prestar</div>
      <div class="kpi-value" style="color:${fin.availableCapitalForLoans > 0 ? 'var(--status-green-text)' : 'var(--status-red-text)'}">
        ${formatMoney(fin.availableCapitalForLoans)}
      </div>
      <div class="kpi-sub">Tope (${state.settings.maxLoanRatio}% del Capital): ${formatMoney(fin.maxLoanAllowedFromCapital)}</div>
    </div>
    <div class="kpi-card peach">
      <div class="kpi-title">Capital Prestado en Calle</div>
      <div class="kpi-value">${formatMoney(fin.activeLoanBalance)}</div>
      <div class="kpi-sub">Saldo sin prestar: ${formatMoney(fin.unallocatedCapital)}</div>
    </div>
    <div class="kpi-card rose">
      <div class="kpi-title">Renta Mensual por Intereses</div>
      <div class="kpi-value">${formatMoney(fin.monthlyInterestExpected)}</div>
      <div class="kpi-sub">Suma de tasas individuales activas</div>
    </div>
  `;

  document.getElementById('loanCapacityText').textContent =
    `${formatMoney(fin.activeLoanBalance)} de ${formatMoney(fin.maxLoanAllowedFromCapital)} (${usedPct}% del cupo)`;
  const bar = document.getElementById('loanCapacityBar');
  bar.style.width = usedPct + '%';
  bar.style.background = usedPct >= 90 ? '#ef4444' : (usedPct >= 70 ? '#f97316' : '#22c55e');

  const filterStatus = document.getElementById('filterLoanStatus')?.value || 'active';
  const loansList = state.loans.filter(l => filterStatus === 'all' ? true : l.balance > 0);

  document.getElementById('loansTableBody').innerHTML = loansList.length
    ? loansList.map(l => {
      const sponsorName = getMemberName(l.sponsorMemberId);
      const lRate = Number(l.interestRate ?? state.settings.interestRate);
      const monthlyInt = l.balance * (lRate / 100);
      const typeBadge = l.borrowerType === 'external'
        ? `<span class="badge badge-ext">Externo</span>`
        : `<span class="badge badge-ok">Miembro</span>`;

      return `
        <tr>
          <td>${escapeHtml(l.date)}</td>
          <td>
            <div class="font-bold">${escapeHtml(l.borrowerName)}</div>
            <small style="color:var(--muted)">CC: ${escapeHtml(l.borrowerDoc || '-')} | Tel: ${escapeHtml(l.borrowerPhone || '-')}</small>
          </td>
          <td>${typeBadge}</td>
          <td class="font-bold" style="color:var(--primary)">${escapeHtml(sponsorName)}</td>
          <td class="text-right">${formatMoney(l.initialAmount)}</td>
          <td class="text-right font-bold" style="color:${l.balance > 0 ? 'var(--status-orange-text)' : 'var(--status-green-text)'}">
            ${formatMoney(l.balance)}
          </td>
          <td class="text-right font-bold" style="color:var(--primary)">${lRate}%</td>
          <td class="text-right font-bold">${formatMoney(monthlyInt)}</td>
          <td class="text-right">${formatMoney(l.interestPaid)}</td>
          <td>
            <button class="btn btn-accent btn-sm" onclick="openLoanManageModal('${escapeHtml(l.id)}')">Gestionar / Pagar</button>
          </td>
        </tr>
      `;
    }).join('')
    : `<tr><td colspan="10" class="empty-row">No hay préstamos registrados en este filtro.</td></tr>`;
}

// --- FORMULARIO DE NUEVO PRÉSTAMO ---
function openNewLoanModal() {
  if (state.members.length === 0) return alert('Primero debes registrar al menos un miembro responsable.');
  const fin = computeFinancials();

  const sponsorSel = document.getElementById('loanSponsorId');
  sponsorSel.innerHTML = state.members.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');

  document.getElementById('loanBorrowerType').value = 'member';
  document.getElementById('bDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('bAmount').value = '';
  document.getElementById('bInterestRate').value = state.settings.interestRate;
  document.getElementById('bNotes').value = '';
  document.getElementById('loanValidationMsg').textContent = '';

  const banner = document.getElementById('loanLimitBanner');
  const topeText = state.settings.maxSingleLoan > 0 ? ` | Tope por préstamo: ${formatMoney(state.settings.maxSingleLoan)}` : '';
  banner.className = fin.availableCapitalForLoans > 0 ? 'alert-box alert-ok' : 'alert-box alert-err';
  banner.textContent = `Capital Total: ${formatMoney(fin.totalCapital)} | Cupo disponible para prestar (${state.settings.maxLoanRatio}%): ${formatMoney(fin.availableCapitalForLoans)}${topeText}`;

  onBorrowerTypeChange();
  openModal('newLoanModal');
}

function onBorrowerTypeChange() {
  const type = document.getElementById('loanBorrowerType').value;
  const sponsorId = document.getElementById('loanSponsorId').value;
  const sponsor = state.members.find(m => m.id === sponsorId);

  if (type === 'member' && sponsor) {
    document.getElementById('bFullName').value = sponsor.name;
    document.getElementById('bPhone').value = sponsor.phone || '';
    document.getElementById('bDocument').value = '';
    document.getElementById('bAddress').value = '';
  } else {
    document.getElementById('bFullName').value = '';
    document.getElementById('bDocument').value = '';
    document.getElementById('bPhone').value = '';
    document.getElementById('bAddress').value = '';
  }
}

function validateLoanAmountPreview() {
  const fin = computeFinancials();
  const amount = parseFloat(document.getElementById('bAmount').value) || 0;
  const customRate = parseFloat(document.getElementById('bInterestRate').value) || 0;
  const msg = document.getElementById('loanValidationMsg');
  const maxSingle = Number(state.settings.maxSingleLoan || 0);

  if (amount <= 0) {
    msg.textContent = '';
    return true;
  }
  if (amount > fin.unallocatedCapital) {
    msg.style.color = 'var(--status-red-text)';
    msg.textContent = `⚠️ El monto (${formatMoney(amount)}) supera el saldo sin prestar del Capital Total (${formatMoney(fin.unallocatedCapital)}).`;
    return false;
  }
  if (amount > fin.availableCapitalForLoans) {
    msg.style.color = 'var(--status-orange-text)';
    msg.textContent = `⚠️ Supera el límite configurado sobre el Capital Total (${state.settings.maxLoanRatio}% = máx. ${formatMoney(fin.availableCapitalForLoans)} disponibles).`;
    return false;
  }
  if (maxSingle > 0 && amount > maxSingle) {
    msg.style.color = 'var(--status-orange-text)';
    msg.textContent = `⚠️ Supera el tope máximo permitido por préstamo individual (${formatMoney(maxSingle)}).`;
    return false;
  }

  const monthlyInt = amount * (customRate / 100);
  msg.style.color = 'var(--status-green-text)';
  msg.textContent = `✓ Desembolso válido desde Capital Total. Generará ${formatMoney(monthlyInt)} al mes (${customRate}% mensual).`;
  return true;
}

async function saveNewLoan(e) {
  e.preventDefault();
  const isValid = validateLoanAmountPreview();
  if (!isValid && !confirm('El monto supera los límites configurados del Capital Total. ¿Deseas autorizarlo de todas formas?')) {
    return;
  }

  const sponsorMemberId = document.getElementById('loanSponsorId').value;
  const borrowerType = document.getElementById('loanBorrowerType').value;
  const borrowerName = document.getElementById('bFullName').value.trim();
  const borrowerDoc = document.getElementById('bDocument').value.trim();
  const borrowerPhone = document.getElementById('bPhone').value.trim();
  const borrowerAddress = document.getElementById('bAddress').value.trim();
  const amount = parseFloat(document.getElementById('bAmount').value) || 0;
  const interestRate = parseFloat(document.getElementById('bInterestRate').value);
  const date = document.getElementById('bDate').value;
  const notes = document.getElementById('bNotes').value.trim();

  if (!sponsorMemberId || !borrowerName || amount <= 0 || isNaN(interestRate)) return;

  try {
    const data = await apiRequest('/api/loans', {
      method: 'POST',
      body: JSON.stringify({
        sponsorMemberId,
        borrowerType,
        borrowerName,
        borrowerDoc,
        borrowerPhone,
        borrowerAddress,
        amount,
        interestRate,
        date,
        notes
      })
    });
    closeModal('newLoanModal');
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

function openLoanManageModal(loanId) {
  const loan = state.loans.find(l => l.id === loanId);
  if (!loan) return;
  const sponsorName = getMemberName(loan.sponsorMemberId);
  const lRate = Number(loan.interestRate ?? state.settings.interestRate);
  const monthlyInt = loan.balance * (lRate / 100);

  document.getElementById('lmLoanId').value = loan.id;
  document.getElementById('lmTitle').textContent = `Préstamo: ${loan.borrowerName}`;
  document.getElementById('lmEditRateInput').value = lRate;
  document.getElementById('lmBorrowerCard').innerHTML = `
    <strong>Deudor:</strong> ${escapeHtml(loan.borrowerName)} (${loan.borrowerType === 'external' ? 'Externo' : 'Miembro'})<br>
    <strong>Documento:</strong> ${escapeHtml(loan.borrowerDoc || '-')} | <strong>Teléfono:</strong> ${escapeHtml(loan.borrowerPhone || '-')}<br>
    <strong>Dirección:</strong> ${escapeHtml(loan.borrowerAddress || '-')}<br>
    <strong>Miembro Responsable:</strong> ${escapeHtml(sponsorName)}<br>
    <strong>Saldo Adeudado:</strong> ${formatMoney(loan.balance)} | <strong>Tasa Pactada:</strong> ${lRate}% mensual (${formatMoney(monthlyInt)}/mes)<br>
    <strong>Notas:</strong> ${escapeHtml(loan.notes || 'Ninguna')}
  `;
  document.getElementById('lmPayNote').value = '';
  updateLoanPayHint();
  openModal('loanManageModal');
}

async function updateSingleLoanRate() {
  const loanId = document.getElementById('lmLoanId').value;
  const newRate = parseFloat(document.getElementById('lmEditRateInput').value);
  if (isNaN(newRate) || newRate < 0) return alert('Ingresa una tasa válida.');

  try {
    const data = await apiRequest(`/api/loans/${encodeURIComponent(loanId)}/rate`, {
      method: 'PATCH',
      body: JSON.stringify({ interestRate: newRate })
    });
    applyState(data);
    openLoanManageModal(loanId);
  } catch (err) {
    alert(err.message);
  }
}

function updateLoanPayHint() {
  const loan = state.loans.find(l => l.id === document.getElementById('lmLoanId').value);
  if (!loan) return;
  const action = document.getElementById('lmActionType').value;
  const input = document.getElementById('lmPayAmount');
  const hint = document.getElementById('lmPayHint');
  const lRate = Number(loan.interestRate ?? state.settings.interestRate);
  const monthlyInt = loan.balance * (lRate / 100);

  if (action === 'interest') {
    input.value = monthlyInt;
    hint.textContent = `Interés calculado del mes (${lRate}% sobre ${formatMoney(loan.balance)}): ${formatMoney(monthlyInt)}. Suma al Capital Total.`;
  } else {
    input.value = loan.balance;
    hint.textContent = `Saldo capital actual: ${formatMoney(loan.balance)}. Al abonar libera cupo en el Capital Total.`;
  }
}

async function executeLoanPayment(e) {
  e.preventDefault();
  const loanId = document.getElementById('lmLoanId').value;
  const action = document.getElementById('lmActionType').value;
  const amount = parseFloat(document.getElementById('lmPayAmount').value) || 0;
  const note = document.getElementById('lmPayNote').value.trim();

  if (!loanId || amount <= 0) return;

  try {
    const data = await apiRequest(`/api/loans/${encodeURIComponent(loanId)}/payments`, {
      method: 'POST',
      body: JSON.stringify({ action, amount, note })
    });
    closeModal('loanManageModal');
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteLoanRecord() {
  const id = document.getElementById('lmLoanId').value;
  if (!confirm('¿Eliminar este registro de préstamo?')) return;

  try {
    const data = await apiRequest(`/api/loans/${encodeURIComponent(id)}`, { method: 'DELETE' });
    closeModal('loanManageModal');
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

// --- MODALES GENERALES ---
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

async function saveNewMember(e) {
  e.preventDefault();
  const name = document.getElementById('mName').value.trim();
  const phone = document.getElementById('mPhone').value.trim();
  if (!name) return;

  try {
    const data = await apiRequest('/api/members', {
      method: 'POST',
      body: JSON.stringify({ name, phone })
    });
    e.target.reset();
    closeModal('memberModal');
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

function openActionModal(memberId) {
  const member = state.members.find(m => m.id === memberId);
  if (!member) return;
  document.getElementById('actMemberId').value = memberId;
  document.getElementById('actionModalTitle').textContent = `Pagar Boletas: ${member.name}`;

  const eligibleRaffles = state.raffles.filter(r => {
    if (r.status === 'active') return true;
    return Object.values(r.picks || {}).some(p => p.memberId === memberId && !p.paid);
  });

  const rSelect = document.getElementById('actRaffleId');
  rSelect.innerHTML = eligibleRaffles.length
    ? eligibleRaffles.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)} (${formatMoney(r.price)} c/u)${r.status === 'closed' ? ' [Cerrada]' : ''}</option>`).join('')
    : `<option value="">Sin rifas disponibles</option>`;

  document.getElementById('actNote').value = '';
  updateActionHint();
  openModal('actionModal');
}

function updateActionHint() {
  const member = state.members.find(m => m.id === document.getElementById('actMemberId').value);
  const rId = document.getElementById('actRaffleId').value;
  const raffle = state.raffles.find(r => r.id === rId);
  const hint = document.getElementById('actHint');
  const input = document.getElementById('actAmount');

  if (!raffle || !member) { hint.textContent = 'No hay rifas activas ni pendientes.'; return; }
  const unpaidNums = Object.entries(raffle.picks || {})
    .filter(([_, d]) => d.memberId === member.id && !d.paid)
    .map(([num]) => num)
    .sort();

  hint.textContent = unpaidNums.length
    ? `Pendientes en "${raffle.name}": ${unpaidNums.length} boleta(s) (#${unpaidNums.join(', #')}) = ${formatMoney(unpaidNums.length * raffle.price)}`
    : `No tiene boletas pendientes en "${raffle.name}".`;
  input.value = unpaidNums.length || 1;
}

async function executeMemberAction(e) {
  e.preventDefault();
  const memberId = document.getElementById('actMemberId').value;
  const raffleId = document.getElementById('actRaffleId').value;
  const count = parseInt(document.getElementById('actAmount').value, 10) || 0;
  const note = document.getElementById('actNote').value.trim();

  if (!memberId || !raffleId || count <= 0) return;

  try {
    const data = await apiRequest(`/api/members/${encodeURIComponent(memberId)}/pay-tickets`, {
      method: 'POST',
      body: JSON.stringify({ raffleId, count, note })
    });
    closeModal('actionModal');
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteMember(id) {
  if (!confirm('¿Eliminar este miembro? Sus números escogidos en la rifa activa quedarán libres nuevamente.')) return;
  try {
    const data = await apiRequest(`/api/members/${encodeURIComponent(id)}`, { method: 'DELETE' });
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

async function clearHistory() {
  if (!confirm('¿Limpiar todo el historial de movimientos?')) return;
  try {
    const data = await apiRequest('/api/history', { method: 'DELETE' });
    applyState(data);
  } catch (err) {
    alert(err.message);
  }
}

function exportBackup() {
  window.location.href = '/api/backup';
}

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      const data = await apiRequest('/api/backup/import', {
        method: 'POST',
        body: JSON.stringify(parsed)
      });
      tempSelectedNumbers.clear();
      applyState(data);
      alert('Respaldo cargado y guardado en SQLite correctamente.');
    } catch (err) {
      alert('No se pudo importar el archivo: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

loadState();
