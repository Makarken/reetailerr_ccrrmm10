# CRM Multi-Workspace

Сделано заново под новую логику: обязательный вход по логину/паролю и разделение на 4 базы (workspace).

## Что реализовано

- Backend `apps-script/Code.gs`:
  - `login/logout/getSession`
  - роли `admin/viewer`
  - выбор workspace для admin
  - viewer привязан к своему workspace
  - базовые CRM actions: `getInventory`, `getDashboard`, `getActivity`, `createPurchase`, `recordSale`, `cancelSale`, `deleteItem`
  - изоляция данных по `workspace_id`

- Frontend `docs/src/main.js` и `web/src/main.js`:
  - экран логина
  - двухшаговый вход для admin (с выбором базы)
  - role-based UI (viewer только read-only)
  - страницы: Дашборд / Склад / История (история только admin)

## Workspace

- `workspace_1` — База с Катей
- `workspace_2` — База с Лешей
- `workspace_3` — База Tolkaem
- `workspace_4` — База Автономо

## Стартовые пользователи

- `admin / adminTolkaem` (admin, может выбрать любую базу)
- `Kate / Kateresalebags` (viewer, workspace_1)
- `Alex / Alexbagss` (viewer, workspace_2)

## Что делать дальше

1. В Apps Script вставить новый `apps-script/Code.gs` и нажать:
   - Deploy → Manage deployments → Edit → Deploy
2. В GitHub Pages включить публикацию из `main /docs` или через GitHub Actions.
3. Открыть сайт в инкогнито (чтобы не мешал старый кэш).

