# База с Катей — CRM для Vinted + Vestiaire

Финальная бесплатная архитектура:

```text
GitHub Pages (frontend)
      ↓
Google Apps Script Web App (API)
      ↓
Google Sheets (database)
```

## Что важно

- Интерфейс: русский
- Валюта: EUR
- Основной ID товара: короткий номер (`item_number`, например `108`)
- Логика под ваш workflow: Vinted/Vestiaire, быстрые покупка/продажа, контроль листинга, контроль денег
- Общие данные на iPhone и laptop

---

## Структура

```bash
.
├─ apps-script/
│  └─ Code.gs
├─ docs/                    # publish-папка для GitHub Pages
│  ├─ index.html
│  └─ src/
│     ├─ main.js
│     ├─ styles.css
│     ├─ config.js
│     └─ config.example.js
├─ web/                     # рабочая копия frontend
│  ├─ index.html
│  └─ src/
│     ├─ main.js
│     ├─ styles.css
│     ├─ config.js
│     └─ config.example.js
└─ server/                  # optional legacy local mock backend
```

---

## Google Sheets (source of truth)

Используется Spreadsheet ID:

`1_Se3EckR9GyiF1Qk95Dp7VXwzV1AVfQLZLGAbpw5M4M`

Листы (названия важны):

1. `Inventory`
2. `Purchases`
3. `Sales`
4. `Statistics`
5. `Activity Log`

Apps Script сам добавит заголовки, если листы пустые.

### Текущая модель Inventory

- item_number
- photo_url
- model_name
- category
- purchase_date
- total_cost
- status
- listed_vinted
- listed_vestiaire
- need_rephoto
- money_received
- sale_price
- sale_date
- platform
- buyer
- platform_fee
- profit
- notes
- updated_at

---

## Что изменено под реальный workflow

### 1) Короткий номер товара
Во всём приложении основной идентификатор — `item_number` (короткий, цифровой/короткий текст).

### 2) Трекинг листинга
У каждого товара есть флаги:
- `listed_vinted` (yes/no)
- `listed_vestiaire` (yes/no)
- `need_rephoto` (yes/no)

### 3) Логика денег
Поле `money_received` (yes/no).

### 4) Остаток закупа
`purchase_balance` считается так:
- берем `total_cost` всех товаров,
- включаем:
  - товары НЕ проданные,
  - товары проданные, но `money_received != yes`.
- если товар продан и `money_received = yes`, его себестоимость больше не учитывается в остатке закупа.

### 5) Продажи по месяцу
Есть отдельная вкладка **Продажи**:
- выбор месяца
- список проданных позиций за месяц
- колонки: номер, себестоимость, цена продажи, прибыль, дата, статус денег, статус
- итоги: количество, выручка, прибыль

---

## Apps Script setup

1. Откройте `https://script.google.com`
2. Создайте проект
3. Вставьте код из `apps-script/Code.gs`
4. Убедитесь, что `SPREADSHEET_ID` уже ваш (он уже вставлен)
5. Deploy → New deployment → Web app
6. Execute as: Me
7. Who has access: Anyone
8. Deploy
9. Скопируйте Web App URL

---

## Куда вставить Apps Script URL

Откройте:

- `docs/src/config.js`

и убедитесь, что там ваш URL:

```js
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/.../exec';
```

(Синхронно можно держать тот же URL в `web/src/config.js`.)

---

## GitHub Pages deploy (самый простой)

1. Запушьте проект в GitHub
2. Repo → Settings → Pages
3. Source: Deploy from a branch
4. Branch: `main`
5. Folder: `/docs`
6. Save

Готово.

---

## Проверка с laptop + iPhone

1. Откройте GitHub Pages URL на laptop
2. Создайте покупку
3. Проверьте, что строка появилась в `Inventory` и `Purchases`
4. Сделайте продажу
5. Проверьте `Sales`, обновление в `Inventory`, запись в `Activity Log`
6. Откройте сайт на iPhone
7. Обновите страницу и убедитесь, что данные те же
8. Смените статус/флаги и проверьте, что Sheets обновился

---

## API actions (frontend -> Apps Script)

GET:
- `getInventory`
- `getDashboard`
- `getAnalytics`
- `getQC`
- `getActivity`

POST:
- `createPurchase`
- `recordSale`
- `updateStatus`
- `editItem`
- `getSalesByMonth`
- `getItemByNumber`

---

## Что можно улучшить позже (v2)

- Авто-архивация старых продаж
- Экспорт отчёта по месяцу в PDF/CSV
- Отдельный фильтр только по Vinted / только по Vestiaire
- Простая авторизация PIN-кодом
