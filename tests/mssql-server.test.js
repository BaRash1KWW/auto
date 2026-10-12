'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createMssqlApplication } = require('../src/server-mssql');

async function withMockServer(run) {
  const database = {
    async all() { return []; },
    async get() { return { value: 0 }; },
    async run() { return { changes: 1 }; },
    async transaction(work) { return work(this); },
    async checkConnection() { return { database_name: 'AutoSalonDB', login_name: 'test_login' }; },
    async close() {}
  };
  const app = createMssqlApplication({ database });
  const server = http.createServer(app.handler);
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { await run(baseUrl); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('SQL Server health endpoint reports database name', async () => {
  await withMockServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.status, 'ok');
    assert.equal(payload.databaseName, 'AutoSalonDB');
    assert.equal(payload.database, 'Microsoft SQL Server');
  });
});

test('SQL Server mode renders table routes and vehicle API', async () => {
  await withMockServer(async (baseUrl) => {
    const list = await fetch(`${baseUrl}/cars`);
    assert.equal(list.status, 200);
    assert.match(await list.text(), /Автомобили/);
    const api = await fetch(`${baseUrl}/api/cars`);
    assert.equal(api.status, 200);
    assert.deepEqual(await api.json(), []);
  });
});
