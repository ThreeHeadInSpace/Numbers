import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { generateForecast, mockForecast } from '../server/forecast.js';
import { periodParameters } from '../shared/numerology.js';

test('configured OAuth providers produce official redirects, state and PKCE; callback without state cannot sign in', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'chisla-oauth-'));
  const config = readConfig({
    NODE_ENV: 'test', APP_URL: 'http://localhost:3000', DATABASE_PATH: join(folder, 'auth.sqlite'),
    BETTER_AUTH_SECRET: 'constant-test-secret-longer-than-32-characters',
    GOOGLE_CLIENT_ID: 'test-google-id', GOOGLE_CLIENT_SECRET: 'test-google-secret',
    VK_CLIENT_ID: '123456', VK_CLIENT_SECRET: 'test-vk-secret',
    YANDEX_CLIENT_ID: 'test-yandex-id', YANDEX_CLIENT_SECRET: 'test-yandex-secret',
  });
  const runtime = await createApplication(config);
  try {
    for (const [provider, host] of [['google', 'accounts.google.com'], ['vk', 'id.vk.com'], ['yandex', 'oauth.yandex.ru']]) {
      const res = await runtime.app.request(`${config.appUrl}/api/auth/sign-in/social`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: config.appUrl },
        body: JSON.stringify({ provider, callbackURL: `${config.appUrl}/account` }),
      });
      const data = await res.json() as { url?: string };
      assert.equal(res.status, 200, JSON.stringify(data));
      const url = new URL(data.url!);
      assert.equal(url.hostname, host);
      assert.ok(url.searchParams.get('state'));
      if (provider !== 'google') assert.ok(url.searchParams.get('code_challenge'));
      assert.equal(url.searchParams.get('redirect_uri'), `${config.appUrl}/api/auth/callback/${provider}`);
    }
    const callback = await runtime.app.request(`${config.appUrl}/api/auth/callback/google?code=forged`);
    assert.notEqual(callback.status, 200);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) n FROM user').get()?.n, 0);
    assert.equal(runtime.auth.options.account?.accountLinking?.enabled, false);
  } finally { runtime.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('DeepSeek truncated JSON, wrong dates and timeouts reject rather than save a partial forecast', async () => {
  const config = readConfig({ NODE_ENV: 'test', AI_MODE: 'deepseek', DEEPSEEK_API_KEY: 'test-not-a-real-key', AI_TIMEOUT_MS: '10' });
  const params = periodParameters('1990-01-01', '2026-10-16');
  const complete = mockForecast(params);
  for (const response of [
    { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(complete) } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{invalid' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...complete, days: complete.days.map(day => ({ ...day, date: '2026-01-01' })) }) } }] },
  ]) {
    await assert.rejects(() => generateForecast(config, params, (async () => Response.json(response)) as typeof fetch));
  }
  const timeoutFetch = (async (_url: string, options: RequestInit) => {
    await new Promise<void>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Abort was not signaled')), 100);
      options.signal!.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal!.reason); }, { once: true });
    });
    return Response.json({});
  }) as typeof fetch;
  await assert.rejects(() => generateForecast(config, params, timeoutFetch), { name: 'TimeoutError' });
});
