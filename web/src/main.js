import { APPS_SCRIPT_URL } from './config.js';

const ReactRef = window.React;
const ReactDOMRef = window.ReactDOM;
const htmRef = window.htm;

if (!ReactRef || !ReactDOMRef || !htmRef) {
  throw new Error('Не удалось загрузить React/ReactDOM/htm из CDN. Проверьте подключение скриптов в index.html.');
}

const { useEffect, useMemo, useState } = ReactRef;
const html = htmRef.bind(ReactRef.createElement);

const SESSION_STORAGE_KEY = 'crm_session_v1';
const PAGES_ADMIN = [['dashboard', 'Дашборд'], ['inventory', 'Склад'], ['activity', 'История']];
const PAGES_VIEWER = [['dashboard', 'Дашборд'], ['inventory', 'Склад']];

const loadStoredSession = () => { try { const raw = window.localStorage.getItem(SESSION_STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch (_) { return null; } };
const saveStoredSession = (s) => s ? window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s)) : window.localStorage.removeItem(SESSION_STORAGE_KEY);

const api = async (action, payload = null) => {
  if (!APPS_SCRIPT_URL) throw new Error('Вставьте URL Apps Script в docs/src/config.js');
  const token = loadStoredSession()?.token || '';
  if (!payload) {
    const resp = await fetch(`${APPS_SCRIPT_URL}?action=${encodeURIComponent(action)}${token ? `&session_token=${encodeURIComponent(token)}` : ''}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Ошибка API');
    return json;
  }
  const resp = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload: token ? { ...payload, session_token: token } : payload })
  });
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

  return html`<div style=${wrap}><form style=${card} onSubmit=${async (e) => {
    e.preventDefault();
    setError('');
    try {
      const result = await onLogin(identity, password, workspaceId);
      if (result?.require_workspace_choice) {
        setWorkspaces(result.workspaces || []);
        setWorkspaceId(result.workspaces?.[0]?.id || '');
      }
    } catch (err) { setError(String(err.message || 'Ошибка входа')); }
  }}>
    <h2>Вход в CRM Multi-Workspace</h2>
    <p style="margin:0;color:#666;font-size:12px">v3 · login/password · 4 базы</p>
    <input style=${input} placeholder="Логин или email" value=${identity} onInput=${(e) => setIdentity(e.target.value)} />
    <input style=${input} type="password" placeholder="Пароль" value=${password} onInput=${(e) => setPassword(e.target.value)} />
    ${workspaces.length ? html`<select style=${input} value=${workspaceId} onChange=${(e) => setWorkspaceId(e.target.value)}>${workspaces.map((w) => html`<option value=${w.id}>${w.name}</option>`)}</select>` : null}
    ${error ? html`<p style="color:#b91c1c">${error}</p>` : null}
    <button style=${btnPrimary}>${workspaces.length ? 'Войти в выбранную базу' : 'Войти'}</button>
  </form></div>`;
}

function App() {
  const [session, setSession] = useState(loadStoredSession());
  const [page, setPage] = useState('dashboard');
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState({});
  const [items, setItems] = useState([]);
  const [activity, setActivity] = useState([]);
  const canEdit = session?.user?.role === 'admin';
  const pages = canEdit ? PAGES_ADMIN : PAGES_VIEWER;

  const login = async (identity, password, workspace_id = '') => {
    const r = await api('login', { identity, password, workspace_id, user_agent: navigator.userAgent || 'web' });
    if (r.require_workspace_choice) return r;
    const next = { token: r.token, user: r.user };
    saveStoredSession(next);
    setSession(next);
    return r;
  };

  const logout = async () => {
    try { await api('logout', {}); } catch (_) {}
    saveStoredSession(null);
    setSession(null);
    setError('');
  };

  const loadAll = async () => {
    if (!session?.token) return;
    setError('');
    try {
      const [d, i] = await Promise.all([api('getDashboard'), api('getInventory')]);
      setDashboard(d.stats || {});
      setItems(i.items || []);
      if (canEdit) {
        const a = await api('getActivity');
        setActivity(a.activity || []);
      } else setActivity([]);
    } catch (e) { setError(String(e.message || 'Ошибка загрузки')); }
  };

  useEffect(() => { loadAll(); }, [session?.token]);

  const addPurchase = async () => {
    if (!canEdit) return;
    const item_number = prompt('Номер товара');
    const model_name = prompt('Модель');
    const total_cost = Number(prompt('Себестоимость', '0') || 0);
    await api('createPurchase', { item_number, model_name, total_cost });
    await loadAll();
  };

  const sellItem = async (item) => {
    if (!canEdit) return;
    const sale_price = Number(prompt(`Цена продажи для №${item.item_number}`, '0') || 0);
    await api('recordSale', { item_number: item.item_number, sale_price });
    await loadAll();
  };

  const cancelSale = async (item) => {
    if (!canEdit) return;
    await api('cancelSale', { item_number: item.item_number });
    await loadAll();
  };

  if (!session?.token) return html`<${LoginPage} onLogin=${login} />`;

  return html`<div style=${appWrap}>
    <header style=${header}>
      <div><b>${session.user.workspace_name || session.user.workspace_id}</b> · ${canEdit ? 'Admin' : 'Viewer'}</div>
      <div><button style=${btn} onClick=${loadAll}>Обновить</button><button style=${btn} onClick=${logout}>Выйти</button></div>
    </header>
    <nav style=${tabs}>${pages.map(([id, label]) => html`<button style=${page === id ? btnPrimary : btn} onClick=${() => setPage(id)}>${label}</button>`)}</nav>
    ${error ? html`<p style="color:#b91c1c">${error}</p>` : null}

    ${page === 'dashboard' ? html`<section style=${grid2}>
      <${Metric} title="Активный склад" value=${dashboard.active_stock || 0} />
      <${Metric} title="Стоимость склада" value=${money(dashboard.stock_value)} />
      <${Metric} title="Продано" value=${dashboard.sold_this_month || 0} />
      <${Metric} title="Прибыль" value=${money(dashboard.profit_this_month)} />
    </section>` : null}

    ${page === 'inventory' ? html`<section>
      ${canEdit ? html`<button style=${btnPrimary} onClick=${addPurchase}>+ Добавить покупку</button>` : null}
      <table style=${table}><thead><tr><th>№</th><th>Модель</th><th>Статус</th><th>Себест.</th><th>Продажа</th><th>Действия</th></tr></thead>
      <tbody>${items.map((i) => html`<tr><td>${i.item_number}</td><td>${i.model_name}</td><td>${i.status || '—'}</td><td>${money(i.total_cost)}</td><td>${i.sale_price ? money(i.sale_price) : '—'}</td><td>
        ${canEdit ? html`<button style=${btn} onClick=${() => sellItem(i)}>Продать</button>
        ${i.status === 'sold' ? html`<button style=${btnDanger} onClick=${() => cancelSale(i)}>Отмена</button>` : null}` : html`<span style="color:#666">read-only</span>`}
      </td></tr>`)}</tbody></table>
    </section>` : null}

    ${canEdit && page === 'activity' ? html`<section><table style=${table}><thead><tr><th>Время</th><th>№</th><th>Действие</th></tr></thead><tbody>${activity.map((a) => html`<tr><td>${a.timestamp}</td><td>${a.item_number}</td><td>${a.action}</td></tr>`)}</tbody></table></section>` : null}
  </div>`;
}

function Metric({ title, value }) { return html`<div style=${metric}><div style="color:#666;font-size:12px">${title}</div><div style="font-size:18px;font-weight:700">${value ?? 0}</div></div>`; }
function money(v) { return `${Number(v || 0).toFixed(2)} €`; }

const appWrap = 'font-family:Inter,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:16px;';
const wrap = 'min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f6f3;';
const card = 'background:#fff;padding:20px;border-radius:12px;box-shadow:0 6px 30px rgba(0,0,0,.08);width:360px;display:flex;flex-direction:column;gap:10px;';
const header = 'display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;';
const tabs = 'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;';
const input = 'padding:8px;border:1px solid #ddd;border-radius:8px;';
const btn = 'padding:8px 10px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;margin-right:6px;';
const btnPrimary = 'padding:8px 10px;border:1px solid #111;background:#111;color:#fff;border-radius:8px;cursor:pointer;margin-right:6px;';
const btnDanger = 'padding:8px 10px;border:1px solid #b91c1c;background:#fff;color:#b91c1c;border-radius:8px;cursor:pointer;';
const table = 'width:100%;border-collapse:collapse;margin-top:10px;';
const grid2 = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:10px 0;';
const metric = 'background:#fff;border:1px solid #eee;border-radius:10px;padding:10px;';

ReactDOMRef.createRoot(document.getElementById('app')).render(html`<${App} />`);
