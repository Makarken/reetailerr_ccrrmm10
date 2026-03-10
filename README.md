# CRM — Multi-Workspace (Resale / Ресейл)

> **Короткий ответ на вопрос «как снова обратиться к Copilot»:**
> После того как смержил PR — просто открой новый Issue в этом репозитории, опиши проблему и нажми кнопку **«Start in Copilot»**. Copilot прочитает этот README и сразу поймёт всю архитектуру, что уже сделано и что нужно делать.

---

## Содержание

1. [Архитектура](#архитектура)
2. [Структура файлов](#структура-файлов)
3. [Базы данных (Google Sheets)](#базы-данных-google-sheets)
4. [Роли и пользователи](#роли-и-пользователи)
5. [Все API-действия](#все-api-действия)
6. [Страницы приложения](#страницы-приложения)
7. [Деплой (развёртывание)](#деплой)
8. [История исправлений (Changelog)](#changelog)
9. [Как продолжать работу с Copilot](#как-продолжать-работу-с-copilot)

---

## Архитектура

```
Browser (React / htm / Tailwind)
    │
    │  HTTPS POST/GET (JSON)
    ▼
Google Apps Script  ←→  Google Sheets (база данных)
(apps-script/Code.gs)        ↑
                    spreadsheet ID: 1N1aS17lWL1Xp7bMB9K_-AtYZSOCgpU57MvB08uJA76A
```

- **Backend** — Google Apps Script (`apps-script/Code.gs`). Один файл, ~850 строк. Все операции — через него.
- **Frontend** — React + `htm` (без сборки, pure CDN). Два одинаковых файла: `web/src/main.js` (основной) и `docs/src/main.js` (GitHub Pages). **Всегда правим оба**.
- **База данных** — Google Sheets. Листы: `Inventory`, `Sales`, `Activity Log`, `Settings`, `Auth Users`, `Auth Sessions`.
- **Мульти-воркспейс** — каждая запись содержит `workspace_id`. Данные изолированы через `scopedRows()`.

---

## Структура файлов

```
apps-script/
  Code.gs           ← ЕДИНСТВЕННЫЙ бэкенд-файл. Вставляется в Google Apps Script.

web/src/
  main.js           ← Основной фронтенд (для деплоя на Node.js или S3)
  config.js         ← APPS_SCRIPT_URL (не коммитить с реальным URL!)
  config.example.js ← Шаблон конфига

docs/src/
  main.js           ← ДУБЛИРУЕТ web/src/main.js (для GitHub Pages)
  config.js         ← Тот же APPS_SCRIPT_URL для GitHub Pages

server/
  index.js          ← Необязательный Node.js сервер (для локальной разработки)
```

> ⚠️ `web/src/main.js` и `docs/src/main.js` — **идентичны**. При каждом изменении фронтенда правим **оба** файла, или запускаем `npm run sync-frontend` чтобы скопировать автоматически.

---

## Базы данных (Google Sheets)

### Лист `Inventory` (склад товаров)

| Поле | Описание |
|------|----------|
| `workspace_id` | Изоляция данных по воркспейсу |
| `item_number` | Уникальный номер товара (только цифры) |
| `status` | `purchased` / `transit` / `japan_transit` / `repair` / `ready` / `listed` / `hold` / `sold` |
| `sale_id` | ID продажи (пустой если не продан) |
| `sale_price` | Цена продажи |
| `money_received` | `yes` / `no` — деньги пришли? |
| `shipping_status` | `pending` / `shipped` / `delivered` / `cancelled` |
| `listed_vinted` | `yes` / `no` |
| `listed_vestiaire` | `yes` / `no` |
| `need_rephoto` | `yes` / `no` |
| `arrived_from_japan` | `yes` / `no` |
| `total_cost` | Себестоимость = base_cost + доставки + налог + ремонт |

### Лист `Sales` (история продаж)

| Поле | Описание |
|------|----------|
| `sale_id` | Первичный ключ |
| `item_number` | Ссылка на товар |
| `is_cancelled` | `yes` / `no` |
| `money_received` | `yes` / `no` (синхронизируется с Inventory) |
| `status` | `sold` / `cancelled` |

### Лист `Settings`

Хранит настройки воркспейса: `purchase_balance_manual`, `repair_masters` (JSON).

### Листы Auth

`Auth Users` и `Auth Sessions` — хранят пользователей и сессии.

---

## Роли и пользователи

| Логин | Пароль | Роль | Воркспейс |
|-------|--------|------|-----------|
| `admin` | `adminTolkaem` | admin | все базы |
| `Kate` | `Kateresalebags` | viewer | workspace_1 (База с Катей) |
| `Alex` | `Alexbagss` | viewer | workspace_2 (База с Лешей) |

- **admin** — полный доступ, видит все данные, может менять воркспейс
- **viewer** — только чтение, видит только проданные товары своей базы

---

## Все API-действия

Запросы идут через `doPost` (с `session_token`). Публичные (без токена): `login`, `logout`, `getSession`, `getSchema`.

| Действие | Только admin | Описание |
|----------|-------------|----------|
| `getInventory` | | Список всех товаров воркспейса |
| `getDashboard` | | Метрики для дашборда |
| `getQC` | | Список товаров «требуют внимания» |
| `getActivity` | | Лог действий |
| `getAnalytics` | | Аналитика по месяцам |
| `getSalesByMonth` | | Продажи за выбранный месяц |
| `getShippingOverview` | | Обзор доставок |
| `getRepairs` | | Данные ремонтов |
| `getItemByNumber` | | Карточка одного товара |
| `createPurchase` | ✅ | Добавить новый товар |
| `recordSale` | ✅ | Оформить продажу (запрещено если status=sold) |
| `cancelSale` | ✅ | Отменить продажу (принимает `sale_id`) |
| `editItem` | ✅ | Редактировать карточку |
| `updateStatus` | ✅ | Изменить статус |
| `updateShipping` | ✅ | Обновить данные доставки |
| `updateMoneyReceived` | ✅ | Отметить «деньги пришли» (принимает `sale_id`) |
| `deleteItem` | ✅ | Удалить товар и все его продажи |
| `sendToRepair` | ✅ | Отправить в ремонт |
| `completeRepair` | ✅ | Завершить ремонт |
| `updatePurchaseBalance` | ✅ | Установить остаток закупа вручную |

---

## Страницы приложения

| Страница | Ключ | Описание |
|----------|------|----------|
| Дашборд | `dashboard` | Метрики: склад, продажи, прибыль, внимание, ремонт |
| Склад | `inventory` | Все товары, фильтры по статусу, поиск |
| Продажи | `sales` | Продажи по месяцу, «деньги пришли», отмена |
| Аналитика | `analytics` | Месячная и годовая таблица |
| Контроль | `qc` | Товары «требуют внимания» (совпадает с `attention_count` на дашборде) |
| Ремонт | `repair` | Управление ремонтами |
| История | `activity` | Лог всех действий |
| Перефото | `rephoto` | Товары с флагом `need_rephoto` |
| Настройки | `settings` | Остаток закупа, мастера ремонта, управление базами |

---

## Деплой

### 1. Google Apps Script (бэкенд)

1. Открыть [script.google.com](https://script.google.com)
2. Открыть существующий проект (или создать новый, привязанный к таблице)
3. Полностью заменить содержимое `Code.gs` содержимым файла `apps-script/Code.gs` из этого репозитория
4. **Deploy → Manage deployments → Edit (иконка карандаша) → New version → Deploy**
5. Убедиться, что деплой имеет тип **«Web app»**, доступ **«Anyone»**

> После изменений в `Code.gs` **обязательно** создавать новую версию деплоя, иначе старый код останется активным.

### 2. GitHub Pages (фронтенд)

Файл `docs/src/main.js` автоматически публикуется через GitHub Pages из ветки `main`, папка `/docs`.

Перед коммитом убедиться, что `docs/src/config.js` содержит правильный `APPS_SCRIPT_URL`:
```js
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/ВАШ_ДЕПЛОЙ_ID/exec';
```

---

## Changelog

### 2026-03-10 — Исправление логики продажи товара

**Проблемы, которые были:**

1. **Двойная продажа** — при двойном нажатии «Оформить продажу» создавались две строки в Sales, товар оставался с `status=sold` но с пустым `sale_id`
2. **Отмена не работала** — `cancelSale` не находил нужную запись в Sales, потому что игнорировал `sale_id` из фронтенда
3. **«Деньги пришли» не обновляла Sales** — `updateMoneyReceived` вызывал `syncSaleRecord` который был no-op при пустом `item.sale_id`
4. **«Требуют внимания» на дашборде** показывал 0 когда в «Контроль» были позиции — использовался другой неполный фильтр
5. **Кнопка «Оформить продажу»** показывалась на уже проданных товарах (когда `status=sold` но `sale_id` пустой)

**Что исправлено в `apps-script/Code.gs`:**

- `recordSale`: добавлена проверка `if (item.status === 'sold') throw` — защита от двойной продажи
- `cancelSale(itemNumber, saleId)`: теперь принимает `sale_id`, ищет запись по нему в приоритете
- `updateMoneyReceived(itemNumber, moneyReceived, saleId)`: при пустом `item.sale_id` напрямую обновляет строку Sales по переданному `saleId`
- `getDashboard`: `attention_count` теперь `= getQC().length` — всегда совпадает с количеством на странице «Контроль»
- `routeAction`: передаёт `payload.sale_id` в `cancelSale` и `updateMoneyReceived`

**Что исправлено в `web/src/main.js` и `docs/src/main.js`:**

- `toggleMoneyReceived(itemNumber, checked, saleId)` — добавлен параметр `saleId`, передаётся в API
- Sales-список: `toggleMoneyReceived(s.item_number, e.target.checked, s.sale_id)` — передаётся `sale_id`
- ItemModal: кнопка «Оформить продажу» скрыта когда `status === 'sold'` ИЛИ `sale_id` есть; кнопка «Отменить» видна при любом из двух условий
- SaleModal: проверка дубля учитывает `status === 'sold'` (не только `sale_id`)

---

## Как продолжать работу с Copilot

### Шаг 1 — Смержить PR

Нажать **«Merge pull request»** на странице PR. Изменения попадут в ветку `main`.

### Шаг 2 — Создать новый Issue

1. Перейти во вкладку **Issues** репозитория
2. Нажать **«New issue»**
3. Описать проблему или что нужно сделать

### Шаг 3 — Запустить Copilot

В Issue нажать кнопку **«Start in Copilot»** (или упомянуть `@copilot`).

Copilot прочитает этот README и будет знать:
- Всю архитектуру системы
- Какие файлы за что отвечают
- Что уже было исправлено (Changelog)
- Как деплоить изменения

### Шаг 4 — Задеплоить бэкенд после исправлений

После каждого мержа PR с изменениями в `apps-script/Code.gs` нужно обновить деплой в Google Apps Script (создать новую версию). Фронтенд (`docs/`) обновляется автоматически через GitHub Pages.

### Примеры хороших запросов к Copilot

```
На странице «Склад» при поиске по номеру товара не работает фильтр — найди и исправь.
```
```
Добавь поле «Покупатель» в карточку товара, чтобы оно сохранялось в Inventory и отображалось в Sales.
```
```
Кнопка «Сохранить карточку» иногда не закрывает модальное окно — разберись и почини.
```
