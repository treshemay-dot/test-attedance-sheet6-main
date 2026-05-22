// ===============================
// OPTI-WORK SOLUTIONS ATTENDANCE
// Replace this URL after you deploy code.gs as a Google Apps Script Web App.
// ===============================
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw7bwqx_454VK21c5uymnVeAiFor_BMp24v_RY2Kq9sodmOIzGdnedKjaQRxjFW2kbM/exec';

const state = {
  agent: JSON.parse(localStorage.getItem('optiwork_agent') || 'null'),
  admin: JSON.parse(localStorage.getItem('optiwork_admin') || 'null')
};

const $ = (id) => document.getElementById(id);

const screens = ['loginScreen', 'registerScreen', 'agentDashboard', 'adminScreen', 'adminDashboard'];

function showScreen(screenId) {
  screens.forEach((id) => $(id).classList.toggle('active', id === screenId));
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.screen === screenId);
  });
  clearMessage();
}

function showMessage(text, type = '') {
  const message = $('message');
  message.textContent = text;
  message.className = `message ${type}`;
}

function clearMessage() {
  showMessage('', '');
}

function requireUrl() {
  if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes('PASTE_YOUR')) {
    throw new Error('Paste your Google Apps Script Web App URL inside script.js first.');
  }
}

async function api(action, data = {}) {
  requireUrl();

  const response = await fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...data })
  });

  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch (err) {
    throw new Error('Server returned invalid JSON. Check Apps Script deployment and permissions.');
  }

  if (!result.success) {
    throw new Error(result.message || 'Request failed.');
  }
  return result;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function readValue(id) {
  return String($(id).value || '').trim();
}

function resetRegistrationForm() {
  ['regName', 'regEmail', 'regCampaign', 'regPin'].forEach((id) => $(id).value = '');
}

function updateAgentDashboard() {
  if (!state.agent) return;
  $('agentWelcome').textContent = `Welcome, ${state.agent.name}`;
  $('agentMeta').textContent = `${state.agent.email} • ${state.agent.campaign || 'No campaign set'}`;
  $('agentStatusBadge').textContent = state.agent.openAttendance ? 'Checked in' : 'Not checked in';
  $('agentStatusBadge').className = state.agent.openAttendance ? 'badge online' : 'badge';
  $('lastActionText').textContent = state.agent.lastAction || 'No attendance action yet.';
}

async function registerAgent() {
  const name = readValue('regName');
  const email = normalizeEmail(readValue('regEmail'));
  const campaign = readValue('regCampaign');
  const pin = readValue('regPin');

  if (!name || !email || !pin) {
    showMessage('Name, email, and PIN are required.', 'error');
    return;
  }

  try {
    showMessage('Creating account...', 'info');
    const result = await api('registerAgent', { name, email, campaign, pin });
    resetRegistrationForm();
    showMessage(result.message || 'Account created. Wait for admin approval.', 'success');
    showScreen('loginScreen');
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function loginAgent() {
  const email = normalizeEmail(readValue('loginEmail'));
  const pin = readValue('loginPin');

  if (!email || !pin) {
    showMessage('Email and PIN are required.', 'error');
    return;
  }

  try {
    showMessage('Logging in...', 'info');
    const result = await api('loginAgent', { email, pin });
    state.agent = result.agent;
    localStorage.setItem('optiwork_agent', JSON.stringify(state.agent));
    $('loginPin').value = '';
    updateAgentDashboard();
    showScreen('agentDashboard');
    showMessage('Logged in successfully.', 'success');
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function checkIn() {
  if (!state.agent) return;
  try {
    showMessage('Checking in...', 'info');
    const result = await api('checkIn', {
      email: state.agent.email,
      timestamp: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    });
    state.agent.openAttendance = true;
    state.agent.lastAction = result.message;
    localStorage.setItem('optiwork_agent', JSON.stringify(state.agent));
    updateAgentDashboard();
    showMessage(result.message, 'success');
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function checkOut() {
  if (!state.agent) return;
  try {
    showMessage('Checking out...', 'info');
    const result = await api('checkOut', {
      email: state.agent.email,
      timestamp: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    });
    state.agent.openAttendance = false;
    state.agent.lastAction = result.message;
    localStorage.setItem('optiwork_agent', JSON.stringify(state.agent));
    updateAgentDashboard();
    showMessage(result.message, 'success');
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

function agentLogout() {
  state.agent = null;
  localStorage.removeItem('optiwork_agent');
  showScreen('loginScreen');
}

async function loginAdmin() {
  const email = normalizeEmail(readValue('adminEmail'));
  const pin = readValue('adminPin');

  if (!email || !pin) {
    showMessage('Admin email and PIN are required.', 'error');
    return;
  }

  try {
    showMessage('Opening admin dashboard...', 'info');
    await api('adminLogin', { adminEmail: email, adminPin: pin });
    state.admin = { email, pin };
    localStorage.setItem('optiwork_admin', JSON.stringify(state.admin));
    $('adminPin').value = '';
    showScreen('adminDashboard');
    await loadAdminData();
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

function adminPayload(extra = {}) {
  if (!state.admin) throw new Error('Admin login required.');
  return { adminEmail: state.admin.email, adminPin: state.admin.pin, ...extra };
}

async function loadAdminData() {
  try {
    showMessage('Loading admin data...', 'info');
    const result = await api('getAdminData', adminPayload());
    renderAgents(result.agents || []);
    renderAttendance(result.attendance || []);
    showMessage('Admin dashboard updated.', 'success');
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

function renderAgents(agents) {
  if (!agents.length) {
    $('agentsTableWrap').innerHTML = '<p class="empty">No agents yet.</p>';
    return;
  }

  const rows = agents.map((agent) => `
    <tr>
      <td>${escapeHtml(agent.name)}</td>
      <td>${escapeHtml(agent.email)}</td>
      <td>${escapeHtml(agent.campaign || '')}</td>
      <td><span class="mini-status ${String(agent.status).toLowerCase()}">${escapeHtml(agent.status)}</span></td>
      <td>${escapeHtml(agent.createdAt || '')}</td>
      <td class="row-actions">
        <button data-action="approveAgent" data-email="${escapeHtml(agent.email)}">Approve</button>
        <button data-action="disableAgent" data-email="${escapeHtml(agent.email)}">Disable</button>
        <button data-action="enableAgent" data-email="${escapeHtml(agent.email)}">Enable</button>
        <button data-action="rejectAgent" data-email="${escapeHtml(agent.email)}">Reject</button>
      </td>
    </tr>
  `).join('');

  $('agentsTableWrap').innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Campaign</th><th>Status</th><th>Created</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderAttendance(records) {
  if (!records.length) {
    $('attendanceTableWrap').innerHTML = '<p class="empty">No attendance records yet.</p>';
    return;
  }

  const rows = records.map((record) => `
    <tr>
      <td>${escapeHtml(record.name)}</td>
      <td>${escapeHtml(record.email)}</td>
      <td>${escapeHtml(record.campaign || '')}</td>
      <td>
        ${escapeHtml(record.checkIn || '')}${record.checkInTz ? ' (' + escapeHtml(record.checkInTz) + ')' : ''}
        ${record.checkInIso ? '<div class="iso">ISO: ' + escapeHtml(record.checkInIso) + ' <button class="copy-iso" data-iso="' + escapeHtml(record.checkInIso) + '">Copy</button></div>' : ''}
      </td>
      <td>
        ${escapeHtml(record.checkOut || '')}${record.checkOutTz ? ' (' + escapeHtml(record.checkOutTz) + ')' : ''}
        ${record.checkOutIso ? '<div class="iso">ISO: ' + escapeHtml(record.checkOutIso) + ' <button class="copy-iso" data-iso="' + escapeHtml(record.checkOutIso) + '">Copy</button></div>' : ''}
      </td>
      <td>${escapeHtml(record.totalHours || '')}</td>
      <td><span class="mini-status ${String(record.status).toLowerCase()}">${escapeHtml(record.status || '')}</span></td>
    </tr>
  `).join('');

  $('attendanceTableWrap').innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Campaign</th><th>Check In</th><th>Check Out</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function handleAgentAction(action, email) {
  try {
    showMessage(`${action.replace('Agent', '')} request...`, 'info');
    const result = await api(action, adminPayload({ email }));
    showMessage(result.message, 'success');
    await loadAdminData();
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

function adminLogout() {
  state.admin = null;
  localStorage.removeItem('optiwork_admin');
  showScreen('adminScreen');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function init() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showScreen(tab.dataset.screen));
  });

  $('registerBtn').addEventListener('click', registerAgent);
  $('agentLoginBtn').addEventListener('click', loginAgent);
  $('checkInBtn').addEventListener('click', checkIn);
  $('checkOutBtn').addEventListener('click', checkOut);
  $('agentLogoutBtn').addEventListener('click', agentLogout);

  $('adminLoginBtn').addEventListener('click', loginAdmin);
  $('refreshAdminBtn').addEventListener('click', loadAdminData);
  $('migrateHeadersBtn').addEventListener('click', async () => {
    try {
      showMessage('Migrating attendance headers...', 'info');
      const result = await api('migrateAttendance', adminPayload());
      showMessage(result.message, 'success');
      await loadAdminData();
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });
  $('adminLogoutBtn').addEventListener('click', adminLogout);

  $('agentsTableWrap').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    handleAgentAction(button.dataset.action, button.dataset.email);
  });

  if (state.agent) {
    updateAgentDashboard();
    showScreen('agentDashboard');
  }
}

init();

// Copy ISO timestamp handler (delegated)
document.getElementById('attendanceTableWrap')?.addEventListener('click', (event) => {
  const btn = event.target.closest && event.target.closest('button.copy-iso');
  if (!btn) return;
  const iso = btn.dataset.iso || '';
  if (!iso) return showMessage('No ISO value to copy.', 'error');
  navigator.clipboard?.writeText(iso).then(() => showMessage('ISO copied to clipboard.', 'success')).catch(() => showMessage('Copy failed.', 'error'));
});
