import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.resolve(__dirname, '../web');

const PORT = Number(process.env.PORT || 3000);
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const MOCK_MODE = process.env.MOCK_MODE === 'true';

const SHEETS = { items: 'items', purchases: 'purchases', sales: 'sales', activity: 'activity', statistics: 'statistics' };
const HEADERS = {
  items: ['item_id', 'photo_url', 'brand', 'model', 'category', 'purchase_date', 'purchase_price', 'shipping_cost', 'customs_cost', 'repair_cost', 'total_cost', 'listing_price', 'sale_price', 'platform', 'buyer', 'notes', 'platform_fee', 'shipping_to_buyer', 'status', 'gross_profit', 'net_profit', 'markup_percent', 'updated_at'],
  purchases: ['timestamp', 'item_id', 'purchase_date', 'purchase_price', 'shipping_cost', 'customs_cost', 'repair_cost', 'total_cost', 'listing_price', 'notes'],
  sales: ['timestamp', 'item_id', 'sale_price', 'platform', 'buyer', 'platform_fee', 'shipping_to_buyer', 'gross_profit', 'net_profit', 'markup_percent', 'status', 'notes'],
  activity: ['timestamp', 'item_id', 'action', 'field', 'old_value', 'new_value', 'actor'],
  statistics: ['timestamp', 'active_stock', 'listed', 'in_transit', 'repair', 'hold', 'sold_this_month', 'net_profit_this_month', 'net_profit_all_time', 'capital_tied_in_stock']
};

const STATUS_LABELS = { purchased: 'Куплено', transit: 'В пути', repair: 'На ремонте', ready: 'Готово', listed: 'Выставлено', hold: 'Резерв', sold: 'Продано', shipped: 'Отправлено', delivered: 'Доставлено' };

const mockDb = {
  items: [
    HEADERS.items,
    ['LV-24001', 'https://images.unsplash.com/photo-1594223274512-ad4803739b7c?w=900', 'Louis Vuitton', 'Speedy 30', 'Сумка', '2026-01-14', '980', '45', '30', '50', '1105', '1780', '', '', '', 'Хорошее состояние', '', '', 'listed', '675', '675', '61.1', new Date().toISOString()],
    ['RLX-24002', 'https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=900', 'Rolex', 'Datejust 36', 'Часы', '2026-02-02', '4200', '70', '120', '190', '4580', '5600', '', '', '', '', '', '', 'repair', '1020', '1020', '22.3', new Date().toISOString()]
  ],
  purchases: [HEADERS.purchases],
  sales: [HEADERS.sales],
  activity: [HEADERS.activity],
  statistics: [HEADERS.statistics]
};

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const toNum = (v) => Number(v || 0);

const parseBody = async (req) => {
  const parts = [];
  for await (const chunk of req) parts.push(chunk);
  const raw = Buffer.concat(parts).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const rowToObj = (row, headers) => Object.fromEntries(headers.map((h, i) => [h, row?.[i] ?? '']));
const objToRow = (obj, headers) => headers.map((h) => obj[h] ?? '');

function computeMetrics(item) {
  const total_cost = toNum(item.purchase_price) + toNum(item.shipping_cost) + toNum(item.customs_cost) + toNum(item.repair_cost);
  const sale = toNum(item.sale_price);
  const listing = toNum(item.listing_price);
  const basis = sale || listing;
  const gross_profit = basis - total_cost;
  const net_profit = sale ? sale - total_cost - toNum(item.platform_fee) - toNum(item.shipping_to_buyer) : gross_profit;
  const markup_percent = total_cost ? ((basis - total_cost) / total_cost) * 100 : 0;
  return { total_cost, gross_profit, net_profit, markup_percent };
}

function normalizeItem(input, prev = {}) {
  const merged = {
    ...prev,
    ...input,
    item_id: String(input.item_id ?? prev.item_id ?? '').trim(),
    photo_url: input.photo_url ?? prev.photo_url ?? '',
    brand: input.brand ?? prev.brand ?? '',
    model: input.model ?? prev.model ?? '',
    category: input.category ?? prev.category ?? '',
    purchase_date: input.purchase_date ?? prev.purchase_date ?? '',
    purchase_price: toNum(input.purchase_price ?? prev.purchase_price),
    shipping_cost: toNum(input.shipping_cost ?? prev.shipping_cost),
    customs_cost: toNum(input.customs_cost ?? prev.customs_cost),
    repair_cost: toNum(input.repair_cost ?? prev.repair_cost),
    listing_price: toNum(input.listing_price ?? prev.listing_price),
    sale_price: toNum(input.sale_price ?? prev.sale_price),
    platform: input.platform ?? prev.platform ?? '',
    buyer: input.buyer ?? prev.buyer ?? '',
    notes: input.notes ?? prev.notes ?? '',
    platform_fee: toNum(input.platform_fee ?? prev.platform_fee),
    shipping_to_buyer: toNum(input.shipping_to_buyer ?? prev.shipping_to_buyer),
    status: input.status ?? prev.status ?? 'purchased'
  };
  return { ...merged, ...computeMetrics(merged), updated_at: new Date().toISOString() };
}

function validatePurchase(body) {
  if (!String(body.item_id || '').trim()) return 'Нужен item_id';
  if (!String(body.brand || '').trim()) return 'Нужен бренд';
  if (!String(body.model || '').trim()) return 'Нужна модель';
  return '';
}

function requireConfig() {
  if (MOCK_MODE) return;
  if (!SPREADSHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) throw new Error('Google Sheets credentials are missing.');
}

async function getAccessToken() {
  if (MOCK_MODE) return 'mock';
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');
  const data = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  const assertion = `${data}.${signer.sign(PRIVATE_KEY, 'base64url')}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!tokenRes.ok) throw new Error(`OAuth error ${tokenRes.status}`);
  return (await tokenRes.json()).access_token;
}

async function sheetsRequest(token, method, endpoint, body) {
  if (MOCK_MODE) return { values: [] };
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`Google Sheets API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function ensureHeader(token, sheetName, headers) {
  if (MOCK_MODE) return;
  const range = `/${encodeURIComponent(`values/${sheetName}!A1:Z1`)}`;
  const current = await sheetsRequest(token, 'GET', range);
  if ((current.values?.[0] || []).length === 0) {
    await sheetsRequest(token, 'PUT', `/${encodeURIComponent(`values/${sheetName}!A1:Z1`)}?valueInputOption=USER_ENTERED`, { values: [headers] });
  }
}

async function readSheet(sheet, headers) {
  if (MOCK_MODE) return mockDb[sheet].slice(1).map((r) => rowToObj(r, headers));
  const token = await getAccessToken();
  await ensureHeader(token, sheet, headers);
  const data = await sheetsRequest(token, 'GET', `/${encodeURIComponent(`values/${sheet}!A2:Z`)}`);
  return (data.values || []).map((r) => rowToObj(r, headers));
}

async function appendRow(sheet, headers, rowObj) {
  const row = objToRow(rowObj, headers);
  if (MOCK_MODE) { mockDb[sheet].push(row); return; }
  const token = await getAccessToken();
  await ensureHeader(token, sheet, headers);
  await sheetsRequest(token, 'POST', `/${encodeURIComponent(`values/${sheet}!A1:Z1:append`)}?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values: [row] });
}

async function updateItemRow(itemId, nextObj) {
  if (MOCK_MODE) {
    const idx = mockDb.items.findIndex((r, i) => i > 0 && r[0] === itemId);
    if (idx === -1) throw new Error('Item not found');
    mockDb.items[idx] = objToRow(nextObj, HEADERS.items);
    return;
  }
  const token = await getAccessToken();
  await ensureHeader(token, SHEETS.items, HEADERS.items);
  const rows = await sheetsRequest(token, 'GET', `/${encodeURIComponent(`values/${SHEETS.items}!A2:Z`)}`);
  const values = rows.values || [];
  const idx = values.findIndex((r) => r[0] === itemId);
  if (idx === -1) throw new Error('Item not found');
  const rowNum = idx + 2;
  await sheetsRequest(token, 'PUT', `/${encodeURIComponent(`values/${SHEETS.items}!A${rowNum}:Z${rowNum}`)}?valueInputOption=USER_ENTERED`, { values: [objToRow(nextObj, HEADERS.items)] });
}

function monthKey(dateString) {
  return String(dateString || '').slice(0, 7);
}

function buildDashboard(items, sales) {
  const currentMonth = monthKey(new Date().toISOString());
  const monthSales = sales.filter((s) => monthKey(s.timestamp) === currentMonth);
  const netMonth = monthSales.reduce((acc, s) => acc + toNum(s.net_profit), 0);
  const netAll = sales.reduce((acc, s) => acc + toNum(s.net_profit), 0);
  return {
    active_stock: items.filter((i) => !['sold', 'shipped', 'delivered'].includes(i.status)).length,
    listed: items.filter((i) => i.status === 'listed').length,
    in_transit: items.filter((i) => i.status === 'transit').length,
    repair: items.filter((i) => i.status === 'repair').length,
    hold: items.filter((i) => i.status === 'hold').length,
    sold_this_month: monthSales.length,
    net_profit_this_month: netMonth,
    net_profit_all_time: netAll,
    capital_tied_in_stock: items.filter((i) => !toNum(i.sale_price)).reduce((acc, i) => acc + toNum(i.total_cost), 0)
  };
}

function buildAnalytics(items, sales) {
  const monthly = {};
  const byPlatform = {};
  const byBrand = {};

  sales.forEach((s) => {
    const m = monthKey(s.timestamp);
    monthly[m] ??= { revenue: 0, net: 0 };
    monthly[m].revenue += toNum(s.sale_price);
    monthly[m].net += toNum(s.net_profit);
    byPlatform[s.platform || 'Не указано'] = (byPlatform[s.platform || 'Не указано'] || 0) + 1;

    const item = items.find((i) => i.item_id === s.item_id);
    byBrand[item?.brand || 'Неизвестно'] = (byBrand[item?.brand || 'Неизвестно'] || 0) + 1;
  });

  const listed = items.filter((i) => i.status === 'listed');
  const aging = listed.map((i) => ({ item_id: i.item_id, days: Math.floor((Date.now() - new Date(i.purchase_date).getTime()) / 86400000) }));
  return {
    monthly,
    byPlatform,
    byBrand,
    soldCount: sales.length,
    averageProfit: sales.length ? sales.reduce((a, s) => a + toNum(s.net_profit), 0) / sales.length : 0,
    aging,
    repricingCandidates: aging.filter((a) => a.days > 60)
  };
}

async function handleApi(req, res, pathname) {
  try {
    requireConfig();

    if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, mode: MOCK_MODE ? 'mock' : 'google-sheets' });

    if (req.method === 'GET' && pathname === '/api/items') return json(res, 200, { items: await readSheet(SHEETS.items, HEADERS.items) });

    if (req.method === 'GET' && /^\/api\/items\/[^/]+$/.test(pathname)) {
      const itemId = decodeURIComponent(pathname.split('/').pop());
      const item = (await readSheet(SHEETS.items, HEADERS.items)).find((x) => x.item_id === itemId);
      return item ? json(res, 200, { item }) : json(res, 404, { error: 'Товар не найден' });
    }

    if (req.method === 'POST' && pathname === '/api/purchases') {
      const body = await parseBody(req);
      const vErr = validatePurchase(body);
      if (vErr) return json(res, 400, { error: vErr });

      const items = await readSheet(SHEETS.items, HEADERS.items);
      if (items.some((i) => i.item_id === body.item_id)) return json(res, 400, { error: 'ID уже существует' });

      const item = normalizeItem({ ...body, status: body.status || 'purchased' });
      await appendRow(SHEETS.items, HEADERS.items, item);
      await appendRow(SHEETS.purchases, HEADERS.purchases, {
        timestamp: new Date().toISOString(), item_id: item.item_id, purchase_date: item.purchase_date, purchase_price: item.purchase_price, shipping_cost: item.shipping_cost, customs_cost: item.customs_cost, repair_cost: item.repair_cost, total_cost: item.total_cost, listing_price: item.listing_price, notes: item.notes
      });
      await appendRow(SHEETS.activity, HEADERS.activity, {
        timestamp: new Date().toISOString(), item_id: item.item_id, action: 'Добавление закупки', field: 'карточка', old_value: '—', new_value: 'создана', actor: 'web'
      });
      return json(res, 201, { item });
    }

    if (req.method === 'PATCH' && /^\/api\/items\/[^/]+$/.test(pathname)) {
      const itemId = decodeURIComponent(pathname.split('/').pop());
      const patch = await parseBody(req);
      const items = await readSheet(SHEETS.items, HEADERS.items);
      const current = items.find((i) => i.item_id === itemId);
      if (!current) return json(res, 404, { error: 'Товар не найден' });

      const next = normalizeItem(patch, current);
      await updateItemRow(itemId, next);
      await appendRow(SHEETS.activity, HEADERS.activity, {
        timestamp: new Date().toISOString(), item_id: itemId, action: 'Редактирование карточки', field: 'карточка', old_value: 'обновление', new_value: 'сохранено', actor: 'web'
      });
      return json(res, 200, { item: next });
    }

    if (req.method === 'PATCH' && /^\/api\/items\/[^/]+\/status$/.test(pathname)) {
      const itemId = decodeURIComponent(pathname.split('/')[3]);
      const { status } = await parseBody(req);
      const items = await readSheet(SHEETS.items, HEADERS.items);
      const current = items.find((i) => i.item_id === itemId);
      if (!current) return json(res, 404, { error: 'Товар не найден' });

      const next = normalizeItem({ status }, current);
      await updateItemRow(itemId, next);
      await appendRow(SHEETS.activity, HEADERS.activity, {
        timestamp: new Date().toISOString(), item_id: itemId, action: 'Изменение статуса', field: 'status', old_value: STATUS_LABELS[current.status] || current.status, new_value: STATUS_LABELS[next.status] || next.status, actor: 'web'
      });
      return json(res, 200, { item: next });
    }

    if (req.method === 'POST' && pathname === '/api/sales') {
      const body = await parseBody(req);
      if (!body.item_id || toNum(body.sale_price) <= 0) return json(res, 400, { error: 'Некорректные данные продажи' });

      const items = await readSheet(SHEETS.items, HEADERS.items);
      const current = items.find((i) => i.item_id === body.item_id);
      if (!current) return json(res, 404, { error: 'Товар не найден' });

      const item = normalizeItem({ ...current, ...body, status: body.status || 'sold' }, current);
      await updateItemRow(current.item_id, item);
      await appendRow(SHEETS.sales, HEADERS.sales, {
        timestamp: new Date().toISOString(), item_id: item.item_id, sale_price: item.sale_price, platform: item.platform, buyer: item.buyer, platform_fee: item.platform_fee, shipping_to_buyer: item.shipping_to_buyer, gross_profit: item.gross_profit, net_profit: item.net_profit, markup_percent: item.markup_percent, status: item.status, notes: body.notes || ''
      });
      await appendRow(SHEETS.activity, HEADERS.activity, {
        timestamp: new Date().toISOString(), item_id: item.item_id, action: 'Оформление продажи', field: 'sale_price', old_value: current.sale_price || '—', new_value: String(item.sale_price), actor: 'web'
      });
      return json(res, 201, { item });
    }

    if (req.method === 'GET' && pathname === '/api/activity') {
      const activity = await readSheet(SHEETS.activity, HEADERS.activity);
      return json(res, 200, { activity: activity.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))) });
    }

    if (req.method === 'GET' && pathname === '/api/dashboard') {
      const [items, sales, activity] = await Promise.all([
        readSheet(SHEETS.items, HEADERS.items),
        readSheet(SHEETS.sales, HEADERS.sales),
        readSheet(SHEETS.activity, HEADERS.activity)
      ]);
      const stats = buildDashboard(items, sales);
      await appendRow(SHEETS.statistics, HEADERS.statistics, { timestamp: new Date().toISOString(), ...stats });
      return json(res, 200, { stats, recentActivity: activity.slice(0, 8) });
    }

    if (req.method === 'GET' && pathname === '/api/analytics') {
      const [items, sales] = await Promise.all([readSheet(SHEETS.items, HEADERS.items), readSheet(SHEETS.sales, HEADERS.sales)]);
      return json(res, 200, buildAnalytics(items, sales));
    }

    if (req.method === 'GET' && pathname === '/api/qc') {
      const items = await readSheet(SHEETS.items, HEADERS.items);
      const attention = items.filter((i) => !i.photo_url || !toNum(i.listing_price) || !i.notes || i.status === 'ready' || (i.status === 'listed' && Math.floor((Date.now() - new Date(i.purchase_date).getTime()) / 86400000) > 45));
      return json(res, 200, { attention });
    }

    return json(res, 404, { error: 'Маршрут не найден' });
  } catch (error) {
    return json(res, 500, { error: `Ошибка сервера: ${error.message}` });
  }
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url.pathname);

  const rawPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(WEB_ROOT, rawPath));
  if (!filePath.startsWith(WEB_ROOT)) return json(res, 403, { error: 'Forbidden' });

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Страница не найдена');
  }
});

server.listen(PORT, () => {
  console.log(`CRM server running on http://localhost:${PORT}`);
  console.log(`Mode: ${MOCK_MODE ? 'MOCK_MODE=true (без Google Sheets)' : 'Google Sheets'}`);
});
