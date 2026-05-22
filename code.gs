/******************************************************
 * OPTI-WORK SOLUTIONS ATTENDANCE BACKEND
 * Google Apps Script + Google Sheets
 *
 * IMPORTANT:
 * 1. Change SPREADSHEET_ID to your Google Sheet ID.
 * 2. Change ADMIN_PIN before deploying.
 * 3. Deploy as Web App:
 *    Execute as: Me
 *    Who has access: Anyone
 ******************************************************/

const SPREADSHEET_ID = '1dRVpTsaJK-SOzxDAWlB3ZxZlgalCJk9kBdxOwvqWrs8';
const COMPANY_NAME = 'Opti-work Solutions';
const ADMIN_EMAILS = ['workfreelance772@gmail.com'];
const ADMIN_PIN = '101786141220';
const TIMEZONE = 'America/New_York';

const AGENTS_SHEET = 'AGENTS';
const ATTENDANCE_SHEET = 'ATTENDANCE';
const HISTORY_SHEET = 'HISTORY';

const AGENT_HEADERS = [
  'Agent ID', 'Name', 'Email', 'Campaign', 'Status', 'PIN Hash', 'PIN Salt',
  'Created At', 'Approved At', 'Approved By', 'Disabled At', 'Last Login'
];

const ATTENDANCE_HEADERS = [
  'Record ID', 'Agent ID', 'Name', 'Email', 'Campaign', 'Check In',
  'Check In ISO', 'Check In TZ', 'Check Out', 'Check Out ISO', 'Check Out TZ',
  'Total Hours', 'Status', 'Created At'
];

const HISTORY_HEADERS = [
  'Timestamp', 'Action', 'Email', 'Details'
];

function doGet() {
  return jsonResponse(true, 'Opti-work Solutions attendance backend is running.');
}

function doPost(e) {
  try {
    const data = parseRequest(e);
    const ss = getSpreadsheet();
    setupSheets(ss);

    switch (data.action) {
      case 'registerAgent': return registerAgent(ss, data);
      case 'loginAgent': return loginAgent(ss, data);
      case 'checkIn': return checkIn(ss, data);
      case 'checkOut': return checkOut(ss, data);
      case 'migrateAttendance': return migrateAttendance(ss, data);
      case 'adminLogin': return adminLogin(data);
      case 'getAdminData': return getAdminData(ss, data);
      case 'approveAgent': return updateAgentStatus(ss, data, 'Approved');
      case 'disableAgent': return updateAgentStatus(ss, data, 'Disabled');
      case 'enableAgent': return updateAgentStatus(ss, data, 'Approved');
      case 'rejectAgent': return updateAgentStatus(ss, data, 'Rejected');
      default: return jsonResponse(false, 'Invalid action.');
    }
  } catch (err) {
    Logger.log(err.stack || err.toString());
    return jsonResponse(false, 'Server error: ' + err.message);
  }
}

function migrateAttendance(ss, data) {
  const adminCheck = verifyAdmin(data);
  if (adminCheck !== true) return adminCheck;

  let sheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!sheet) sheet = ss.insertSheet(ATTENDANCE_SHEET);

  const headerRange = sheet.getRange(1, 1, 1, ATTENDANCE_HEADERS.length);
  const current = headerRange.getValues()[0];
  let changed = false;
  for (let i = 0; i < ATTENDANCE_HEADERS.length; i++) {
    if (String(current[i] || '').trim() !== ATTENDANCE_HEADERS[i]) {
      current[i] = ATTENDANCE_HEADERS[i];
      changed = true;
    }
  }
  headerRange.setValues([current]);
  sheet.setFrozenRows(1);

  logHistory(ss, 'MIGRATE_ATTENDANCE', normalizeEmail(data.adminEmail || ''), `Attendance headers synchronized.`);
  return jsonResponse(true, changed ? 'Attendance headers updated.' : 'Attendance headers already up to date.');
}

function parseRequest(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('No post data received.');
  }
  return JSON.parse(e.postData.contents);
}

function jsonResponse(success, message, extra) {
  const output = { success, message };
  if (extra) Object.assign(output, extra);
  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID.includes('PASTE_YOUR')) {
    throw new Error('Set SPREADSHEET_ID inside code.gs first.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function setupSheets(ss) {
  ensureSheet(ss, AGENTS_SHEET, AGENT_HEADERS);
  ensureSheet(ss, ATTENDANCE_SHEET, ATTENDANCE_HEADERS);
  ensureSheet(ss, HISTORY_SHEET, HISTORY_HEADERS);
}

function ensureSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeaders = currentHeaders.every(v => !v);
  if (needsHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function registerAgent(ss, data) {
  const name = clean(data.name);
  const email = normalizeEmail(data.email);
  const campaign = clean(data.campaign);
  const pin = clean(data.pin);

  if (!name || !email || !pin) {
    return jsonResponse(false, 'Name, email, and PIN are required.');
  }

  const agentsSheet = ss.getSheetByName(AGENTS_SHEET);
  const existing = findAgentByEmail(agentsSheet, email);
  if (existing) {
    return jsonResponse(false, 'This email is already registered. Wait for approval or contact admin.');
  }

  const salt = Utilities.getUuid();
  const pinHash = hashPin(pin, salt);
  const agentId = 'AGT-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const now = nowString();

  agentsSheet.appendRow([
    agentId, name, email, campaign, 'Pending', pinHash, salt,
    now, '', '', '', ''
  ]);

  logHistory(ss, 'REGISTER_PENDING', email, `${name} registered and is waiting for admin approval.`);
  return jsonResponse(true, 'Account created. Please wait for admin approval before logging in.');
}

function loginAgent(ss, data) {
  const email = normalizeEmail(data.email);
  const pin = clean(data.pin);

  if (!email || !pin) return jsonResponse(false, 'Email and PIN are required.');

  const agentsSheet = ss.getSheetByName(AGENTS_SHEET);
  const found = findAgentByEmail(agentsSheet, email);
  if (!found) return jsonResponse(false, 'Account not found. Please register first.');

  const agent = rowToAgent(found.values);

  if (agent.status === 'Pending') return jsonResponse(false, 'Your account is pending admin approval.');
  if (agent.status === 'Disabled') return jsonResponse(false, 'Your account is disabled. Contact admin.');
  if (agent.status === 'Rejected') return jsonResponse(false, 'Your registration was rejected. Contact admin.');
  if (agent.status !== 'Approved') return jsonResponse(false, 'Your account is not approved.');

  const attemptedHash = hashPin(pin, agent.pinSalt);
  if (attemptedHash !== agent.pinHash) return jsonResponse(false, 'Incorrect PIN.');

  agentsSheet.getRange(found.rowNumber, 12).setValue(nowString());
  const openRecord = getOpenAttendanceForEmail(ss.getSheetByName(ATTENDANCE_SHEET), email);

  return jsonResponse(true, 'Login successful.', {
    agent: safeAgent(agent, !!openRecord, openRecord ? `Currently checked in since ${formatDateTime(openRecord.values[5])}.` : 'Ready to check in.')
  });
}

function checkIn(ss, data) {
  const email = normalizeEmail(data.email);
  const agent = requireApprovedAgent(ss, email);
  const attendanceSheet = ss.getSheetByName(ATTENDANCE_SHEET);

  const openRecord = getOpenAttendanceForEmail(attendanceSheet, email);
  if (openRecord) {
    return jsonResponse(false, 'You are already checked in. Please check out first.');
  }
  let now = data.timestamp ? new Date(data.timestamp) : new Date();
  if (isNaN(now.getTime())) now = new Date();
  const recordId = 'REC-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const checkInDisplay = formatDateTime(now, data.timeZone);

  // Append with new ISO columns: Check In ISO at col7, Check Out at col8, Check Out ISO at col9
  attendanceSheet.appendRow([
    recordId, agent.agentId, agent.name, agent.email, agent.campaign,
    now, data.timestamp || '', data.timeZone || '', '', '', '', '', 'Open', now
  ]);

  // Keep the sheet readable while still storing real Date values for correct duration math.
  const lastRow = attendanceSheet.getLastRow();
  attendanceSheet.getRange(lastRow, 6).setNumberFormat('yyyy-mm-dd hh:mm:ss AM/PM');
  attendanceSheet.getRange(lastRow, 9).setNumberFormat('yyyy-mm-dd hh:mm:ss AM/PM');
  attendanceSheet.getRange(lastRow, 14).setNumberFormat('yyyy-mm-dd hh:mm:ss AM/PM');

  logHistory(ss, 'CHECK_IN', email, `${agent.name} checked in at ${checkInDisplay}.`);
  return jsonResponse(true, `Checked in at ${checkInDisplay}.`);
}

function checkOut(ss, data) {
  const email = normalizeEmail(data.email);
  const agent = requireApprovedAgent(ss, email);
  const attendanceSheet = ss.getSheetByName(ATTENDANCE_SHEET);

  const openRecord = getOpenAttendanceForEmail(attendanceSheet, email);
  if (!openRecord) {
    return jsonResponse(false, 'No open check-in found. Please check in first.');
  }
  let now = data.timestamp ? new Date(data.timestamp) : new Date();
  if (isNaN(now.getTime())) now = new Date();
  const checkOutDisplay = formatDateTime(now, data.timeZone);

  // Prefer the original client ISO if present for accurate instant comparison
  const checkInInstant = openRecord.values[6] ? parseDate(openRecord.values[6]) : parseDate(openRecord.values[5]);
  const totalHours = calculateHours(checkInInstant, now);

  attendanceSheet.getRange(openRecord.rowNumber, 9).setValue(now).setNumberFormat('yyyy-mm-dd hh:mm:ss AM/PM');
  attendanceSheet.getRange(openRecord.rowNumber, 10).setValue(data.timestamp || '');
  attendanceSheet.getRange(openRecord.rowNumber, 11).setValue(data.timeZone || '');
  attendanceSheet.getRange(openRecord.rowNumber, 12).setValue(totalHours);
  attendanceSheet.getRange(openRecord.rowNumber, 13).setValue('Completed');

  logHistory(ss, 'CHECK_OUT', email, `${agent.name} checked out at ${checkOutDisplay}. Total: ${totalHours}.`);
  return jsonResponse(true, `Checked out at ${checkOutDisplay}. Total: ${totalHours}.`);
}

function adminLogin(data) {
  const email = normalizeEmail(data.adminEmail);
  const pin = clean(data.adminPin);
  if (!ADMIN_EMAILS.map(normalizeEmail).includes(email) || pin !== ADMIN_PIN) {
    return jsonResponse(false, 'Invalid admin email or PIN.');
  }
  return jsonResponse(true, 'Admin login successful.');
}

function getAdminData(ss, data) {
  const adminCheck = verifyAdmin(data);
  if (adminCheck !== true) return adminCheck;

  const agents = getAgents(ss).map(a => ({
    name: a.name,
    email: a.email,
    campaign: a.campaign,
    status: a.status,
    createdAt: a.createdAt,
    approvedAt: a.approvedAt,
    disabledAt: a.disabledAt
  }));

  const attendance = getAttendance(ss).slice(-100).reverse().map(r => ({
    name: r.name,
    email: r.email,
    campaign: r.campaign,
    checkIn: r.checkIn,
    checkInIso: r.checkInIso,
    checkInTz: r.checkInTz,
    checkOut: r.checkOut,
    checkOutIso: r.checkOutIso,
    checkOutTz: r.checkOutTz,
    totalHours: r.totalHours,
    status: r.status
  }));

  return jsonResponse(true, 'Admin data loaded.', { agents, attendance });
}

function updateAgentStatus(ss, data, status) {
  const adminCheck = verifyAdmin(data);
  if (adminCheck !== true) return adminCheck;

  const email = normalizeEmail(data.email);
  const agentsSheet = ss.getSheetByName(AGENTS_SHEET);
  const found = findAgentByEmail(agentsSheet, email);
  if (!found) return jsonResponse(false, 'Agent not found.');

  const now = nowString();
  agentsSheet.getRange(found.rowNumber, 5).setValue(status);

  if (status === 'Approved') {
    agentsSheet.getRange(found.rowNumber, 9).setValue(now);
    agentsSheet.getRange(found.rowNumber, 10).setValue(normalizeEmail(data.adminEmail));
    agentsSheet.getRange(found.rowNumber, 11).setValue('');
  }

  if (status === 'Disabled') {
    agentsSheet.getRange(found.rowNumber, 11).setValue(now);
  }

  logHistory(ss, 'STATUS_' + status.toUpperCase(), email, `Admin changed account status to ${status}.`);
  return jsonResponse(true, `Agent status changed to ${status}.`);
}

function verifyAdmin(data) {
  const email = normalizeEmail(data.adminEmail);
  const pin = clean(data.adminPin);
  if (!ADMIN_EMAILS.map(normalizeEmail).includes(email) || pin !== ADMIN_PIN) {
    return jsonResponse(false, 'Admin authorization failed.');
  }
  return true;
}

function requireApprovedAgent(ss, email) {
  const agentsSheet = ss.getSheetByName(AGENTS_SHEET);
  const found = findAgentByEmail(agentsSheet, email);
  if (!found) throw new Error('Agent account not found.');
  const agent = rowToAgent(found.values);
  if (agent.status !== 'Approved') throw new Error('Agent is not approved or has been disabled.');
  return agent;
}

function findAgentByEmail(sheet, email) {
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (normalizeEmail(rows[i][2]) === email) {
      return { rowNumber: i + 1, values: rows[i] };
    }
  }
  return null;
}

function getOpenAttendanceForEmail(sheet, email) {
  const rows = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    const rowEmail = normalizeEmail(rows[i][3]);
    // Status moved to column 13 after adding ISO and TZ columns
    const status = clean(rows[i][12]);
    if (rowEmail === email && status === 'Open') {
      return { rowNumber: i + 1, values: rows[i] };
    }
  }
  return null;
}

function getAgents(ss) {
  const rows = ss.getSheetByName(AGENTS_SHEET).getDataRange().getValues();
  return rows.slice(1).filter(r => r[2]).map(rowToAgent);
}

function getAttendance(ss) {
  const rows = ss.getSheetByName(ATTENDANCE_SHEET).getDataRange().getValues();
  return rows.slice(1).filter(r => r[3]).map(rowToAttendance);
}

function rowToAgent(row) {
  return {
    agentId: clean(row[0]),
    name: clean(row[1]),
    email: normalizeEmail(row[2]),
    campaign: clean(row[3]),
    status: clean(row[4]),
    pinHash: clean(row[5]),
    pinSalt: clean(row[6]),
    createdAt: formatAny(row[7]),
    approvedAt: formatAny(row[8]),
    approvedBy: clean(row[9]),
    disabledAt: formatAny(row[10]),
    lastLogin: formatAny(row[11])
  };
}

function rowToAttendance(row) {
  return {
    recordId: clean(row[0]),
    agentId: clean(row[1]),
    name: clean(row[2]),
    email: normalizeEmail(row[3]),
    campaign: clean(row[4]),
    checkIn: formatAny(row[5]),
    checkInIso: clean(row[6]),
    checkInTz: clean(row[7]),
    checkOut: formatAny(row[8]),
    checkOutIso: clean(row[9]),
    checkOutTz: clean(row[10]),
    totalHours: clean(row[11]),
    status: clean(row[12]),
    createdAt: formatAny(row[13])
  };
}

function safeAgent(agent, openAttendance, lastAction) {
  return {
    name: agent.name,
    email: agent.email,
    campaign: agent.campaign,
    status: agent.status,
    openAttendance,
    lastAction
  };
}

function hashPin(pin, salt) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin + ':' + salt);
  return raw.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function calculateHours(start, end) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);

  if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return '';
  }

  const diffMs = endDate.getTime() - startDate.getTime();
  if (diffMs < 0) {
    return '';
  }

  const totalMinutes = Math.round(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function parseDate(value) {
  if (value instanceof Date) return value;
  if (!value) return null;

  // Handles old rows saved as text like: 2026-05-22 11:46:00 PM
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (match) {
    let [, y, m, d, hh, mm, ss, ampm] = match;
    let hour = Number(hh);
    if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
    if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
    return new Date(Number(y), Number(m) - 1, Number(d), hour, Number(mm), Number(ss));
  }

  const parsed = new Date(text);
  return parsed;
}

function nowString() {
  return formatDateTime(new Date());
}

function formatDateTime(date, zone) {
  const tz = zone || TIMEZONE;
  try {
    return Utilities.formatDate(new Date(date), tz, 'yyyy-MM-dd hh:mm:ss a');
  } catch (err) {
    return Utilities.formatDate(new Date(date), TIMEZONE, 'yyyy-MM-dd hh:mm:ss a');
  }
}

function formatAny(value) {
  if (!value) return '';
  if (value instanceof Date) return formatDateTime(value);
  return clean(value);
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function clean(value) {
  return String(value || '').trim();
}

function logHistory(ss, action, email, details) {
  const sheet = ss.getSheetByName(HISTORY_SHEET);
  sheet.appendRow([nowString(), action, email, details]);
}
