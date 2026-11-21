function showAlert(type, message) {
  const el = document.getElementById('registerAlert');
  el.className = `alert-box ${type === 'error' ? 'alert-err' : 'alert-ok'}`;
  el.textContent = message;
  el.style.display = 'block';
}

function hideAlert() {
  const el = document.getElementById('registerAlert');
  el.style.display = 'none';
}

async function submitPublicRegistration(e) {
  e.preventDefault();
  hideAlert();

  const nameInput = document.getElementById('regName');
  const phoneInput = document.getElementById('regPhone');
  const btn = document.getElementById('registerSubmitBtn');

  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();

  if (name.length < 2) {
    showAlert('error', 'Por favor escribe tu nombre completo.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Registrando...';

  try {
    const res = await fetch('/api/public/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Error HTTP ${res.status}`);
    }

    const member = data.member;
    const activeRaffle = data.activeRaffle;

    document.getElementById('registerCard').style.display = 'none';
    const successCard = document.getElementById('registerSuccessCard');
    successCard.style.display = 'block';

    const msgEl = document.getElementById('successMemberMsg');
    const goBtn = document.getElementById('goToRaffleBtn');

    if (activeRaffle) {
      msgEl.innerHTML = `Bienvenido(a), <strong>${escapeHtml(member.name)}</strong>. Ya quedaste registrado(a). Ahora puedes escoger tus números en la rifa activa <strong>"${escapeHtml(activeRaffle.name)}"</strong>.`;
      goBtn.href = `/rifa?miembro=${encodeURIComponent(member.id)}`;
      goBtn.textContent = `🎟️ Escoger mis números en "${activeRaffle.name}"`;
    } else {
      msgEl.innerHTML = `Bienvenido(a), <strong>${escapeHtml(member.name)}</strong>. Ya quedaste registrado(a) en la natillera. Cuando se habilite una rifa activa podrás escoger tus números.`;
      goBtn.href = `/rifa?miembro=${encodeURIComponent(member.id)}`;
      goBtn.textContent = '🎟️ Ver estado de la Rifa';
    }
  } catch (err) {
    showAlert('error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Registrarme';
  }
}

function resetRegistrationForm() {
  document.getElementById('registerForm').reset();
  hideAlert();
  document.getElementById('registerSuccessCard').style.display = 'none';
  document.getElementById('registerCard').style.display = 'block';
  document.getElementById('regName').focus();
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
