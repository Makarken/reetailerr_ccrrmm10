/**
 * Multi-workspace CRM backend (Google Apps Script)
 */

const CONFIG = {
  SPREADSHEET_ID: '1N1aS17lWL1Xp7bMB9K_-AtYZSOCgpU57MvB08uJA76A',
  SESSION_TTL_HOURS: 24 * 14,
  WORKSPACES: [
    { id: 'workspace_1', name: 'База с Катей' },
    { id: 'workspace_2', name: 'База с Лешей' },
    { id: 'workspace_3', name: 'База Tolkaem' },
    { id: 'workspace_4', name: 'База Автономо' }
  ],
  AUTH: { users: 'Auth Users', sessions: 'Auth Sessions' },
  SHEETS: { inventory: 'Inventory', activity: 'Activity Log' },
  HEADERS: {
    authUsers: ['user_id', 'login', 'email', 'password_hash', 'password_salt', 'workspace_id', 'role', 'is_active', 'created_at', 'updated_at'],
    authSessions: ['session_id', 'user_id', 'workspace_id', 'role', 'expires_at', 'created_at', 'last_seen_at', 'revoked_at', 'user_agent'],
    inventory: ['workspace_id', 'item_number', 'model_name', 'status', 'total_cost', 'sale_price', 'updated_at'],
    activity: ['workspace_id', 'timestamp', 'item_number', 'action', 'field', 'old_value', 'new_value', 'actor']
  }
};

let REQUEST_CONTEXT = null;

function doGet(e) { return safeRoute(String((e && e.parameter && e.parameter.action) || ''), (e && e.parameter) || {}); }
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return safeRoute(String(body.action || ''), body.payload || {});
  } catch (err) { return jsonResponse({ ok: false, error: err.message }); }
}
function safeRoute(action, payload) {
  try {
    REQUEST_CONTEXT = null;
    return jsonResponse(routeAction(action, payload));
  } catch (error) { return jsonResponse({ ok: false, error: error.message }); }
}

function routeAction(action, payload) {
  const publicHandlers = {
    login: () => login(payload.identity, payload.password, payload.user_agent || '', payload.workspace_id || ''),
    logout: () => ({ ok: true, revoked: revokeSession(payload.session_token || '') }),
    getSession: () => ({ ok: true, session: getSessionInfo(payload.session_token || '') }),
    getSchema: () => ({ ok: true, workspaces: CONFIG.WORKSPACES })
  };
  if (publicHandlers[action]) return publicHandlers[action]();

  const auth = requireSession(payload.session_token || payload.token || '');
  REQUEST_CONTEXT = auth;

  const handlers = {
    getInventory: () => ({ ok: true, items: scopedRows(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory) }),
    getDashboard: () => ({ ok: true, stats: getDashboard() }),
    getActivity: () => ({ ok: true, activity: getActivity() }),
    getItemByNumber: () => ({ ok: true, item: getItemByNumber(payload.item_number) }),
    createPurchase: () => ({ ok: true, item: createPurchase(payload) }),
    recordSale: () => ({ ok: true, item: recordSale(payload) }),
    cancelSale: () => ({ ok: true, item: cancelSale(payload.item_number) }),
    deleteItem: () => ({ ok: true, deleted: deleteItem(payload.item_number) })
  };

  const adminOnly = { createPurchase: 1, recordSale: 1, cancelSale: 1, deleteItem: 1 };
  if (adminOnly[action] && auth.role !== 'admin') throw new Error('Недостаточно прав для этого действия');

  if (!handlers[action]) throw new Error('Unknown action: ' + action);
  return handlers[action]();
}

function nowIso() { return new Date().toISOString(); }
function toNum(v) { return Number(v || 0); }
function normalizeIdentity(value) { return String(value || '').trim().toLowerCase(); }
function randomId(prefix) { return [prefix, Utilities.getUuid().replace(/-/g, '')].join('_'); }
function activeWorkspaceId() { return REQUEST_CONTEXT && REQUEST_CONTEXT.workspace_id ? REQUEST_CONTEXT.workspace_id : ''; }
function workspaceById(id) { return CONFIG.WORKSPACES.find((w) => w.id === id) || null; }

function hashPassword(password, salt) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, `${salt}:${password}`, Utilities.Charset.UTF_8);
  return raw.map((b) => { const v = (b + 256) % 256; return (v < 16 ? '0' : '') + v.toString(16); }).join('');
}

function ensureDefaultUsers() {
  if (getRows(CONFIG.AUTH.users, CONFIG.HEADERS.authUsers).length) return;
  const now = nowIso();
  const seeds = [
    { user_id: 'u_admin', login: 'admin', email: 'admin@crm.local', password: 'adminTolkaem', salt: 'salt_admin_2026', workspace_id: '*', role: 'admin' },
    { user_id: 'u_kate', login: 'Kate', email: 'kate@crm.local', password: 'Kateresalebags', salt: 'salt_kate_2026', workspace_id: 'workspace_1', role: 'viewer' },
    { user_id: 'u_alex', login: 'Alex', email: 'alex@crm.local', password: 'Alexbagss', salt: 'salt_alex_2026', workspace_id: 'workspace_2', role: 'viewer' }
  ];
  seeds.forEach((s) => appendRow(CONFIG.AUTH.users, CONFIG.HEADERS.authUsers, {
    user_id: s.user_id, login: s.login, email: s.email, password_hash: hashPassword(s.password, s.salt), password_salt: s.salt,
    workspace_id: s.workspace_id, role: s.role, is_active: 'yes', created_at: now, updated_at: now
  }));
}
function getAuthUsers() { ensureDefaultUsers(); return getRows(CONFIG.AUTH.users, CONFIG.HEADERS.authUsers); }

function createSessionForUser(user, ua, ws) {
  const now = new Date();
  const session = {
    session_id: randomId('sess'), user_id: user.user_id, workspace_id: ws, role: user.role,
    expires_at: new Date(now.getTime() + CONFIG.SESSION_TTL_HOURS * 3600000).toISOString(),
    created_at: now.toISOString(), last_seen_at: now.toISOString(), revoked_at: '', user_agent: String(ua || '').slice(0, 250)
  };
  upsertSessionRow(session);
  return session;
}

function login(identity, password, userAgent, selectedWorkspaceId) {
  const id = normalizeIdentity(identity);
  if (!id || !password) throw new Error('Введите логин/email и пароль');
  const user = getAuthUsers().find((u) => normalizeIdentity(u.login) === id || normalizeIdentity(u.email) === id);
  if (!user || String(user.is_active || 'yes') !== 'yes') throw new Error('Неверный логин/email или пароль');
  if (hashPassword(String(password), user.password_salt) !== user.password_hash) throw new Error('Неверный логин/email или пароль');

  if (user.role === 'admin') {
    if (!selectedWorkspaceId) return { ok: true, require_workspace_choice: true, workspaces: CONFIG.WORKSPACES };
    if (!workspaceById(selectedWorkspaceId)) throw new Error('Выбран неизвестный workspace');
    const session = createSessionForUser(user, userAgent, selectedWorkspaceId);
    return { ok: true, token: session.session_id, user: { user_id: user.user_id, login: user.login, role: user.role, workspace_id: selectedWorkspaceId, workspace_name: workspaceById(selectedWorkspaceId).name } };
  }

  if (!workspaceById(user.workspace_id)) throw new Error('Пользователь привязан к неизвестному workspace');
  const session = createSessionForUser(user, userAgent, user.workspace_id);
  return { ok: true, token: session.session_id, user: { user_id: user.user_id, login: user.login, role: user.role, workspace_id: user.workspace_id, workspace_name: workspaceById(user.workspace_id).name } };
}

function requireSession(token) {
  const session = getSessionInfo(token);
  if (!session) throw new Error('Требуется авторизация');
  return session;
}
function getSessionInfo(token) {
  if (!token) return null;
  const row = getRows(CONFIG.AUTH.sessions, CONFIG.HEADERS.authSessions).find((s) => s.session_id === token);
  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  row.last_seen_at = nowIso();
  upsertSessionRow(row);
  return { session_id: row.session_id, user_id: row.user_id, role: row.role, workspace_id: row.workspace_id, expires_at: row.expires_at };
}
function revokeSession(token) {
  const rows = getRows(CONFIG.AUTH.sessions, CONFIG.HEADERS.authSessions);
  const row = rows.find((s) => s.session_id === token && !s.revoked_at);
  if (!row) return false;
  row.revoked_at = nowIso();
  upsertSessionRow(row);
  return true;
}
function upsertSessionRow(next) {
  const rows = getRows(CONFIG.AUTH.sessions, CONFIG.HEADERS.authSessions);
  const idx = rows.findIndex((r) => r.session_id === next.session_id);
  if (idx < 0) return appendRow(CONFIG.AUTH.sessions, CONFIG.HEADERS.authSessions, next);
  getSheet(CONFIG.AUTH.sessions, CONFIG.HEADERS.authSessions).getRange(idx + 2, 1, 1, CONFIG.HEADERS.authSessions.length).setValues([objToRow(next, CONFIG.HEADERS.authSessions)]);
}

function scopedRows(sheet, headers) {
  const ws = activeWorkspaceId();
  const rows = getRows(sheet, headers);
  if (!ws || headers.indexOf('workspace_id') < 0) return rows;
  return rows.filter((r) => String(r.workspace_id || '') === ws);
}

function getItemByNumber(itemNumber) {
  const key = String(itemNumber || '').trim();
  return scopedRows(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory).find((i) => String(i.item_number) === key) || null;
}
function createPurchase(payload) {
  const ws = activeWorkspaceId();
  const row = { workspace_id: ws, item_number: String(payload.item_number || '').trim(), model_name: String(payload.model_name || '').trim(), status: 'purchased', total_cost: toNum(payload.total_cost), sale_price: '', updated_at: nowIso() };
  if (!row.item_number || !row.model_name) throw new Error('Введите номер и модель');
  if (getItemByNumber(row.item_number)) throw new Error('Такой номер уже существует');
  appendRow(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory, row);
  addActivity(row.item_number, 'Добавление покупки', 'card', '', 'created');
  return row;
}
function recordSale(payload) {
  const item = getItemByNumber(payload.item_number);
  if (!item) throw new Error('Товар не найден');
  item.sale_price = toNum(payload.sale_price);
  item.status = 'sold';
  item.updated_at = nowIso();
  saveInventoryItem(item);
  addActivity(item.item_number, 'Оформление продажи', 'sale', '', String(item.sale_price));
  return item;
}
function cancelSale(itemNumber) {
  const item = getItemByNumber(itemNumber);
  if (!item) throw new Error('Товар не найден');
  item.sale_price = '';
  item.status = 'listed';
  item.updated_at = nowIso();
  saveInventoryItem(item);
  addActivity(item.item_number, 'Отмена продажи', 'sale', 'sold', 'listed');
  return item;
}
function deleteItem(itemNumber) {
  const ws = activeWorkspaceId();
  const key = String(itemNumber || '').trim();
  deleteRowsWhere(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory, (r) => String(r.workspace_id) === ws && String(r.item_number) === key);
  addActivity(key, 'Удаление карточки', 'card', 'exists', 'deleted');
  return true;
}
function getActivity() { return scopedRows(CONFIG.SHEETS.activity, CONFIG.HEADERS.activity).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))); }
function getDashboard() {
  const items = scopedRows(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory);
  const sold = items.filter((i) => String(i.status) === 'sold');
  return {
    active_stock: items.filter((i) => !['sold', 'cancelled'].includes(String(i.status))).length,
    stock_value: items.reduce((a, i) => a + toNum(i.total_cost), 0),
    sold_this_month: sold.length,
    profit_this_month: sold.reduce((a, s) => a + toNum(s.sale_price) - toNum(s.total_cost), 0),
    profit_share_each: sold.reduce((a, s) => a + toNum(s.sale_price) - toNum(s.total_cost), 0) / 3,
    purchase_balance: items.reduce((a, i) => a + toNum(i.total_cost), 0),
    pending_shipping: 0,
    in_transit: 0,
    repair_count: 0,
    attention_count: 0,
    avg_sale_days: 0,
    oldest_item_number: items[0] ? items[0].item_number : '',
    oldest_item_days: 0
  };
}
function addActivity(itemNumber, action, field, oldValue, newValue) {
  appendRow(CONFIG.SHEETS.activity, CONFIG.HEADERS.activity, { workspace_id: activeWorkspaceId(), timestamp: nowIso(), item_number: itemNumber || '', action: action || '', field: field || '', old_value: oldValue || '', new_value: newValue || '', actor: 'web' });
}
function saveInventoryItem(item) {
  const ws = activeWorkspaceId();
  const rows = getRows(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory);
  const idx = rows.findIndex((r) => String(r.workspace_id) === ws && String(r.item_number) === String(item.item_number));
  if (idx < 0) throw new Error('Товар не найден');
  getSheet(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory).getRange(idx + 2, 1, 1, CONFIG.HEADERS.inventory.length).setValues([objToRow(item, CONFIG.HEADERS.inventory)]);
}
function deleteRowsWhere(sheetName, headers, predicate) {
  const sh = getSheet(sheetName, headers);
  const rows = getRows(sheetName, headers);
  for (let i = rows.length - 1; i >= 0; i -= 1) if (predicate(rows[i])) sh.deleteRow(i + 2);
}

function jsonResponse(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function ss() { return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); }
function cellText(v) { return String(v == null ? '' : v); }
function objToRow(obj, headers) { return headers.map((h) => obj[h] == null ? '' : cellText(obj[h])); }
function getSheet(name, headers) {
  const sheet = ss().getSheetByName(name) || ss().insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}
function getRows(sheetName, headers) {
  const sh = getSheet(sheetName, headers);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, headers.length).getValues().map((row) => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}
function appendRow(sheetName, headers, obj) { getSheet(sheetName, headers).appendRow(objToRow(obj, headers)); }
