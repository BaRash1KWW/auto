'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { createDatabase } = require('./src/database');
const { entities } = require('./src/entities');

const DEFAULT_DB_PATH = path.join(__dirname, 'instance', 'autosalon.db');
const MONEY_KEYS = new Set(['list_price', 'sale_price', 'cost', 'purchase_price', 'base_salary']);
const NAV_ITEMS = [
  ['/', '▦', 'Обзор'], ['/cars', '◈', 'Автомобили'], ['/sales', '↗', 'Продажи'],
  ['/customers', '♙', 'Клиенты'], ['/employees', '♧', 'Сотрудники'], ['/service-records', '⚙', 'Сервис'],
  ['/suppliers', '▤', 'Поставщики'], ['/supplier-orders', '☷', 'Заказы поставщикам'],
  ['/brands', '◇', 'Марки'], ['/models', '▧', 'Модели'], ['/positions', '♧', 'Должности'], ['/car-statuses', '●', 'Статусы авто']
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value))} ₽`;
}

function statusClass(value) {
  if (['В наличии', 'Доставлен'].includes(value)) return 'status-green';
  if (value === 'Продан') return 'status-gray';
  if (value === 'В пути') return 'status-blue';
  return 'status-orange';
}

function messageFromDbError(error) {
  const message = String(error?.message || '').toLowerCase();
  const number = Number(error?.number || error?.originalError?.info?.number || 0);
  if ([2601, 2627].includes(number) || message.includes('unique constraint') || message.includes('unique key constraint') || message.includes('duplicate key')) {
    return 'Такая запись уже существует: проверьте VIN или уникальное название.';
  }
  if (message.includes('foreign key constraint') || message.includes('foreign key') || message.includes('reference constraint')) {
    return 'Не удалось сохранить запись: связанная запись отсутствует или используется другими данными.';
  }
  if (message.includes('check constraint') || message.includes('check constraint') || number === 547) {
    return 'Одно из значений нарушает ограничение таблицы. Проверьте выбранные значения и связанные записи.';
  }
  if (number === 515 || message.includes('not null constraint') || message.includes('cannot insert the value null')) {
    return 'Заполните все обязательные поля.';
  }
  return 'Не удалось сохранить запись. Проверьте введённые значения и ограничения базы данных.';
}

function getEntity(slug) { return entities[slug] || null; }

function buildFields(database, config) {
  return config.fields.map((source) => {
    const item = { ...source };
    if (item.optionsSql) {
      item.choices = database.all(item.optionsSql).map((row) => {
        const values = Object.values(row);
        return { value: String(values[0]), label: String(values[1]) };
      });
    } else {
      item.choices = item.options || [];
    }
    return item;
  });
}

function collectFormData(fields, body) {
  const data = {};
  for (const item of fields) {
    const raw = String(body[item.name] ?? '').trim();
    if (item.required && !raw) return { error: `Заполните обязательное поле «${item.label}».` };
    if (!raw) {
      data[item.name] = item.kind === 'date' || item.kind === 'select' || (item.kind === 'number' && item.optional)
        ? null : (item.kind === 'number' ? 0 : '');
      continue;
    }
    if (item.kind === 'number') {
      const number = Number(raw);
      if (!Number.isFinite(number)) return { error: `Поле «${item.label}» должно быть числом.` };
      if (number < 0) return { error: `Поле «${item.label}» не может быть отрицательным.` };
      data[item.name] = number;
    } else if (item.kind === 'select') {
      if (!item.choices.some((option) => String(option.value) === raw)) return { error: `Выберите корректное значение для поля «${item.label}».` };
      data[item.name] = item.optionsSql ? Number(raw) : raw;
    } else {
      data[item.name] = raw;
    }
  }
  return { data };
}

function renderLayout({ title, breadcrumb, activePath, body, notice = null, error = null }) {
  const navigation = NAV_ITEMS.map(([href, icon, label]) => {
    const active = href === '/' ? activePath === '/' : activePath.startsWith(href);
    return `<a href="${href}" class="nav-link${active ? ' active' : ''}"><span class="nav-icon">${icon}</span>${label}</a>`;
  }).join('\n');
  const messages = `${notice ? `<div class="flash-stack"><div class="flash flash-success">${escapeHtml(notice)}</div></div>` : ''}${error ? `<div class="flash-stack"><div class="flash flash-error">${escapeHtml(error)}</div></div>` : ''}`;
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Учебная информационная система управления автосалоном"><title>${escapeHtml(title)} — AutoSalon</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="/static/styles.css"></head><body>
<aside class="sidebar"><a href="/" class="brand-lockup"><span class="brand-mark">A</span><span><strong>AutoSalon</strong><small>Система управления</small></span></a>
<div class="nav-caption">РАБОЧЕЕ МЕСТО</div><nav class="navigation">${navigation}</nav>
<div class="sidebar-bottom"><div class="online-dot"></div><span>Локальная база данных</span><small>Node.js · Практика №15</small></div></aside>
<main class="main-area"><header class="topbar"><div class="breadcrumb">AutoSalon <span>/</span> ${escapeHtml(breadcrumb)}</div>
<div class="profile"><span class="profile-avatar">А</span><span><strong>Администратор</strong><small>Рабочая область</small></span></div></header>
<section class="page-content">${messages}${body}</section><footer class="footer">AutoSalon <span>·</span> Учебная информационная система автосалона · Node.js</footer></main></body></html>`;
}

function pageResponse(res, status, html) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(303, { location, 'cache-control': 'no-store' });
  res.end();
}

async function readForm(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 32768) throw Object.assign(new Error('Тело запроса слишком большое.'), { statusCode: 413 });
  }
  return Object.fromEntries(new URLSearchParams(body));
}

function renderDashboard(database, query) {
  const metrics = {
    cars: database.get('SELECT COUNT(*) AS value FROM cars').value,
    available: database.get("SELECT COUNT(*) AS value FROM cars c JOIN car_statuses s ON s.id=c.status_id WHERE s.name='В наличии'").value,
    customers: database.get('SELECT COUNT(*) AS value FROM customers').value,
    sales: database.get('SELECT COUNT(*) AS value FROM sales').value,
    revenue: database.get('SELECT COALESCE(SUM(sale_price), 0) AS value FROM sales').value
  };
  const recent = database.all(`SELECT s.id, s.sale_date, s.sale_price, s.contract_number, c.full_name AS customer_name,
    b.name || ' ' || m.name AS car_name, e.full_name AS employee_name FROM sales s
    JOIN customers c ON c.id=s.customer_id JOIN cars car ON car.id=s.car_id JOIN models m ON m.id=car.model_id
    JOIN brands b ON b.id=m.brand_id JOIN employees e ON e.id=s.employee_id ORDER BY s.id DESC LIMIT 5`);
  const recentRows = recent.length ? recent.map((sale) => `<tr><td><span class="contract-tag">${escapeHtml(sale.contract_number)}</span></td>
    <td><strong>${escapeHtml(sale.car_name)}</strong><small class="table-sub">${escapeHtml(sale.customer_name)}</small></td><td>${escapeHtml(sale.sale_date)}</td>
    <td class="amount">${formatMoney(sale.sale_price)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">Продаж пока нет. Оформите первую сделку.</td></tr>';
  const body = `<div class="page-heading"><div><div class="eyebrow">ПАНЕЛЬ УПРАВЛЕНИЯ</div><h1>Добро пожаловать</h1><p>Главные показатели и последние операции автосалона.</p></div><a href="/sales/new" class="button button-primary"><span>＋</span> Оформить продажу</a></div>
  <div class="metric-grid"><article class="metric-card"><div class="metric-top"><span>Автомобили</span><span class="metric-icon icon-blue">◈</span></div><div class="metric-value">${metrics.cars}</div><div class="metric-note">Всего в системе</div></article>
  <article class="metric-card"><div class="metric-top"><span>В наличии</span><span class="metric-icon icon-green">✓</span></div><div class="metric-value">${metrics.available}</div><div class="metric-note">Доступны к продаже</div></article>
  <article class="metric-card"><div class="metric-top"><span>Клиенты</span><span class="metric-icon icon-purple">♙</span></div><div class="metric-value">${metrics.customers}</div><div class="metric-note">Зарегистрировано</div></article>
  <article class="metric-card"><div class="metric-top"><span>Сделки</span><span class="metric-icon icon-orange">↗</span></div><div class="metric-value">${metrics.sales}</div><div class="metric-note">Оформлено продаж</div></article></div>
  <div class="dashboard-columns"><section class="panel recent-panel"><div class="panel-heading"><div><h2>Последние продажи</h2><p>Недавно оформленные сделки</p></div><a class="text-link" href="/sales">Все продажи <span>→</span></a></div>
  <div class="table-wrap"><table><thead><tr><th>Договор</th><th>Автомобиль / клиент</th><th>Дата</th><th>Сумма</th></tr></thead><tbody>${recentRows}</tbody></table></div></section>
  <section class="panel quick-panel"><div class="panel-heading"><div><h2>Быстрый доступ</h2><p>Основные действия</p></div></div>
  <a href="/cars/new" class="quick-action"><span class="quick-symbol symbol-blue">＋</span><span><strong>Добавить автомобиль</strong><small>Новая позиция в каталоге</small></span><b>→</b></a>
  <a href="/customers/new" class="quick-action"><span class="quick-symbol symbol-purple">♙</span><span><strong>Новый клиент</strong><small>Создать карточку клиента</small></span><b>→</b></a>
  <a href="/service-records/new" class="quick-action"><span class="quick-symbol symbol-orange">⚙</span><span><strong>Запись в сервис</strong><small>Добавить обслуживание</small></span><b>→</b></a>
  <div class="revenue-summary"><span>Общая сумма продаж</span><strong>${formatMoney(metrics.revenue)}</strong><small>За все зарегистрированные сделки</small></div></section></div>
  <section class="module-section"><div class="section-title"><h2>Разделы системы</h2><p>Работа с основными данными автосалона</p></div><div class="module-grid">
  <a href="/cars" class="module-card"><span class="module-symbol icon-blue">◈</span><strong>Автомобили</strong><small>Каталог, цена и статус</small></a><a href="/customers" class="module-card"><span class="module-symbol icon-purple">♙</span><strong>Клиенты</strong><small>Контакты и документы</small></a>
  <a href="/employees" class="module-card"><span class="module-symbol icon-green">♧</span><strong>Сотрудники</strong><small>Должности и контакты</small></a><a href="/suppliers" class="module-card"><span class="module-symbol icon-orange">▤</span><strong>Поставщики</strong><small>Контактные данные</small></a></div></section>`;
  return renderLayout({ title: 'Обзор', breadcrumb: 'Обзор', activePath: '/', body, notice: query.get('notice'), error: query.get('error') });
}

function renderEntityList(config, rows, query) {
  const headings = config.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('');
  const dataRows = rows.map((row) => {
    const cells = config.columns.map((column) => {
      const value = row[column.key];
      let content;
      if (column.key === 'status') content = `<span class="status-pill ${statusClass(value)}">${escapeHtml(value || '—')}</span>`;
      else if (MONEY_KEYS.has(column.key) && value !== null && value !== undefined) content = `<span class="amount">${formatMoney(value)}</span>`;
      else content = escapeHtml(value === null || value === undefined || value === '' ? '—' : value);
      return `<td>${content}</td>`;
    }).join('');
    const edit = config.editable === false ? '' : `<a class="icon-button" href="${config.listPath}/${row.id}/edit" title="Редактировать" aria-label="Редактировать">✎</a>`;
    const remove = config.deletable === false ? '' : `<form method="post" action="${config.listPath}/${row.id}/delete" onsubmit="return confirm('Удалить запись №${row.id}?')"><button class="icon-button danger-button" type="submit" title="Удалить" aria-label="Удалить">×</button></form>`;
    return `<tr>${cells}<td class="row-actions">${edit}${remove}</td></tr>`;
  }).join('') || `<tr><td colspan="${config.columns.length + 1}" class="empty-state">Записей пока нет. Добавьте первую запись.</td></tr>`;
  const addButton = config.createable === false ? '' : `<a href="${config.listPath}/new" class="button button-primary"><span>＋</span> Добавить запись</a>`;
  const body = `<div class="page-heading"><div><div class="eyebrow">УПРАВЛЕНИЕ ДАННЫМИ</div><h1>${escapeHtml(config.title)}</h1><p>Просмотр и ведение записей информационной системы.</p></div>${addButton}</div>
  <section class="panel entity-panel"><div class="panel-heading entity-panel-heading"><div><h2>Список записей</h2><p>Найдено записей: ${rows.length}</p></div><div class="table-search"><span>⌕</span><input id="tableFilter" type="search" placeholder="Поиск по таблице…" aria-label="Поиск по таблице"></div></div>
  <div class="table-wrap"><table id="dataTable"><thead><tr>${headings}<th class="actions-col">Действия</th></tr></thead><tbody>${dataRows}</tbody></table></div>
  <div class="table-footer"><span>Показано: ${rows.length}</span><span>База данных SQLite <span class="footer-dot">●</span></span></div></section>
  <script>const filter=document.getElementById('tableFilter');filter.addEventListener('input',()=>{const q=filter.value.toLocaleLowerCase('ru');document.querySelectorAll('#dataTable tbody tr').forEach(row=>{row.hidden=!row.innerText.toLocaleLowerCase('ru').includes(q);});});</script>`;
  return renderLayout({ title: config.title, breadcrumb: config.title, activePath: config.listPath, body, notice: query.get('notice'), error: query.get('error') });
}

function renderEntityForm(database, config, values, recordId, error = null) {
  const fields = buildFields(database, config);
  const inputs = fields.map((item) => {
    const rawValue = values[item.name] === null || values[item.name] === undefined ? '' : String(values[item.name]);
    const required = item.required ? ' required' : '';
    const id = escapeHtml(item.name);
    let input;
    if (item.kind === 'select') {
      const choices = item.choices.map((option) => `<option value="${escapeHtml(option.value)}"${rawValue === String(option.value) ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
      input = `<select id="${id}" name="${id}"${required}><option value="">Выберите значение</option>${choices}</select>${item.choices.length ? '' : '<small class="field-help">Сначала добавьте соответствующие справочные данные.</small>'}`;
    } else if (item.kind === 'textarea') {
      input = `<textarea id="${id}" name="${id}" rows="3"${required}>${escapeHtml(rawValue)}</textarea>`;
    } else {
      const constraints = item.kind === 'number' ? ' min="0" step="any"' : '';
      const autocomplete = item.kind === 'email' ? ' autocomplete="email"' : '';
      input = `<input id="${id}" name="${id}" type="${escapeHtml(item.kind)}" value="${escapeHtml(rawValue)}"${required}${constraints}${autocomplete}>`;
    }
    return `<div class="form-field${item.kind === 'textarea' ? ' field-wide' : ''}"><label for="${id}">${escapeHtml(item.label)}${item.required ? '<span class="required-star">*</span>' : ''}</label>${input}</div>`;
  }).join('');
  const formAction = `${config.listPath}${recordId ? `/${recordId}/edit` : '/new'}`;
  const body = `<div class="page-heading"><div><div class="eyebrow">УПРАВЛЕНИЕ ДАННЫМИ</div><h1>${recordId ? 'Редактирование записи' : 'Новая запись'}</h1><p>${escapeHtml(config.title)} · Заполните поля формы и сохраните данные.</p></div><a href="${config.listPath}" class="button button-secondary">← Назад к списку</a></div>
  <section class="panel form-panel"><div class="form-intro"><span class="form-intro-icon">✎</span><div><h2>${escapeHtml(config.title)}</h2><p>Поля со звёздочкой обязательны для заполнения.</p></div></div>
  <form method="post" action="${formAction}" class="data-form">${inputs}<div class="form-actions"><a href="${config.listPath}" class="button button-secondary">Отмена</a><button class="button button-primary" type="submit">${recordId ? 'Сохранить изменения' : 'Сохранить запись'} <span>→</span></button></div></form></section>`;
  return renderLayout({ title: `${recordId ? 'Редактирование' : 'Новая запись'} · ${config.title}`, breadcrumb: `${config.title} / ${recordId ? 'Редактирование' : 'Новая запись'}`, activePath: config.listPath, body, error });
}

function render404(pathname) {
  const body = '<section class="panel error-panel"><div class="error-code">404</div><h1>Страница не найдена</h1><p>Возможно, запись была удалена или ссылка устарела.</p><a class="button button-primary" href="/">Вернуться на главную</a></section>';
  return renderLayout({ title: 'Страница не найдена', breadcrumb: 'Ошибка 404', activePath: pathname, body });
}

function createApplication(options = {}) {
  const databasePath = options.databasePath || process.env.DATABASE_PATH || DEFAULT_DB_PATH;
  const database = createDatabase(databasePath, { seed: options.seed !== false });
  const handler = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (req.method === 'GET' && pathname === '/static/styles.css') {
        const css = fs.readFileSync(path.join(__dirname, 'static', 'styles.css'));
        res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' });
        return res.end(css);
      }
      if (req.method === 'GET' && pathname === '/api/health') {
        database.get('SELECT 1 AS value');
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
        return res.end(JSON.stringify({ status: 'ok', service: 'autosalon-web', runtime: 'node.js' }));
      }
      if (req.method === 'GET' && pathname === '/api/cars') {
        const cars = database.all(`SELECT c.id, b.name AS brand, m.name AS model, c.year, c.vin, c.list_price, st.name AS status
          FROM cars c JOIN models m ON m.id=c.model_id JOIN brands b ON b.id=m.brand_id
          JOIN car_statuses st ON st.id=c.status_id ORDER BY c.id`);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
        return res.end(JSON.stringify(cars));
      }
      if (req.method === 'GET' && pathname === '/') return pageResponse(res, 200, renderDashboard(database, url.searchParams));

      const directEntity = Object.entries(entities).find(([, config]) => config.listPath === pathname);
      if (req.method === 'GET' && directEntity) {
        const [, config] = directEntity;
        return pageResponse(res, 200, renderEntityList(config, database.all(config.listSql), url.searchParams));
      }

      const formRoute = pathname.match(/^(.+)\/new$/);
      if (formRoute) {
        const config = getEntity(formRoute[1].slice(1));
        if (!config || config.createable === false) return pageResponse(res, 404, render404(pathname));
        if (req.method === 'GET') return pageResponse(res, 200, renderEntityForm(database, config, {}, null, url.searchParams.get('error')));
        if (req.method === 'POST') {
          const body = await readForm(req);
          const fields = buildFields(database, config);
          const result = collectFormData(fields, body);
          if (result.error) return pageResponse(res, 400, renderEntityForm(database, config, body, null, result.error));
          const data = result.data;
          const names = Object.keys(data);
          try {
            database.raw.exec('BEGIN');
            database.run(`INSERT INTO ${config.table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`, names.map((name) => data[name]));
            if (formRoute[1].slice(1) === 'sales') {
              const sold = database.get("SELECT id FROM car_statuses WHERE name='Продан'");
              if (sold) database.run('UPDATE cars SET status_id=? WHERE id=?', [sold.id, data.car_id]);
            }
            database.raw.exec('COMMIT');
            return redirect(res, `${config.listPath}?notice=${encodeURIComponent('Запись успешно добавлена.')}`);
          } catch (error) {
            try { database.raw.exec('ROLLBACK'); } catch { /* rollback is best-effort */ }
            return pageResponse(res, 400, renderEntityForm(database, config, body, null, messageFromDbError(error)));
          }
        }
      }

      const editRoute = pathname.match(/^(.+)\/(\d+)\/edit$/);
      if (editRoute) {
        const config = getEntity(editRoute[1].slice(1));
        const recordId = Number(editRoute[2]);
        if (!config || config.editable === false) return pageResponse(res, 404, render404(pathname));
        const current = database.get(`SELECT * FROM ${config.table} WHERE id=?`, [recordId]);
        if (!current) return pageResponse(res, 404, render404(pathname));
        if (req.method === 'GET') return pageResponse(res, 200, renderEntityForm(database, config, current, recordId));
        if (req.method === 'POST') {
          const body = await readForm(req);
          const fields = buildFields(database, config);
          const result = collectFormData(fields, body);
          if (result.error) return pageResponse(res, 400, renderEntityForm(database, config, body, recordId, result.error));
          const data = result.data;
          const names = Object.keys(data);
          try {
            database.run(`UPDATE ${config.table} SET ${names.map((name) => `${name}=?`).join(', ')} WHERE id=?`, [...names.map((name) => data[name]), recordId]);
            return redirect(res, `${config.listPath}?notice=${encodeURIComponent('Изменения сохранены.')}`);
          } catch (error) {
            return pageResponse(res, 400, renderEntityForm(database, config, body, recordId, messageFromDbError(error)));
          }
        }
      }

      const deleteRoute = pathname.match(/^(.+)\/(\d+)\/delete$/);
      if (req.method === 'POST' && deleteRoute) {
        const config = getEntity(deleteRoute[1].slice(1));
        if (!config || config.deletable === false) return pageResponse(res, 404, render404(pathname));
        const recordId = Number(deleteRoute[2]);
        try {
          const result = database.run(`DELETE FROM ${config.table} WHERE id=?`, [recordId]);
          const notice = result.changes ? 'Запись удалена.' : 'Запись не найдена.';
          return redirect(res, `${config.listPath}?notice=${encodeURIComponent(notice)}`);
        } catch (error) {
          const message = messageFromDbError(error);
          const friendly = message.startsWith('Не удалось сохранить') ? 'Нельзя удалить запись: сначала измените или удалите связанные данные.' : message;
          return redirect(res, `${config.listPath}?error=${encodeURIComponent(friendly)}`);
        }
      }

      return pageResponse(res, 404, render404(pathname));
    } catch (error) {
      console.error(error);
      const status = error.statusCode || 500;
      return pageResponse(res, status, renderLayout({ title: 'Ошибка сервера', breadcrumb: 'Ошибка', activePath: '', body: `<section class="panel error-panel"><h1>Не удалось обработать запрос</h1><p>${escapeHtml(status === 413 ? 'Слишком большой запрос.' : 'Проверьте журналы приложения.')}</p><a class="button button-primary" href="/">Вернуться на главную</a></section>` }));
    }
  };
  return { handler, database };
}

module.exports = { createApplication, escapeHtml, formatMoney, messageFromDbError, render404 };

if (require.main === module) {
  // Load .env for local development; Docker Compose may inject the same values directly.
  try { require('dotenv').config(); } catch { /* dotenv is a declared dependency; keep startup errors readable below */ }
  if (String(process.env.DB_CLIENT || 'sqlite').toLowerCase() === 'mssql') {
    require('./src/server-mssql').start();
  } else {
    const { handler, database } = createApplication();
    const port = Number(process.env.PORT || 5000);
    const host = process.env.HOST || '0.0.0.0';
    const server = http.createServer(handler);
    server.listen(port, host, () => console.log(`AutoSalon Web на Node.js: http://${host}:${port}`));
    const shutdown = () => server.close(() => { database.close(); process.exit(0); });
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

