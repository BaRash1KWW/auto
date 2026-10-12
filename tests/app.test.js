'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApplication } = require('../server');

async function withServer(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autosalon-node-test-'));
  const databasePath = path.join(tempDir, 'autosalon.db');
  const { handler, database } = createApplication({ databasePath });
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run({ baseUrl, database });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('главная страница отображает стартовые показатели', async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Добро пожаловать/);
    assert.match(html, /Node\.js/);
    assert.match(html, /Автомобили/);
    assert.match(html, /ДП-2025-001/);
  });
});

test('health endpoint сообщает о Node.js-сервисе', async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.runtime, 'node.js');
  });
});

test('cars API возвращает автомобили с маркой, моделью и статусом', async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/cars`);
    const cars = await response.json();
    assert.equal(response.status, 200);
    assert.equal(cars.length, 4);
    assert.ok(cars.some((car) => car.brand === 'Toyota' && car.model === 'Camry'));
    assert.ok(cars.some((car) => ['В наличии', 'Продан'].includes(car.status)));
  });
});

test('новую марку можно создать через веб-форму', async () => {
  await withServer(async ({ baseUrl, database }) => {
    const response = await fetch(`${baseUrl}/brands/new`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Test Motors', country: 'Тестовая страна' }),
      redirect: 'manual'
    });
    assert.equal(response.status, 303);
    assert.match(response.headers.get('location'), /^\/brands\?notice=/);
    assert.equal(database.get('SELECT country FROM brands WHERE name=?', ['Test Motors']).country, 'Тестовая страна');
  });
});

test('продажа меняет статус автомобиля и не допускает повторной продажи', async () => {
  await withServer(async ({ baseUrl, database }) => {
    const first = await fetch(`${baseUrl}/sales/new`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        car_id: '1', customer_id: '2', employee_id: '1', sale_date: '2026-10-13',
        sale_price: '1750000', payment_method: 'Наличные', contract_number: 'NODE-TEST-001', notes: 'Тест'
      }),
      redirect: 'manual'
    });
    assert.equal(first.status, 303);
    assert.equal(database.get("SELECT st.name FROM cars c JOIN car_statuses st ON st.id=c.status_id WHERE c.id=1").name, 'Продан');
    assert.equal(database.get('SELECT COUNT(*) AS total FROM sales').total, 2);

    const second = await fetch(`${baseUrl}/sales/new`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        car_id: '1', customer_id: '3', employee_id: '1', sale_date: '2026-10-13',
        sale_price: '1700000', payment_method: 'Наличные', contract_number: 'NODE-TEST-002', notes: 'Повторная продажа'
      }),
      redirect: 'manual'
    });
    assert.equal(second.status, 400);
    assert.match(await second.text(), /уже существует|связанные данные|удалить связанные|выберите корректное значение/i);
    assert.equal(database.get('SELECT COUNT(*) AS total FROM sales').total, 2);
  });
});

test('ограничения SQLite не позволяют удалить марку со связанной моделью', async () => {
  await withServer(async ({ baseUrl, database }) => {
    const response = await fetch(`${baseUrl}/brands/1/delete`, { method: 'POST', redirect: 'manual' });
    assert.equal(response.status, 303);
    assert.match(response.headers.get('location'), /^\/brands\?error=/);
    assert.ok(database.get('SELECT id FROM brands WHERE id=1'));
    assert.equal(database.get('PRAGMA foreign_keys').foreign_keys, 1);
  });
});

test('неизвестный адрес возвращает страницу 404', async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/does-not-exist`);
    const html = await response.text();
    assert.equal(response.status, 404);
    assert.match(html, /Страница не найдена/);
  });
});
