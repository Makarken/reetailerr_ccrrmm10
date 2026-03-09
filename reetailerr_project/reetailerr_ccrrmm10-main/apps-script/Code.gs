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
  SHEETS: { inventory: 'Inventory', activity: 'Activity Log', sales: 'Sales', settings: 'Settings' },
  HEADERS: {
    authUsers: ['user_id', 'login', 'email', 'password_hash', 'password_salt', 'workspace_id', 'role', 'is_active', 'created_at', 'updated_at'],
    authSessions: ['session_id', 'user_id', 'workspace_id', 'role', 'expires_at', 'created_at', 'last_seen_at', 'revoked_at', 'user_agent'],
    inventory: [
      'workspace_id', 'item_number', 'photo_url', 'buyee_url', 'model_name', 'category', 'description', 'purchase_date',
      'base_cost', 'buyout_price', 'shipping_japan', 'tax', 'customs_tax', 'shipping_spain', 'repair_cost', 'total_cost', 'listing_price',
      'status', 'listed_vinted', 'listed_vestiaire', 'need_rephoto', 'money_received',
      'sale_id', 'sale_price', 'sale_date', 'platform', 'buyer', 'platform_fee', 'profit',
      'tracking_number', 'shipping_label_url', 'shipping_date', 'shipping_status',
      'repair_master', 'repair_sent_date', 'repair_finished_date', 'repair_notes', 'arrived_from_japan', 'arrived_date', 'japan_arrival_date', 'sold_storage_days', 'notes', 'updated_at'
    ],
    sales: [
      'workspace_id', 'sale_id', 'timestamp', 'item_number', 'model_name', 'sale_date', 'sale_price', 'platform', 'buyer',
      'platform_fee', 'total_cost', 'profit', 'money_received', 'status', 'shipping_status',
      'tracking_number', 'shipping_label_url', 'shipping_date', 'pre_sale_status', 'sold_storage_days', 'is_cancelled', 'cancelled_at', 'notes'
    ],
    activity: ['workspace_id', 'timestamp', 'item_number', 'action', 'field', 'old_value', 'new_value', 'actor'],
    settings: ['workspace_id', 'key', 'value']
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
    getAnalytics: () => ({ ok: true, ...getAnalytics() }),
    getQC: () => ({ ok: true, attention: getQC() }),
    getShippingOverview: () => ({ ok: true, ...getShippingOverview() }),
    getRepairs: () => ({ ok: true, ...getRepairs(payload.month || '') }),
    getSalesByMonth: () => ({ ok: true, ...getSalesByMonth(payload.month || '') }),
    getItemByNumber: () => ({ ok: true, item: getItemByNumber(payload.item_number) }),
    createPurchase: () => ({ ok: true, item: createPurchase(payload) }),
    recordSale: () => ({ ok: true, item: recordSale(payload) }),
    cancelSale: () => ({ ok: true, item: cancelSale(payload.item_number) }),
    editItem: () => ({ ok: true, item: editItem(payload.item_number, payload.updates || {}) }),
    updateStatus: () => ({ ok: true, item: updateStatus(payload.item_number, payload.status) }),
    updatePurchaseBalance: () => ({ ok: true, value: updatePurchaseBalanceManual(payload.value) }),
    updateShipping: () => ({ ok: true, item: updateShipping(payload.item_number, payload.shipping || {}) }),
    updateMoneyReceived: () => ({ ok: true, item: updateMoneyReceived(payload.item_number, payload.money_received) }),
    sendToRepair: () => ({ ok: true, item: sendToRepair(payload.item_number, payload.master_id || payload.master_name || '') }),
    completeRepair: () => ({ ok: true, item: completeRepair(payload.item_number, payload.repair_cost) }),
    addRepairMaster: () => ({ ok: true, masters: addRepairMaster(payload.name, payload.city) }),
    deleteRepairMaster: () => ({ ok: true, masters: deleteRepairMaster(payload.id) }),
    deleteItem: () => ({ ok: true, deleted: deleteItem(payload.item_number) })
  };

  const adminOnly = { createPurchase: 1, recordSale: 1, cancelSale: 1, editItem: 1, updateStatus: 1, updatePurchaseBalance: 1, updateShipping: 1, updateMoneyReceived: 1, sendToRepair: 1, completeRepair: 1, addRepairMaster: 1, deleteRepairMaster: 1, deleteItem: 1 };
  if (adminOnly[action] && auth.role !== 'admin') throw new Error('Недостаточно прав для этого действия');

  if (!handlers[action]) throw new Error('Unknown action: ' + action);
  return handlers[action]();
}

function nowIso() { return new Date().toISOString(); }
function toNum(v) { return Number(v || 0); }
function boolText(v) { return ['true', '1', 'yes', 'да', 'y'].includes(String(v || '').toLowerCase()) ? 'yes' : 'no'; }
function monthKey(v) { return String(v || '').slice(0, 7); }
function shippingStatus(v) { return ['pending', 'shipped', 'delivered', 'cancelled'].includes(String(v || '')) ? String(v) : 'pending'; }
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
  if (!user || boolText(user.is_active) !== 'yes') throw new Error('Неверные учётные данные');
  const expected = hashPassword(password, String(user.password_salt || ''));
  if (String(user.password_hash || '') !== expected) throw new Error('Неверные учётные данные');

  const allowed = user.workspace_id === '*' ? CONFIG.WORKSPACES.map((w) => w.id) : [String(user.workspace_id)];
  if (!allowed.length) throw new Error('У пользователя не задана база');

  if (allowed.length > 1 && !selectedWorkspaceId) {
    return { ok: true, require_workspace_choice: true, workspaces: allowed.map((ws) => workspaceById(ws) || { id: ws, name: ws }) };
  }

  const workspaceId = selectedWorkspaceId || allowed[0];
  if (allowed.indexOf(workspaceId) < 0) throw new Error('Доступ к этой базе запрещен');

  const session = createSessionForUser(user, userAgent, workspaceId);
  const ws = workspaceById(workspaceId);

  return {
    ok: true,
    token: session.session_id,
    user: {
      user_id: user.user_id,
      login: user.login,
      email: user.email,
      role: user.role,
      workspace_id: workspaceId,
      workspace_name: ws ? ws.name : workspaceId
    }
  };
}
function getAuthUsers() { ensureDefaultUsers(); return getRows(CONFIG.AUTH.users, CONFIG.HEADERS.authUsers); }

function getSessionInfo(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const row = getRows(CONFIG.AUTH.sessions, CONFIG.HEADERS.authSessions).find((s) => s.session_id === t && !s.revoked_at);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  const user = getAuthUsers().find((u) => u.user_id === row.user_id);
  if (!user) return null;
  return {
    token: row.session_id,
    user_id: user.user_id,
    login: user.login,
    email: user.email,
    role: row.role,
    workspace_id: row.workspace_id,
    workspace_name: (workspaceById(row.workspace_id) || {}).name || row.workspace_id
  };
}

function requireSession(token) {
  const info = getSessionInfo(token);
  if (!info) throw new Error('Требуется авторизация');
  const row = getRows(CONFIG.AUTH.sessions, CONFIG.HEADERS.authSessions).find((s) => s.session_id === info.token);
  row.last_seen_at = nowIso();
  upsertSessionRow(row);
  return info;
}

function revokeSession(token) {
  const t = String(token || '').trim();
  if (!t) return false;
  const rows = getRows(CONFIG.AUTH.sessions, CONFIG.HEADERS.authSessions);
  const row = rows.find((s) => s.session_id === t && !s.revoked_at);
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

function assertNumericItemNumber(itemNumber) {
  const key = String(itemNumber || '').trim();
  if (!/^\d+$/.test(key)) throw new Error('Номер товара должен содержать только цифры');
  return key;
}

function createPurchase(payload) {
  const ws = activeWorkspaceId();
  const now = nowIso();
  const itemNumber = assertNumericItemNumber(payload.item_number);
  const item = {
    workspace_id: ws,
    item_number: itemNumber,
    photo_url: String(payload.photo_url || ''),
    buyee_url: String(payload.buyee_url || ''),
    model_name: String(payload.model_name || '').trim(),
    category: String(payload.category || 'Сумка'),
    description: String(payload.description || ''),
    purchase_date: String(payload.purchase_date || now.slice(0, 10)),
    base_cost: toNum(payload.base_cost || payload.buyout_price || payload.total_cost || 0),
    buyout_price: toNum(payload.buyout_price || payload.base_cost || payload.total_cost || 0),
    shipping_japan: toNum(payload.shipping_japan),
    tax: toNum(payload.tax || payload.customs_tax),
    customs_tax: toNum(payload.customs_tax || payload.tax),
    shipping_spain: toNum(payload.shipping_spain),
    repair_cost: toNum(payload.repair_cost),
    total_cost: toNum(payload.total_cost || payload.base_cost || 0),
    status: 'purchased',
    listed_vinted: 'no', listed_vestiaire: 'no', need_rephoto: 'no', money_received: 'no',
    sale_id: '', sale_price: '', sale_date: '', platform: '', buyer: '', platform_fee: '', profit: '',
    tracking_number: '', shipping_label_url: '', shipping_date: '', shipping_status: 'pending',
    repair_master: '', repair_sent_date: '', repair_finished_date: '', repair_notes: '', arrived_from_japan: 'no', arrived_date: '', japan_arrival_date: '', sold_storage_days: '', listing_price: toNum(payload.listing_price), notes: String(payload.notes || ''), updated_at: now
  };
  if (!item.model_name) throw new Error('Введите модель');
  if (getItemByNumber(item.item_number)) throw new Error('Такой номер уже существует');
  appendRow(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory, item);
  addActivity(item.item_number, 'Добавление покупки', 'card', '', 'created');
  return item;
}
function recordSale(payload) {
  const item = getItemByNumber(assertNumericItemNumber(payload.item_number));
  if (!item) throw new Error('Товар не найден');
  const salePrice = toNum(payload.sale_price);
  const saleDate = String(payload.sale_date || nowIso().slice(0, 10));
  const platform = String(payload.platform || item.platform || 'Vinted');
  const fee = toNum(payload.platform_fee);
  const profit = salePrice - toNum(item.total_cost) - fee;
  const saleId = randomId('sale');

  item.sale_id = saleId;
  item.sale_price = salePrice;
  item.sale_date = saleDate;
  item.platform = platform;
  item.platform_fee = fee;
  item.profit = profit;
  item.status = 'sold';
  item.shipping_status = shippingStatus(payload.shipping_status || item.shipping_status || 'pending');
  item.money_received = boolText(payload.money_received || item.money_received || 'no');
  item.updated_at = nowIso();
  saveInventoryItem(item);

  appendRow(CONFIG.SHEETS.sales, CONFIG.HEADERS.sales, {
    workspace_id: activeWorkspaceId(),
    sale_id: saleId,
    timestamp: nowIso(),
    item_number: item.item_number,
    model_name: item.model_name,
    sale_date: saleDate,
    sale_price: salePrice,
    platform,
    buyer: String(payload.buyer || item.buyer || ''),
    platform_fee: fee,
    total_cost: toNum(item.total_cost),
    profit,
    money_received: item.money_received,
    status: 'sold',
    shipping_status: item.shipping_status,
    tracking_number: String(item.tracking_number || ''),
    shipping_label_url: String(item.shipping_label_url || ''),
    shipping_date: String(item.shipping_date || ''),
    pre_sale_status: String(payload.pre_sale_status || 'listed'),
    sold_storage_days: String(item.sold_storage_days || ''),
    is_cancelled: 'no',
    cancelled_at: '',
    notes: String(payload.notes || item.notes || '')
  });

  addActivity(item.item_number, 'Оформление продажи', 'sale', '', String(item.sale_price));
  return item;
}
function cancelSale(itemNumber) {
  const item = getItemByNumber(itemNumber);
  if (!item) throw new Error('Товар не найден');

  const sales = scopedRows(CONFIG.SHEETS.sales, CONFIG.HEADERS.sales);
  const sale = sales.find((s) => String(s.sale_id) === String(item.sale_id)) || sales.filter((s) => String(s.item_number) === String(item.item_number)).slice(-1)[0];
  if (sale) {
    sale.is_cancelled = 'yes';
    sale.cancelled_at = nowIso();
    sale.status = 'cancelled';
    sale.shipping_status = 'cancelled';
    saveSale(sale);
  }

  item.sale_id = '';
  item.sale_price = '';
  item.sale_date = '';
  item.profit = '';
  item.platform_fee = '';
  item.money_received = 'no';
  item.status = 'listed';
  item.updated_at = nowIso();
  saveInventoryItem(item);
  addActivity(item.item_number, 'Отмена продажи', 'sale', 'sold', 'listed');
  return item;
}

function getSalesByMonth(month) {
  const m = monthKey(month) || monthKey(nowIso());
  const all = scopedRows(CONFIG.SHEETS.sales, CONFIG.HEADERS.sales).filter((s) => String(s.is_cancelled || 'no') !== 'yes');
  const items = all.filter((s) => monthKey(s.sale_date || s.timestamp) === m);
  const summary = {
    sold_count: items.length,
    revenue: items.reduce((a, s) => a + toNum(s.sale_price), 0),
    profit: items.reduce((a, s) => a + (boolText(s.money_received) === 'yes' ? toNum(s.profit) : 0), 0),
    profit_processing: items.reduce((a, s) => a + (boolText(s.money_received) === 'yes' ? 0 : toNum(s.profit)), 0)
  };
  return { month: m, items: items.sort((a, b) => String(b.sale_date).localeCompare(String(a.sale_date))), summary };
}

function updateStatus(itemNumber, status) {
  const item = getItemByNumber(itemNumber);
  if (!item) throw new Error('Товар не найден');
  const prev = item.status;
  item.status = String(status || prev || 'purchased');
  item.updated_at = nowIso();
  saveInventoryItem(item);
  addActivity(item.item_number, 'Изменение статуса', 'status', prev, item.status);
  return item;
}
function editItem(itemNumber, updates) {
  const item = getItemByNumber(itemNumber);
  if (!item) throw new Error('Товар не найден');
  Object.keys(updates || {}).forEach((k) => {
    if (CONFIG.HEADERS.inventory.indexOf(k) >= 0 && !['workspace_id', 'item_number'].includes(k)) item[k] = String(updates[k] == null ? '' : updates[k]);
  });
  item.buyout_price = toNum(item.buyout_price || item.base_cost);
  item.base_cost = toNum(item.base_cost || item.buyout_price);
  item.customs_tax = toNum(item.customs_tax || item.tax);
  item.tax = toNum(item.tax || item.customs_tax);
  item.arrived_date = String(item.arrived_date || item.japan_arrival_date || '');
  item.japan_arrival_date = String(item.japan_arrival_date || item.arrived_date || '');
  item.total_cost = toNum(item.base_cost) + toNum(item.shipping_japan) + toNum(item.tax) + toNum(item.shipping_spain) + toNum(item.repair_cost);
  item.shipping_status = shippingStatus(item.shipping_status);
  item.money_received = boolText(item.money_received);
  item.need_rephoto = boolText(item.need_rephoto);
  item.updated_at = nowIso();
  saveInventoryItem(item);
  addActivity(item.item_number, 'Редактирование карточки', 'card', '', 'updated');
  return item;
}
function updatePurchaseBalanceManual(value) {
  setSettingValue('purchase_balance_manual', String(toNum(value)));
  return toNum(value);
}

function deleteItem(itemNumber) {
  const ws = activeWorkspaceId();
  const key = String(itemNumber || '').trim();
  deleteRowsWhere(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory, (r) => String(r.workspace_id) === ws && String(r.item_number) === key);
  deleteRowsWhere(CONFIG.SHEETS.sales, CONFIG.HEADERS.sales, (r) => String(r.workspace_id) === ws && String(r.item_number) === key);
  addActivity(key, 'Удаление карточки', 'card', 'exists', 'deleted');
  return true;
}
function getActivity() { return scopedRows(CONFIG.SHEETS.activity, CONFIG.HEADERS.activity).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))); }
function getDashboard() {
  const items = scopedRows(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory);
  const sold = items.filter((i) => String(i.status) === 'sold' && monthKey(i.sale_date) === monthKey(nowIso()));
  const active = items.filter((i) => !['sold', 'cancelled'].includes(String(i.status)));
  const purchaseBalanceAuto = items
    .filter((i) => String(i.status) === 'sold' && boolText(i.money_received) === 'yes')
    .reduce((a, i) => a + toNum(i.total_cost), 0);
  return {
    active_stock: active.length,
    stock_value: active.reduce((a, i) => a + toNum(i.total_cost), 0),
    sold_this_month: sold.length,
    profit_this_month: sold.reduce((a, s) => a + toNum(s.profit || (toNum(s.sale_price) - toNum(s.total_cost))), 0),
    profit_share_each: sold.reduce((a, s) => a + toNum(s.profit || (toNum(s.sale_price) - toNum(s.total_cost))), 0) / 3,
    purchase_balance: purchaseBalanceAuto,
    pending_shipping: items.filter((i) => String(i.shipping_status || 'pending') === 'pending' && String(i.status) === 'sold').length,
    in_transit: items.filter((i) => String(i.shipping_status) === 'shipped').length,
    repair_count: items.filter((i) => String(i.status) === 'repair').length,
    attention_count: items.filter((i) => boolText(i.need_rephoto) === 'yes' || !String(i.photo_url || '')).length,
    awaiting_japan: items.filter((i) => boolText(i.arrived_from_japan) !== 'yes').length
  };
}

function getAnalytics() {
  const sales = scopedRows(CONFIG.SHEETS.sales, CONFIG.HEADERS.sales).filter((s) => String(s.is_cancelled || 'no') !== 'yes');
  const monthly = {};
  sales.forEach((s) => {
    const m = monthKey(s.sale_date || s.timestamp);
    if (!m) return;
    if (!monthly[m]) monthly[m] = { sold_count: 0, revenue: 0, profit: 0, potential_profit: 0, items: [] };
    const pr = toNum(s.profit);
    monthly[m].sold_count += 1;
    monthly[m].revenue += toNum(s.sale_price);
    monthly[m].profit += boolText(s.money_received) === 'yes' ? pr : 0;
    monthly[m].potential_profit += pr;
    monthly[m].items.push(s);
  });
  return { monthly };
}
function getQC() {
  const items = scopedRows(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory);
  const out = [];
  items.forEach((i) => {
    const reasons = [];
    if (!String(i.description || '').trim()) reasons.push('Нет описания');
    if (boolText(i.listed_vinted) !== 'yes') reasons.push('Не выставлено на Vinted');
    if (boolText(i.listed_vestiaire) !== 'yes') reasons.push('Не выставлено на Vestiaire');
    if (boolText(i.need_rephoto) === 'yes') reasons.push('Нужно перефото');
    if (String(i.status) === 'sold' && boolText(i.money_received) !== 'yes') reasons.push('Продано, но деньги не зашли');
    if (String(i.status) === 'sold' && String(i.shipping_status || 'pending') === 'pending') reasons.push('Продано, но не отправлено');
    if (String(i.shipping_status) === 'shipped') reasons.push('Отправлено, но не доставлено');
    if (reasons.length) out.push({ item_number: i.item_number, model_name: i.model_name, reasons, photo_url: i.photo_url, status: i.status });
  });
  return out;
}
function getShippingOverview() {
  const items = scopedRows(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory).filter((i) => String(i.status) === 'sold');
  const summary = { pending: 0, shipped: 0, delivered: 0, cancelled: 0 };
  items.forEach((i) => { summary[shippingStatus(i.shipping_status)] += 1; });
  return { summary, items };
}
function getRepairs(month) {
  const m = monthKey(month) || monthKey(nowIso());
  const items = scopedRows(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory).filter((i) => String(i.status) === 'repair' || monthKey(i.repair_sent_date) === m || monthKey(i.repair_finished_date) === m);
  const masters = getRepairMasters();
  const stats = { sent: items.filter((i) => monthKey(i.repair_sent_date) === m).length, completed: items.filter((i) => monthKey(i.repair_finished_date) === m).length, spend: items.reduce((a, i) => a + toNum(i.repair_cost), 0) };
  return { month: m, items, masters, stats };
}
function getRepairMasters() {
  const raw = String(getSettingValue('repair_masters', '[]') || '[]');
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; } catch (_) { return []; }
}
function setRepairMasters(masters) { setSettingValue('repair_masters', JSON.stringify(masters || [])); }
function addRepairMaster(name, city) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Введите имя мастера');
  const masters = getRepairMasters();
  masters.push({ id: randomId('master'), name: nm, city: String(city || '').trim() });
  setRepairMasters(masters);
  return masters;
}
function deleteRepairMaster(id) {
  const masters = getRepairMasters().filter((m) => String(m.id) !== String(id));
  setRepairMasters(masters);
  return masters;
}
function updateShipping(itemNumber, shipping) {
  const item = getItemByNumber(itemNumber);
  if (!item) throw new Error('Товар не найден');
  item.shipping_status = shippingStatus(shipping.shipping_status || item.shipping_status);
  item.shipping_date = String(shipping.shipping_date || item.shipping_date || '');
  item.tracking_number = String(shipping.tracking_number || item.tracking_number || '');
  item.shipping_label_url = String(shipping.shipping_label_url || item.shipping_label_url || '');
  item.updated_at = nowIso();
  saveInventoryItem(item);
  addActivity(item.item_number, 'Обновление доставки', 'shipping', '', item.shipping_status);
  return item;
}
function updateMoneyReceived(itemNumber, moneyReceived) {
  const item = getItemByNumber(itemNumber);
  if (!item) throw new Error('Товар не найден');
  item.money_received = boolText(moneyReceived);
  item.updated_at = nowIso();
  saveInventoryItem(item);
  addActivity(item.item_number, 'Обновление оплаты', 'money_received', '', item.money_received);
  return item;
}
function sendToRepair(itemNumber, masterIdOrName) {
  const item = getItemByNumber(itemNumber);
  if (!item) throw new Error('Товар не найден');
  const masters = getRepairMasters();
  const m = masters.find((x) => String(x.id) === String(masterIdOrName));
  item.repair_master = m ? `${m.name}${m.city ? ` (${m.city})` : ''}` : String(masterIdOrName || item.repair_master || '');
  item.repair_sent_date = nowIso().slice(0, 10);
  item.status = 'repair';
  item.updated_at = nowIso();
  saveInventoryItem(item);
  addActivity(item.item_number, 'Отправка в ремонт', 'status', '', 'repair');
  return item;
}
function completeRepair(itemNumber, repairCost) {
  const item = getItemByNumber(itemNumber);
  if (!item) throw new Error('Товар не найден');
  item.repair_cost = toNum(repairCost != null ? repairCost : item.repair_cost);
  item.total_cost = toNum(item.base_cost || item.buyout_price) + toNum(item.shipping_japan) + toNum(item.tax || item.customs_tax) + toNum(item.shipping_spain) + toNum(item.repair_cost);
  item.status = 'ready';
  item.repair_finished_date = nowIso().slice(0, 10);
  item.updated_at = nowIso();
  saveInventoryItem(item);
  addActivity(item.item_number, 'Ремонт выполнен', 'repair', '', 'ready');
  return item;
}

function addActivity(itemNumber, action, field, oldValue, newValue) {
  appendRow(CONFIG.SHEETS.activity, CONFIG.HEADERS.activity, { workspace_id: activeWorkspaceId(), timestamp: nowIso(), item_number: itemNumber || '', action: action || '', field: field || '', old_value: oldValue || '', new_value: newValue || '', actor: REQUEST_CONTEXT && REQUEST_CONTEXT.login ? REQUEST_CONTEXT.login : 'web' });
}
function saveInventoryItem(item) {
  const ws = activeWorkspaceId();
  const rows = getRows(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory);
  const idx = rows.findIndex((r) => String(r.workspace_id) === ws && String(r.item_number) === String(item.item_number));
  if (idx < 0) throw new Error('Товар не найден');
  getSheet(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory).getRange(idx + 2, 1, 1, CONFIG.HEADERS.inventory.length).setValues([objToRow(item, CONFIG.HEADERS.inventory)]);
}
function saveSale(sale) {
  const ws = activeWorkspaceId();
  const rows = getRows(CONFIG.SHEETS.sales, CONFIG.HEADERS.sales);
  const idx = rows.findIndex((r) => String(r.workspace_id) === ws && String(r.sale_id) === String(sale.sale_id));
  if (idx < 0) throw new Error('Продажа не найдена');
  getSheet(CONFIG.SHEETS.sales, CONFIG.HEADERS.sales).getRange(idx + 2, 1, 1, CONFIG.HEADERS.sales.length).setValues([objToRow(sale, CONFIG.HEADERS.sales)]);
}
function deleteRowsWhere(sheetName, headers, predicate) {
  const sh = getSheet(sheetName, headers);
  const rows = getRows(sheetName, headers);
  for (let i = rows.length - 1; i >= 0; i -= 1) if (predicate(rows[i])) sh.deleteRow(i + 2);
}

function jsonResponse(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function ss() { return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); }
function cellText(v) { const txt = String(v == null ? '' : v); return txt.length > 49000 ? '' : txt; }
function objToRow(obj, headers) { return headers.map((h) => obj[h] == null ? '' : cellText(obj[h])); }
function getSheet(name, headers) {
  const sheet = ss().getSheetByName(name) || ss().insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }

  const width = Math.max(sheet.getLastColumn(), headers.length);
  const currentHeaders = sheet.getRange(1, 1, 1, width).getValues()[0].slice(0, headers.length).map((x) => String(x || '').trim());
  const needMigrate = currentHeaders.length !== headers.length || headers.some((h, i) => currentHeaders[i] !== h);
  if (!needMigrate) return sheet;

  const lastRow = sheet.getLastRow();
  const values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues() : [];
  const currentIndex = {};
  currentHeaders.forEach((h, i) => { if (h) currentIndex[h] = i; });
  const migrated = values.map((row) => headers.map((h) => {
    const idx = currentIndex[h];
    return idx == null ? '' : row[idx];
  }));

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (migrated.length) sheet.getRange(2, 1, migrated.length, headers.length).setValues(migrated);
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
function getSettingValue(key, fallback) {
  const rows = scopedRows(CONFIG.SHEETS.settings, CONFIG.HEADERS.settings);
  const row = rows.find((r) => String(r.key) === String(key));
  return row ? row.value : fallback;
}
function setSettingValue(key, value) {
  const ws = activeWorkspaceId();
  const sh = getSheet(CONFIG.SHEETS.settings, CONFIG.HEADERS.settings);
  const rows = getRows(CONFIG.SHEETS.settings, CONFIG.HEADERS.settings);
  const idx = rows.findIndex((r) => String(r.workspace_id) === ws && String(r.key) === String(key));
  if (idx < 0) {
    appendRow(CONFIG.SHEETS.settings, CONFIG.HEADERS.settings, { workspace_id: ws, key: String(key), value: String(value) });
    return;
  }
  sh.getRange(idx + 2, 1, 1, CONFIG.HEADERS.settings.length).setValues([objToRow({ ...rows[idx], value: String(value) }, CONFIG.HEADERS.settings)]);
}
function appendRow(sheetName, headers, obj) { getSheet(sheetName, headers).appendRow(objToRow(obj, headers)); }
