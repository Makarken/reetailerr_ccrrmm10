import { APPS_SCRIPT_URL } from './config.js';

const React = window.React;
const ReactDOM = window.ReactDOM;

if (!React || !ReactDOM) {
  throw new Error('React/ReactDOM не загрузились из CDN.');
}

const { useEffect, useState, createElement: h } = React;

const SESSION_STORAGE_KEY = 'crm_session_v1';
const PAGES_ADMIN = [['dashboard', 'Дашборд'], ['inventory', 'Склад'], ['activity', 'История']];
const PAGES_VIEWER = [['dashboard', 'Дашборд'], ['inventory', 'Склад']];

const loadStoredSession = () => { try { const raw = window.localStorage.getItem(SESSION_STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch (_) { return null; } };
const saveStoredSession = (s) => s ? window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s)) : window.localStorage.removeItem(SESSION_STORAGE_KEY);

const api = async (action, payload = null) => {
  if (!APPS_SCRIPT_URL) throw new Error('URL не установлен');
  const token = loadStoredSession()?.token || '';
  if (!payload) {
    const resp = await fetch(`${APPS_SCRIPT_URL}?action=${encodeURIComponent(action)}${token ? `&session_token=${encodeURIComponent(token)}` : ''}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'API error');
    return json;
  }
  const resp = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, payload: token ? { ...payload, session_token: token } : payload }) });
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || 'API error');
  return json;
};

function LoginPage({ onLogin }) {
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const result = await onLogin(identity, password, workspaceId);
      if (result?.require_workspace_choice) {
        setWorkspaces(result.workspaces || []);
        setWorkspaceId(result.workspaces?.[0]?.id || '');
      }
    } catch (err) { setError(String(err.message || 'Login error')); }
  };

  return h('div', { style: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f6f3' } },
    h('form', { style: { background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 6px 30px rgba(0,0,0,.08)', width: '360px', display: 'flex', flexDirection: 'column', gap: '10px' }, onSubmit: handleSubmit },
      h('h2', null, 'Вход в CRM'),
      h('p', { style: { margin: 0, color: '#666', fontSize: '12px' } }, 'v3'),
      h('input', { style: { padding: '8px', border: '1px solid #ddd', borderRadius: '8px' }, placeholder: 'Логин', value: identity, onChange: (e) => setIdentity(e.target.value) }),
      h('input', { style: { padding: '8px', border: '1px solid #ddd', borderRadius: '8px' }, type: 'password', placeholder: 'Пароль', value: password, onChange: (e) => setPassword(e.target.value) }),
      workspaces.length > 0 ? h('select', { style: { padding: '8px', border: '1px solid #ddd', borderRadius: '8px' }, value: workspaceId, onChange: (e) => setWorkspaceId(e.target.value) },
        workspaces.map((w) => h('option', { key: w.id, value: w.id }, w.name))
      ) : null,
      error ? h('p', { style: { color: 'red' } }, error) : null,
      h('button', { style: { padding: '8px 10px', border: '1px solid #111', background: '#111', color: '#fff', borderRadius: '8px', cursor: 'pointer' } }, workspaces.length ? 'Войти' : 'Вход')
    )
  );
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
    } catch (e) { setError(String(e.message || 'Load error')); }
  };

  useEffect(() => { loadAll(); }, [session?.token]);

  const addPurchase = async () => {
    if (!canEdit) return;
    const item_number = prompt('Номер');
    const model_name = prompt('Модель');
    const total_cost = Number(prompt('Себест', '0') || 0);
    await api('createPurchase', { item_number, model_name, total_cost });
    await loadAll();
  };

  const sellItem = async (item) => {
    if (!canEdit) return;
    const sale_price = Number(prompt(`Цена №${item.item_number}`, '0') || 0);
    await api('recordSale', { item_number: item.item_number, sale_price });
    await loadAll();
  };

  const cancelSale = async (item) => {
    if (!canEdit) return;
    await api('cancelSale', { item_number: item.item_number });
    await loadAll();
  };

  if (!session?.token) return h(LoginPage, { onLogin: login });

  return h('div', { style: { fontFamily: 'Inter,Arial,sans-serif', maxWidth: '1100px', margin: '0 auto', padding: '16px' } },
    h('header', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '10px' } },
      h('div', null, h('b', null, session.user.workspace_name || session.user.workspace_id), ' · ', canEdit ? 'Admin' : 'Viewer'),
      h('div', null, h('button', { style: { padding: '8px 10px', border: '1px solid #ddd', background: '#fff', borderRadius: '8px', cursor: 'pointer', marginRight: '6px' }, onClick: loadAll }, 'Обновить'), h('button', { style: { padding: '8px 10px', border: '1px solid #ddd', background: '#fff', borderRadius: '8px', cursor: 'pointer' }, onClick: logout }, 'Выйти'))
    ),
    h('nav', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '10px 0' } },
      pages.map(([id, label]) => h('button', { key: id, style: { padding: '8px 10px', border: page === id ? '1px solid #111' : '1px solid #ddd', background: page === id ? '#111' : '#fff', color: page === id ? '#fff' : '#000', borderRadius: '8px', cursor: 'pointer', marginRight: '6px' }, onClick: () => setPage(id) }, label))
    ),
    error ? h('p', { style: { color: 'red' } }, error) : null,
    page === 'dashboard' ? h('section', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', margin: '10px 0' } },
      h('div', { style: { background: '#fff', border: '1px solid #eee', borderRadius: '10px', padding: '10px' } }, h('div', { style: { color: '#666', fontSize: '12px' } }, 'Склад'), h('div', { style: { fontSize: '18px', fontWeight: '700' } }, dashboard.active_stock || 0)),
      h('div', { style: { background: '#fff', border: '1px solid #eee', borderRadius: '10px', padding: '10px' } }, h('div', { style: { color: '#666', fontSize: '12px' } }, 'Стоимость'), h('div', { style: { fontSize: '18px', fontWeight: '700' } }, `${Number(dashboard.stock_value || 0).toFixed(2)} €`)),
      h('div', { style: { background: '#fff', border: '1px solid #eee', borderRadius: '10px', padding: '10px' } }, h('div', { style: { color: '#666', fontSize: '12px' } }, 'Продано'), h('div', { style: { fontSize: '18px', fontWeight: '700' } }, dashboard.sold_this_month || 0)),
      h('div', { style: { background: '#fff', border: '1px solid #eee', borderRadius: '10px', padding: '10px' } }, h('div', { style: { color: '#666', fontSize: '12px' } }, 'Прибыль'), h('div', { style: { fontSize: '18px', fontWeight: '700' } }, `${Number(dashboard.profit_this_month || 0).toFixed(2)} €`))
    ) : null,
    page === 'inventory' ? h('section', null,
      canEdit ? h('button', { style: { padding: '8px 10px', border: '1px solid #111', background: '#111', color: '#fff', borderRadius: '8px', cursor: 'pointer', marginRight: '6px' }, onClick: addPurchase }, '+ Покупка') : null,
      h('table', { style: { width: '100%', borderCollapse: 'collapse', marginTop: '10px' } },
        h('thead', null, h('tr', null, h('th', null, '№'), h('th', null, 'Модель'), h('th', null, 'Статус'), h('th', null, 'Себест'), h('th', null, 'Продажа'), h('th', null, 'Действия'))),
        h('tbody', null, items.map((i) => h('tr', { key: i.item_number }, h('td', null, i.item_number), h('td', null, i.model_name), h('td', null, i.status || '—'), h('td', null, `${Number(i.total_cost).toFixed(2)} €`), h('td', null, i.sale_price ? `${Number(i.sale_price).toFixed(2)} €` : '—'), h('td', null, canEdit ? [h('button', { key: 'sell', style: { padding: '8px 10px', border: '1px solid #ddd', background: '#fff', borderRadius: '8px', cursor: 'pointer', marginRight: '6px' }, onClick: () => sellItem(i) }, 'Продать'), i.status === 'sold' ? h('button', { key: 'cancel', style: { padding: '8px 10px', border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', borderRadius: '8px', cursor: 'pointer' }, onClick: () => cancelSale(i) }, 'Отмена') : null] : h('span', { style: { color: '#666' } }, 'read-only')))))
    ) : null,
    canEdit && page === 'activity' ? h('section', null,
      h('table', { style: { width: '100%', borderCollapse: 'collapse', marginTop: '10px' } },
        h('thead', null, h('tr', null, h('th', null, 'Время'), h('th', null, '№'), h('th', null, 'Действие'))),
        h('tbody', null, activity.map((a) => h('tr', { key: `${a.timestamp}-${a.item_number}` }, h('td', null, a.timestamp), h('td', null, a.item_number), h('td', null, a.action))))
      )
    ) : null
  );
}

const root = ReactDOM.createRoot(document.getElementById('app'));
root.render(h(App));
