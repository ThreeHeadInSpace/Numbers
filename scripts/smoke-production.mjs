// Uses compiled modules and temporary SQLite. No real provider requests or credentials.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { serveStatic } from '@hono/node-server/serve-static';
import { readConfig } from '../dist/server/server/config.js';
import { createApplication } from '../dist/server/server/app.js';
const folder = mkdtempSync(join(tmpdir(), 'chisla-production-'));
const base = readConfig({
  NODE_ENV: 'test', APP_URL: 'https://production.example.test',
  DATABASE_PATH: join(folder, 'production.sqlite'),
  BETTER_AUTH_SECRET: 'compiled-smoke-only-secret-longer-than-32-characters',
  PAYMENT_MODE: 'yookassa', YOOKASSA_SHOP_ID: 'test-shop', YOOKASSA_SECRET_KEY: 'test_fake_key',
  AI_MODE: 'mock', GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret',
});
const runtime = await createApplication({ ...base, production: true, demoAuth: false });
runtime.app.get('*', serveStatic({ root: './dist/client' }));
runtime.app.get('*', serveStatic({ path: './dist/client/index.html' }));
try {
  const request = (path, method = 'GET', body) => runtime.app.request(base.appUrl + path, {
    method, headers: { origin: base.appUrl, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const home = await request('/'); const html = await home.text();
  assert.equal(home.status, 200); assert.match(html, /Числа/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  const asset = html.match(/src="([^\"]+\.js)"/)[1];
  assert.equal((await request(asset)).status, 200);
  assert.equal((await request('/fonts/Manrope.ttf')).status, 200);
  assert.equal((await request('/account')).status, 200);
  assert.equal((await request('/api/me')).status, 401);
  assert.equal((await request('/api/auth/sign-in/anonymous', 'POST', {})).status, 404);
  assert.equal((await request('/api/not-a-route')).status, 404);
  assert.equal((await request('/.env')).headers.get('content-type')?.includes('text/html'), true);
  const login = await request('/api/auth/sign-in/social', 'POST', { provider: 'google', callbackURL: base.appUrl + '/account' });
  assert.equal(login.status, 200);
  assert.ok(login.headers.getSetCookie().some(cookie => /Secure/i.test(cookie) && /HttpOnly/i.test(cookie)));
  console.log('Production smoke: compiled frontend/API, SPA routes, fonts, CSP, Secure/HttpOnly cookies and disabled demo login — PASS.');
} finally { runtime.close(); rmSync(folder, { recursive: true, force: true }); }
