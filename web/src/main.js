import { APPS_SCRIPT_URL } from './config.js';

const ReactRef = window.React;
const ReactDOMRef = window.ReactDOM;
const htmRef = window.htm;
if (!ReactRef || !ReactDOMRef || !htmRef) throw new Error('Не удалось загрузить React/ReactDOM/htm.');
const { useEffect, useMemo, useState } = ReactRef;
const html = htmRef.bind(ReactRef.createElement);

const SESSION_STORAGE_KEY = 'crm_session_v1';
const STATUS = ['all', 'purchased', 'transit', 'repair', 'ready', 'listed', 'hold', 'sold', 'shipped', 'delivered'];
const ADMIN_PAGES = [['dashboard', 'Дашборд', '🏠'], ['inventory', 'Склад', '📦'], ['sales', 'Продажи', '💶'], ['activity', 'История', '📑']];
const VIEWER_PAGES = [['dashboard', 'Дашборд', '🏠'], ['inventory', 'Склад', '📦'], ['sales', 'Продажи', '💶']];
const money = (v) => `${Number(v || 0).toFixed(0)} €`;
const boolTxt = (v) => ['true', '1', 'yes', 'да', 'y'].includes(String(v || '').toLowerCase()) ? 'yes' : 'no';

const loadStoredSession = () => { try { const raw = localStorage.getItem(SESSION_STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch (_) { return null; } };
const saveStoredSession = (s) => s ? localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_STORAGE_KEY);

const api = async (action, payload = null) => {
  if (!APPS_SCRIPT_URL) throw new Error('Вставьте URL Apps Script в docs/src/config.js');
  const token = loadStoredSession()?.token || '';
  if (!payload) {
    const resp = await fetch(`${APPS_SCRIPT_URL}?action=${encodeURIComponent(action)}${token ? `&session_token=${encodeURIComponent(token)}` : ''}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Ошибка API');
    return json;
  }
  const resp = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, payload: token ? { ...payload, session_token: token } : payload }) });
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || 'Ошибка API');
  return json;
};

function LoginPage({ onLogin }) {
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [error, setError] = useState('');
  return html`<div className="login-wrap"><form className="login-card" onSubmit=${async (e) => { e.preventDefault(); setError(''); try { const result = await onLogin(identity, password, workspaceId); if (result?.require_workspace_choice) { setWorkspaces(result.workspaces || []); setWorkspaceId(result.workspaces?.[0]?.id || ''); } } catch (err) { setError(String(err.message || 'Ошибка входа')); } }}>
    <h2>CRM Multi-Workspace</h2><p className="muted">Luxury Light · mobile-first</p>
    <input className="f" placeholder="Логин или email" value=${identity} onInput=${(e) => setIdentity(e.target.value)} />
    <input className="f" type="password" placeholder="Пароль" value=${password} onInput=${(e) => setPassword(e.target.value)} />
    ${workspaces.length ? html`<select className="f" value=${workspaceId} onChange=${(e) => setWorkspaceId(e.target.value)}>${workspaces.map((w) => html`<option value=${w.id}>${w.name}</option>`)}</select>` : null}
    ${error ? html`<p className="err">${error}</p>` : null}
    <button className="btn primary">${workspaces.length ? 'Войти в выбранную базу' : 'Войти'}</button>
  </form></div>`;
}

function App() {
  const [session, setSession] = useState(loadStoredSession());
  const [page, setPage] = useState('dashboard');
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState({});
  const [items, setItems] = useState([]);
  const [activity, setActivity] = useState([]);
  const [salesMonth, setSalesMonth] = useState(new Date().toISOString().slice(0, 7));
  const [salesData, setSalesData] = useState({ items: [], summary: {} });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [view, setView] = useState('cards');
  const [selected, setSelected] = useState(null);
  const canEdit = session?.user?.role === 'admin';
  const pages = canEdit ? ADMIN_PAGES : VIEWER_PAGES;

  const login = async (identity, password, workspace_id = '') => {
    const r = await api('login', { identity, password, workspace_id, user_agent: navigator.userAgent || 'web' });
    if (r.require_workspace_choice) return r;
    const next = { token: r.token, user: r.user };
    saveStoredSession(next); setSession(next);
    return r;
  };
  const logout = async () => { try { await api('logout', {}); } catch (_) {} saveStoredSession(null); setSession(null); };

  const loadAll = async () => {
    if (!session?.token) return;
    try {
      setError('');
      const [d, i, s] = await Promise.all([api('getDashboard'), api('getInventory'), api('getSalesByMonth', { month: salesMonth })]);
      setDashboard(d.stats || {}); setItems(i.items || []); setSalesData(s || { items: [], summary: {} });
      if (canEdit) { const a = await api('getActivity'); setActivity(a.activity || []); }
    } catch (e) { setError(String(e.message || 'Ошибка загрузки')); }
  };
  useEffect(() => { loadAll(); }, [session?.token, salesMonth]);

  const filtered = useMemo(() => items.filter((i) => {
    const q = query.trim().toLowerCase();
    const passQ = !q || String(i.item_number).toLowerCase().includes(q) || String(i.model_name || '').toLowerCase().includes(q) || String(i.category || '').toLowerCase().includes(q);
    return passQ && (status === 'all' || String(i.status) === status);
  }), [items, query, status]);

  const saveItem = async () => {
    if (!canEdit || !selected) return;
    await api('editItem', { item_number: selected.item_number, updates: selected });
    await loadAll();
  };

  if (!session?.token) return html`<${LoginPage} onLogin=${login} />`;

  return html`<div className="app">
    <header className="top premium-card"><div><b>${session.user.workspace_name || session.user.workspace_id}</b><div className="muted">${canEdit ? 'Admin' : 'Viewer'}</div></div><div><button className="btn" onClick=${loadAll}>Обновить</button><button className="btn" onClick=${logout}>Выйти</button></div></header>
    ${error ? html`<p className="err">${error}</p>` : null}

    ${page === 'dashboard' ? html`<section className="grid kpis">
      <${Kpi} title="Активный склад" value=${dashboard.active_stock} />
      <${Kpi} title="Стоимость склада" value=${money(dashboard.stock_value)} featured=${1} />
      <${Kpi} title="Продано в этом месяце" value=${dashboard.sold_this_month} />
      <${Kpi} title="Прибыль за месяц" value=${money(dashboard.profit_this_month)} featured=${1} />
      <${Kpi} title="На 1 человека" value=${money(dashboard.profit_share_each)} />
      <${Kpi} title="Остаток закупа" value=${money(dashboard.purchase_balance)} />
      <${Kpi} title="Не отправлено" value=${dashboard.pending_shipping} />
      <${Kpi} title="В пути из Японии" value=${dashboard.awaiting_japan} />
      <${Kpi} title="На ремонте" value=${dashboard.repair_count} />
      <${Kpi} title="Требуют внимания" value=${dashboard.attention_count} />
    </section>
    ${canEdit ? html`<section className="premium-card panel"><h3>Ручная корректировка остатка закупа</h3><div className="row"><input className="f" type="number" defaultValue=${dashboard.purchase_balance || 0} id="purchase-balance" /><button className="btn primary" onClick=${async () => { const v = document.getElementById('purchase-balance').value; await api('updatePurchaseBalance', { value: Number(v || 0) }); await loadAll(); }}>Сохранить</button></div></section>` : null}
    <section className="premium-card panel"><h3>Ожидают отправки / доставки</h3><p className="muted">Не отправлено: <b>${dashboard.pending_shipping || 0}</b> · В пути: <b>${dashboard.in_transit || 0}</b></p></section>` : null}

    ${page === 'inventory' ? html`<section>
      <div className="premium-card panel"><div className="row"><input className="f" placeholder="Поиск по номеру, модели, категории" value=${query} onInput=${(e) => setQuery(e.target.value)} /><select className="f" value=${status} onChange=${(e) => setStatus(e.target.value)}>${STATUS.map((s) => html`<option value=${s}>${s === 'all' ? 'Все статусы' : s}</option>`)}</select><select className="f" value=${view} onChange=${(e) => setView(e.target.value)}><option value="cards">Плитка</option><option value="list">Список</option></select>${canEdit ? html`<button className="btn primary" onClick=${async () => { const item_number = prompt('Номер товара'); const model_name = prompt('Модель'); const total_cost = Number(prompt('Себестоимость', '0') || 0); if (!item_number || !model_name) return; await api('createPurchase', { item_number, model_name, total_cost }); await loadAll(); }}>+ Покупка</button>` : null}</div></div>
      <div className=${view === 'cards' ? 'cards' : 'list'}>${filtered.map((i) => html`<article className="premium-card item" onClick=${() => setSelected({ ...i })}>
        <div className="thumb">${i.photo_url ? html`<img src=${i.photo_url} alt=""/>` : html`<span>📷</span>`}</div>
        <div className="meta"><h4>#${i.item_number} · ${i.model_name}</h4><p>${i.category || '—'} · ${money(i.total_cost)} · ${i.platform || '—'}</p><p>${i.status || '—'} · доставка: ${i.shipping_status || 'pending'} · продажа: ${i.sale_price ? money(i.sale_price) : '—'}</p></div>
      </article>`)}</div>
    </section>` : null}

    ${page === 'sales' ? html`<section className="fade-in">
      <div className="row"><input className="f" type="month" value=${salesMonth} onInput=${(e) => setSalesMonth(e.target.value)} /></div>
      <div className="grid kpis"><${Kpi} title="Продано" value=${salesData.summary?.sold_count || 0} /><${Kpi} title="Выручка" value=${money(salesData.summary?.revenue)} /><${Kpi} title="Прибыль" value=${money(salesData.summary?.profit)} /><${Kpi} title="Прибыль в обработке" value=${money(salesData.summary?.profit_processing)} /></div>
      <div className="cards">${(salesData.items || []).map((s) => html`<article className="premium-card item"><div className="thumb">${s.shipping_label_url ? html`<img src=${s.shipping_label_url} alt=""/>` : html`<span>💶</span>`}</div><div className="meta"><h4>#${s.item_number} · ${s.model_name}</h4><p>${s.platform || '—'} · ${s.sale_date || '—'} · ${s.shipping_status || 'pending'}</p><p>Покупка ${money(s.total_cost)} / Продажа ${money(s.sale_price)} / Прибыль ${money(s.profit)}</p><p>Деньги: ${boolTxt(s.money_received)}</p>${canEdit ? html`<button className="btn danger" onClick=${async () => { await api('cancelSale', { item_number: s.item_number }); await loadAll(); }}>Отменить продажу</button>` : null}</div></article>`)}
      </div></section>` : null}

    ${canEdit && page === 'activity' ? html`<section className="premium-card panel"><table><thead><tr><th>Время</th><th>№</th><th>Действие</th></tr></thead><tbody>${activity.map((a) => html`<tr><td>${a.timestamp}</td><td>${a.item_number}</td><td>${a.action}</td></tr>`)}</tbody></table></section>` : null}

    ${selected ? html`<section className="drawer"><div className="drawer-card premium-card"><h3>Карточка #${selected.item_number}</h3>
      <div className="grid2"><input className="f" value=${selected.model_name || ''} onInput=${(e) => setSelected({ ...selected, model_name: e.target.value })} /><input className="f" value=${selected.category || ''} onInput=${(e) => setSelected({ ...selected, category: e.target.value })} /><input className="f" value=${selected.photo_url || ''} onInput=${(e) => setSelected({ ...selected, photo_url: e.target.value })} placeholder="Фото URL" /><input className="f" value=${selected.description || ''} onInput=${(e) => setSelected({ ...selected, description: e.target.value })} placeholder="Описание" /><input className="f" type="number" value=${selected.total_cost || 0} onInput=${(e) => setSelected({ ...selected, total_cost: e.target.value })} /><input className="f" type="number" value=${selected.sale_price || 0} onInput=${(e) => setSelected({ ...selected, sale_price: e.target.value })} /><input className="f" value=${selected.shipping_status || 'pending'} onInput=${(e) => setSelected({ ...selected, shipping_status: e.target.value })} /><input className="f" value=${selected.tracking_number || ''} onInput=${(e) => setSelected({ ...selected, tracking_number: e.target.value })} placeholder="Track" /><input className="f" value=${selected.shipping_label_url || ''} onInput=${(e) => setSelected({ ...selected, shipping_label_url: e.target.value })} placeholder="Label URL" /><input className="f" value=${selected.platform || ''} onInput=${(e) => setSelected({ ...selected, platform: e.target.value })} placeholder="Платформа" /><input className="f" value=${selected.notes || ''} onInput=${(e) => setSelected({ ...selected, notes: e.target.value })} placeholder="Заметки" /></div>
      <div className="row">${canEdit ? html`<button className="btn primary" onClick=${saveItem}>Сохранить карточку</button><button className="btn" onClick=${async () => { const v = prompt('Новый статус', selected.status || 'listed'); if (!v) return; await api('updateStatus', { item_number: selected.item_number, status: v }); setSelected(null); await loadAll(); }}>Изменить статус</button><button className="btn" onClick=${async () => { const price = Number(prompt('Цена продажи', selected.sale_price || '0') || 0); await api('recordSale', { item_number: selected.item_number, sale_price: price, platform: selected.platform || 'Vinted' }); setSelected(null); await loadAll(); }}>Оформить продажу</button><button className="btn danger" onClick=${async () => { await api('cancelSale', { item_number: selected.item_number }); setSelected(null); await loadAll(); }}>Отменить продажу</button>` : null}<button className="btn" onClick=${() => setSelected(null)}>Закрыть</button></div>
    </div></section>` : null}

    <nav className="bottom">${pages.map(([id, label, icon]) => html`<button className=${page === id ? 'b active' : 'b'} onClick=${() => setPage(id)}><span>${icon}</span><small>${label}</small></button>`)}${canEdit ? html`<button className="fab" onClick=${() => setPage('inventory')}>+</button>` : null}</nav>
  </div>`;
}

function Kpi({ title, value, featured }) { return html`<div className=${featured ? 'premium-card kpi kpi-featured' : 'premium-card kpi'}><div className="muted">${title}</div><div className="v">${value ?? 0}</div></div>`; }

ReactDOMRef.createRoot(document.getElementById('app')).render(html`<${App} />`);
