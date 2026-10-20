import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApplication } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { mockForecast } from "../server/forecast.js";
import type { Parameters } from "../shared/numerology.js";
import type { Order } from "../src/api.js";

const baseEnv = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "testing-secret-which-is-constant-and-long-enough",
  PAYMENT_MODE: "mock",
  AI_MODE: "mock",
};
async function fixture(
  extra: Record<string, string> = {},
  fetcher?: typeof fetch,
) {
  const folder = mkdtempSync(join(tmpdir(), "chisla-test-"));
  const config = readConfig({
    ...baseEnv,
    DATABASE_PATH: join(folder, "test.sqlite"),
    ...extra,
  });
  let runtime = await createApplication(config, { fetcher });
  function client() {
    const cookies = new Map<string, string>();
    return {
      cookies,
      async req(
        path: string,
        method = "GET",
        body?: unknown,
        origin = config.appUrl,
      ) {
        const res = await runtime.app.request(config.appUrl + path, {
          method,
          headers: {
            origin,
            "content-type": "application/json",
            cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        for (const cookie of res.headers.getSetCookie()) {
          const [pair] = cookie.split(";");
          const i = pair.indexOf("=");
          cookies.set(pair.slice(0, i), pair.slice(i + 1));
        }
        return { res, data: (await res.json()) as any };
      },
      async login() {
        const result = await this.req(
          "/api/auth/sign-in/anonymous",
          "POST",
          {},
        );
        assert.equal(result.res.status, 200, JSON.stringify(result.data));
        return result;
      },
      async order(birthDate = "1990-01-01", requestKey = randomUUID()) {
        const result = await this.req("/api/orders", "POST", {
          birthDate,
          requestKey,
          acceptTerms: true,
          amount: 1,
        });
        assert.equal(result.res.status, 200, JSON.stringify(result.data));
        return result.data as Order;
      },
    };
  }
  return {
    config,
    get runtime() {
      return runtime;
    },
    client,
    async restart() {
      runtime.close();
      runtime = await createApplication(config, { fetcher });
    },
    cleanup() {
      runtime.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

test("anonymous free calculation validates input and does not call any external API", async () => {
  let calls = 0;
  const f = await fixture({}, (async () => {
    calls++;
    throw new Error("No external calls allowed");
  }) as typeof fetch);
  try {
    const c = f.client();
    assert.equal(
      (await c.req("/api/calculate", "POST", { birthDate: "2009-11-11" })).data
        .number,
      33,
    );
    assert.equal(
      (await c.req("/api/calculate", "POST", { birthDate: "2023-02-29" })).res
        .status,
      400,
    );
    assert.equal(calls, 0);
    assert.equal(
      f.runtime.db.prepare("SELECT COUNT(*) AS n FROM profiles").get()?.n,
      0,
    );
  } finally {
    f.cleanup();
  }
});
test("API requires sessions and same-origin requests; does not expose secrets", async () => {
  const f = await fixture();
  try {
    const c = f.client();
    assert.equal((await c.req("/api/me")).res.status, 401);
    assert.equal((await c.req("/api/orders", "POST", {})).res.status, 401);
    assert.equal(
      (
        await c.req(
          "/api/calculate",
          "POST",
          { birthDate: "2000-01-01" },
          "https://attacker.example",
        )
      ).res.status,
      403,
    );
    const conf = await c.req("/api/config");
    assert.equal(JSON.stringify(conf.data).includes(f.config.secret), false);
    assert.equal("aiKey" in conf.data, false);
    assert.deepEqual(conf.data.providers, {
      vk: false,
      google: false,
      yandex: false,
      apple: false,
    });
    const login = await c.login();
    assert.ok(
      login.res.headers
        .getSetCookie()
        .some((cookie) => /HttpOnly/i.test(cookie)),
    );
    assert.ok(
      login.res.headers
        .getSetCookie()
        .some((cookie) => /SameSite=Lax/i.test(cookie)),
    );
    const other = f.client();
    await other.login();
    const order = await c.order();
    assert.equal((await other.req(`/api/orders/${order.id}`)).res.status, 404);
    assert.equal(
      (await other.req(`/api/orders/${order.id}/generate`, "POST", {})).res
        .status,
      404,
    );
    assert.equal(
      (
        await other.req(`/api/orders/${order.id}/mock-payment`, "POST", {
          outcome: "succeeded",
        })
      ).res.status,
      404,
    );
  } finally {
    f.cleanup();
  }
});
test("full demo journey: server price, idempotent order/payment, saved generation and restart persistence", async () => {
  const f = await fixture();
  try {
    const c = f.client();
    await c.login();
    assert.equal(
      (await c.req("/api/profile", "PATCH", { birthDate: "1990-01-01" })).res
        .status,
      200,
    );
    const key = randomUUID();
    const order = await c.order("1990-01-01", key);
    assert.equal(order.amount, 14900);
    assert.equal((await c.order("1990-01-01", key)).id, order.id);
    assert.equal((await c.order("1990-01-01")).id, order.id);
    assert.equal(
      (await c.req(`/api/orders/${order.id}/generate`, "POST", {})).res.status,
      403,
    );
    assert.equal(
      (await c.req(`/api/orders/${order.id}/sync`, "POST", {})).data.status,
      "pending",
    );
    await c.req(`/api/orders/${order.id}/mock-payment`, "POST", {
      outcome: "succeeded",
    });
    await c.req(`/api/orders/${order.id}/mock-payment`, "POST", {
      outcome: "succeeded",
    });
    const generated = (
      await c.req(`/api/orders/${order.id}/generate`, "POST", {})
    ).data as Order;
    assert.equal(generated.forecast?.status, "completed");
    assert.equal(generated.forecast?.mode, "mock");
    assert.equal(generated.forecast?.content?.days.length, 7);
    assert.match(generated.forecast!.content!.theme, /Демонстрационный/);
    await c.req(`/api/orders/${order.id}/generate`, "POST", {});
    assert.equal(
      f.runtime.db
        .prepare("SELECT attempts FROM forecasts WHERE order_id=?")
        .get(order.id)?.attempts,
      1,
    );
    assert.equal(
      f.runtime.db
        .prepare("SELECT count(*) n FROM events WHERE name='payment_succeeded'")
        .get()?.n,
      1,
    );
    await f.restart();
    const saved = (await c.req(`/api/orders/${order.id}`)).data as Order;
    assert.deepEqual(saved.forecast?.content, generated.forecast?.content);
    assert.equal((await c.req("/api/me")).data.birthDate, "1990-01-01");
    assert.equal(
      (await c.req("/api/account", "DELETE", { confirmation: "УДАЛИТЬ" })).res
        .status,
      200,
    );
    assert.equal((await c.req("/api/me")).res.status, 401);
    for (const table of [
      "user",
      "account",
      "session",
      "profiles",
      "forecasts",
      "orders",
    ])
      assert.equal(
        f.runtime.db.prepare(`SELECT count(*) n FROM ${table}`).get()?.n,
        0,
        table,
      );
  } finally {
    f.cleanup();
  }
});
test("canceled demo payment cannot unlock generation or be changed into paid", async () => {
  const f = await fixture();
  try {
    const c = f.client();
    await c.login();
    const order = await c.order();
    await c.req(`/api/orders/${order.id}/mock-payment`, "POST", {
      outcome: "canceled",
    });
    assert.equal(
      (
        await c.req(`/api/orders/${order.id}/mock-payment`, "POST", {
          outcome: "succeeded",
        })
      ).data.status,
      "canceled",
    );
    assert.equal(
      (await c.req(`/api/orders/${order.id}/generate`, "POST", {})).res.status,
      403,
    );
    assert.notEqual((await c.order()).id, order.id);
  } finally {
    f.cleanup();
  }
});
test("rate limiting applies to free requests", async () => {
  const f = await fixture();
  try {
    const c = f.client();
    let status = 200;
    for (let i = 0; i < 31; i++)
      status = (
        await c.req("/api/calculate", "POST", { birthDate: "1990-01-01" })
      ).res.status;
    assert.equal(status, 429);
  } finally {
    f.cleanup();
  }
});
test("AI failures preserve payment, retry works, parallel generation is locked and no PII leaves server", async () => {
  let count = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let params: Parameters;
  const fetcher = (async (_url: string, init: RequestInit) => {
    count++;
    if (count === 1)
      return Response.json({ error: "unavailable" }, { status: 503 });
    const payload = JSON.parse(init.body as string);
    params = JSON.parse(payload.messages[1].content);
    assert.equal(payload.model, "deepseek-flash");
    assert.ok(payload.max_tokens <= 4000);
    assert.equal(JSON.stringify(params).includes("1990-01-01"), false);
    assert.equal("email" in params, false);
    assert.equal("userId" in params, false);
    await gate;
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(mockForecast(params)) },
        },
      ],
    });
  }) as typeof fetch;
  const f = await fixture(
    { AI_MODE: "deepseek", DEEPSEEK_API_KEY: "test-only" },
    fetcher,
  );
  try {
    const c = f.client();
    await c.login();
    const order = await c.order();
    await c.req(`/api/orders/${order.id}/mock-payment`, "POST", {
      outcome: "succeeded",
    });
    const failed = (await c.req(`/api/orders/${order.id}/generate`, "POST", {}))
      .data as Order;
    assert.equal(failed.status, "paid");
    assert.equal(failed.forecast?.status, "failed");
    const first = c.req(`/api/orders/${order.id}/generate`, "POST", {});
    await new Promise<void>((r) => setTimeout(r, 25));
    const second = await c.req(`/api/orders/${order.id}/generate`, "POST", {});
    assert.equal(second.data.forecast.status, "generating");
    assert.equal(count, 2);
    release();
    assert.equal((await first).data.forecast.status, "completed");
    await c.req(`/api/orders/${order.id}/generate`, "POST", {});
    assert.equal(count, 2);
  } finally {
    release();
    f.cleanup();
  }
});
test("YooKassa webhook independently verifies payment and tolerates duplicates and forged status", async () => {
  let state = "pending";
  let gets = 0;
  let posts = 0;
  let orderId = "";
  let amount = "149.00";
  let paymentTest = true;
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts++;
      const body = JSON.parse(init.body as string);
      orderId = body.metadata.order_id;
      assert.equal(body.amount.value, "149.00");
      assert.ok((init.headers as Record<string, string>)["Idempotence-Key"]);
    } else {
      gets++;
      assert.ok(String(url).endsWith("/payments/yoo-test-payment"));
    }
    return Response.json({
      id: "yoo-test-payment",
      status: state,
      paid: state === "succeeded",
      test: paymentTest,
      amount: { value: amount, currency: "RUB" },
      metadata: { order_id: orderId },
      confirmation: {
        confirmation_url: "https://yookassa.ru/test-confirmation",
      },
    });
  }) as typeof fetch;
  const f = await fixture(
    {
      PAYMENT_MODE: "yookassa",
      YOOKASSA_SHOP_ID: "123",
      YOOKASSA_SECRET_KEY: "test_fake_key",
    },
    fetcher,
  );
  try {
    const c = f.client();
    await c.login();
    const order = await c.order();
    assert.equal(posts, 1);
    await c.order();
    assert.equal(posts, 1);
    const webhook = () =>
      c.req(
        "/api/payments/webhook",
        "POST",
        {
          event: "payment.succeeded",
          object: { id: "yoo-test-payment", paid: true },
        },
        "https://untrusted.example",
      );
    assert.equal((await webhook()).res.status, 200);
    assert.equal(
      (await c.req(`/api/orders/${order.id}`)).data.status,
      "pending",
    );
    state = "succeeded";
    amount = "1.00";
    assert.equal((await webhook()).res.status, 503);
    amount = "149.00";
    paymentTest = false;
    assert.equal((await webhook()).res.status, 503);
    paymentTest = true;
    assert.equal((await webhook()).res.status, 200);
    await webhook();
    assert.equal((await c.req(`/api/orders/${order.id}`)).data.status, "paid");
    assert.equal(
      f.runtime.db
        .prepare("SELECT count(*) n FROM events WHERE name='payment_succeeded'")
        .get()?.n,
      1,
    );
    assert.ok(gets >= 4);
    assert.equal(
      (
        await c.req(`/api/orders/${order.id}/mock-payment`, "POST", {
          outcome: "succeeded",
        })
      ).res.status,
      404,
    );
    await c.req("/api/account", "DELETE", { confirmation: "УДАЛИТЬ" });
    const retained = f.runtime.db
      .prepare("SELECT user_id,params,payment_url FROM orders WHERE id=?")
      .get(order.id);
    assert.deepEqual(
      { ...retained },
      { user_id: null, params: null, payment_url: null },
    );
    assert.equal(
      f.runtime.db.prepare("SELECT count(*) n FROM forecasts").get()?.n,
      0,
    );
  } finally {
    f.cleanup();
  }
});
test("startup refuses unsafe production and real-payment configurations", () => {
  assert.throws(() => readConfig({ NODE_ENV: "production" }));
  assert.throws(() =>
    readConfig({
      ...baseEnv,
      PAYMENT_MODE: "yookassa",
      YOOKASSA_SHOP_ID: "1",
      YOOKASSA_SECRET_KEY: "live_do_not_charge",
    }),
  );
  assert.throws(() =>
    readConfig({ ...baseEnv, LIVE_PAYMENTS_ENABLED: "true" }),
  );
});
