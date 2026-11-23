let publicData = { raffle: null, members: [] };
let selectedNumbers = new Set();

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(val) {
  return '$' + Number(val || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function pad2(n) {
  return n.toString().padStart(2, '0');
}

function showPublicAlert(type, message) {
  const el = document.getElementById('publicRaffleAlert');
  el.className = `alert-box ${type === 'error' ? 'alert-err' : 'alert-ok'}`;
  el.textContent = message;
  el.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function hidePublicAlert() {
  const el = document.getElementById('publicRaffleAlert');
  el.style.display = 'none';
}

function getPreselectedMemberId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('miembro') || '';
}

async function loadPublicRaffle(keepAlert = false) {
  if (!keepAlert) hidePublicAlert();
  try {
    const res = await fetch('/api/public/raffle');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error HTTP ${res.status}`);

    publicData = data;
    // Remove any locally selected number that was taken in the meantime
    if (publicData.raffle) {
      for (const code of Array.from(selectedNumbers)) {
        if (publicData.raffle.picks[code]) {
          selectedNumbers.delete(code);
        }
      }
    } else {
      selectedNumbers.clear();
    }

    syncMemberDropdown();
    renderPublicBoard();
  } catch (err) {
    showPublicAlert('error', 'No se pudo cargar el talonario: ' + err.message);
  }
}

function syncMemberDropdown() {
  const sel = document.getElementById('pubMemberSelect');
  const currentVal = sel.value;
  const fromQuery = getPreselectedMemberId();

  if (!publicData.members.length) {
    sel.innerHTML = `<option value="">-- Aún no hay miembros registrados --</option>`;
    return;
  }

  sel.innerHTML = `<option value="">-- Selecciona tu nombre --</option>` +
    publicData.members.map((m, idx) =>
      `<option value="${escapeHtml(m.id)}">${idx + 1}. ${escapeHtml(m.name)}</option>`
    ).join('');

  if (currentVal && publicData.members.some(m => m.id === currentVal)) {
    sel.value = currentVal;
  } else if (fromQuery && publicData.members.some(m => m.id === fromQuery)) {
    sel.value = fromQuery;
  }
}

function onMemberSelectChange() {
  renderMyNumbers();
  updateConfirmButton();
}

function renderMyNumbers() {
  const box = document.getElementById('myNumbersSummary');
  const raffle = publicData.raffle;
  const memberId = document.getElementById('pubMemberSelect').value;

  if (!raffle || !memberId) {
    box.style.display = 'none';
    return;
  }

  const member = publicData.members.find(m => m.id === memberId);
  const myPicks = Object.entries(raffle.picks || {})
    .filter(([_, p]) => p.memberId === memberId)
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (!myPicks.length) {
    box.style.display = 'block';
    box.innerHTML = `
      <div style="font-size:0.86rem; color:var(--muted);">
        <strong>${escapeHtml(member?.name || '')}</strong>, aún no tienes números apartados en esta rifa. Toca los números disponibles (blancos) en el talonario y luego haz clic en <strong>Confirmar Selección</strong>.
      </div>
    `;
    return;
  }

  const paidCount = myPicks.filter(([_, p]) => p.paid).length;
  const unpaidCount = myPicks.length - paidCount;
  const pendingMoney = unpaidCount * raffle.price;

  const pills = myPicks.map(([code, p]) =>
    `<span class="num-pill ${p.paid ? 'paid' : 'unpaid'}">#${escapeHtml(code)} ${p.paid ? '✓' : ''}</span>`
  ).join('');

  box.style.display = 'block';
  box.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem; margin-bottom:0.4rem;">
      <strong style="color:var(--primary); font-size:0.9rem;">Tus números en "${escapeHtml(raffle.name)}" (${myPicks.length}):</strong>
      <span style="font-size:0.82rem; font-weight:700; color:${pendingMoney > 0 ? 'var(--status-orange-text)' : 'var(--status-green-text)'};">
        ${pendingMoney > 0 ? `Pendiente por pagar: ${formatMoney(pendingMoney)}` : '¡Todas tus boletas están pagadas!'}
      </span>
    </div>
    <div>${pills}</div>
  `;
}

function updateConfirmButton() {
  const btn = document.getElementById('pubConfirmBtn');
  const raffle = publicData.raffle;
  if (!raffle) return;
  const count = selectedNumbers.size;
  const total = count * raffle.price;
  btn.textContent = count > 0
    ? `Confirmar ${count} número${count === 1 ? '' : 's'} (${formatMoney(total)})`
    : 'Confirmar Selección (0 números)';
  btn.disabled = count === 0;
}

function renderPublicBoard() {
  const raffle = publicData.raffle;
  const banner = document.getElementById('pubRaffleBanner');
  const wrapper = document.getElementById('pubBoardWrapper');
  const grid = document.getElementById('pubNumberGrid');
  const freeHeader = document.getElementById('pubFreeHeader');
  const freeList = document.getElementById('pubFreeList');

  if (!raffle) {
    wrapper.style.display = 'none';
    banner.innerHTML = `
      <div>
        <strong style="color:var(--primary); font-size:1rem;">No hay ninguna rifa activa en este momento</strong>
        <p style="font-size:0.86rem; color:var(--muted); margin-top:0.2rem;">
          Cuando el administrador habilite una nueva rifa, podrás escoger tus números aquí.
        </p>
      </div>
    `;
    return;
  }

  wrapper.style.display = 'block';
  const picks = raffle.picks || {};
  const takenCount = Object.keys(picks).length;
  const freeCount = 100 - takenCount;

  banner.innerHTML = `
    <div>
      <span class="badge badge-ok" style="margin-bottom:0.25rem;">RIFA ACTIVA</span>
      <h3 style="font-size:1.12rem; color:var(--text);">${escapeHtml(raffle.name)}</h3>
      <span style="font-size:0.86rem; color:var(--muted);">
        Valor por boleta: <strong>${formatMoney(raffle.price)}</strong> &nbsp;|&nbsp;
        Disponibles: <strong style="color:var(--primary);">${freeCount} de 100</strong>
      </span>
    </div>
  `;

  let html = '';
  const freeNums = [];

  for (let i = 0; i < 100; i++) {
    const code = pad2(i);
    const taken = picks[code];

    if (taken) {
      const statusClass = taken.paid ? 'taken-paid' : 'taken-unpaid';
      html += `
        <div class="num-cell num-cell-readonly ${statusClass}" title="#${code} - Ocupado por ${escapeHtml(taken.firstName)}">
          <span class="n-code">${code}</span>
          <span class="n-owner">${escapeHtml(taken.firstName)}</span>
        </div>
      `;
    } else {
      freeNums.push(code);
      const isSelected = selectedNumbers.has(code);
      html += `
        <div class="num-cell ${isSelected ? 'selected-now' : 'free'}" onclick="togglePublicNumber('${code}')">
          <span class="n-code">${code}</span>
          <span class="n-owner">${isSelected ? 'Elegido' : 'Libre'}</span>
        </div>
      `;
    }
  }

  grid.innerHTML = html;
  renderMyNumbers();
  updateConfirmButton();

  freeHeader.textContent = `Números disponibles (${freeNums.length} de 100):`;
  freeList.innerHTML = freeNums.length
    ? freeNums.map(n => `<span class="missing-tag">${n}</span>`).join('')
    : `<span class="badge badge-ok">¡Talonario completo! Todos los números ya fueron escogidos.</span>`;
}

function togglePublicNumber(code) {
  if (selectedNumbers.has(code)) {
    selectedNumbers.delete(code);
  } else {
    selectedNumbers.add(code);
  }
  renderPublicBoard();
}

async function confirmPublicNumbers() {
  hidePublicAlert();
  const raffle = publicData.raffle;
  const memberId = document.getElementById('pubMemberSelect').value;

  if (!raffle) return showPublicAlert('error', 'No hay una rifa activa en este momento.');
  if (!memberId) return showPublicAlert('error', 'Por favor selecciona tu nombre en la lista antes de confirmar.');
  if (selectedNumbers.size === 0) return showPublicAlert('error', 'Toca al menos un número disponible para escogerlo.');

  const member = publicData.members.find(m => m.id === memberId);
  const chosenList = Array.from(selectedNumbers).sort();
  const totalCost = chosenList.length * raffle.price;

  const ok = confirm(
    `¿Confirmas apartar ${chosenList.length} número(s) para ${member ? member.name : 'ti'}?\n\n` +
    `• Números: ${chosenList.join(', ')}\n` +
    `• Valor total: ${formatMoney(totalCost)}`
  );
  if (!ok) return;

  const btn = document.getElementById('pubConfirmBtn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const res = await fetch('/api/public/raffle/picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, numbers: chosenList })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Error HTTP ${res.status}`);
    }

    selectedNumbers.clear();
    publicData = data;
    syncMemberDropdown();
    renderPublicBoard();
    showPublicAlert(
      'ok',
      `¡Listo! Apartaste exitosamente los números: ${chosenList.join(', ')} (${formatMoney(totalCost)}).`
    );
  } catch (err) {
    showPublicAlert('error', err.message);
    selectedNumbers.clear();
    await loadPublicRaffle(true);
  }
}

loadPublicRaffle();
