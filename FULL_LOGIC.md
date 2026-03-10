# Полная логика системы CRM — Resale / Ресейл

> Этот файл описывает **всю** логику работы системы: базу данных, роли, фото товара, остаток закупа, продажи, ремонт и всё остальное. Создан специально чтобы всегда можно было быстро восстановить контекст.

---

## Содержание

1. [Архитектура](#1-архитектура)
2. [База данных (Google Sheets)](#2-база-данных-google-sheets)
   - [Inventory — склад товаров](#лист-inventory--склад-товаров-46-колонок)
   - [Sales — история продаж](#лист-sales--история-продаж-23-колонки)
   - [Activity Log — лог действий](#лист-activity-log--лог-действий-8-колонок)
   - [Settings — настройки](#лист-settings--настройки)
   - [Auth Users — пользователи](#лист-auth-users--пользователи-10-колонок)
   - [Auth Sessions — сессии](#лист-auth-sessions--сессии-9-колонок)
3. [Роли: Admin vs Viewer](#3-роли-admin-vs-viewer)
4. [Фото товара](#4-фото-товара)
5. [Жизненный цикл товара (статусы)](#5-жизненный-цикл-товара-статусы)
6. [Остаток закупа](#6-остаток-закупа)
7. [Себестоимость товара](#7-себестоимость-товара)
8. [Логика продажи](#8-логика-продажи)
9. [Отмена продажи](#9-отмена-продажи)
10. [Деньги пришли](#10-деньги-пришли)
11. [Доставка покупателю](#11-доставка-покупателю)
12. [Ремонт](#12-ремонт)
13. [QC — «Требуют внимания»](#13-qc--требуют-внимания)
14. [Аутентификация и сессии](#14-аутентификация-и-сессии)
15. [Мульти-воркспейс (базы)](#15-мульти-воркспейс-базы)
16. [Кэширование](#16-кэширование)
17. [Все API-действия](#17-все-api-действия)
18. [Страницы приложения](#18-страницы-приложения)
19. [Дашборд — метрики](#19-дашборд--метрики)
20. [Аналитика по месяцам](#20-аналитика-по-месяцам)
21. [Деплой](#21-деплой)

---

## 1. Архитектура

```
Браузер (React + htm + Tailwind CSS — без сборки, только CDN)
    │
    │  HTTPS POST/GET (JSON)
    │  Один эндпоинт: APPS_SCRIPT_URL
    ▼
Google Apps Script  (apps-script/Code.gs — единственный файл бэкенда, ~1000 строк)
    │
    │  SpreadsheetApp (нативный API)
    ▼
Google Sheets  (6 листов — база данных)
  spreadsheet ID: 1N1aS17lWL1Xp7bMB9K_-AtYZSOCgpU57MvB08uJA76A
```

**Ключевые факты:**
- Бэкенд — **один** файл `apps-script/Code.gs`. Никаких серверов, никаких баз данных кроме Sheets.
- Фронтенд — **два идентичных** файла: `web/src/main.js` (основной) и `docs/src/main.js` (GitHub Pages). При каждом изменении правим **оба**, либо `npm run sync-frontend`.
- API работает через единый URL. GET-запросы передают `action` как параметр, POST — в теле JSON.
- Изоляция данных: каждая запись содержит `workspace_id`, чтение всегда фильтруется через `scopedRows()`.

---

## 2. База данных (Google Sheets)

### Лист `Inventory` — склад товаров (46 колонок)

Это главная таблица. Каждая строка = один товар.

| Поле | Тип | Описание |
|------|-----|----------|
| `workspace_id` | строка | К какой базе принадлежит товар (изоляция данных) |
| `item_number` | число (строка) | Уникальный номер товара — **только цифры**, назначается вручную |
| `photo_url` | base64 строка | Фото товара — хранится как Data URL (jpeg base64), макс. 49 000 символов |
| `buyee_url` | строка | Ссылка на лот на Buyee/Yahoo Japan |
| `model_name` | строка | Название модели (обязательное поле) |
| `category` | строка | `Сумка` / `Часы` / `Аксессуар` / `Обувь` / `Одежда` |
| `description` | строка | Описание товара (нужно для листинга) |
| `purchase_date` | дата | Дата закупа (YYYY-MM-DD) |
| `base_cost` | число | Базовая стоимость / ставка закупа |
| `buyout_price` | число | Цена выкупа (синоним `base_cost`) |
| `shipping_japan` | число | Доставка по Японии |
| `tax` | число | Налог / таможня |
| `customs_tax` | число | Таможенный налог (синоним `tax`) |
| `shipping_spain` | число | Доставка в Испанию |
| `repair_cost` | число | Стоимость ремонта |
| `total_cost` | число | **Себестоимость** = base_cost + shipping_japan + tax + shipping_spain + repair_cost |
| `listing_price` | число | Желаемая цена листинга |
| `status` | строка | Текущий статус (см. [раздел 5](#5-жизненный-цикл-товара-статусы)) |
| `listed_vinted` | `yes`/`no` | Выставлен на Vinted |
| `listed_vestiaire` | `yes`/`no` | Выставлен на Vestiaire Collective |
| `need_rephoto` | `yes`/`no` | Нужно переснять фото |
| `money_received` | `yes`/`no` | Деньги от покупателя получены |
| `sale_id` | строка | ID продажи (ссылка на лист Sales; пустой = не продан) |
| `sale_price` | число | Цена продажи |
| `sale_date` | дата | Дата продажи |
| `platform` | строка | `Vinted` / `Vestiaire` |
| `buyer` | строка | Имя/ник покупателя |
| `platform_fee` | число | Комиссия платформы |
| `profit` | число | Прибыль = sale_price − total_cost − platform_fee |
| `tracking_number` | строка | Трекинг-номер отправления |
| `shipping_label_url` | строка | Ссылка на этикетку доставки |
| `shipping_date` | дата | Дата отправки |
| `shipping_status` | строка | `pending` / `shipped` / `delivered` / `cancelled` |
| `repair_master` | строка | Имя мастера ремонта |
| `repair_sent_date` | дата | Дата отправки в ремонт |
| `repair_finished_date` | дата | Дата завершения ремонта |
| `repair_notes` | строка | Заметки по ремонту |
| `arrived_from_japan` | `yes`/`no` | Товар прибыл из Японии |
| `arrived_date` | дата | Дата прибытия (общая) |
| `japan_arrival_date` | дата | Дата прибытия из Японии (используется для расчёта дней хранения) |
| `sold_storage_days` | число | Сколько дней товар провёл на складе до продажи |
| `notes` | строка | Произвольные заметки |
| `updated_at` | ISO строка | Время последнего изменения |

---

### Лист `Sales` — история продаж (23 колонки)

Каждая строка = одна транзакция продажи. При отмене продажи строка помечается отменённой (не удаляется), а новая создаётся при следующей продаже.

| Поле | Описание |
|------|----------|
| `workspace_id` | Изоляция данных |
| `sale_id` | Первичный ключ (например, `sale_abc123def`) |
| `timestamp` | ISO-время когда была зарегистрирована продажа |
| `item_number` | Ссылка на товар в Inventory |
| `model_name` | Копия названия модели (денормализация для истории) |
| `sale_date` | Дата продажи |
| `sale_price` | Цена продажи |
| `platform` | Vinted / Vestiaire |
| `buyer` | Покупатель |
| `platform_fee` | Комиссия платформы |
| `total_cost` | Себестоимость (копия из Inventory на момент продажи) |
| `profit` | Прибыль |
| `money_received` | `yes`/`no` (синхронизируется с Inventory) |
| `status` | `sold` / `cancelled` |
| `shipping_status` | `pending` / `shipped` / `delivered` / `cancelled` (синхронизируется) |
| `tracking_number` | Трекинг (синхронизируется) |
| `shipping_label_url` | Ссылка на этикетку (синхронизируется) |
| `shipping_date` | Дата отправки (синхронизируется) |
| `pre_sale_status` | Статус товара ДО продажи — нужен для восстановления при отмене |
| `sold_storage_days` | Дней хранения до продажи |
| `is_cancelled` | `yes`/`no` |
| `cancelled_at` | Дата/время отмены |
| `notes` | Заметки |

**Синхронизация Sales ↔ Inventory:** функция `syncSaleRecord(item)` копирует `money_received`, `shipping_status`, `tracking_number`, `shipping_date`, `shipping_label_url` из Inventory в Sales при каждом обновлении этих полей.

---

### Лист `Activity Log` — лог действий (8 колонок)

Каждое изменение записывается автоматически. Хранит последние 200 записей (при чтении, не при записи).

| Поле | Описание |
|------|----------|
| `workspace_id` | База |
| `timestamp` | ISO-время действия |
| `item_number` | Номер товара |
| `action` | Текстовое описание действия (например, «Оформление продажи») |
| `field` | Поле которое изменилось (`status`, `sale`, `card`, `shipping`, `repair`, `money_received`) |
| `old_value` | Старое значение |
| `new_value` | Новое значение |
| `actor` | Кто сделал (`login` пользователя или `web`) |

**Примеры записей в логе:**
- `Добавление покупки | card | (пусто) → created`
- `Изменение статуса | status | ready → sold`
- `Оформление продажи | sale | (пусто) → цена`
- `Отмена продажи | sale | sold → ready`
- `Отправка в ремонт | status | (пусто) → repair`
- `Ремонт выполнен | repair | (пусто) → ready`
- `Обновление доставки | shipping | (пусто) → shipped`
- `Обновление оплаты | money_received | (пусто) → yes`
- `Редактирование карточки | card | (пусто) → updated`
- `Удаление карточки | card | exists → deleted`

---

### Лист `Settings` — настройки

Хранит настройки в формате «ключ-значение» с привязкой к `workspace_id`.

| Ключ | Описание |
|------|----------|
| `purchase_balance_base` | Числовой базис остатка закупа |
| `purchase_balance_base_at` | ISO-время когда был установлен базис |
| `purchase_balance_base_is_set` | `yes` — если базис установлен вручную |
| `purchase_balance_manual` | Устаревшее поле (статическое значение, для обратной совместимости) |
| `repair_masters` | JSON-массив мастеров ремонта: `[{id, name, city}]` |
| `workspaces_config` | JSON-массив динамически созданных баз (хранится под `workspace_id = __global__`) |

---

### Лист `Auth Users` — пользователи (10 колонок)

| Поле | Описание |
|------|----------|
| `user_id` | Уникальный ID (`u_admin`, `u_kate`, `u_alex`, или `u_uuid`) |
| `login` | Логин пользователя (нечувствителен к регистру при входе) |
| `email` | Email (используется как альтернативный логин) |
| `password_hash` | SHA-256 хэш пароля: `hash = SHA256(salt + ":" + password)` |
| `password_salt` | Случайная соль (уникальна для каждого пользователя) |
| `workspace_id` | К какой базе привязан; `*` = все базы (только для admin) |
| `role` | `admin` / `viewer` |
| `is_active` | `yes` / `no` |
| `created_at` | Дата создания |
| `updated_at` | Дата обновления |

**Пользователи по умолчанию** (создаются при первом обращении к листу):

| Логин | Пароль | Роль | База |
|-------|--------|------|------|
| `admin` | `adminTolkaem` | admin | `*` (все базы) |
| `Kate` | `Kateresalebags` | viewer | workspace_1 (База с Катей) |
| `Alex` | `Alexbagss` | viewer | workspace_2 (База с Лешей) |

---

### Лист `Auth Sessions` — сессии (9 колонок)

| Поле | Описание |
|------|----------|
| `session_id` | Токен сессии (например, `sess_abc123def`) — передаётся в каждом запросе |
| `user_id` | Ссылка на Auth Users |
| `workspace_id` | Активная база в этой сессии |
| `role` | Роль пользователя |
| `expires_at` | Когда истекает (TTL = 14 дней) |
| `created_at` | Время создания |
| `last_seen_at` | Последняя активность (обновляется не чаще 1 раза в 5 минут) |
| `revoked_at` | Время отзыва (logout); пустое = активна |
| `user_agent` | Browser User-Agent (первые 250 символов) |

---

## 3. Роли: Admin vs Viewer

### Admin (`workspace_id: *`)

- Видит **все базы**, может переключаться между ними
- Читает: инвентарь, продажи, аналитику, QC, ремонт, лог, перефото
- Пишет: **всё** — создаёт товары, записывает продажи, отменяет, редактирует, управляет доставкой, ремонтом, настройками
- Управляет базами: создаёт/удаляет базы, меняет логин/пароль зрителя
- Видит детальные статусы товаров

**Список только-admin действий** (бэкенд выбрасывает ошибку «Недостаточно прав» при вызове зрителем):
`createPurchase`, `recordSale`, `cancelSale`, `editItem`, `updateStatus`, `updatePurchaseBalance`, `updateShipping`, `updateMoneyReceived`, `sendToRepair`, `completeRepair`, `addRepairMaster`, `deleteRepairMaster`, `deleteItem`, `createWorkspace`, `deleteWorkspace`, `changeViewerCredentials`

---

### Viewer (`workspace_id: конкретная база`)

- Привязан к **одной** базе
- Читает только: **проданные товары** своей базы (только `status === sold`)
- **Не может** писать ничего
- **Не видит:** Аналитику, QC, Перефото, Ремонт, Лог действий
- Видит упрощённый статус: «В наличии» / «Продано» (без детальных промежуточных статусов)
- Не видит затраты (себестоимость, прибыль)

**Изоляция данных на бэкенде:**
```javascript
// Каждый запрос на чтение проходит через scopedRows():
function scopedRows(sheet, headers) {
  const ws = activeWorkspaceId();  // из сессии
  const rows = getRows(sheet, headers);
  return rows.filter(r => String(r.workspace_id) === ws);
}
```
Зритель физически получает только строки своей базы — другие базы просто не попадают в ответ.

---

## 4. Фото товара

### Как добавляется

1. Пользователь выбирает файл через `<input type="file" accept="image/*">`
2. JavaScript читает файл как Data URL через `FileReader.readAsDataURL(file)`
3. Фото **сжимается на стороне браузера**:
   - Максимальный размер стороны: **420 пикселей**
   - Качество JPEG: **0.68**
   - Рисуется на `<canvas>`, затем конвертируется обратно в `data:image/jpeg;base64,...`
4. Получившийся base64-Data URL отправляется в API как поле `photo_url`
5. Бэкенд сохраняет строку в ячейку Google Sheets

### Ограничение размера

Google Sheets ограничивает размер ячейки **49 000 символами**. Если строка photo_url длиннее — она заменяется пустой строкой (`cellText` в `objToRow`). Функция `clampCell` на фронтенде также обрезает поле до лимита перед отправкой.

### Как хранится

Фото хранится прямо в ячейке листа `Inventory`, колонка `photo_url`, как строка вида:
```
data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAA...
```

Это не ссылка на файл — это сами данные изображения, закодированные в base64.

### Как отображается

Фронтенд использует значение напрямую как атрибут `src` элемента `<img>`:
```javascript
<img src=${item.photo_url || 'https://images.unsplash.com/photo-...'} />
```
Если фото нет — показывается заглушка (stock-фото с Unsplash).

### Где видно

- Карточка товара в инвентаре (вид сеткой и вид списком)
- Модальное окно редактирования товара
- Страница QC — рядом с каждой проблемой
- Страница Перефото

---

## 5. Жизненный цикл товара (статусы)

```
purchased  →  transit  →  japan_transit  →  [repair]  →  ready  →  listed  →  sold
     ↑                                          ↑↓           ↑          ↑
   (создан)                              sendToRepair    вручную    вручную
                                         completeRepair →ready
```

| Статус | Описание | Кто переводит |
|--------|----------|---------------|
| `purchased` | Только что добавлен/закуплен | Автоматически при `createPurchase` |
| `transit` | В пути (международная доставка) | Admin через `updateStatus` |
| `japan_transit` | В пути из Японии | Admin через `updateStatus` |
| `repair` | Отдан в ремонт | Admin через `sendToRepair` |
| `ready` | Готов к продаже (пришёл на склад) | Admin через `updateStatus` или `completeRepair` |
| `listed` | Выставлен на продажу (Vinted/Vestiaire) | Admin через `updateStatus` |
| `hold` | На удержании/резерве | Admin через `updateStatus` |
| `sold` | Продан | Автоматически при `recordSale` |
| `cancelled` | Отменён/возврат | Admin через `updateStatus` |

**Счётчик дней хранения (`sold_storage_days`):**
- Отсчёт начинается от `japan_arrival_date` (если `arrived_from_japan = yes`)
- Вычисляется в момент продажи: `storageStartDayGs(item)` = количество дней от даты прибытия до сегодня
- Сохраняется в `sold_storage_days` и используется в аналитике для `avg_sale_days`

---

## 6. Остаток закупа

Остаток закупа показывает сколько денег «в обороте» — либо вложено в товар на складе, либо ожидает оплаты от покупателей.

### Режим A: ручной базис (если `purchase_balance_base_is_set = yes`)

Используется когда в настройках вручную вводится сумма (Admin → Настройки → «Остаток закупа»).

```
остаток = базис
          - стоимость АКТИВНЫХ товаров, купленных ПОСЛЕ даты базиса
          - стоимость ПРОДАННЫХ товаров с money_received=NO, купленных ПОСЛЕ даты базиса
          + стоимость ПРОДАННЫХ (money_received=YES) товаров, купленных ДО базиса И проданных ПОСЛЕ базиса
```

**Объяснение логики:**
- Базис — это сумма на счету в момент установки. Например, 10 000 €.
- Каждая новая покупка уменьшает остаток (деньги ушли).
- Когда деньги от продажи пришли (`money_received = yes`) — остаток восстанавливается.
- Товары купленные до базиса уже учтены в базисе, поэтому возврат денег от их продажи прибавляется.

### Режим B: авто (если базис НЕ установлен)

```
остаток = -(стоимость всех активных товаров) - (стоимость проданных с money_received=NO)
```

Это отрицательное число — показывает сколько денег заморожено в запасах и ожидает оплаты. Например, `-5000 €` означает, что в запасах вложено 5000 €.

### Обратная совместимость

Если в Settings есть старое поле `purchase_balance_manual` (без `base_is_set`) — оно используется как статический ручной оверрайд (legacy, не рекомендуется).

### Как устанавливается

Admin → страница «Настройки» → вводит число → нажимает «Сохранить». Бэкенд вызывает `updatePurchaseBalanceManual()`:
```javascript
setSettingValue('purchase_balance_base', String(value));
setSettingValue('purchase_balance_base_at', nowIso());  // текущий момент
setSettingValue('purchase_balance_base_is_set', 'yes');
```

### Где отображается

На дашборде большим числом: «Остаток закупа». При наведении показывается дата базиса.

---

## 7. Себестоимость товара

```
total_cost = base_cost + shipping_japan + tax + shipping_spain + repair_cost
```

- `base_cost` / `buyout_price` — цена закупа на аукционе (синонимы, взаимозаменяемы)
- `shipping_japan` — доставка внутри Японии (Buyee → японский склад или напрямую)
- `tax` / `customs_tax` — налог/таможня (синонимы)
- `shipping_spain` — доставка из Японии в Испанию
- `repair_cost` — добавляется автоматически при завершении ремонта (`completeRepair`)

**Пересчёт `total_cost`:**
- При создании товара: из payload, если не передан — `base_cost`
- При редактировании (`editItem`): пересчитывается автоматически
- При завершении ремонта (`completeRepair`): пересчитывается с новым `repair_cost`

**Прибыль:**
```
profit = sale_price - total_cost - platform_fee
```

---

## 8. Логика продажи

### `recordSale(payload)` — оформить продажу

**Входные данные:** `item_number`, `sale_price`, `sale_date`, `platform`, `platform_fee`, `buyer`, `money_received`, `shipping_status`, `pre_sale_status`

**Защита от дублирования (двойная проверка):**
```javascript
if (item.status === 'sold') throw new Error('Товар уже продан...');
if (item.sale_id)           throw new Error('У товара уже есть активная продажа...');
```

**Что происходит:**
1. Проверяет что товар не продан (и по `status`, и по `sale_id`)
2. Проверяет что `sale_price > 0`
3. Генерирует уникальный `sale_id` (`sale_abc123...`)
4. Вычисляет `profit = sale_price - total_cost - platform_fee`
5. Обновляет запись в `Inventory`:
   - `status = sold`
   - `sale_id`, `sale_price`, `sale_date`, `platform`, `buyer`, `platform_fee`, `profit`
   - `money_received` (если передано)
   - `shipping_status`
6. Создаёт новую строку в листе `Sales` с полными данными
7. Записывает в `Activity Log`
8. Сбрасывает кэш

---

## 9. Отмена продажи

### `cancelSale(itemNumber, saleId)` — отменить продажу

**Поиск записи в Sales (приоритет):**
1. По переданному `saleId` параметру
2. По `item.sale_id` (если есть)
3. По последней неотменённой продаже этого товара

**Что происходит:**
1. Помечает строку в Sales: `is_cancelled = yes`, `cancelled_at = now`, `status = cancelled`, `shipping_status = cancelled`
2. Восстанавливает товар в Inventory:
   - Статус восстанавливается из `pre_sale_status` (то что было ДО продажи) или `ready` по умолчанию
   - Очищает: `sale_id`, `sale_price`, `sale_date`, `profit`, `platform_fee`
   - Сбрасывает: `money_received = no`, `shipping_status = pending`
3. Записывает в `Activity Log`
4. Сбрасывает кэш

**Идемпотентность:** если вызвать повторно — не упадёт (нет активной продажи → нечего отменять).

---

## 10. Деньги пришли

### `updateMoneyReceived(itemNumber, moneyReceived, saleId)`

Отмечает что деньги от покупателя получены.

**Особенность:** если `item.sale_id` пустой (старые данные до исправления бага) — находит запись в Sales напрямую по переданному `saleId` и обновляет её.

**Что обновляется:**
1. `Inventory.money_received = yes/no`
2. `Sales.money_received = yes/no` (через `syncSaleRecord` или прямое обновление по `sale_id`)
3. Запись в `Activity Log`

**Влияние на остаток закупа:** после установки `money_received = yes` для товара — в следующем расчёте его `total_cost` уже не будет вычитаться как «деньги в ожидании».

---

## 11. Доставка покупателю

### `updateShipping(itemNumber, shipping)`

Обновляет данные доставки покупателю.

**Входные данные:** `shipping_status`, `shipping_date`, `tracking_number`, `shipping_label_url`

**Статусы доставки:**
| Статус | Смысл |
|--------|-------|
| `pending` | Продан, но ещё не отправлен |
| `shipped` | Отправлен (есть трекинг) |
| `delivered` | Доставлен покупателю |
| `cancelled` | Доставка отменена |

**Синхронизация:** вызывает `syncSaleRecord(item)` чтобы продублировать данные доставки в лист Sales.

**QC-проверки:**
- `sold` + `shipping_status = pending` → «Продано, но не отправлено» (требует внимания)
- `shipping_status = shipped` (любой статус) → «Отправлено, но не доставлено»
- `sold` + `money_received = no` → «Продано, но деньги не зашли»

---

## 12. Ремонт

### `sendToRepair(itemNumber, masterIdOrName)`

Отправляет товар в ремонт.

**Ограничение:** нельзя отправить проданный товар в ремонт (`status === sold` или есть `sale_id`).

**Что происходит:**
1. Находит мастера из списка мастеров по `id`, или использует переданную строку как имя
2. Записывает `repair_master`, `repair_sent_date = сегодня`, `status = repair`

### `completeRepair(itemNumber, repairCost)`

Завершает ремонт.

**Что происходит:**
1. Устанавливает `repair_cost` (обновляет если передан)
2. Пересчитывает `total_cost` с учётом нового `repair_cost`
3. Устанавливает `status = ready`, `repair_finished_date = сегодня`

### Мастера ремонта

Хранятся в Settings как JSON: `[{id: "master_abc", name: "Иван", city: "Москва"}, ...]`

Admin может добавлять и удалять мастеров через страницу «Настройки».

### QC-проверка ремонта

Если `status = repair` и прошло более **14 дней** с `repair_sent_date` → «В ремонте более N дней» (попадает в «Требуют внимания»).

---

## 13. QC — «Требуют внимания»

Функция `getQCFromItems(items)` проверяет каждый товар по **8 критериям**:

| № | Условие | Причина |
|---|---------|---------|
| 1 | `photo_url` пустой (любой статус) | «Нет фото» |
| 2 | `status` ∈ {ready, listed, hold} И `description` пустой | «Нет описания» |
| 3 | `status` ∈ {ready, listed, hold} И не выставлен ни на Vinted, ни на Vestiaire | «Не выставлено ни на Vinted, ни на Vestiaire» |
| 4 | `need_rephoto = yes` (любой статус кроме cancelled) | «Нужно перефото» |
| 5 | `status = sold` И `money_received ≠ yes` | «Продано, но деньги не зашли» |
| 6 | `status = sold` И `shipping_status = pending` | «Продано, но не отправлено» |
| 7 | `shipping_status = shipped` (любой статус) | «Отправлено, но не доставлено» |
| 8 | `status = repair` И дней с отправки > 14 | «В ремонте более N дней» |

**Исключение:** товары со `status = sold` + `money_received = yes` + `shipping_status = delivered` — они полностью завершены и пропускаются.

**Связь с дашбордом:** `attention_count` на дашборде = `getQCFromItems(items).length` — всегда совпадает с количеством на странице «Контроль».

---

## 14. Аутентификация и сессии

### Вход (`login`)

1. Принимает `identity` (логин или email) + `password` + `user_agent` + `workspace_id` (опционально)
2. Нормализует `identity`: trim + toLowerCase
3. Находит пользователя в Auth Users
4. Проверяет `is_active = yes`
5. Хэширует пароль: `SHA256(salt + ":" + password)`
6. Сравнивает с `password_hash`
7. Если admin и несколько баз — возвращает `require_workspace_choice: true` + список баз
8. Создаёт сессию: `session_id = sess_uuid`, TTL = 14 дней
9. Сохраняет в `Auth Sessions`
10. Возвращает `token` (= `session_id`), данные пользователя, название базы

### Проверка токена (`requireSession`)

Каждый защищённый запрос:
1. Ищет токен в Auth Sessions
2. Проверяет что `revoked_at` пустой
3. Проверяет что `expires_at` > сейчас
4. Обновляет `last_seen_at` если прошло > 5 минут (оптимизация: не писать в Sheets на каждый запрос)
5. Возвращает объект `{token, user_id, login, email, role, workspace_id, workspace_name}`

### Выход (`logout`)

Устанавливает `revoked_at = now` в записи сессии. Токен немедленно перестаёт работать.

### Хранение на фронтенде

Токен хранится в `localStorage` под ключом `crm_session_v1`. При каждом API-вызове передаётся в теле POST-запроса как `session_token`.

### Переключение базы (`switchWorkspace`)

Только для admin. Обновляет `workspace_id` в текущей сессии — admin переходит в другую базу без выхода и повторного входа.

---

## 15. Мульти-воркспейс (базы)

### Статические базы (в коде)

```javascript
WORKSPACES: [
  { id: 'workspace_1', name: 'База с Катей' },
  { id: 'workspace_2', name: 'База с Лешей' },
  { id: 'workspace_3', name: 'База Tolkaem' },
  { id: 'workspace_4', name: 'База Автономо' }
]
```

Нельзя удалить через интерфейс (`is_static: true`).

### Динамические базы

Admin может создавать новые базы через страницу «Настройки» → «Управление базами».

**`createWorkspace(name, viewerLogin, viewerPassword)`:**
1. Проверяет уникальность имени и логина
2. Генерирует `workspace_id = workspace_uuid`
3. Добавляет в `workspaces_config` (JSON в Settings с `workspace_id = __global__`)
4. Создаёт нового viewer-пользователя для этой базы

**`deleteWorkspace(workspaceId)`:**
- Только динамические базы (не статические)
- Помечает базу как `is_deleted: true` в `workspaces_config`
- Деактивирует viewer-пользователей (`is_active = no`)
- Данные товаров **не удаляются** (только пользователи деактивируются)

**`changeViewerCredentials(workspaceId, newLogin, newPassword)`:**
Меняет логин и пароль зрителя для указанной базы. Генерирует новую соль.

---

## 16. Кэширование

**CacheService Google Apps Script**, TTL = **20 секунд**.

Ключ кэша: `crm_v1_{workspace_id}_{sheetName}`

**Что кэшируется:**
- `Inventory` (все товары текущей базы)
- `Sales` (все продажи текущей базы)
- `Activity Log`

**Инвалидация:** вызывается `invalidateSheetsCache()` после **каждой** записи/изменения. Удаляет записи для всех трёх листов текущей базы.

**Ограничение:** максимум 95 KB на запись кэша (жёсткий лимит CacheService = 100 KB, запас 5 KB).

**Зачем:** избегает повторных чтений из Sheets в пределах одного «сессионного окна» (~20 сек). Например, `getDashboard` и `getQC` вместе читают Inventory только один раз.

---

## 17. Все API-действия

### Публичные (без токена)

| Действие | Описание |
|----------|----------|
| `login` | Аутентификация. Параметры: `identity`, `password`, `user_agent`, `workspace_id` |
| `logout` | Выход. Параметры: `session_token` |
| `getSession` | Проверить/восстановить сессию. Параметры: `session_token` |
| `getSchema` | Список воркспейсов (конфиг) |

### Доступны всем авторизованным (admin + viewer)

| Действие | Описание |
|----------|----------|
| `getInventory` | Все товары текущей базы |
| `getDashboard` | Метрики дашборда |
| `getActivity` | Лог действий (последние 200) |
| `getAnalytics` | Аналитика по месяцам |
| `getQC` | Список «требуют внимания» |
| `getShippingOverview` | Обзор доставок |
| `getRepairs` | Данные ремонтов за месяц. Параметры: `month` (YYYY-MM) |
| `getSalesByMonth` | Продажи за месяц. Параметры: `month` (YYYY-MM) |
| `getItemByNumber` | Карточка одного товара. Параметры: `item_number` |
| `listWorkspaces` | Список активных баз |
| `switchWorkspace` | Переключить базу. Параметры: `workspace_id` |

### Только для admin

| Действие | Описание |
|----------|----------|
| `createPurchase` | Добавить товар. Параметры: все поля товара |
| `recordSale` | Оформить продажу. Параметры: `item_number`, `sale_price`, `sale_date`, `platform`, `platform_fee`, `buyer`, `pre_sale_status` |
| `cancelSale` | Отменить продажу. Параметры: `item_number`, `sale_id` |
| `editItem` | Редактировать карточку. Параметры: `item_number`, `updates` (объект) |
| `updateStatus` | Изменить статус. Параметры: `item_number`, `status` |
| `updatePurchaseBalance` | Установить базис остатка закупа. Параметры: `value` |
| `updateShipping` | Обновить доставку. Параметры: `item_number`, `shipping` (объект) |
| `updateMoneyReceived` | Отметить оплату. Параметры: `item_number`, `money_received`, `sale_id` |
| `sendToRepair` | Отдать в ремонт. Параметры: `item_number`, `master_id` или `master_name` |
| `completeRepair` | Завершить ремонт. Параметры: `item_number`, `repair_cost` |
| `addRepairMaster` | Добавить мастера. Параметры: `name`, `city` |
| `deleteRepairMaster` | Удалить мастера. Параметры: `id` |
| `deleteItem` | Удалить товар и продажи. Параметры: `item_number` |
| `createWorkspace` | Создать базу. Параметры: `name`, `viewer_login`, `viewer_password` |
| `deleteWorkspace` | Удалить базу. Параметры: `workspace_id` |
| `changeViewerCredentials` | Сменить логин/пароль зрителя. Параметры: `workspace_id`, `new_login`, `new_password` |

---

## 18. Страницы приложения

| Страница | Кто видит | Загружается |
|----------|-----------|-------------|
| **Дашборд** | admin + viewer | При входе (core load) |
| **Склад** | admin + viewer | При входе (core load) |
| **Продажи** | admin + viewer | Лениво (при первом открытии) |
| **Аналитика** | только admin | Лениво |
| **Контроль (QC)** | только admin | Лениво |
| **Ремонт** | только admin | Лениво |
| **История** | только admin | Лениво |
| **Перефото** | только admin | Лениво |
| **Настройки** | только admin | Лениво |

### Дашборд
Карточки метрик + кнопки быстрых действий. Метрики: остаток закупа, склад, продажи месяца, прибыль, ожидают доставки, в пути, ремонт, требуют внимания.

### Склад (Inventory)
Список всех товаров с фильтрами:
- По статусу (все / купленные / в пути / готовы / выставлены / проданы / ремонт / ...)
- Поиск по тексту (модель, номер)
- Вид: список или сетка (фото)
- Каждый товар: клик открывает модальное окно с деталями

### Продажи (Sales)
Список продаж за выбранный месяц. Чекбокс «деньги пришли» на каждой строке. Кнопка «Отменить продажу». Итоги: количество, выручка, прибыль.

### Аналитика (Analytics)
Таблица по месяцам: количество продаж, выручка, прибыль (реализованная + в обработке), средняя наценка. Итоговая строка по году.

### Контроль (QC)
Список товаров требующих внимания с причинами и фото.

### Ремонт (Repair)
Список товаров в ремонте + история ремонтов за месяц. Кнопки «Завершить ремонт». Статистика: отправлено / завершено / потрачено.

### История (Activity Log)
Хронологический лог всех действий. Последние 200 записей.

### Перефото (Rephoto)
Товары с флагом `need_rephoto = yes` — нужно переснять фото.

### Настройки (Settings)
- Установка остатка закупа
- Управление мастерами ремонта
- Управление базами (создать/удалить, сменить пароль зрителя)

---

## 19. Дашборд — метрики

| Метрика | Вычисление |
|---------|-----------|
| `active_stock` | Количество товаров с `status ∉ {sold, cancelled}` |
| `stock_value` | Сумма `total_cost` активных товаров |
| `sold_this_month` | Количество продаж в текущем месяце |
| `profit_this_month` | Прибыль по проданным с `money_received=yes` в текущем месяце |
| `profit_pending_this_month` | Прибыль по проданным с `money_received=no` в текущем месяце |
| `profit_share_each` | `profit_this_month / 3` (делится на 3 партнёра) |
| `purchase_balance` | Остаток закупа (см. раздел 6) |
| `pending_shipping` | `status=sold` И `shipping_status=pending` |
| `in_transit` | `status ∈ {transit, japan_transit}` |
| `repair_count` | `status=repair` |
| `attention_count` | `getQCFromItems(items).length` |
| `awaiting_japan` | `arrived_from_japan ≠ yes` И `status ∉ {sold, cancelled}` |
| `avg_sale_days` | Среднее `sold_storage_days` по всем проданным товарам |
| `oldest_item_days` | Максимум дней хранения среди активных товаров (с `japan_arrival_date`) |
| `avg_monthly_roi` | Среднее `(profit/cost)*100` по месяцам из истории Sales |

---

## 20. Аналитика по месяцам

**`getAnalytics()`** группирует все продажи (из Sales, не отменённые) по месяцу `sale_date`.

Для каждого месяца:

| Поле | Вычисление |
|------|-----------|
| `sold_count` | Количество продаж |
| `revenue` | Сумма `sale_price` |
| `profit` | Сумма `profit` где `money_received = yes` |
| `profit_processing` | Сумма `profit` где `money_received ≠ yes` (в обработке) |
| `potential_profit` | Сумма всего `profit` (независимо от оплаты) |
| `avg_markup` | Средняя наценка `(sale_price - total_cost) / total_cost * 100` |

**`getSalesByMonth(month)`** — детальный список продаж за конкретный месяц с summary.

---

## 21. Деплой

### Бэкенд (Google Apps Script)

1. Открыть [script.google.com](https://script.google.com)
2. Открыть проект (должен быть привязан к таблице с ID: `1N1aS17lWL1Xp7bMB9K_-AtYZSOCgpU57MvB08uJA76A`)
3. Полностью заменить содержимое `Code.gs` содержимым `apps-script/Code.gs` из репозитория
4. **Deploy → Manage deployments → Edit → New version → Deploy**
5. Тип деплоя: **Web app**, доступ: **Anyone**

⚠️ После любого изменения `Code.gs` **обязательно** создавать новую версию деплоя — иначе старый код останется активным!

### Фронтенд (GitHub Pages)

Файл `docs/src/main.js` автоматически публикуется через GitHub Pages из ветки `main`, папка `/docs`.

Перед коммитом проверить `docs/src/config.js`:
```js
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/ВАШ_ДЕПЛОЙ_ID/exec';
```

### Синхронизация фронтенд-файлов

```bash
npm run sync-frontend  # копирует web/src/main.js → docs/src/main.js
```

Оба файла (`web/src/main.js` и `docs/src/main.js`) должны быть **идентичны**.

---

*Файл создан автоматически на основе полного анализа кода `apps-script/Code.gs` и `web/src/main.js`. Актуален на 2026-03-10.*
