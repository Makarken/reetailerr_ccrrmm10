import React, { useEffect, useMemo, useState } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import htm from 'https://esm.sh/htm@3.1.1';
import { APPS_SCRIPT_URL } from './config.js';

const html = htm.bind(React.createElement);

const STATUS_META = {
  purchased: { label: 'Куплено', icon: '🛍️', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  transit: { label: 'В пути', icon: '🚚', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  repair: { label: 'На ремонте', icon: '🔧', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  ready: { label: 'Готово', icon: '✨', cls: 'bg-stone-100 text-stone-700 border-stone-200' },
  listed: { label: 'Выставлено', icon: '🏷️', cls: 'bg-violet-100 text-violet-700 border-violet-200' },
  hold: { label: 'Резерв', icon: '⏳', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  sold: { label: 'Продано', icon: '💸', cls: 'bg-green-100 text-green-700 border-green-200' },
  shipped: { label: 'Отправлено', icon: '📦', cls: 'bg-teal-100 text-teal-700 border-teal-200' },
  delivered: { label: 'Доставлено', icon: '✅', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' }
};

const SHIPPING_META = {
  pending: { label: 'Не отправлено', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  shipped: { label: 'Отправлено', cls: 'bg-teal-100 text-teal-700 border-teal-200' },
  delivered: { label: 'Доставлено', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  cancelled: { label: 'Отменено', cls: 'bg-rose-100 text-rose-700 border-rose-200' }
};

const BOTTOM_PAGES = [
  ['dashboard', 'Дашборд', '🏠'],
  ['inventory', 'Склад', '📦'],
  ['sales', 'Продажи', '💶']
];

const MENU_PAGES = [
  ['analytics', 'Аналитика', '📈'],
  ['qc', 'Контроль', '⚠️'],
  ['repair', 'Ремонт', '🔧'],
  ['activity', 'История', '📑'],
  ['rephoto', 'Перефото', '📸'],
  ['settings', 'Настройки', '⚙️']
];

const PLATFORM_OPTIONS = ['Vinted', 'Vestiaire'];
const CATEGORY_OPTIONS = ['Сумка', 'Часы', 'Аксессуар', 'Обувь', 'Одежда'];

const money = (v) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(v || 0));
const n = (v) => Number(v || 0);
const pct = (v) => `${Number(v || 0).toFixed(1)}%`;
const boolText = (v) => ['true', '1', 'yes', 'да', 'y'].includes(String(v || '').toLowerCase()) ? 'yes' : 'no';
const shippingLabel = (status) => (SHIPPING_META[status] || SHIPPING_META.pending).label;
const formatDate = (v) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('ru-RU'); };
const formatMonthRu = (month) => {
  if (!month) return '—';
  const d = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return month;
  const txt = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
};
const storageStartDate = (item) => (boolText(item?.arrived_from_japan) === 'yes' && item?.japan_arrival_date ? item.japan_arrival_date : '');
const daysOnStock = (item, endDate = '') => {
  const start = storageStartDate(item);
  if (!start) return 0;
  const s = new Date(start);
  const e = new Date(endDate || new Date().toISOString().slice(0, 10));
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  return Math.max(0, Math.floor((e.getTime() - s.getTime()) / 86400000));
};
const stockAgeCls = (days) => {
  if (days > 90) return 'text-red-700';
  if (days > 60) return 'text-orange-600';
  if (days > 30) return 'text-yellow-700';
  return 'text-slate-700';
};


const MAX_CELL_LEN = 49000;
const clampCell = (v) => {
  const txt = String(v || '');
  return txt.length > MAX_CELL_LEN ? '' : txt;
};
const sanitizeMediaFields = (obj = {}) => ({
  ...obj,
  photo_url: clampCell(obj.photo_url),
  shipping_label_url: clampCell(obj.shipping_label_url),
  buyee_url: clampCell(obj.buyee_url)
});

const toCompressedImage = (file, maxSize = 420, quality = 0.68) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Не удалось обработать фото'));
    img.src = String(reader.result || '');
  };
  reader.readAsDataURL(file);
});

const normalizePurchasePayload = (payload) => ({
  ...sanitizeMediaFields(payload),
  item_number: String(payload.item_number || '').trim(),
  base_cost: Number(payload.base_cost || 0),
  shipping_japan: Number(payload.shipping_japan || 0),
  tax: Number(payload.tax || 0),
  shipping_spain: Number(payload.shipping_spain || 0),
  repair_cost: Number(payload.repair_cost || 0),
  total_cost: Number(payload.total_cost || 0)
});

const normalizeSalePayload = (payload) => ({
  ...sanitizeMediaFields(payload),
  item_number: String(payload.item_number || '').trim()
});

const api = async (action, payload = null) => {
  if (!APPS_SCRIPT_URL) throw new Error('Вставьте URL Apps Script в src/config.js');
  if (!payload) {
    const response = await fetch(`${APPS_SCRIPT_URL}?action=${encodeURIComponent(action)}`);
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Ошибка API');
    return json;
  }
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload })
  });
  const json = await response.json();
  if (!json.ok) throw new Error(json.error || 'Ошибка API');
  return json;
};

const StatusBadge = ({ status }) => {
  const m = STATUS_META[status] || { label: status, icon: '•', cls: 'bg-slate-100 text-slate-700 border-slate-200' };
  return html`<span className=${`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs ${m.cls}`}>${m.icon} ${m.label}</span>`;
};

const ShippingBadge = ({ status }) => {
  const m = SHIPPING_META[status] || SHIPPING_META.pending;
  return html`<span className=${`inline-flex items-center px-2 py-1 rounded-full border text-xs ${m.cls}`}>${m.label}</span>`;
};

const AnalyticsChart = ({ series = [] }) => {
  const width = 680;
  const height = 220;
  const maxValue = Math.max(1, ...series.map((x) => Math.max(Number(x.revenue || 0), Number(x.profit || 0), Number(x.sold_count || 0) * 100)));
  const step = width / Math.max(1, series.length - 1);
  const pointsRevenue = series.map((x, i) => `${i * step},${height - (Number(x.revenue || 0) / maxValue) * (height - 28) - 8}`).join(' ');
  const pointsProfit = series.map((x, i) => `${i * step},${height - (Number(x.profit || 0) / maxValue) * (height - 28) - 8}`).join(' ');
  const pointsCount = series.map((x, i) => `${i * step},${height - ((Number(x.sold_count || 0) * 100) / maxValue) * (height - 28) - 8}`).join(' ');
  return html`<div className="overflow-x-auto"><svg viewBox=${`0 0 ${width} ${height}`} className="min-w-[640px] w-full h-56">
      <polyline fill="none" stroke="#8b6f4e" strokeWidth="3" points=${pointsRevenue}/>
      <polyline fill="none" stroke="#16a34a" strokeWidth="3" points=${pointsProfit}/>
      <polyline fill="none" stroke="#2563eb" strokeWidth="3" points=${pointsCount}/>
    </svg>
    <div className="text-xs text-luxe-muted flex flex-wrap gap-3"><span>● Выручка</span><span className="text-green-700">● Прибыль</span><span className="text-blue-700">● Кол-во (x100)</span></div>
  </div>`;
};

function App() {
  const [page, setPage] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [items, setItems] = useState([]);
  const [dashboard, setDashboard] = useState({});
  const [activity, setActivity] = useState([]);
  const [analytics, setAnalytics] = useState({ monthly: {} });
  const [attention, setAttention] = useState([]);
  const [shippingOverview, setShippingOverview] = useState({ summary: {}, items: [] });
  const [monthSales, setMonthSales] = useState({ month: '', items: [], summary: {} });
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [showPurchase, setShowPurchase] = useState(false);
  const [showSale, setShowSale] = useState(false);
  const [salesMonth, setSalesMonth] = useState(new Date().toISOString().slice(0, 7));
  const [showMenu, setShowMenu] = useState(false);
  const [showFabMenu, setShowFabMenu] = useState(false);
  const [inventoryView, setInventoryView] = useState('list');
  const [salesView, setSalesView] = useState('list');
  const [analyticsYear, setAnalyticsYear] = useState(new Date().getFullYear());
  const [analyticsType, setAnalyticsType] = useState('monthly');
  const [purchaseBalanceInput, setPurchaseBalanceInput] = useState('0');
  const [repairData, setRepairData] = useState({ items: [], masters: [] });
  const [repairTarget, setRepairTarget] = useState(null);
  const [repairCardItem, setRepairCardItem] = useState(null);
  const [repairMonth, setRepairMonth] = useState(new Date().toISOString().slice(0, 7));

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [i, d, a, an, qc, sh, rep] = await Promise.all([
        api('getInventory'),
        api('getDashboard'),
        api('getActivity'),
        api('getAnalytics'),
        api('getQC'),
        api('getShippingOverview'),
        api('getRepairs', { month: repairMonth })
      ]);
      setItems(i.items || []);
      setDashboard(d.stats || {});
      setActivity(a.activity || []);
      setAnalytics(an || { monthly: {} });
      setAttention(qc.attention || []);
      setRepairData(rep || { items: [], masters: [] });

      const sm = await api('getSalesByMonth', { month: salesMonth });

      setMonthSales(sm || { month: salesMonth, items: [], summary: {} });

      setShippingOverview(sh || { summary: {}, items: [] });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [salesMonth, repairMonth]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2400); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { setPurchaseBalanceInput(String(Number(dashboard.purchase_balance || 0))); }, [dashboard.purchase_balance]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      const passQ = !q || String(i.item_number).includes(q) || String(i.model_name || '').toLowerCase().includes(q);
      return passQ && (statusFilter === 'all' || i.status === statusFilter);
    });
  }, [items, query, statusFilter]);

  const rephotoItems = useMemo(() => items.filter((i) => boolText(i.need_rephoto) === 'yes'), [items]);

  const analyticsYearSeries = useMemo(() => Object.entries(analytics.monthly || {})
    .filter(([m]) => Number(String(m).slice(0, 4)) === Number(analyticsYear))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, v]) => ({ month: m, sold_count: Number(v.sold_count || 0), revenue: Number(v.revenue || 0), profit: Number(v.profit || 0), potential_profit: Number(v.potential_profit || 0) })), [analytics, analyticsYear]);

  const analyticsYearTotals = useMemo(() => ({
    sold_count: analyticsYearSeries.reduce((a, x) => a + x.sold_count, 0),
    revenue: analyticsYearSeries.reduce((a, x) => a + x.revenue, 0),
    profit: analyticsYearSeries.reduce((a, x) => a + x.profit, 0),
    share_each: analyticsYearSeries.reduce((a, x) => a + x.profit, 0) / 3,
    potential_profit: analyticsYearSeries.reduce((a, x) => a + x.potential_profit, 0)
  }), [analyticsYearSeries]);
  const monthlyAnalytics = useMemo(() => {
    const m = analytics.monthly?.[salesMonth] || { items: [], sold_count: 0, revenue: 0, profit: 0 };
    return m;
  }, [analytics, salesMonth]);

  const humanError = (err, fallback) => {
    const msg = String(err?.message || '').trim();
    if (!msg) return fallback;
    if (msg.includes('Unknown action')) return 'Бэкенд Apps Script не обновлён. Опубликуйте новую версию Web App.';
    if (msg.includes('Failed to fetch')) return 'Нет связи с Apps Script. Проверьте URL и доступ к интернету.';
    return msg;
  };

  const savePurchase = async (payload) => {
    try {
      setError('');
      const requestPayload = normalizePurchasePayload(payload);
      const r = await api('createPurchase', requestPayload);
      console.info('[createPurchase] request payload:', requestPayload);
      console.info('[createPurchase] response:', r);

      if (r?.ok && r?.item) {
        setShowPurchase(false);
        setShowFabMenu(false);
        setToast('Покупка сохранена');
        loadAll();
        return;
      }

      throw new Error(r?.error || `Некорректный ответ createPurchase: ${JSON.stringify(r)}`);
    } catch (e) {
      setError('Ошибка сохранения покупки: ' + humanError(e, 'Не удалось сохранить покупку'));
    }
  };

  const saveSale = async (payload) => {
    try {
      setError('');
      const requestPayload = sanitizeMediaFields(normalizeSalePayload(payload));
      const r = await api('recordSale', requestPayload);
      if (!(r?.ok && r?.item)) throw new Error(r?.error || `Некорректный ответ recordSale: ${JSON.stringify(r)}`);
      setShowSale(false);
      setShowFabMenu(false);
      setToast('Продажа сохранена');
      loadAll();
    } catch (e) {
      setError('Ошибка сохранения продажи: ' + humanError(e, 'Не удалось сохранить продажу'));
    }
  };

  const saveItem = async (itemNumber, updates) => { await api('editItem', { item_number: itemNumber, updates: sanitizeMediaFields(updates) }); setSelected(null); setToast('Карточка обновлена'); loadAll(); };
  const updateStatus = async (itemNumber, status) => { await api('updateStatus', { item_number: itemNumber, status }); setToast('Статус обновлён'); loadAll(); };
  const updateShipping = async (itemNumber, shipping) => { await api('updateShipping', { item_number: itemNumber, shipping: sanitizeMediaFields(shipping) }); setToast('Доставка обновлена'); loadAll(); };
  const cancelSale = async (itemNumber, saleId) => {
    if (!window.confirm(`Отменить продажу товара №${itemNumber}?`)) return;
    await api('cancelSale', { item_number: itemNumber, sale_id: saleId });
    setToast('Продажа отменена');
    loadAll();
  };

  const deleteItem = async (itemNumber) => {
    if (!window.confirm(`Удалить карточку товара №${itemNumber} полностью?`)) return;
    await api('deleteItem', { item_number: itemNumber });
    setSelected(null);
    setToast('Карточка удалена');
    loadAll();
  };

  const toggleMoneyReceived = async (itemNumber, checked) => {
    await api('updateMoneyReceived', { item_number: itemNumber, money_received: checked ? 'yes' : 'no' });
    setToast('Оплата обновлена');
    loadAll();
  };

  const savePurchaseBalance = async () => {
    await api('updatePurchaseBalance', { value: Number(purchaseBalanceInput || 0) });
    setToast('Остаток закупа обновлён');
    loadAll();
  };
  const sendToRepair = async (itemNumber, masterId) => {
    await api('sendToRepair', { item_number: itemNumber, master_id: masterId });
    setToast('Товар отправлен в ремонт');
    loadAll();
  };
  const completeRepair = async (itemNumber, repairCost = null) => {
    let value = repairCost;
    if (value == null) {
      value = window.prompt('Введите стоимость ремонта (€)', '0');
      if (value == null) return;
    }
    await api('completeRepair', { item_number: itemNumber, repair_cost: Number(value || 0) });
    setToast('Ремонт завершен');
    loadAll();
  };
  const addMaster = async () => {
    const name = window.prompt('Имя мастера');
    if (!name) return;
    const city = window.prompt('Город мастера', '') || '';
    await api('addRepairMaster', { name, city });
    setToast('Мастер добавлен');
    loadAll();
  };
  const deleteMaster = async (id) => {
    await api('deleteRepairMaster', { id });
    setToast('Мастер удален');
    loadAll();
  };

  const openFromMenu = (nextPage) => {
    setPage(nextPage);
    setShowMenu(false);
  };

  return html`<div className="min-h-screen pb-24 bg-gradient-to-br from-luxe-bg via-luxe-bg to-[#ece6db]">
    <header className="sticky top-0 z-20 border-b border-luxe-border bg-luxe-bg/95 backdrop-blur px-4 py-3 relative flex items-center justify-between">
      <button className="tap-btn rounded-xl border border-luxe-border bg-white px-3 py-2 text-sm" onClick=${() => setShowMenu(true)}>☰</button>
      <h1 className="text-lg font-semibold absolute left-1/2 -translate-x-1/2">База с Катей</h1>
      <button className="tap-btn rounded-xl border border-luxe-border bg-white px-3 py-2 text-sm" onClick=${loadAll}>Обновить</button>
    </header>

    ${showMenu && html`<div className="fixed inset-0 z-40"><div className="absolute inset-0 bg-black/40" onClick=${() => setShowMenu(false)}></div><aside className="absolute left-0 top-0 h-full w-72 bg-white shadow-xl p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Меню</h2><button className="tap-btn" onClick=${() => setShowMenu(false)}>✕</button></div><div className="mt-4 space-y-2">${MENU_PAGES.map(([id, label, icon]) => html`<button className=${`w-full text-left rounded-xl px-3 py-2 ${page === id ? 'bg-luxe-accent text-white' : 'bg-[#f7f4ef]'}`} onClick=${() => openFromMenu(id)}>${icon} ${label}</button>`)}</div></aside></div>`}

    <main className="p-4 max-w-7xl mx-auto space-y-3 fade-in">
      ${error && html`<div className="rounded-xl bg-rose-100 text-rose-700 p-3">${error}</div>`}
      ${loading && html`<div className="space-y-2"><div className="premium-card rounded-2xl p-5 animate-pulse h-16"></div><div className="premium-card rounded-2xl p-5 animate-pulse h-16"></div></div>`}

      ${!loading && page === 'dashboard' && html`<section className="space-y-3"><div className="grid grid-cols-2 gap-3">${[
        ['📦', 'Активный склад', dashboard.active_stock || 0],
        ['💰', 'Стоимость склада', money(dashboard.stock_value || 0)],
        ['✅', 'Продано в этом месяце', dashboard.sold_this_month || 0],
        ['💶', 'Прибыль за месяц', money(dashboard.profit_this_month)],
        ['👥', 'На 1 человека', money(dashboard.profit_share_each)],
        ['🏦', 'Остаток закупа', money(dashboard.purchase_balance || 0)],
        ['📭', 'Не отправлено', shippingOverview.summary?.pending || 0],
        ['🚚', 'В пути из Японии', dashboard.in_transit || 0],
        ['🔧', 'На ремонте', dashboard.repair_count || 0],
        ['⚠️', 'Требуют внимания', dashboard.attention_count || 0]
      ].map(([i, t, v]) => html`<div className="premium-card rounded-2xl p-4"><p className="text-xs text-luxe-muted">${i} ${t}</p><p className="text-lg font-semibold mt-1">${v}</p></div>`)}</div>
      <div className="premium-card rounded-2xl p-4"><p className="text-sm font-medium">Ручная корректировка остатка закупа</p><div className="mt-2 flex gap-2"><input type="number" className="rounded-xl border border-luxe-border p-2 bg-white w-44" value=${purchaseBalanceInput} onInput=${(e) => setPurchaseBalanceInput(e.target.value)}/><button className="tap-btn rounded-xl border border-luxe-border px-3 py-2" onClick=${savePurchaseBalance}>Сохранить</button></div></div>
      <div className="premium-card rounded-2xl p-4"><h2 className="font-semibold">Ожидают отправки / доставки</h2><ul className="mt-2 text-sm space-y-2">${(shippingOverview.items || []).slice(0, 7).map((s) => html`<li className="border-b border-luxe-border/60 pb-2">№${s.item_number} · ${s.platform || '—'} · ${formatDate(s.sale_date)} · <${ShippingBadge} status=${s.shipping_status}/></li>`)}</ul></div></section>`}

      ${!loading && page === 'inventory' && html`<section className="space-y-3"><div className="premium-card rounded-2xl p-3 grid grid-cols-1 md:grid-cols-3 gap-2 items-end"><div className="md:col-span-2"><label className="text-xs text-luxe-muted">Поиск</label><input className="w-full rounded-xl border border-luxe-border p-2 bg-white" value=${query} onInput=${(e) => setQuery(e.target.value)} placeholder="Номер или модель"/></div><div><label className="text-xs text-luxe-muted">Статус</label><select className="w-full rounded-xl border border-luxe-border p-2 bg-white" value=${statusFilter} onChange=${(e) => setStatusFilter(e.target.value)}><option value="all">Все</option>${Object.entries(STATUS_META).map(([k, v]) => html`<option value=${k}>${v.label}</option>`)}</select></div><div><label className="text-xs text-luxe-muted">Вид</label><select className="w-full rounded-xl border border-luxe-border p-2 bg-white" value=${inventoryView} onChange=${(e) => setInventoryView(e.target.value)}><option value="list">Списком</option><option value="grid-sm">Плитка маленькая</option><option value="grid-lg">Плитка большая</option></select></div></div>
      ${!filteredItems.length ? html`<div className="premium-card rounded-2xl p-6 text-center text-luxe-muted">Склад пуст. Добавьте покупку через +</div>` : null}
      <div className=${inventoryView === 'list' ? 'space-y-2' : inventoryView === 'grid-sm' ? 'grid grid-cols-2 md:grid-cols-4 gap-2' : 'grid grid-cols-1 md:grid-cols-2 gap-3'}>${filteredItems.map((i) => html`<article className="premium-card rounded-2xl p-3"><div className=${inventoryView === 'list' ? 'flex justify-between items-start gap-2' : 'space-y-2'}><div><img src=${i.photo_url || 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=300'} className=${inventoryView === 'grid-sm' ? 'h-24 w-full rounded-lg object-contain bg-white border border-luxe-border mb-2' : inventoryView === 'grid-lg' ? 'h-36 w-full rounded-lg object-contain bg-white border border-luxe-border mb-2' : 'h-16 w-16 rounded-lg object-contain bg-white border border-luxe-border mb-2'}/><p className="font-semibold">№ товара: ${i.item_number || '—'}</p><p className="text-sm">Модель: ${i.model_name || '—'}</p><p className="text-sm text-luxe-muted">Категория: ${i.category || '—'}</p><p className="text-sm">Себестоимость: ${money(i.total_cost)}</p><p className=${`text-sm ${stockAgeCls(daysOnStock(i))}`}>Дней на складе: ${daysOnStock(i, i.sale_date || '')}</p><p className="text-sm">Платформа: ${i.platform || '—'}</p><p className="text-sm">Цена продажи: ${n(i.sale_price) > 0 ? money(i.sale_price) : '—'}</p></div><div className="flex ${inventoryView === 'list' ? 'flex-col items-end' : 'flex-row'} gap-1"><${StatusBadge} status=${i.status}/><${ShippingBadge} status=${i.shipping_status}/></div></div><button className="tap-btn mt-2 rounded-lg bg-luxe-accent text-white px-3 py-1.5 text-xs" onClick=${() => setSelected(i)}>Открыть</button></article>`)}</div></section>`}

      ${!loading && page === 'sales' && html`<section className="space-y-3"><div className="premium-card rounded-2xl p-4 flex flex-wrap items-end gap-3"><div><label className="text-xs text-luxe-muted">Месяц</label><input type="month" className="rounded-xl border border-luxe-border p-2 bg-white" value=${salesMonth} onInput=${(e) => setSalesMonth(e.target.value)}/></div><div><label className="text-xs text-luxe-muted">Вид</label><select className="rounded-xl border border-luxe-border p-2 bg-white" value=${salesView} onChange=${(e) => setSalesView(e.target.value)}><option value="list">Списком</option><option value="grid-sm">Плитка маленькая</option><option value="grid-lg">Плитка большая</option></select></div><p className="text-sm text-luxe-muted">${formatMonthRu(monthSales.month || salesMonth)}</p></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">${[['Продано', monthSales.summary?.sold_count || 0], ['Выручка', money(monthSales.summary?.revenue)], ['Прибыль', money(monthSales.summary?.profit)], ['Прибыль в обработке', money(monthSales.summary?.potential_profit)]].map(([t, v]) => html`<div className="premium-card rounded-2xl p-3"><p className="text-xs text-luxe-muted">${t}</p><p className="text-lg font-semibold">${v}</p></div>`)}</div>
      ${!(monthSales.items || []).length ? html`<div className="premium-card rounded-2xl p-6 text-center text-luxe-muted">За выбранный месяц продаж нет.</div>` : null}<div className=${salesView === 'list' ? 'space-y-2' : salesView === 'grid-sm' ? 'grid grid-cols-2 md:grid-cols-4 gap-2' : 'grid grid-cols-1 md:grid-cols-2 gap-3'}>${(monthSales.items || []).map((s) => { const item = items.find((x) => String(x.item_number) === String(s.item_number)) || null; const cost = n(s.total_cost); const markup = cost > 0 ? ((n(s.sale_price) - cost) / cost) * 100 : 0; return html`<article className="premium-card rounded-2xl p-3"><div className=${salesView === 'list' ? 'flex justify-between gap-2' : 'space-y-2'}><div><img src=${item?.photo_url || 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=300'} className=${salesView === 'grid-sm' ? 'h-24 w-full rounded-lg object-contain bg-white border border-luxe-border mb-2 cursor-pointer' : salesView === 'grid-lg' ? 'h-36 w-full rounded-lg object-contain bg-white border border-luxe-border mb-2 cursor-pointer' : 'h-14 w-14 rounded-lg object-contain bg-white border border-luxe-border mb-2 cursor-pointer'} onClick=${() => item ? setSelected(item) : null}/><p className="font-semibold">№${s.item_number} · ${s.platform || '—'}</p><p className="text-sm text-luxe-muted">${formatDate(s.sale_date || s.timestamp)} · Покупка: ${money(cost)}</p><p className="text-sm">Продажа: <b>${money(s.sale_price)}</b> · Реальная: <b>${money(s.profit)}</b> · Потенц.: <b>${money(s.potential_profit)}</b> · Накрутка: <b>${pct(markup)}</b></p></div><div className="flex ${salesView === 'list' ? 'flex-col items-end' : 'flex-row'} gap-1"><${ShippingBadge} status=${s.shipping_status}/>${s.shipping_label_url ? html`<a className="text-blue-700 underline text-xs" href=${s.shipping_label_url} target="_blank">Лейбл</a>` : null}<label className="text-xs inline-flex items-center gap-1"><input type="checkbox" checked=${boolText(s.money_received) === 'yes'} onChange=${(e) => toggleMoneyReceived(s.item_number, e.target.checked)}/>Зашли деньги</label></div></div><button className="tap-btn mt-2 rounded-lg border border-rose-300 text-rose-700 px-2 py-1 text-xs" onClick=${() => cancelSale(s.item_number, s.sale_id)}>Отменить продажу</button></article>`; })}</div></section>`}

      ${!loading && page === 'analytics' && html`<section className="space-y-3"><div className="premium-card rounded-2xl p-4"><div className="flex flex-wrap items-end justify-between gap-2"><h2 className="font-semibold">Аналитика</h2><div className="flex gap-2"><button className=${`tap-btn rounded-lg px-3 py-1 border ${analyticsType === 'monthly' ? 'bg-luxe-accent text-white border-luxe-accent' : 'border-luxe-border'}`} onClick=${() => setAnalyticsType('monthly')}>Месячная</button><button className=${`tap-btn rounded-lg px-3 py-1 border ${analyticsType === 'yearly' ? 'bg-luxe-accent text-white border-luxe-accent' : 'border-luxe-border'}`} onClick=${() => setAnalyticsType('yearly')}>Годовая</button></div></div>
      ${analyticsType === 'monthly' ? html`<div className="mt-3 space-y-3"><label className="text-xs text-luxe-muted">Месяц<input type="month" className="ml-2 rounded-lg border border-luxe-border p-1 bg-white" value=${salesMonth} onInput=${(e) => setSalesMonth(e.target.value)}/></label><div className="overflow-auto"><table className="min-w-[760px] w-full text-sm"><thead><tr className="text-xs text-luxe-muted"><th className="text-left">№</th><th className="text-left">Модель</th><th>Цена продажи</th><th>Себестоимость</th><th>Прибыль</th><th>В обработке</th><th>% прибыли</th></tr></thead><tbody>${(monthlyAnalytics.items || []).map((row, idx) => html`<tr className="border-t border-luxe-border/60"><td className="py-2">${idx + 1}</td><td>${row.model_name || '—'}</td><td className="text-center">${money(row.sale_price)}</td><td className="text-center">${money(row.total_cost)}</td><td className="text-center">${money(row.profit)}</td><td className="text-center">${money(row.potential_profit)}</td><td className="text-center">${pct(row.profit_percent)}</td></tr>`)}</tbody></table></div><div className="grid md:grid-cols-5 gap-2"><div className="rounded-xl border border-luxe-border p-3"><p className="text-xs text-luxe-muted">Продано товаров</p><p className="text-lg font-semibold">${monthlyAnalytics.sold_count || 0}</p></div><div className="rounded-xl border border-luxe-border p-3"><p className="text-xs text-luxe-muted">Сумма продаж</p><p className="text-lg font-semibold">${money(monthlyAnalytics.revenue || 0)}</p></div><div className="rounded-xl border border-luxe-border p-3"><p className="text-xs text-luxe-muted">Прибыль</p><p className="text-lg font-semibold">${money(monthlyAnalytics.profit || 0)}</p></div><div className="rounded-xl border border-luxe-border p-3"><p className="text-xs text-luxe-muted">Прибыль в обработке</p><p className="text-lg font-semibold">${money(monthlyAnalytics.potential_profit || 0)}</p></div><div className="rounded-xl border border-luxe-border p-3"><p className="text-xs text-luxe-muted">Прибыль на 1 человека</p><p className="text-lg font-semibold">${money((monthlyAnalytics.profit || 0) / 3)}</p></div></div></div>` : html`<div className="mt-3"><label className="text-xs text-luxe-muted">Год<select className="ml-2 rounded-lg border border-luxe-border p-1 bg-white" value=${analyticsYear} onChange=${(e) => setAnalyticsYear(Number(e.target.value))}>${Array.from(new Set(Object.keys(analytics.monthly || {}).map((k) => Number(String(k).slice(0,4))).filter(Boolean))).sort((a,b)=>b-a).map((y) => html`<option value=${y}>${y}</option>`)}</select></label><div className="overflow-auto mt-2"><table className="min-w-[420px] w-full text-sm"><thead><tr className="text-xs text-luxe-muted"><th className="text-left">Месяц</th><th>Продажи</th><th>Прибыль</th><th>В обработке</th></tr></thead><tbody>${analyticsYearSeries.map((v) => html`<tr className="border-t border-luxe-border/60"><td className="py-2">${formatMonthRu(v.month)}</td><td className="text-center">${v.sold_count}</td><td className="text-center">${money(v.profit)}</td><td className="text-center">${money(v.potential_profit)}</td></tr>`)}</tbody></table></div><div className="mt-3"><${AnalyticsChart} series=${analyticsYearSeries.map((x) => ({ ...x, revenue: 0 }))}/></div><div className="grid md:grid-cols-2 lg:grid-cols-4 gap-2 mt-3"><div className="rounded-xl border border-luxe-border p-3"><p className="text-xs text-luxe-muted">Общая прибыль за год</p><p className="text-lg font-semibold">${money(analyticsYearTotals.profit)}</p></div><div className="rounded-xl border border-luxe-border p-3"><p className="text-xs text-luxe-muted">Средняя прибыль в месяц</p><p className="text-lg font-semibold">${money((analyticsYearTotals.profit || 0) / Math.max(1, analyticsYearSeries.length || 1))}</p></div><div className="rounded-xl border border-luxe-border p-3"><p className="text-xs text-luxe-muted">Средний срок продажи</p><p className="text-lg font-semibold">${Math.round(Number(dashboard.avg_sale_days || 0))} дн.</p></div><div className="rounded-xl border border-luxe-border p-3"><p className="text-xs text-luxe-muted">Самый старый товар</p><p className="text-lg font-semibold">${dashboard.oldest_item_number ? `№${dashboard.oldest_item_number} · ${dashboard.oldest_item_days || 0} дн.` : '—'}</p></div></div></div>`}
      </div></section>`}
      ${!loading && page === 'qc' && html`<section className="premium-card rounded-2xl p-4"><h2 className="font-semibold">Контроль</h2><ul className="mt-2 text-sm space-y-2">${attention.map((i) => html`<li className="border-b border-luxe-border/60 pb-2"><button className="w-full text-left" onClick=${() => setSelected(i.item)}><div className="flex gap-2"><img src=${i.photo_url || i.item?.photo_url || 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=160'} className="w-12 h-12 rounded-lg object-contain bg-white border border-luxe-border"/><div><p><b>№ ${i.item_number}</b> · ${i.model_name || '—'}</p><p className="text-luxe-muted">Причины: ${(i.reasons || []).map((r)=>r.label).join(' · ') || '—'}</p></div></div></button></li>`)}</ul></section>`}
      ${!loading && page === 'repair' && html`<section className="space-y-3"><div className="premium-card rounded-2xl p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Ремонт</h2><div className="flex items-center gap-2"><input type="month" className="rounded-lg border border-luxe-border p-1 bg-white" value=${repairMonth} onInput=${(e) => setRepairMonth(e.target.value)}/><button className="tap-btn rounded-lg border border-luxe-border px-3 py-1" onClick=${addMaster}>Добавить мастера</button></div></div><p className="text-sm text-luxe-muted mt-2">Потрачено на ремонт за месяц: <b>${money(repairData.spent_this_month || 0)}</b></p><ul className="mt-2 text-sm space-y-1">${(repairData.masters || []).map((m) => html`<li className="flex justify-between border-b border-luxe-border/60 pb-1"><span>${m.name} ${m.city ? `(${m.city})` : ''}</span><button className="text-rose-700" onClick=${() => deleteMaster(m.id)}>Удалить</button></li>`)}</ul></div><div className="space-y-2">${(repairData.items || []).map((i) => html`<article className="premium-card rounded-2xl p-3"><div className="flex gap-3"><img src=${i.photo_url || 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=160'} className="w-16 h-16 rounded-lg object-contain bg-white border border-luxe-border"/><div><p className="font-semibold">№${i.item_number} · ${i.model_name || '—'}</p><p className="text-sm text-luxe-muted">Мастер: ${i.repair_master || '—'}</p><p className="text-sm text-luxe-muted">Отправлено: ${formatDate(i.repair_sent_date)}</p><p className=${`text-sm ${i.repair_days > 14 ? 'text-rose-700' : 'text-luxe-muted'}`}>В ремонте: ${i.repair_days || 0} дн.</p></div></div><div className="flex gap-2 mt-2"><button className="tap-btn rounded-lg border border-luxe-border px-3 py-1 text-sm" onClick=${() => setRepairCardItem(i)}>Открыть</button><button className="tap-btn rounded-lg bg-emerald-700 text-white px-3 py-1 text-sm" onClick=${() => completeRepair(i.item_number)}>Ремонт выполнен</button></div></article>`)}</div></section>`}
      ${!loading && page === 'activity' && html`<section className="premium-card rounded-2xl p-4 overflow-auto"><table className="min-w-[760px] w-full text-sm"><thead><tr className="text-xs text-luxe-muted"><th className="text-left">Время</th><th>Номер</th><th>Действие</th><th className="text-left">Описание</th></tr></thead><tbody>${activity.map((a) => html`<tr className="border-t border-luxe-border/60"><td className="py-2">${new Date(a.timestamp).toLocaleString('ru-RU')}</td><td>${a.item_number}</td><td>${a.action}</td><td>${a.description || '—'}</td></tr>`)}</tbody></table></section>`}
      ${!loading && page === 'rephoto' && html`<section className="space-y-3"><div className="premium-card rounded-2xl p-4"><h2 className="font-semibold">Товары на перефото</h2><p className="text-sm text-luxe-muted mt-1">Всего: ${rephotoItems.length}</p></div>${rephotoItems.map((i) => html`<article className="premium-card rounded-2xl p-3"><div className="flex gap-2 items-start"><img src=${i.photo_url || 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=120'} className="w-12 h-12 rounded-lg object-contain bg-white border border-luxe-border"/><div><p className="font-semibold">№${i.item_number} · ${i.model_name || '—'}</p><p className="text-sm text-luxe-muted">${i.category || '—'}</p></div></div><button className="tap-btn mt-2 rounded-lg bg-luxe-accent text-white px-3 py-1.5 text-xs" onClick=${() => setSelected(i)}>Открыть</button></article>`)}</section>`}
      ${!loading && page === 'settings' && html`<section className="premium-card rounded-2xl p-4"><h2 className="font-semibold">Настройки</h2><p className="mt-2 text-sm text-luxe-muted">API подключен через Apps Script URL из <code>src/config.js</code>.</p><button className="tap-btn mt-3 rounded-lg border border-luxe-border px-3 py-2 text-sm" onClick=${loadAll}>Обновить данные</button></section>`}
    </main>

    ${showFabMenu && html`<div className="fixed inset-0 z-30" onClick=${() => setShowFabMenu(false)}></div>`}
    <div className="fixed right-4 bottom-24 z-40 flex flex-col items-end gap-2">
      ${showFabMenu && html`<div className="premium-card rounded-2xl p-2 flex flex-col gap-2"><button className="tap-btn rounded-xl bg-white border border-luxe-border px-3 py-2 text-sm" onClick=${() => { setShowPurchase(true); setShowFabMenu(false); }}>+ Покупка</button><button className="tap-btn rounded-xl bg-white border border-luxe-border px-3 py-2 text-sm" onClick=${() => { setShowSale(true); setShowFabMenu(false); }}>+ Продажа</button></div>`}
      <button className="tap-btn h-14 w-14 rounded-full bg-luxe-accent text-white text-3xl leading-none shadow-lg" onClick=${() => setShowFabMenu(!showFabMenu)}>+</button>
    </div>

    ${selected && html`<${ItemModal} item=${selected} close=${() => setSelected(null)} save=${saveItem} updateStatus=${updateStatus} updateShipping=${updateShipping} openSale=${() => setShowSale(true)} cancelSale=${cancelSale} deleteItem=${deleteItem} sendToRepair=${(num) => setRepairTarget(num)} />`}
    ${repairTarget && html`<${RepairAssignModal} itemNumber=${repairTarget} masters=${repairData.masters || []} close=${() => setRepairTarget(null)} submit=${async (masterId) => { await sendToRepair(repairTarget, masterId); setRepairTarget(null); }} />`}
    ${repairCardItem && html`<${RepairItemModal} item=${repairCardItem} masters=${repairData.masters || []} close=${() => setRepairCardItem(null)} save=${saveItem} completeRepair=${completeRepair} />`}
    ${showPurchase && html`<${PurchaseModal} close=${() => setShowPurchase(false)} save=${savePurchase} />`}
    ${showSale && html`<${SaleModal} close=${() => setShowSale(false)} items=${items} save=${saveSale} />`}

    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 border-t border-luxe-border mx-auto max-w-7xl p-2 grid grid-cols-3 gap-1 z-20">
      ${BOTTOM_PAGES.map(([id, label, icon]) => html`<button onClick=${() => setPage(id)} className=${`tap-btn rounded-xl text-xs py-2 ${id === page ? 'bg-luxe-accent text-white' : 'text-luxe-muted'}`}>${icon}<br/>${label}</button>`)}
    </nav>

    ${toast && html`<div className="fixed bottom-20 right-4 bg-emerald-700 text-white px-4 py-2 rounded-xl z-50">${toast}</div>`}
  </div>`;
}

function PurchaseModal({ close, save }) {
  const [f, setF] = useState({
    item_number: '',
    photo_url: '',
    buyee_url: '',
    model_name: '',
    category: 'Сумка',
    purchase_date: new Date().toISOString().slice(0, 10),
    base_cost: '',
    shipping_japan: '',
    tax: '',
    shipping_spain: '',
    repair_cost: '',
    total_cost: 0,
    status: 'purchased',
    listed_vinted: 'no',
    listed_vestiaire: 'no',
    need_rephoto: 'no',
    money_received: 'no',
    notes: ''
  });
  const [preview, setPreview] = useState('');
  const computedTotal = n(f.base_cost) + n(f.shipping_japan) + n(f.tax) + n(f.shipping_spain) + n(f.repair_cost);
  const invalid = !String(f.item_number).trim() || !String(f.model_name).trim() || computedTotal <= 0;

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await toCompressedImage(file);
      setPreview(data);
      setF({ ...f, photo_url: data });
    } catch (_) {
      setPreview('');
    }
  };

  return html`<div className="fixed inset-0 bg-black/45 p-3 md:p-8 z-30 overflow-auto"><form onSubmit=${(e) => { e.preventDefault(); if (!invalid) save({ ...f, total_cost: computedTotal }); }} className="max-w-2xl mx-auto premium-card rounded-2xl p-4 space-y-3"><div className="flex justify-between"><h2 className="font-semibold text-lg">Покупка</h2><button type="button" onClick=${close}>✕</button></div>
    <div className="grid md:grid-cols-2 gap-2">
      <label className="text-xs">Номер товара<input className="w-full mt-1 rounded-xl border p-2" value=${f.item_number} onInput=${(e) => setF({ ...f, item_number: e.target.value })} placeholder="108"/></label>
      <label className="text-xs">Модель<input className="w-full mt-1 rounded-xl border p-2" value=${f.model_name} onInput=${(e) => setF({ ...f, model_name: e.target.value })}/></label>
      <label className="text-xs">Категория<select className="w-full mt-1 rounded-xl border p-2" value=${f.category} onChange=${(e) => setF({ ...f, category: e.target.value })}>${CATEGORY_OPTIONS.map((c) => html`<option value=${c}>${c}</option>`)}</select></label>
      <label className="text-xs">Дата покупки<input type="date" className="w-full mt-1 rounded-xl border p-2" value=${f.purchase_date} onInput=${(e) => setF({ ...f, purchase_date: e.target.value })}/></label>
      <label className="text-xs">Выкуп товара (€)<input type="number" className="w-full mt-1 rounded-xl border p-2" value=${f.base_cost} onInput=${(e) => setF({ ...f, base_cost: e.target.value })}/></label>
      <label className="text-xs">Доставка с Японии (€)<input type="number" className="w-full mt-1 rounded-xl border p-2" value=${f.shipping_japan} onInput=${(e) => setF({ ...f, shipping_japan: e.target.value })}/></label>
      <label className="text-xs">Налог (€)<input type="number" className="w-full mt-1 rounded-xl border p-2" value=${f.tax} onInput=${(e) => setF({ ...f, tax: e.target.value })}/></label>
      <label className="text-xs">Доставка в Испанию (€)<input type="number" className="w-full mt-1 rounded-xl border p-2" value=${f.shipping_spain} onInput=${(e) => setF({ ...f, shipping_spain: e.target.value })}/></label>
      <label className="text-xs">Ремонт (€)<input type="number" className="w-full mt-1 rounded-xl border p-2" value=${f.repair_cost} onInput=${(e) => setF({ ...f, repair_cost: e.target.value })}/></label>
      <label className="text-xs">Себестоимость (авто)<input type="number" disabled className="w-full mt-1 rounded-xl border p-2 bg-slate-100" value=${computedTotal}/></label>
      <label className="text-xs">Статус<select className="w-full mt-1 rounded-xl border p-2" value=${f.status} onChange=${(e) => setF({ ...f, status: e.target.value })}>${Object.entries(STATUS_META).map(([k, v]) => html`<option value=${k}>${v.label}</option>`)}</select></label>
    </div>
    <div className="rounded-xl border border-luxe-border p-3 bg-white"><p className="text-sm font-medium">Фото товара</p><input type="file" accept="image/*" onChange=${onPickPhoto} className="mt-2 text-sm"/><p className="text-xs text-luxe-muted mt-1">Выберите фото с телефона/компьютера.</p><label className="text-xs text-luxe-muted mt-2 block">Ссылка Buyee (опционально)</label><input className="w-full mt-1 rounded-xl border p-2 text-sm" value=${f.buyee_url} onInput=${(e) => setF({ ...f, buyee_url: e.target.value })} placeholder="https://buyee.jp/..."/>${(preview || f.photo_url) ? html`<img src=${preview || f.photo_url} className="mt-2 h-28 w-full rounded-lg object-contain bg-white"/>` : null}</div>
    <label className="text-xs inline-flex items-center gap-2"><input type="checkbox" checked=${boolText(f.need_rephoto) === 'yes'} onChange=${(e) => setF({ ...f, need_rephoto: e.target.checked ? 'yes' : 'no' })}/>Нужно перефото</label>
    <label className="text-xs block">Заметки<textarea className="w-full mt-1 rounded-xl border p-2" rows="2" value=${f.notes} onInput=${(e) => setF({ ...f, notes: e.target.value })}></textarea></label>
    <button disabled=${invalid} className="tap-btn w-full rounded-xl bg-luxe-accent text-white py-3 disabled:opacity-50">Сохранить покупку</button></form></div>`;
}

function SaleModal({ close, items, save }) {
  const [itemNumber, setItemNumber] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [showShipBlock, setShowShipBlock] = useState(false);
  const [f, setF] = useState({ sale_price: '', platform: 'Vinted', money_received: 'no', status: 'sold', notes: '', shipping_label_url: '', shipping_status: 'pending', shipping_date: '', tracking_number: '' });
  const [labelData, setLabelData] = useState('');

  useEffect(() => {
    const num = String(itemNumber || '').trim();
    if (!num) {
      setSelectedItem(null);
      setLookupError('');
      return;
    }

    let cancelled = false;
    setLookupLoading(true);
    setLookupError('');
    api('getItemByNumber', { item_number: num })
      .then((res) => {
        if (cancelled) return;
        const it = res?.item || null;
        if (!it) {
          setSelectedItem(null);
          setLookupError('Товар с таким номером не найден');
        } else if (it.sale_id) {
          setSelectedItem(null);
          setLookupError('Товар уже продан, выберите другой номер');
        } else {
          setSelectedItem(it);
          setLookupError('');
        }
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = String(e.message || '');
        if (msg.includes('Unknown action: getItemByNumber')) {
          const local = items.find((x) => String(x.item_number).trim() === num || (!Number.isNaN(Number(num)) && Number(x.item_number) === Number(num))) || null;
          if (!local) {
            setSelectedItem(null);
            setLookupError('Товар с таким номером не найден');
          } else if (local.sale_id) {
            setSelectedItem(null);
            setLookupError('Товар уже продан, выберите другой номер');
          } else {
            setSelectedItem(local);
            setLookupError('');
          }
        } else {
          setSelectedItem(null);
          setLookupError(String(e.message || 'Ошибка поиска товара'));
        }
      })
      .finally(() => {
        if (!cancelled) setLookupLoading(false);
      });

    return () => { cancelled = true; };
  }, [itemNumber]);

  const invalid = lookupLoading || !selectedItem || n(f.sale_price) <= 0;

  const onPickLabel = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result || '');
      setLabelData(data);
      setF({ ...f, shipping_label_url: data });
    };
    reader.readAsDataURL(file);
  };

  return html`<div className="fixed inset-0 bg-black/45 p-3 md:p-8 z-30 overflow-auto"><form onSubmit=${(e) => { e.preventDefault(); if (!invalid) save({ ...f, item_number: selectedItem.item_number, sale_date: new Date().toISOString().slice(0, 10) }); }} className="max-w-xl mx-auto premium-card rounded-2xl p-4 space-y-3"><div className="flex justify-between"><h2 className="font-semibold text-lg">Продажа</h2><button type="button" onClick=${close}>✕</button></div>
    <label className="text-xs block">Номер товара<input className="w-full mt-1 rounded-xl border p-2" value=${itemNumber} onInput=${(e) => setItemNumber(e.target.value)} placeholder="Например 108"/></label>
    ${lookupLoading ? html`<p className="text-xs text-luxe-muted">Ищем товар...</p>` : null}
    ${lookupError ? html`<p className="text-xs text-rose-600">${lookupError}</p>` : null}
    ${selectedItem ? html`<div className="rounded-xl bg-[#f5efe6] p-3 text-sm">Товар: <b>№${selectedItem.item_number} · ${selectedItem.model_name || '—'}</b><br/>Себестоимость: <b>${money(selectedItem.total_cost)}</b> · Статус: <b>${STATUS_META[selectedItem.status]?.label || selectedItem.status}</b></div>` : null}
    <div className="grid md:grid-cols-2 gap-2">
      <label className="text-xs">Цена продажи<input type="number" className="w-full mt-1 rounded-xl border p-2" value=${f.sale_price} onInput=${(e) => setF({ ...f, sale_price: e.target.value })}/></label>
      <label className="text-xs">Платформа<select className="w-full mt-1 rounded-xl border p-2" value=${f.platform} onChange=${(e) => setF({ ...f, platform: e.target.value })}>${PLATFORM_OPTIONS.map((p) => html`<option>${p}</option>`)}</select></label>
      <label className="text-xs">Деньги зашли<select className="w-full mt-1 rounded-xl border p-2" value=${f.money_received} onChange=${(e) => setF({ ...f, money_received: e.target.value })}><option value="no">Нет</option><option value="yes">Да</option></select></label>
      <label className="text-xs">Статус продажи / доставки<select className="w-full mt-1 rounded-xl border p-2" value=${f.status} onChange=${(e) => setF({ ...f, status: e.target.value })}>${['sold', 'shipped', 'delivered'].map((s) => html`<option value=${s}>${STATUS_META[s].label}</option>`)}</select></label>
    </div>
    <label className="text-xs block">Заметки (опционально)<textarea className="w-full mt-1 rounded-xl border p-2" rows="2" value=${f.notes} onInput=${(e) => setF({ ...f, notes: e.target.value })}></textarea></label>
    <div className="rounded-xl border border-luxe-border p-3 bg-white">
      <button type="button" className="tap-btn text-sm underline" onClick=${() => setShowShipBlock(!showShipBlock)}>${showShipBlock ? 'Скрыть' : 'Показать'} блок доставки (опционально)</button>
      ${showShipBlock ? html`<div className="mt-2 space-y-2"><label className="text-xs block">Статус доставки<select className="w-full mt-1 rounded-xl border p-2" value=${f.shipping_status} onChange=${(e) => setF({ ...f, shipping_status: e.target.value })}>${Object.keys(SHIPPING_META).filter((x) => x !== 'cancelled').map((s) => html`<option value=${s}>${shippingLabel(s)}</option>`)}</select></label><label className="text-xs block">Дата отправки<input type="date" className="w-full mt-1 rounded-xl border p-2" value=${f.shipping_date} onInput=${(e) => setF({ ...f, shipping_date: e.target.value })}/></label><label className="text-xs block">Трек-номер (опционально)<input className="w-full mt-1 rounded-xl border p-2" value=${f.tracking_number} onInput=${(e) => setF({ ...f, tracking_number: e.target.value })}/></label><p className="text-sm font-medium">Лейбл доставки</p><input type="file" accept="application/pdf,image/*" onChange=${onPickLabel} className="text-sm"/><input className="w-full rounded-xl border p-2 text-sm" value=${f.shipping_label_url} onInput=${(e) => setF({ ...f, shipping_label_url: e.target.value })} placeholder="или вставьте ссылку"/>${(labelData || f.shipping_label_url) && html`<a className="text-blue-700 underline block" href=${labelData || f.shipping_label_url} target="_blank">Открыть лейбл</a>`}</div>` : null}
    </div>
    <button disabled=${invalid} className="tap-btn w-full rounded-xl bg-luxe-accent text-white py-3 disabled:opacity-50">Сохранить продажу</button></form></div>`;
}

function ItemModal({ item, close, save, updateStatus, updateShipping, openSale, cancelSale, deleteItem, sendToRepair }) {
  const [f, setF] = useState(item);
  const [labelData, setLabelData] = useState('');
  const [photoPreview, setPhotoPreview] = useState('');

  const onPickItemPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await toCompressedImage(file);
      setPhotoPreview(data);
      setF({ ...f, photo_url: data });
    } catch (_) {
      setPhotoPreview('');
    }
  };

  const onPickShippingLabel = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result || '');
      setLabelData(data);
      setF({ ...f, shipping_label_url: data });
    };
    reader.readAsDataURL(file);
  };

  return html`<div className="fixed inset-0 bg-black/45 p-3 md:p-8 z-[60] overflow-auto"><form onSubmit=${(e) => { e.preventDefault(); save(item.item_number, { ...sanitizeMediaFields(f), total_cost: n(f.base_cost) + n(f.shipping_japan) + n(f.tax) + n(f.shipping_spain) + n(f.repair_cost) }); }} className="max-w-3xl mx-auto premium-card rounded-2xl p-4 space-y-3 max-h-[calc(100vh-2rem)] overflow-auto pb-24"><div className="flex justify-between"><h2 className="font-semibold text-lg">Карточка № ${item.item_number}</h2><button type="button" onClick=${close}>✕</button></div>
  <div className="grid md:grid-cols-2 gap-3"><div><img src=${photoPreview || f.photo_url || 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=900'} className="w-full h-56 rounded-xl object-contain bg-white"/><input type="file" accept="image/*" onChange=${onPickItemPhoto} className="mt-2 text-sm"/><p className="text-xs text-luxe-muted mt-1">Сменить фото товара</p></div><div className="space-y-2"><label className="text-sm block">Модель<input className="w-full mt-1 rounded-xl border p-2 text-sm" value=${f.model_name || ''} onInput=${(e) => setF({ ...f, model_name: e.target.value })} placeholder="Введите модель"/></label><label className="text-sm block">Категория<select className="w-full mt-1 rounded-xl border p-2 text-sm" value=${f.category || ''} onChange=${(e) => setF({ ...f, category: e.target.value })}>${CATEGORY_OPTIONS.map((c) => html`<option value=${c}>${c}</option>`)}</select></label><p className="text-sm">Описание товара:</p><textarea className="w-full rounded-xl border p-2 text-sm" rows="3" value=${f.notes || ''} onInput=${(e) => setF({ ...f, notes: e.target.value })}></textarea><p className="text-sm">Статус: <${StatusBadge} status=${f.status}/></p><p className="text-sm">Дата покупки: <b>${formatDate(f.purchase_date)}</b></p><p className={\`text-sm ${stockAgeCls(daysOnStock(f, f.sale_date || ''))}\`}>Срок хранения: <b>${daysOnStock(f, f.sale_date || '')} дн.</b></p><p className="text-sm">Себестоимость: <b>${money(f.total_cost)}</b></p>${f.buyee_url ? html`<p className="text-sm">Buyee: <a className="text-blue-700 underline" href=${f.buyee_url} target="_blank">ссылка</a></p>` : html`<p className="text-sm text-luxe-muted">Buyee: —</p>`}<p className="text-sm">Продажа: <b>${f.sale_date ? `${f.platform || '—'} · ${formatDate(f.sale_date)} · ${money(f.sale_price)}` : '—'}</b></p><p className="text-sm">Доставка: <${ShippingBadge} status=${f.shipping_status}/></p>${(labelData || f.shipping_label_url) ? html`<a className="text-blue-700 underline text-sm" href=${labelData || f.shipping_label_url} target="_blank">Открыть лейбл</a>` : html`<p className="text-sm text-luxe-muted">Лейбл не прикреплен</p>`}<div className="flex gap-2">${!f.sale_id ? html`<button type="button" className="tap-btn rounded-xl bg-luxe-accent text-white px-4 py-2" onClick=${openSale}>Оформить продажу</button>` : null}<button type="button" className="tap-btn rounded-xl border border-luxe-border px-4 py-2" onClick=${() => sendToRepair(item.item_number)}>Отправить в ремонт</button>${f.sale_id ? html`<button type="button" className="tap-btn rounded-xl border border-rose-300 text-rose-700 px-4 py-2" onClick=${() => cancelSale(item.item_number, f.sale_id)}>Отменить продажу</button>` : null}</div></div></div>
  <div className="grid md:grid-cols-2 gap-2">
    <label className="text-xs">Статус<select className="w-full mt-1 rounded-xl border p-2" value=${f.status} onChange=${(e) => { setF({ ...f, status: e.target.value }); updateStatus(item.item_number, e.target.value); }}>${Object.entries(STATUS_META).map(([k, v]) => html`<option value=${k}>${v.label}</option>`)}</select></label>
    <label className="text-xs">Статус доставки<select className="w-full mt-1 rounded-xl border p-2" value=${f.shipping_status || 'pending'} onChange=${(e) => setF({ ...f, shipping_status: e.target.value })}>${Object.keys(SHIPPING_META).map((s) => html`<option value=${s}>${shippingLabel(s)}</option>`)}</select></label>
    <label className="text-xs">Дата покупки<input type="date" className="w-full mt-1 rounded-xl border p-2" value=${f.purchase_date || ''} onInput=${(e) => setF({ ...f, purchase_date: e.target.value })}/></label>
    <label className="text-xs">Дата продажи<input type="date" className="w-full mt-1 rounded-xl border p-2" value=${f.sale_date || ''} onInput=${(e) => setF({ ...f, sale_date: e.target.value })} disabled=${!f.sale_id}/></label>
    <label className="text-xs">Выкуп товара (€)<input type="number" className="w-full mt-1 rounded-xl border p-2" value=${f.base_cost || 0} onInput=${(e) => setF({ ...f, base_cost: e.target.value, total_cost: n(e.target.value) + n(f.shipping_japan) + n(f.tax) + n(f.shipping_spain) + n(f.repair_cost) })}/></label>
    <label className="text-xs">Доставка с Японии (€)<input type="number" className="w-full mt-1 rounded-xl border p-2" value=${f.shipping_japan || 0} onInput=${(e) => setF({ ...f, shipping_japan: e.target.value, total_cost: n(f.base_cost) + n(e.target.value) + n(f.tax) + n(f.shipping_spain) + n(f.repair_cost) })}/></label>
    <label className="text-xs">Налог (€)<input type="number" className="w-full mt-1 rounded-xl border p-2" value=${f.tax || 0} onInput=${(e) => setF({ ...f, tax: e.target.value, total_cost: n(f.base_cost) + n(f.shipping_japan) + n(e.target.value) + n(f.shipping_spain) + n(f.repair_cost) })}/></label>
    <label className="text-xs">Доставка в Испанию (€)<input type="number" className="w-full mt-1 rounded-xl border p-2" value=${f.shipping_spain || 0} onInput=${(e) => setF({ ...f, shipping_spain: e.target.value, total_cost: n(f.base_cost) + n(f.shipping_japan) + n(f.tax) + n(e.target.value) + n(f.repair_cost) })}/></label>
    <label className="text-xs">Ремонт (€)<input type="number" className="w-full mt-1 rounded-xl border p-2" value=${f.repair_cost || 0} onInput=${(e) => setF({ ...f, repair_cost: e.target.value, total_cost: n(f.base_cost) + n(f.shipping_japan) + n(f.tax) + n(f.shipping_spain) + n(e.target.value) })}/></label>
    <label className="text-xs">Себестоимость (авто)<input disabled className="w-full mt-1 rounded-xl border p-2 bg-slate-100" value=${n(f.base_cost) + n(f.shipping_japan) + n(f.tax) + n(f.shipping_spain) + n(f.repair_cost)}/></label>
    <label className="text-xs md:col-span-2">Ссылка Buyee<input className="w-full mt-1 rounded-xl border p-2" value=${f.buyee_url || ''} onInput=${(e) => setF({ ...f, buyee_url: e.target.value })} placeholder="https://buyee.jp/..."/></label>
    <label className="text-xs inline-flex items-center gap-2"><input type="checkbox" checked=${boolText(f.listed_vinted) === 'yes'} onChange=${(e) => { const nextV = e.target.checked ? 'yes' : 'no'; const both = nextV === 'yes' && boolText(f.listed_vestiaire) === 'yes'; setF({ ...f, listed_vinted: nextV, arrived_from_japan: both ? 'yes' : f.arrived_from_japan, japan_arrival_date: both ? (f.japan_arrival_date || new Date().toISOString().slice(0,10)) : f.japan_arrival_date }); }}/>Выставлено на Vinted</label>
    <label className="text-xs inline-flex items-center gap-2"><input type="checkbox" checked=${boolText(f.listed_vestiaire) === 'yes'} onChange=${(e) => { const nextV = e.target.checked ? 'yes' : 'no'; const both = nextV === 'yes' && boolText(f.listed_vinted) === 'yes'; setF({ ...f, listed_vestiaire: nextV, arrived_from_japan: both ? 'yes' : f.arrived_from_japan, japan_arrival_date: both ? (f.japan_arrival_date || new Date().toISOString().slice(0,10)) : f.japan_arrival_date }); }}/>Выставлено на Vestiaire</label>
    <label className="text-xs inline-flex items-center gap-2"><input type="checkbox" checked=${boolText(f.arrived_from_japan) === 'yes'} onChange=${(e) => setF({ ...f, arrived_from_japan: e.target.checked ? 'yes' : 'no', japan_arrival_date: e.target.checked ? (f.japan_arrival_date || new Date().toISOString().slice(0,10)) : '' })}/>Приехало с Японии</label>
    <label className="text-xs">Дата прибытия из Японии<input type="date" className="w-full mt-1 rounded-xl border p-2" value=${f.japan_arrival_date || ''} onInput=${(e) => setF({ ...f, japan_arrival_date: e.target.value, arrived_from_japan: e.target.value ? 'yes' : f.arrived_from_japan })}/></label>
    <label className="text-xs inline-flex items-center gap-2 md:col-span-2"><input type="checkbox" checked=${boolText(f.need_rephoto) === 'yes'} onChange=${(e) => setF({ ...f, need_rephoto: e.target.checked ? 'yes' : 'no' })}/>Нужно перефото</label>
    <label className="text-xs">Дата отправки<input type="date" className="w-full mt-1 rounded-xl border p-2" value=${f.shipping_date || ''} onInput=${(e) => setF({ ...f, shipping_date: e.target.value })}/></label>
    <label className="text-xs">Трек-номер<input className="w-full mt-1 rounded-xl border p-2" value=${f.tracking_number || ''} onInput=${(e) => setF({ ...f, tracking_number: e.target.value })}/></label>
    <label className="text-xs md:col-span-2">Лейбл доставки<input className="w-full mt-1 rounded-xl border p-2" value=${f.shipping_label_url || ''} onInput=${(e) => setF({ ...f, shipping_label_url: e.target.value })}/></label>
    <div className="md:col-span-2"><p className="text-sm text-luxe-muted">Загрузить этикетку для отправки</p><input type="file" accept="application/pdf,image/*" onChange=${onPickShippingLabel} className="mt-2 text-sm"/></div>
  </div>
  <div className="flex gap-2"><button type="button" className="tap-btn rounded-xl border border-luxe-border px-4 py-2" onClick=${() => { if (f.sale_id) { updateShipping(item.item_number, { tracking_number: f.tracking_number, shipping_label_url: f.shipping_label_url, shipping_date: f.shipping_date, shipping_status: f.shipping_status }); } save(item.item_number, { ...sanitizeMediaFields(f), total_cost: n(f.base_cost) + n(f.shipping_japan) + n(f.tax) + n(f.shipping_spain) + n(f.repair_cost) }); }}>Сохранить карточку</button><button type="button" className="tap-btn rounded-xl border border-rose-300 text-rose-700 px-4 py-2" onClick=${() => deleteItem(item.item_number)}>Удалить карточку</button></div>
  </form></div>`;
}



function RepairAssignModal({ itemNumber, masters, close, submit }) {
  const [master, setMaster] = useState(String(masters?.[0]?.id || ''));
  return html`<div className="fixed inset-0 bg-black/45 p-3 md:p-8 z-[70] overflow-auto"><form onSubmit=${(e) => { e.preventDefault(); if (master) submit(master); }} className="max-w-md mx-auto premium-card rounded-2xl p-4 space-y-3"><div className="flex justify-between"><h2 className="font-semibold text-lg">Отправить в ремонт · №${itemNumber}</h2><button type="button" onClick=${close}>✕</button></div><label className="text-xs">Мастер<select className="w-full mt-1 rounded-xl border p-2" value=${master} onChange=${(e) => setMaster(e.target.value)}>${(masters || []).map((m) => html`<option value=${m.id}>${m.name}${m.city ? ` (${m.city})` : ''}</option>`)}</select></label><button className="tap-btn w-full rounded-xl bg-luxe-accent text-white py-2" disabled=${!master}>Отправить</button></form></div>`;
}

function RepairItemModal({ item, masters, close, save, completeRepair }) {
  const initialMaster = (masters || []).find((m) => `${m.name}${m.city ? ` (${m.city})` : ''}` === (item.repair_master || ''))?.id || String(masters?.[0]?.id || '');
  const [f, setF] = useState({ repair_notes: item.repair_notes || '', repair_cost: item.repair_cost || 0, repair_master_id: initialMaster, repair_sent_date: item.repair_sent_date || new Date().toISOString().slice(0,10) });
  return html`<div className="fixed inset-0 bg-black/45 p-3 md:p-8 z-[70] overflow-auto"><form onSubmit=${(e) => { e.preventDefault(); const m=(masters||[]).find((x)=>String(x.id)===String(f.repair_master_id)); const masterName=m ? `${m.name}${m.city ? ` (${m.city})` : ''}` : item.repair_master; save(item.item_number, { ...item, repair_notes: f.repair_notes, repair_cost: Number(f.repair_cost || 0), repair_master: masterName, repair_sent_date: f.repair_sent_date, status: 'repair' }); close(); }} className="max-w-xl mx-auto premium-card rounded-2xl p-4 space-y-3"><div className="flex justify-between"><h2 className="font-semibold text-lg">Карта ремонта №${item.item_number}</h2><button type="button" onClick=${close}>✕</button></div><div className="flex gap-3"><img src=${item.photo_url || 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=120'} className="w-16 h-16 rounded-lg object-contain bg-white border border-luxe-border"/><div><p className="font-semibold">${item.model_name || '—'}</p><p className="text-sm text-luxe-muted">Мастер: ${item.repair_master || '—'}</p><p className="text-sm text-luxe-muted">Отправлено: ${formatDate(item.repair_sent_date)}</p></div></div><div className="grid md:grid-cols-2 gap-2"><label className="text-xs">Мастер<select className="w-full mt-1 rounded-xl border p-2" value=${f.repair_master_id} onChange=${(e)=>setF({ ...f, repair_master_id: e.target.value })}>${(masters||[]).map((m)=>html`<option value=${m.id}>${m.name}${m.city ? ` (${m.city})` : ''}</option>`)}</select></label><label className="text-xs">Дата отправки в ремонт<input type="date" className="w-full mt-1 rounded-xl border p-2" value=${f.repair_sent_date} onInput=${(e)=>setF({ ...f, repair_sent_date: e.target.value })}/></label></div><label className="text-xs">Что ремонтировать<textarea className="w-full mt-1 rounded-xl border p-2" rows="4" value=${f.repair_notes} onInput=${(e) => setF({ ...f, repair_notes: e.target.value })}></textarea></label><label className="text-xs">Стоимость ремонта (€)<input type="number" className="w-full mt-1 rounded-xl border p-2" value=${f.repair_cost} onInput=${(e) => setF({ ...f, repair_cost: e.target.value })}/></label><div className="flex gap-2"><button className="tap-btn rounded-xl border border-luxe-border px-4 py-2" type="submit">Сохранить</button><button type="button" className="tap-btn rounded-xl bg-emerald-700 text-white px-4 py-2" onClick=${async () => { await completeRepair(item.item_number, f.repair_cost); close(); }}>Ремонт выполнен</button></div></form></div>`;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
