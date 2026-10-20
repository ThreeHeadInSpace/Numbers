import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoApi } from "../src/demo/api.js";
import { createNavigation } from "../src/navigation.js";
import type { Me, Order, PublicConfig } from "../src/api.js";
import type { FreeResult } from "../shared/numerology.js";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test("Pages routes stay below /Numbers/ and preserve deep links, query strings and anchors", () => {
  const nav = createNavigation(true, "/Numbers/");
  assert.equal(nav.href("/"), "/Numbers/");
  assert.equal(
    nav.href("/account?order=demo"),
    "/Numbers/#/account?order=demo",
  );
  assert.equal(nav.href("/legal/privacy"), "/Numbers/#/legal/privacy");
  assert.equal(nav.href("/#weekly"), "/Numbers/#weekly");
  assert.equal(
    nav.path({ pathname: "/Numbers/", search: "", hash: "#/forecast/demo" }),
    "/forecast/demo",
  );
  assert.equal(
    nav.search({
      pathname: "/Numbers/",
      search: "",
      hash: "#/account?order=demo",
    }),
    "?order=demo",
  );
  assert.equal(
    nav.path({ pathname: "/Numbers/", search: "", hash: "#weekly" }),
    "/",
  );
  const production = createNavigation(false);
  assert.equal(production.href("/account?order=123"), "/account?order=123");
  assert.equal(
    production.href("https://yookassa.ru/example"),
    "https://yookassa.ru/example",
  );
  assert.equal(
    production.path({ pathname: "/account", search: "?order=123", hash: "" }),
    "/account",
  );
  assert.equal(
    production.search({ pathname: "/account", search: "?order=123", hash: "" }),
    "?order=123",
  );
});

test("static demo completes calculation, sample cabinet, payment and saved forecast without network", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Static demo must never call HTTP");
  };
  try {
    const store = storage();
    const now = () => new Date("2026-10-21T10:00:00Z");
    const request = createDemoApi(store, now, 0);
    const config = (await request("/api/config")) as PublicConfig;
    assert.equal(config.livePayments, false);
    assert.equal(config.paymentMode, "mock");
    assert.ok(Object.values(config.providers).every((enabled) => !enabled));
    assert.equal(
      (
        (await request("/api/calculate", "POST", {
          birthDate: "2009-11-11",
        })) as FreeResult
      ).number,
      33,
    );
    await assert.rejects(
      request("/api/calculate", "POST", { birthDate: "2001-02-29" }),
      { status: 400 },
    );
    await assert.rejects(request("/api/me"), { status: 401 });
    await request("/api/auth/sign-in/anonymous", "POST", {});
    const sample = (await request("/api/me")) as Me;
    assert.match(sample.user.name, /демо/);
    assert.equal(sample.orders[0].forecast?.content?.days.length, 7);
    const input = {
      birthDate: "1990-01-01",
      requestKey: "demo-click-1",
      acceptTerms: true,
      amount: 1,
    };
    const order = (await request("/api/orders", "POST", input)) as Order;
    assert.equal(order.amount, 14900);
    assert.equal(
      ((await request("/api/orders", "POST", input)) as Order).id,
      order.id,
    );
    await assert.rejects(
      request(`/api/orders/${order.id}/generate`, "POST", {}),
      { status: 403 },
    );
    await request(`/api/orders/${order.id}/mock-payment`, "POST", {
      outcome: "succeeded",
    });
    const ready = (await request(
      `/api/orders/${order.id}/generate`,
      "POST",
      {},
    )) as Order;
    assert.equal(ready.forecast?.status, "completed");
    assert.equal(ready.forecast?.mode, "mock");
    assert.equal(ready.forecast?.content?.days.length, 7);
    const reopened = createDemoApi(store, now, 0);
    assert.deepEqual(
      ((await reopened(`/api/orders/${order.id}`)) as Order).forecast?.content,
      ready.forecast?.content,
    );
    await assert.rejects(
      request("/api/auth/sign-in/social", "POST", { provider: "google" }),
      { status: 400 },
    );
    await assert.rejects(request("/api/payments/webhook", "POST", {}), {
      status: 404,
    });
    await request("/api/profile", "PATCH", { birthDate: null });
    assert.equal(((await request("/api/me")) as Me).birthDate, null);
    await request("/api/account", "DELETE", { confirmation: "УДАЛИТЬ" });
    await assert.rejects(request("/api/me"), { status: 401 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("static demo handles canceled payments and unavailable browser storage safely", async () => {
  const request = createDemoApi(
    {
      getItem() {
        throw new Error("Blocked");
      },
      setItem() {
        throw new Error("Blocked");
      },
      removeItem() {},
    },
    () => new Date("2026-10-21T10:00:00Z"),
    0,
  );
  await request("/api/auth/sign-in/anonymous", "POST", {});
  const order = (await request("/api/orders", "POST", {
    birthDate: "1990-01-01",
    requestKey: "canceled",
    acceptTerms: true,
  })) as Order;
  await request(`/api/orders/${order.id}/mock-payment`, "POST", {
    outcome: "canceled",
  });
  await request(`/api/orders/${order.id}/mock-payment`, "POST", {
    outcome: "succeeded",
  });
  assert.equal(
    ((await request(`/api/orders/${order.id}`)) as Order).status,
    "canceled",
  );
  await assert.rejects(
    request(`/api/orders/${order.id}/generate`, "POST", {}),
    { status: 403 },
  );
});
