/**
 * База с Катей — Google Apps Script API bridge
 * Архитектура: GitHub Pages -> Apps Script Web App -> Google Sheets
 */

const SHIPPING_STATUS = {
  pending: 'Не отправлено',
  shipped: 'Отправлено',
  delivered: 'Доставлено',
  cancelled: 'Отменено'
};

const CONFIG = {
  SPREADSHEET_ID: '18iiIdp8kKYGd8SV-uWFqdQfvW0EkUtg9-s6tV9mU0Eg',
  SHEETS: {
    inventory: 'Inventory',
    purchases: 'Purchases',
    sales: 'Sales',
    statistics: 'Statistics',
    activity: 'Activity Log',
    settings: 'Settings'
  },
  HEADERS: {
    inventory: [
      'item_number', 'photo_url', 'buyee_url', 'model_name', 'category', 'purchase_date',
      'base_cost', 'shipping_japan', 'tax', 'shipping_spain', 'repair_cost', 'total_cost',
      'status', 'listed_vinted', 'listed_vestiaire', 'need_rephoto', 'money_received',
      'sale_id', 'sale_price', 'sale_date', 'platform', 'buyer', 'platform_fee', 'profit',
      'tracking_number', 'shipping_label_url', 'shipping_date', 'shipping_status',
      'repair_master', 'repair_sent_date', 'repair_notes', 'arrived_from_japan', 'japan_arrival_date', 'sold_storage_days', 'notes', 'updated_at'
    ],
    purchases: ['timestamp', 'item_number', 'model_name', 'purchase_date', 'base_cost', 'shipping_japan', 'tax', 'shipping_spain', 'repair_cost', 'total_cost', 'notes'],
    sales: [
      'sale_id', 'timestamp', 'item_number', 'model_name', 'sale_date', 'sale_price', 'platform', 'buyer',
      'platform_fee', 'total_cost', 'profit', 'money_received', 'status', 'shipping_status',
      'tracking_number', 'shipping_label_url', 'shipping_date', 'pre_sale_status',
      'sold_storage_days', 'is_cancelled', 'cancelled_at', 'notes'
    ],
    statistics: ['timestamp', 'active_stock', 'stock_value', 'sold_this_month', 'profit_this_month', 'profit_share_each', 'purchase_balance', 'pending_shipping', 'in_transit', 'repair_count', 'attention_count', 'avg_sale_days', 'oldest_item_number', 'oldest_item_days'],
    activity: ['timestamp', 'item_number', 'action', 'field', 'old_value', 'new_value', 'actor'],
    settings: ['key', 'value']
  },
  STATUS_LABELS: {
    purchased: 'Куплено',
    transit: 'В пути',
    repair: 'На ремонте',
    ready: 'Готово',
    listed: 'Выставлено',
    hold: 'Резерв',
    sold: 'Продано',
    shipped: 'Отправлено',
    delivered: 'Доставлено'
  }
};

function doGet(e) {
  try {
    return jsonResponse(routeAction(String((e && e.parameter && e.parameter.action) || ''), e && e.parameter ? e.parameter : {}));
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return jsonResponse(routeAction(String(body.action || ''), body.payload || {}));
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function routeAction(action, payload) {
  const handlers = {
    getInventory: () => ({ ok: true, items: getInventory() }),
    getDashboard: () => ({ ok: true, stats: getDashboard() }),
    getAnalytics: () => ({ ok: true, ...getAnalytics() }),
    getQC: () => ({ ok: true, attention: getQC() }),
    getRepairs: () => ({ ok: true, ...getRepairs(payload.month || payload.monthKey || '') }),
    getActivity: () => ({ ok: true, activity: getActivity() }),
    getSalesByMonth: () => ({ ok: true, ...getSalesByMonth(payload.month || payload.monthKey || '') }),
    getShippingOverview: () => ({ ok: true, ...getShippingOverview() }),
    getItemByNumber: () => ({ ok: true, item: getItemByNumber(payload.item_number) }),
    createPurchase: () => ({ ok: true, item: createPurchase(payload) }),
    recordSale: () => ({ ok: true, item: recordSale(payload) }),
    updateShipping: () => ({ ok: true, item: updateShipping(payload.item_number, payload.shipping || {}) }),
    updateMoneyReceived: () => ({ ok: true, item: updateMoneyReceived(payload.item_number, payload.money_received) }),
    updatePurchaseBalance: () => ({ ok: true, value: updatePurchaseBalanceManual(payload.value) }),
    sendToRepair: () => ({ ok: true, item: sendToRepair(payload.item_number, payload.master_id || payload.master_name || '') }),
    completeRepair: () => ({ ok: true, item: completeRepair(payload.item_number, payload.repair_cost) }),
    addRepairMaster: () => ({ ok: true, masters: addRepairMaster(payload.name, payload.city) }),
    deleteRepairMaster: () => ({ ok: true, masters: deleteRepairMaster(payload.id) }),
    deleteItem: () => ({ ok: true, deleted: deleteItem(payload.item_number) }),
    cancelSale: () => ({ ok: true, item: cancelSale(payload.item_number, payload.sale_id) }),
    updateStatus: () => ({ ok: true, item: updateStatus(payload.item_number, payload.status) }),
    editItem: () => ({ ok: true, item: editItem(payload.item_number, payload.updates || {}) })
  };

  if (!handlers[action]) throw new Error('Unknown action: ' + action);
  return handlers[action]();
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function ss() { return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); }

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
  const oldHeaders = sheet.getRange(1, 1, 1, width).getValues()[0].map((x) => String(x || '').trim());
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];

  const aliases = {
    item_number: ['item_number', 'item_id'],
    model_name: ['model_name', 'model'],
    total_cost: ['total_cost', 'purchase_price'],
    base_cost: ['base_cost', 'total_cost', 'purchase_price'],
    shipping_japan: ['shipping_japan', 'delivery_japan', 'japan_shipping'],
    tax: ['tax', 'nalog'],
    shipping_spain: ['shipping_spain', 'delivery_spain', 'spain_shipping'],
    repair_cost: ['repair_cost', 'repair'],
    buyee_url: ['buyee_url', 'auction_url', 'source_url'],
    purchase_date: ['purchase_date'],
    status: ['status'],
    sale_price: ['sale_price'],
    sale_date: ['sale_date'],
    platform: ['platform'],
    shipping_status: ['shipping_status'],
    arrived_from_japan: ['arrived_from_japan'],
    japan_arrival_date: ['japan_arrival_date', 'arrived_date'],
    repair_notes: ['repair_notes', 'repair_comment'],
    tracking_number: ['tracking_number'],
    shipping_label_url: ['shipping_label_url'],
    notes: ['notes'],
    photo_url: ['photo_url']
  };

  const mappedRows = rows.map((row) => {
    const obj = {};
    oldHeaders.forEach((h, i) => { if (h) obj[h] = row[i]; });
    return headers.map((h) => {
      if (obj[h] != null && obj[h] !== '') return cellText(obj[h]);
      const alt = aliases[h] || [];
      for (let i = 0; i < alt.length; i += 1) {
        if (obj[alt[i]] != null && obj[alt[i]] !== '') return cellText(obj[alt[i]]);
      }
      return '';
    });
  });

  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (mappedRows.length) sheet.getRange(2, 1, mappedRows.length, headers.length).setValues(mappedRows);
  return sheet;
}

function getRows(sheetName, headers) {
  const sh = getSheet(sheetName, headers);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function appendRow(sheetName, headers, obj) {
  getSheet(sheetName, headers).appendRow(headers.map((h) => obj[h] == null ? '' : cellText(obj[h])));
}

function updateInventoryRow(itemNumber, nextObj) {
  const sh = getSheet(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory);
  const rows = getRows(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory);
  const idx = rows.findIndex((r) => String(r.item_number) === String(itemNumber));
  if (idx === -1) throw new Error('Товар не найден');
  sh.getRange(idx + 2, 1, 1, CONFIG.HEADERS.inventory.length)
    .setValues([CONFIG.HEADERS.inventory.map((h) => nextObj[h] == null ? '' : cellText(nextObj[h]))]);
}

function updateSalesRow(saleId, updater) {
  const sh = getSheet(CONFIG.SHEETS.sales, CONFIG.HEADERS.sales);
  const rows = getRows(CONFIG.SHEETS.sales, CONFIG.HEADERS.sales);
  const idx = rows.findIndex((r) => String(r.sale_id) === String(saleId));
  if (idx === -1) throw new Error('Продажа не найдена');
  const next = updater(rows[idx]);
  sh.getRange(idx + 2, 1, 1, CONFIG.HEADERS.sales.length)
    .setValues([CONFIG.HEADERS.sales.map((h) => next[h] == null ? '' : cellText(next[h]))]);
  return next;
}

function deleteRowsByItemNumber(sheetName, headers, itemNumber) {
  const sh = getSheet(sheetName, headers);
  const rows = getRows(sheetName, headers);
  const target = String(itemNumber);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (String(rows[i].item_number) === target) sh.deleteRow(i + 2);
  }
}

function getSettingValue(key, fallback) {
  const rows = getRows(CONFIG.SHEETS.settings, CONFIG.HEADERS.settings);
  const row = rows.find((r) => String(r.key) === String(key));
  return row ? row.value : fallback;
}

function setSettingValue(key, value) {
  const sh = getSheet(CONFIG.SHEETS.settings, CONFIG.HEADERS.settings);
  const rows = getRows(CONFIG.SHEETS.settings, CONFIG.HEADERS.settings);
  const idx = rows.findIndex((r) => String(r.key) === String(key));
  const row = { key: String(key), value: String(value == null ? '' : value) };
  if (idx === -1) {
    sh.appendRow(CONFIG.HEADERS.settings.map((h) => row[h] || ''));
  } else {
    sh.getRange(idx + 2, 1, 1, CONFIG.HEADERS.settings.length)
      .setValues([CONFIG.HEADERS.settings.map((h) => row[h] || '')]);
  }
  return row.value;
}

function toNum(v) { return Number(v || 0); }
function cellText(v) {
  const txt = String(v == null ? '' : v);
  return txt.length > 49000 ? '' : txt;
}
function monthKey(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const dot = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dot) return `${dot[3]}-${dot[2]}`;
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return raw.slice(0, 7);
}
function toDateSafe(v) {
  const raw = String(v || '').trim();
  if (!raw) return null;
  const dot = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dot) {
    const d = new Date(`${dot[3]}-${dot[2]}-${dot[1]}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
function diffDays(startDate, endDate) {
  const s = toDateSafe(startDate);
  const e = toDateSafe(endDate || new Date().toISOString().slice(0, 10));
  if (!s || !e) return 0;
  return Math.max(0, Math.floor((e.getTime() - s.getTime()) / 86400000));
}

function storageStartDate(item) {
  if (boolText(item.arrived_from_japan) === 'yes' && String(item.japan_arrival_date || '').trim()) {
    return item.japan_arrival_date;
  }
  return '';
}

function calcStorageDays(item, endDate) {
  const start = storageStartDate(item);
  if (!start) return 0;
  return diffDays(start, endDate || new Date().toISOString().slice(0, 10));
}

function paidProfit(sale) {
  return boolText(sale.money_received) === 'yes' ? toNum(sale.profit) : 0;
}

function boolText(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return (s === 'true' || s === '1' || s === 'yes' || s === 'да' || s === 'y') ? 'yes' : 'no';
}
function shippingStatus(v) {
  return SHIPPING_STATUS[v] ? v : 'pending';
}
function calcTotalCost(input, prev) {
  const p = prev || {};
  const baseCost = toNum(input.base_cost != null ? input.base_cost : p.base_cost != null ? p.base_cost : p.total_cost);
  const shippingJapan = toNum(input.shipping_japan != null ? input.shipping_japan : p.shipping_japan);
  const tax = toNum(input.tax != null ? input.tax : p.tax);
  const shippingSpain = toNum(input.shipping_spain != null ? input.shipping_spain : p.shipping_spain);
  const repairCost = toNum(input.repair_cost != null ? input.repair_cost : p.repair_cost);
  const explicit = input.total_cost != null ? toNum(input.total_cost) : null;
  const computed = baseCost + shippingJapan + tax + shippingSpain + repairCost;
  return {
    base_cost: baseCost,
    shipping_japan: shippingJapan,
    tax: tax,
    shipping_spain: shippingSpain,
    repair_cost: repairCost,
    total_cost: explicit != null && explicit > 0 ? explicit : computed
  };
}
function isCancelledSale(s) {
  return boolText(s.is_cancelled) === 'yes' || String(s.shipping_status) === 'cancelled' || String(s.status) === 'cancelled';
}
function activeSalesOnly(sales) {
  return sales.filter((s) => !isCancelledSale(s));
}


function saleDateValue(sale) {
  return String(sale.sale_date || sale.timestamp || '').trim();
}

function validSaleRow(sale) {
  if (isCancelledSale(sale)) return false;
  if (!String(sale.item_number || '').trim()) return false;
  if (toNum(sale.sale_price) <= 0) return false;
  if (!saleDateValue(sale)) return false;
  return true;
}

function getValidSales() {
  return getRows(CONFIG.SHEETS.sales, CONFIG.HEADERS.sales).filter((s) => validSaleRow(s));
}
function createSaleId(itemNumber) {
  return String(itemNumber) + '-' + new Date().getTime();
}

function normalizeItem(input, prev) {
  const p = prev || {};
  const costs = calcTotalCost(input, p);
  const item = {
    item_number: String(input.item_number != null ? input.item_number : p.item_number || '').trim(),
    photo_url: cellText(input.photo_url != null ? input.photo_url : (p.photo_url || '')),
    buyee_url: cellText(input.buyee_url != null ? input.buyee_url : (p.buyee_url || '')),
    model_name: input.model_name != null ? input.model_name : (p.model_name || ''),
    category: input.category != null ? input.category : (p.category || ''),
    purchase_date: input.purchase_date != null ? input.purchase_date : (p.purchase_date || ''),
    base_cost: costs.base_cost,
    shipping_japan: costs.shipping_japan,
    tax: costs.tax,
    shipping_spain: costs.shipping_spain,
    repair_cost: costs.repair_cost,
    total_cost: costs.total_cost,
    status: input.status != null ? input.status : (p.status || 'purchased'),
    listed_vinted: boolText(input.listed_vinted != null ? input.listed_vinted : p.listed_vinted),
    listed_vestiaire: boolText(input.listed_vestiaire != null ? input.listed_vestiaire : p.listed_vestiaire),
    need_rephoto: boolText(input.need_rephoto != null ? input.need_rephoto : p.need_rephoto),
    money_received: boolText(input.money_received != null ? input.money_received : p.money_received),
    sale_id: input.sale_id != null ? input.sale_id : (p.sale_id || ''),
    sale_price: toNum(input.sale_price != null ? input.sale_price : p.sale_price),
    sale_date: input.sale_date != null ? input.sale_date : (p.sale_date || ''),
    platform: input.platform != null ? input.platform : (p.platform || ''),
    buyer: input.buyer != null ? input.buyer : (p.buyer || ''),
    platform_fee: toNum(input.platform_fee != null ? input.platform_fee : p.platform_fee),
    profit: 0,
    tracking_number: cellText(input.tracking_number != null ? input.tracking_number : (p.tracking_number || '')),
    shipping_label_url: cellText(input.shipping_label_url != null ? input.shipping_label_url : (p.shipping_label_url || '')),
    shipping_date: input.shipping_date != null ? input.shipping_date : (p.shipping_date || ''),
    shipping_status: shippingStatus(input.shipping_status != null ? input.shipping_status : p.shipping_status),
    repair_master: input.repair_master != null ? input.repair_master : (p.repair_master || ''),
    repair_sent_date: input.repair_sent_date != null ? input.repair_sent_date : (p.repair_sent_date || ''),
    repair_notes: input.repair_notes != null ? input.repair_notes : (p.repair_notes || ''),
    arrived_from_japan: boolText(input.arrived_from_japan != null ? input.arrived_from_japan : p.arrived_from_japan),
    japan_arrival_date: input.japan_arrival_date != null ? input.japan_arrival_date : (p.japan_arrival_date || ''),
    sold_storage_days: toNum(input.sold_storage_days != null ? input.sold_storage_days : p.sold_storage_days),
    notes: cellText(input.notes != null ? input.notes : (p.notes || '')),
    updated_at: new Date().toISOString()
  };
  if ((item.listed_vinted === 'yes' || item.listed_vestiaire === 'yes') && item.arrived_from_japan !== 'yes') {
    item.arrived_from_japan = 'yes';
    item.japan_arrival_date = item.japan_arrival_date || new Date().toISOString().slice(0, 10);
  }
  if (item.sale_date && toNum(item.sale_price) > 0) {
    item.sold_storage_days = calcStorageDays(item, item.sale_date);
  }
  item.profit = item.sale_price ? (item.sale_price - item.total_cost - item.platform_fee) : 0;
  return item;
}

function addActivity(entry) {
  appendRow(CONFIG.SHEETS.activity, CONFIG.HEADERS.activity, {
    timestamp: new Date().toISOString(),
    item_number: entry.item_number || '',
    action: entry.action || '',
    field: entry.field || '',
    old_value: entry.old_value || '',
    new_value: entry.new_value || '',
    actor: 'web'
  });
}

function getInventory() {
  return getRows(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory)
    .map((row) => normalizeItem(row, row))
    .sort((a, b) => Number(a.item_number) - Number(b.item_number));
}

function getItemByNumber(itemNumber) {
  const key = String(itemNumber || '').trim();
  if (!key) return null;
  const num = Number(key);
  return getInventory().find((x) => {
    const itemKey = String(x.item_number || '').trim();
    if (itemKey === key) return true;
    if (!Number.isNaN(num) && itemKey !== '' && Number(itemKey) === num) return true;
    return false;
  }) || null;
}

function createPurchase(payload) {
  const itemNumber = String(payload.item_number || '').trim();
  if (!itemNumber) throw new Error('Нужен короткий номер товара');
  const modelName = String(payload.model_name || '').trim();
  if (!modelName) throw new Error('Нужна модель');
  const items = getInventory();
  if (items.some((i) => String(i.item_number) === itemNumber)) throw new Error('Такой номер уже существует');

  const item = normalizeItem({
    ...payload,
    item_number: itemNumber,
    model_name: modelName,
    total_cost: payload.total_cost,
    status: payload.status || 'purchased'
  }, {});
  appendRow(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory, item);
  appendRow(CONFIG.SHEETS.purchases, CONFIG.HEADERS.purchases, {
    timestamp: new Date().toISOString(),
    item_number: item.item_number,
    model_name: item.model_name,
    purchase_date: item.purchase_date,
    base_cost: item.base_cost,
    shipping_japan: item.shipping_japan,
    tax: item.tax,
    shipping_spain: item.shipping_spain,
    repair_cost: item.repair_cost,
    total_cost: item.total_cost,
    notes: item.notes
  });
  addActivity({ item_number: item.item_number, action: 'Добавление покупки', field: 'карточка', old_value: '—', new_value: 'создана' });
  return item;
}

function editItem(itemNumber, updates) {
  const current = getItemByNumber(itemNumber);
  if (!current) throw new Error('Товар не найден');
  const next = normalizeItem(updates, current);
  updateInventoryRow(itemNumber, next);

  if (current.sale_id) {
    updateSalesRow(current.sale_id, (sale) => ({
      ...sale,
      model_name: next.model_name,
      sale_date: next.sale_date,
      sale_price: next.sale_price,
      platform: next.platform,
      total_cost: next.total_cost,
      profit: next.profit,
      money_received: next.money_received,
      status: next.status,
      shipping_status: next.shipping_status,
      tracking_number: next.tracking_number,
      shipping_label_url: next.shipping_label_url,
      shipping_date: next.shipping_date,
      sold_storage_days: next.sold_storage_days,
      notes: next.notes
    }));
  }

  addActivity({ item_number: itemNumber, action: 'Редактирование карточки', field: 'карточка', old_value: 'обновление', new_value: 'сохранено' });
  return next;
}

function updateStatus(itemNumber, status) {
  const current = getItemByNumber(itemNumber);
  if (!current) throw new Error('Товар не найден');
  const next = normalizeItem({ status: status }, current);
  updateInventoryRow(itemNumber, next);
  addActivity({ item_number: itemNumber, action: 'Изменение статуса', field: 'status', old_value: CONFIG.STATUS_LABELS[current.status] || current.status, new_value: CONFIG.STATUS_LABELS[next.status] || next.status });
  return next;
}

function recordSale(payload) {
  const current = getItemByNumber(payload.item_number);
  if (!current) throw new Error('Товар не найден');
  if (toNum(payload.sale_price) <= 0) throw new Error('Введите корректную цену продажи');

  const saleId = createSaleId(current.item_number);
  const next = normalizeItem({
    sale_id: saleId,
    sale_price: payload.sale_price,
    sale_date: payload.sale_date || new Date().toISOString().slice(0, 10),
    platform: payload.platform || '',
    buyer: payload.buyer || '',
    platform_fee: payload.platform_fee || 0,
    notes: payload.notes != null ? payload.notes : current.notes,
    money_received: payload.money_received != null ? payload.money_received : current.money_received,
    status: payload.status || 'sold',
    tracking_number: payload.tracking_number || '',
    shipping_label_url: payload.shipping_label_url || '',
    shipping_date: payload.shipping_date || '',
    shipping_status: payload.shipping_status || 'pending'
  }, current);

  updateInventoryRow(current.item_number, next);
  appendRow(CONFIG.SHEETS.sales, CONFIG.HEADERS.sales, {
    sale_id: saleId,
    timestamp: new Date().toISOString(),
    item_number: next.item_number,
    model_name: next.model_name,
    sale_date: next.sale_date,
    sale_price: next.sale_price,
    platform: next.platform,
    buyer: next.buyer,
    platform_fee: next.platform_fee,
    total_cost: next.total_cost,
    profit: next.profit,
    money_received: next.money_received,
    status: next.status,
    shipping_status: next.shipping_status,
    tracking_number: next.tracking_number,
    shipping_label_url: next.shipping_label_url,
    shipping_date: next.shipping_date,
    pre_sale_status: current.status || 'listed',
    sold_storage_days: next.sold_storage_days,
    is_cancelled: 'no',
    cancelled_at: '',
    notes: next.notes
  });
  addActivity({ item_number: next.item_number, action: 'Оформление продажи', field: 'sale_price', old_value: current.sale_price || '—', new_value: String(next.sale_price) });
  return next;
}

function updateShipping(itemNumber, shipping) {
  const current = getItemByNumber(itemNumber);
  if (!current) throw new Error('Товар не найден');
  if (!current.sale_id) throw new Error('Для товара нет активной продажи');

  const next = normalizeItem({
    tracking_number: shipping.tracking_number,
    shipping_label_url: shipping.shipping_label_url,
    shipping_date: shipping.shipping_date,
    shipping_status: shipping.shipping_status,
    status: shipping.shipping_status === 'delivered' ? 'delivered' : (shipping.shipping_status === 'shipped' ? 'shipped' : current.status)
  }, current);
  updateInventoryRow(itemNumber, next);

  updateSalesRow(current.sale_id, (sale) => ({
    ...sale,
    tracking_number: next.tracking_number,
    shipping_label_url: next.shipping_label_url,
    shipping_date: next.shipping_date,
    shipping_status: next.shipping_status,
    status: next.status,
    notes: next.notes
  }));

  addActivity({
    item_number: itemNumber,
    action: 'Обновление доставки',
    field: 'shipping_status',
    old_value: SHIPPING_STATUS[current.shipping_status] || SHIPPING_STATUS.pending,
    new_value: SHIPPING_STATUS[next.shipping_status] || SHIPPING_STATUS.pending
  });
  return next;
}

function updateMoneyReceived(itemNumber, value) {
  const current = getItemByNumber(itemNumber);
  if (!current) throw new Error('Товар не найден');
  const next = normalizeItem({ money_received: value }, current);
  updateInventoryRow(itemNumber, next);

  if (current.sale_id) {
    updateSalesRow(current.sale_id, (sale) => ({
      ...sale,
      money_received: next.money_received,
      notes: next.notes
    }));
  }

  addActivity({
    item_number: itemNumber,
    action: 'Обновление оплаты',
    field: 'money_received',
    old_value: boolText(current.money_received) === 'yes' ? 'yes' : 'no',
    new_value: next.money_received
  });
  return next;
}

function updatePurchaseBalanceManual(value) {
  const target = toNum(value);
  setSettingValue('purchase_balance_base', target);
  setSettingValue('purchase_balance_base_at', new Date().toISOString());
  return target;
}

function getRepairMasters() {
  const raw = String(getSettingValue('repair_masters', ''));
  if (!raw) {
    return [
      { id: 'polina-dnipro', name: 'Полина', city: 'Днепр' },
      { id: 'spain-watchmaker', name: 'Испания', city: 'часовщик' },
      { id: 'kharkiv-types', name: 'Харьковские типы', city: '' }
    ];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveRepairMasters(masters) {
  setSettingValue('repair_masters', JSON.stringify(masters || []));
  return masters;
}

function addRepairMaster(name, city) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Введите имя мастера');
  const c = String(city || '').trim();
  const masters = getRepairMasters();
  masters.push({ id: `m-${new Date().getTime()}`, name: n, city: c });
  return saveRepairMasters(masters);
}

function deleteRepairMaster(id) {
  const target = String(id || '').trim();
  if (!target) throw new Error('Не передан id мастера');
  return saveRepairMasters(getRepairMasters().filter((m) => String(m.id) !== target));
}

function sendToRepair(itemNumber, masterIdOrName) {
  const current = getItemByNumber(itemNumber);
  if (!current) throw new Error('Товар не найден');
  const masters = getRepairMasters();
  const found = masters.find((m) => String(m.id) === String(masterIdOrName) || String(m.name) === String(masterIdOrName));
  const masterName = found ? `${found.name}${found.city ? ` (${found.city})` : ''}` : String(masterIdOrName || '').trim();
  if (!masterName) throw new Error('Выберите мастера');
  const next = normalizeItem({ status: 'repair', repair_master: masterName, repair_sent_date: new Date().toISOString().slice(0, 10), repair_notes: current.repair_notes || '' }, current);
  updateInventoryRow(itemNumber, next);
  addActivity({ item_number: itemNumber, action: 'Отправлено в ремонт', field: 'repair_master', old_value: current.repair_master || '—', new_value: masterName });
  return next;
}

function completeRepair(itemNumber, repairCost) {
  const current = getItemByNumber(itemNumber);
  if (!current) throw new Error('Товар не найден');
  const next = normalizeItem({
    repair_cost: toNum(repairCost),
    status: 'ready',
    repair_master: '',
    repair_sent_date: '',
    repair_notes: ''
  }, current);
  updateInventoryRow(itemNumber, next);
  addActivity({ item_number: itemNumber, action: 'Ремонт выполнен', field: 'repair_cost', old_value: String(current.repair_cost || 0), new_value: String(next.repair_cost || 0) });
  return next;
}

function getRepairs(month) {
  const items = getInventory().filter((i) => String(i.status) === 'repair');
  const monthKeyValue = month || monthKey(new Date().toISOString());
  const activity = getRows(CONFIG.SHEETS.activity, CONFIG.HEADERS.activity)
    .filter((a) => a.action === 'Ремонт выполнен' && monthKey(String(a.timestamp || '')) === monthKeyValue);
  const spent = activity.reduce((acc, a) => acc + toNum(a.new_value), 0);
  return {
    masters: getRepairMasters(),
    month: monthKeyValue,
    spent_this_month: spent,
    items: items.map((i) => ({ ...i, repair_days: diffDays(i.repair_sent_date || i.updated_at, new Date().toISOString().slice(0, 10)) }))
  };
}

function deleteItem(itemNumber) {
  const current = getItemByNumber(itemNumber);
  if (!current) throw new Error('Товар не найден');
  deleteRowsByItemNumber(CONFIG.SHEETS.inventory, CONFIG.HEADERS.inventory, itemNumber);
  deleteRowsByItemNumber(CONFIG.SHEETS.purchases, CONFIG.HEADERS.purchases, itemNumber);
  deleteRowsByItemNumber(CONFIG.SHEETS.sales, CONFIG.HEADERS.sales, itemNumber);
  addActivity({ item_number: itemNumber, action: 'Удаление карточки', field: 'card', old_value: 'exists', new_value: 'deleted' });
  return true;
}

function cancelSale(itemNumber, saleId) {
  const current = getItemByNumber(itemNumber);
  if (!current) throw new Error('Товар не найден');
  if (!saleId && !current.sale_id) throw new Error('Не найдена продажа для отмены');
  const targetSaleId = saleId || current.sale_id;

  const sale = updateSalesRow(targetSaleId, (prev) => ({
    ...prev,
    is_cancelled: 'yes',
    cancelled_at: new Date().toISOString(),
    status: 'cancelled',
    shipping_status: 'cancelled',
    money_received: 'no'
  }));

  const restoreStatus = sale.pre_sale_status || 'listed';
  const next = normalizeItem({
    sale_id: '',
    sale_price: 0,
    sale_date: '',
    platform: '',
    buyer: '',
    platform_fee: 0,
    profit: 0,
    money_received: 'no',
    tracking_number: '',
    shipping_label_url: '',
    shipping_date: '',
    shipping_status: 'pending',
    status: restoreStatus
  }, current);

  updateInventoryRow(itemNumber, next);
  addActivity({ item_number: itemNumber, action: 'Отмена продажи', field: 'status', old_value: 'Продано', new_value: CONFIG.STATUS_LABELS[restoreStatus] || restoreStatus });
  return next;
}

function getActivity() {
  const descriptionByAction = {
    'Добавление покупки': 'Добавление покупки',
    'Оформление продажи': 'Оформление продажи',
    'Обновление доставки': 'Обновление доставки',
    'Отмена продажи': 'Отмена продажи',
    'Изменение статуса': 'Изменение статуса',
    'Редактирование карточки': 'Обновление карточки товара'
  };

  return getRows(CONFIG.SHEETS.activity, CONFIG.HEADERS.activity)
    .map((row) => {
      const base = descriptionByAction[row.action] || row.action || 'Действие';
      const details = row.field ? ` (${row.field}: ${row.old_value || '—'} → ${row.new_value || '—'})` : '';
      return {
        ...row,
        description: `${base}${details}`
      };
    })
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

function calcPurchaseBalance(purchases, sales) {
  const baseValue = toNum(getSettingValue('purchase_balance_base', 0));
  const baseAt = String(getSettingValue('purchase_balance_base_at', '') || '');
  const purchasesAfterBase = baseAt ? purchases.filter((p) => String(p.timestamp || '') >= baseAt) : purchases;
  const salesAfterBase = baseAt ? sales.filter((s) => String(s.timestamp || '') >= baseAt) : sales;
  const spent = purchasesAfterBase.reduce((acc, p) => acc + toNum(p.total_cost), 0);
  const returned = sales
    .filter((s) => !baseAt || String(s.timestamp || '') >= baseAt)
    .filter((s) => boolText(s.money_received) === 'yes')
    .reduce((acc, s) => acc + toNum(s.total_cost), 0);
  return baseValue + returned - spent;
}

function getDashboard() {
  const items = getInventory();
  const purchases = getRows(CONFIG.SHEETS.purchases, CONFIG.HEADERS.purchases);
  const sales = getValidSales();
  const currentMonth = monthKey(new Date().toISOString());
  const monthSales = sales.filter((s) => monthKey(saleDateValue(s)) === currentMonth);
  const activeStatuses = ['sold', 'shipped', 'delivered', 'cancelled'];

  const attention = getQC();
  const soldWithDays = sales.filter((s) => toNum(s.sold_storage_days) > 0 && boolText(s.money_received) === 'yes');
  const activeStock = items.filter((i) => !activeStatuses.includes(String(i.status)));
  const oldest = activeStock
    .map((i) => ({ item_number: i.item_number, days: calcStorageDays(i), model_name: i.model_name }))
    .sort((a, b) => b.days - a.days)[0] || { item_number: '', days: 0, model_name: '' };

  const stats = {
    active_stock: activeStock.length,
    stock_value: activeStock.reduce((acc, i) => acc + toNum(i.total_cost), 0),
    sold_this_month: monthSales.length,
    profit_this_month: monthSales.reduce((a, s) => a + paidProfit(s), 0),
    profit_share_each: monthSales.reduce((a, s) => a + paidProfit(s), 0) / 3,
    purchase_balance: calcPurchaseBalance(purchases, sales),
    pending_shipping: sales.filter((s) => shippingStatus(s.shipping_status) === 'pending' && boolText(s.money_received) !== 'yes').length,
    in_transit: items.filter((i) => boolText(i.arrived_from_japan) !== 'yes' && !['sold','shipped','delivered','cancelled'].includes(String(i.status))).length,
    repair_count: items.filter((i) => String(i.status) === 'repair').length,
    attention_count: attention.length,
    avg_sale_days: soldWithDays.length ? soldWithDays.reduce((a, s) => a + toNum(s.sold_storage_days), 0) / soldWithDays.length : 0,
    oldest_item_number: oldest.item_number,
    oldest_item_model: oldest.model_name,
    oldest_item_days: oldest.days
  };

  appendRow(CONFIG.SHEETS.statistics, CONFIG.HEADERS.statistics, { timestamp: new Date().toISOString(), ...stats });
  return stats;
}

function getAnalytics() {
  const sales = getValidSales();
  const monthly = {};
  sales.forEach((s) => {
    const m = monthKey(saleDateValue(s));
    if (!m) return;
    if (!monthly[m]) monthly[m] = { sold_count: 0, revenue: 0, profit: 0, potential_profit: 0, items: [] };
    monthly[m].sold_count += 1;
    monthly[m].revenue += toNum(s.sale_price);
    monthly[m].profit += paidProfit(s);
    monthly[m].potential_profit += toNum(s.profit);
    monthly[m].items.push({
      sale_id: s.sale_id,
      item_number: s.item_number,
      model_name: s.model_name,
      total_cost: toNum(s.total_cost),
      sale_price: toNum(s.sale_price),
      profit: paidProfit(s),
      potential_profit: toNum(s.profit),
      profit_percent: toNum(s.total_cost) ? ((paidProfit(s) / toNum(s.total_cost)) * 100) : 0,
      sale_date: s.sale_date,
      platform: s.platform,
      money_received: s.money_received,
      status: s.status,
      tracking_number: s.tracking_number,
      shipping_status: s.shipping_status,
      shipping_label_url: s.shipping_label_url
    });
  });
  return { monthly: monthly };
}

function getSalesByMonth(month) {
  const monthKeyValue = month || monthKey(new Date().toISOString());
  const sales = getValidSales()
    .filter((s) => monthKey(saleDateValue(s)) === monthKeyValue)
    .sort((a, b) => String(saleDateValue(a)).localeCompare(String(saleDateValue(b))));

  return {
    month: monthKeyValue,
    items: sales.map((s) => ({ ...s, profit: paidProfit(s), potential_profit: toNum(s.profit), profit_percent: toNum(s.total_cost) ? ((paidProfit(s) / toNum(s.total_cost)) * 100) : 0 })),
    summary: {
      sold_count: sales.length,
      revenue: sales.reduce((a, x) => a + toNum(x.sale_price), 0),
      profit: sales.reduce((a, x) => a + paidProfit(x), 0),
      potential_profit: sales.reduce((a, x) => a + toNum(x.profit), 0)
    }
  };
}

function getShippingOverview() {
  const sales = getValidSales();
  const waiting = sales.filter((s) => shippingStatus(s.shipping_status) === 'pending' && boolText(s.money_received) !== 'yes');
  const shipped = sales.filter((s) => shippingStatus(s.shipping_status) === 'shipped');
  const delivered = sales.filter((s) => shippingStatus(s.shipping_status) === 'delivered');
  return {
    summary: {
      pending: waiting.length,
      shipped: shipped.length,
      delivered: delivered.length
    },
    items: sales
      .filter((s) => shippingStatus(s.shipping_status) === 'pending' && boolText(s.money_received) !== 'yes')
      .sort((a, b) => String(b.sale_date || b.timestamp).localeCompare(String(a.sale_date || a.timestamp)))
      .slice(0, 20)
  };
}

function getQC() {
  const reasonLabels = {
    no_photo: 'Нет фото',
    no_notes: 'Нет описания',
    not_listed_vinted: 'Не выставлено на Vinted',
    not_listed_vestiaire: 'Не выставлено на Vestiaire',
    need_rephoto: 'Нужно перефото',
    sold_no_money: 'Продано, но деньги не зашли',
    sold_not_shipped: 'Продано, но еще не отправлено',
    shipped_not_delivered: 'Отправлено, но не доставлено',
    repair_too_long: 'В ремонте более 14 дней',
    stale_stock: 'Товар долго не продаётся'
  };

  const soldStatuses = ['sold', 'shipped', 'delivered'];

  return getInventory().reduce((acc, item) => {
    const sold = soldStatuses.includes(String(item.status));
    const closedSale = boolText(item.money_received) === 'yes' && (sold || String(item.sale_id || '').trim());
    if (closedSale) return acc;
    const sh = shippingStatus(item.shipping_status);
    const checks = [
      !item.photo_url ? 'no_photo' : '',
      !String(item.notes || '').trim() ? 'no_notes' : '',
      (!sold && boolText(item.listed_vinted) === 'no') ? 'not_listed_vinted' : '',
      (!sold && boolText(item.listed_vestiaire) === 'no') ? 'not_listed_vestiaire' : '',
      boolText(item.need_rephoto) === 'yes' ? 'need_rephoto' : '',
      (String(item.status) === 'repair' && diffDays(item.repair_sent_date || item.updated_at, new Date().toISOString().slice(0, 10)) > 14) ? 'repair_too_long' : '',
      (!sold && calcStorageDays(item) > 90) ? 'stale_stock' : '',
      (sold && boolText(item.money_received) === 'no') ? 'sold_no_money' : '',
      (sold && boolText(item.money_received) !== 'yes' && sh === 'pending') ? 'sold_not_shipped' : '',
      (sold && boolText(item.money_received) !== 'yes' && sh === 'shipped') ? 'shipped_not_delivered' : ''
    ].filter(Boolean);

    if (!checks.length) return acc;
    acc.push({
      item_number: item.item_number,
      model_name: item.model_name,
      status: item.status,
      shipping_status: item.shipping_status,
      money_received: item.money_received,
      photo_url: item.photo_url,
      reasons: checks.map((code) => ({ code, label: reasonLabels[code] || code })),
      item: item
    });
    return acc;
  }, []);
}
