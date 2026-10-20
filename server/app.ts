import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { getCookie, setCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createAuth } from "./auth.js";
import { openDatabase, migrateApp, transaction } from "./db.js";
import {
  calculateLifePath,
  periodParameters,
  validateBirthDate,
  type Parameters,
} from "../shared/numerology.js";
import { generateForecast } from "./forecast.js";
import { validatePayment, yooRequest } from "./payments.js";
import type { Config } from "./config.js";

type Order = {
  id: string;
  user_id: string | null;
  amount: number;
  status: "pending" | "paid" | "canceled";
  payment_id: string | null;
  payment_url: string | null;
  mode: string;
  idempotency_key: string;
  params: string | null;
  period_start: string;
  period_end: string;
  created_at: string;
  paid_at: string | null;
  creation_error: string | null;
  terms_version: string;
  request_key: string;
};
type ForecastRow = {
  id: string;
  order_id: string;
  status: string;
  content: string | null;
  mode: string | null;
  error: string | null;
  attempts: number;
};
const now = () => new Date().toISOString();
const termsVersion = "2026-10-16";
const safeId = z.string().uuid();

export async function createApplication(
  config: Config,
  dependencies: { fetcher?: typeof fetch } = {},
) {
  const db = openDatabase(config.dbPath);
  const auth = await createAuth(config, db);
  migrateApp(db);
  db.prepare(
    "UPDATE forecasts SET status='failed', error='Генерация была прервана перезапуском. Повторите бесплатно.' WHERE status='generating'",
  ).run();
  const fetcher = dependencies.fetcher || fetch;
  const orderMode =
    config.paymentMode === "mock"
      ? "mock"
      : config.livePayments
        ? "yookassa_live"
        : "yookassa_test";
  const app = new Hono();
  const limits = new Map<string, { count: number; until: number }>();
  let lastCleanup = 0;
  function rate(key: string, max: number, window = 60000) {
    const time = Date.now();
    if (time - lastCleanup > 60000) {
      for (const [k, v] of limits) if (v.until < time) limits.delete(k);
      lastCleanup = time;
    }
    const bucket = limits.get(key);
    if (bucket && bucket.until > time) {
      if (bucket.count >= max)
        throw new HTTPException(429, {
          message: "Слишком много запросов. Подождите минуту.",
        });
      bucket.count++;
    } else {
      if (limits.size >= 10000)
        throw new HTTPException(429, {
          message: "Сервис занят. Попробуйте позже.",
        });
      limits.set(key, { count: 1, until: time + window });
    }
  }
  async function session(c: Context) {
    return auth.api.getSession({ headers: c.req.raw.headers });
  }
  async function requireUser(c: Context) {
    const s = await session(c);
    if (!s)
      throw new HTTPException(401, {
        message: "Войдите, чтобы открыть личный кабинет.",
      });
    return s.user;
  }
  function visitor(c: Context) {
    const existing = getCookie(c, "chisla_visitor");
    if (existing && safeId.safeParse(existing).success) return existing;
    const id = randomUUID();
    setCookie(c, "chisla_visitor", id, {
      httpOnly: true,
      sameSite: "Lax",
      secure: config.production,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return id;
  }
  function event(
    name: string,
    userId: string | null,
    orderId: string | null,
    visitorId: string | null = null,
    utm: unknown = null,
  ) {
    if (orderId && !visitorId)
      visitorId =
        (
          db
            .prepare(
              "SELECT visitor_id FROM events WHERE name='order_created' AND order_id=?",
            )
            .get(orderId) as { visitor_id?: string } | undefined
        )?.visitor_id || null;
    db.prepare(
      "INSERT OR IGNORE INTO events(name,user_id,order_id,visitor_id,utm,created_at) VALUES (?,?,?,?,?,?)",
    ).run(
      name,
      userId,
      orderId,
      visitorId,
      utm ? JSON.stringify(utm) : null,
      now(),
    );
  }
  function ownedOrder(id: string, userId: string) {
    const order = db
      .prepare("SELECT * FROM orders WHERE id=? AND user_id=?")
      .get(id, userId) as Order | undefined;
    if (!order) throw new HTTPException(404, { message: "Заказ не найден." });
    return order;
  }
  function publicOrder(order: Order) {
    const forecast = db
      .prepare("SELECT * FROM forecasts WHERE order_id=?")
      .get(order.id) as ForecastRow | undefined;
    return {
      id: order.id,
      amount: order.amount,
      status: order.status,
      paymentUrl: order.payment_url,
      mode: order.mode,
      start: order.period_start,
      end: order.period_end,
      createdAt: order.created_at,
      paymentError: order.creation_error
        ? "Не удалось создать платёж. Повторите — повторного списания не будет."
        : null,
      forecast: forecast
        ? {
            id: forecast.id,
            status: forecast.status,
            mode: forecast.mode,
            error: forecast.error,
            content: forecast.content ? JSON.parse(forecast.content) : null,
          }
        : null,
    };
  }
  async function syncPayment(order: Order) {
    if (order.mode === "mock" || !order.payment_id || order.status === "paid")
      return;
    if (order.mode !== orderMode) throw new Error("ORDER_ENVIRONMENT_MISMATCH");
    const payment = await yooRequest(
      config,
      `payments/${encodeURIComponent(order.payment_id)}`,
      fetcher,
    );
    validatePayment(config, payment, order);
    transaction(db, () => {
      db.prepare("INSERT OR IGNORE INTO payment_events VALUES (?,?,?)").run(
        payment.id,
        payment.status,
        now(),
      );
      if (payment.status === "succeeded" && payment.paid === true) {
        const updated = db
          .prepare(
            "UPDATE orders SET status='paid',paid_at=?,payment_url=NULL WHERE id=? AND status='pending'",
          )
          .run(now(), order.id);
        if (updated.changes)
          event("payment_succeeded", order.user_id, order.id);
      } else if (payment.status === "canceled") {
        db.prepare(
          "UPDATE orders SET status='canceled',payment_url=NULL WHERE id=? AND status='pending'",
        ).run(order.id);
      }
    });
  }
  async function createPayment(order: Order, email: string) {
    if (order.mode !== orderMode)
      throw new HTTPException(409, {
        message:
          "Этот заказ создан в другом режиме магазина. Обратитесь в поддержку.",
      });
    if (order.payment_id || order.status !== "pending") return;
    if (Date.now() - Date.parse(order.created_at) > 23 * 3600000)
      throw new HTTPException(409, {
        message:
          "Старый платёж требует проверки поддержки. Новый платёж для него не создаётся.",
      });
    if (order.mode === "mock") {
      db.prepare("UPDATE orders SET payment_id=?,payment_url=? WHERE id=?").run(
        `mock_${order.id}`,
        `/checkout/${order.id}`,
        order.id,
      );
      return;
    }
    // The same order always uses the same key and payload, including after an interrupted response.
    try {
      const payment = await yooRequest(
        config,
        "payments",
        fetcher,
        {
          amount: { value: (order.amount / 100).toFixed(2), currency: "RUB" },
          capture: true,
          confirmation: {
            type: "redirect",
            return_url: `${config.appUrl}/account?order=${order.id}`,
          },
          description: "Персональный нумерологический прогноз на 7 дней",
          metadata: { order_id: order.id },
          ...(config.livePayments
            ? {
                receipt: {
                  customer: { email },
                  tax_system_code: config.taxSystemCode,
                  items: [
                    {
                      description: "Нумерологический прогноз на 7 дней",
                      quantity: "1.00",
                      amount: {
                        value: (order.amount / 100).toFixed(2),
                        currency: "RUB",
                      },
                      vat_code: config.vatCode,
                      payment_subject: "service",
                      payment_mode: "full_payment",
                    },
                  ],
                },
              }
            : {}),
        },
        order.idempotency_key,
      );
      validatePayment(config, payment, { ...order, payment_id: payment.id });
      if (!payment.confirmation?.confirmation_url?.startsWith("https://"))
        throw new Error("INVALID_PAYMENT_URL");
      db.prepare(
        "UPDATE orders SET payment_id=?,payment_url=?,creation_error=NULL WHERE id=?",
      ).run(payment.id, payment.confirmation.confirmation_url, order.id);
    } catch {
      db.prepare(
        "UPDATE orders SET creation_error='provider_unavailable' WHERE id=?",
      ).run(order.id);
      throw new HTTPException(502, {
        message:
          "ЮKassa временно недоступна. Заказ сохранён; повторите оплату из кабинета.",
      });
    }
  }

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: config.production
        ? {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            fontSrc: ["'self'"],
            connectSrc: ["'self'"],
            frameAncestors: ["'none'"],
            formAction: ["'self'", "https://appleid.apple.com"],
          }
        : undefined,
      referrerPolicy: "strict-origin-when-cross-origin",
    }),
  );
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 16384,
      onError: (c) => c.json({ error: "Слишком большой запрос." }, 413),
    }),
  );
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (c.req.path === "/api/payments/webhook") {
      await next();
      return;
    }
    let address = "127.0.0.1";
    try {
      address = getConnInfo(c).remote.address || address;
    } catch {
      /* app.request in tests has no socket */
    }
    if (config.env.TRUST_PROXY === "true")
      address =
        c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() || address;
    // Never accept this internal header from the client. Better Auth uses only the server-resolved value.
    c.req.raw.headers.set("x-chisla-client-ip", address);
    const fingerprint = createHash("sha256")
      .update(config.secret + address)
      .digest("hex")
      .slice(0, 24);
    rate(`ip:${fingerprint}`, 180);
    if (
      !c.req.path.startsWith("/api/auth/") &&
      !["GET", "HEAD", "OPTIONS"].includes(c.req.method)
    ) {
      if (c.req.header("origin") !== config.appUrl)
        throw new HTTPException(403, {
          message: "Источник запроса не разрешён.",
        });
      if (!c.req.header("content-type")?.includes("application/json"))
        throw new HTTPException(415, { message: "Ожидается JSON." });
    }
    if (c.req.path === "/api/calculate") rate(`free:${fingerprint}`, 30);
    await next();
  });
  app.get("/api/health", (c) => {
    db.prepare("SELECT 1").get();
    return c.json({ status: "ok" });
  });
  app.get("/api/config", (c) =>
    c.json({
      price: config.price,
      paymentMode: config.paymentMode,
      aiMode: config.aiMode,
      livePayments: config.livePayments,
      demoAuth: config.demoAuth,
      providers: config.providers,
      legalReady: config.env.LEGAL_READY === "true",
    }),
  );
  app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
  app.post("/api/events", async (c) => {
    const input = z
      .object({
        name: z.enum(["landing_view", "purchase_click"]),
        utm: z.record(z.string(), z.string().max(100)).optional(),
      })
      .parse(await c.req.json());
    const utm = Object.fromEntries(
      Object.entries(input.utm || {})
        .filter(([key]) =>
          [
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_content",
            "utm_term",
          ].includes(key),
        )
        .map(([k, v]) => [
          k,
          v.replace(/[^а-яёa-z0-9_. -]/gi, "").slice(0, 100),
        ]),
    );
    event(
      input.name,
      (await session(c))?.user.id || null,
      null,
      visitor(c),
      utm,
    );
    return c.json({ ok: true });
  });
  app.post("/api/calculate", async (c) => {
    const body = z.object({ birthDate: z.string() }).parse(await c.req.json());
    event("calculation_started", null, null, visitor(c));
    let result;
    try {
      result = calculateLifePath(body.birthDate);
    } catch (e) {
      throw new HTTPException(400, { message: (e as Error).message });
    }
    event("free_result", null, null, visitor(c));
    return c.json(result);
  });
  app.get("/api/me", async (c) => {
    const user = await requireUser(c);
    const profile = db
      .prepare("SELECT birth_date FROM profiles WHERE user_id=?")
      .get(user.id) as { birth_date: string } | undefined;
    const orders = db
      .prepare(
        "SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
      )
      .all(user.id) as Order[];
    return c.json({
      user: { name: user.name, image: user.image },
      birthDate: profile?.birth_date || null,
      orders: orders.map(publicOrder),
    });
  });
  app.patch("/api/profile", async (c) => {
    const user = await requireUser(c);
    const { birthDate } = z
      .object({ birthDate: z.string().nullable() })
      .parse(await c.req.json());
    try {
      if (birthDate) validateBirthDate(birthDate);
    } catch (e) {
      throw new HTTPException(400, { message: (e as Error).message });
    }
    db.prepare(
      "INSERT INTO profiles VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET birth_date=excluded.birth_date,updated_at=excluded.updated_at",
    ).run(user.id, birthDate, now());
    return c.json({ ok: true });
  });
  app.post("/api/orders", async (c) => {
    const user = await requireUser(c);
    rate(`orders:${user.id}`, 6);
    const input = z
      .object({
        birthDate: z.string(),
        requestKey: safeId,
        acceptTerms: z.literal(true),
      })
      .parse(await c.req.json());
    if (config.livePayments && (!user.email || user.email.endsWith(".invalid")))
      throw new HTTPException(400, {
        message:
          "Для электронного чека необходим email аккаунта. Войдите через провайдера, который передаёт email.",
      });
    let params: Parameters;
    try {
      params = periodParameters(
        input.birthDate,
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Moscow",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
      );
    } catch (e) {
      throw new HTTPException(400, { message: (e as Error).message });
    }
    const snapshot = JSON.stringify(params);
    let order = db
      .prepare(
        "SELECT * FROM orders WHERE user_id=? AND (request_key=? OR (mode=? AND period_start=? AND params=? AND status IN ('pending','paid'))) ORDER BY created_at DESC LIMIT 1",
      )
      .get(user.id, input.requestKey, orderMode, params.start, snapshot) as
      Order | undefined;
    if (!order) {
      const id = randomUUID();
      transaction(db, () => {
        db.prepare(
          "INSERT INTO orders(id,user_id,amount,status,mode,idempotency_key,params,period_start,period_end,created_at,terms_version,request_key) VALUES (?,?,?,'pending',?,?,?,?,?,?,?,?)",
        ).run(
          id,
          user.id,
          config.price,
          orderMode,
          randomUUID(),
          snapshot,
          params.start,
          params.end,
          now(),
          termsVersion,
          input.requestKey,
        );
        db.prepare(
          "INSERT INTO forecasts(id,order_id,status) VALUES (?,?,'pending')",
        ).run(randomUUID(), id);
        event("order_created", user.id, id, visitor(c));
      });
      order = ownedOrder(id, user.id);
    }
    await createPayment(order, user.email);
    return c.json(publicOrder(ownedOrder(order.id, user.id)));
  });
  app.get("/api/orders/:id", async (c) => {
    const user = await requireUser(c);
    return c.json(publicOrder(ownedOrder(c.req.param("id"), user.id)));
  });
  app.post("/api/orders/:id/checkout", async (c) => {
    const user = await requireUser(c);
    rate(`checkout:${user.id}`, 10);
    const order = ownedOrder(c.req.param("id"), user.id);
    // YooKassa remembers idempotency keys for 24 h. Never blindly recreate an unresolved old payment.
    if (
      !order.payment_id &&
      Date.now() - Date.parse(order.created_at) > 23 * 3600000
    )
      throw new HTTPException(409, {
        message:
          "Старый платёж требует проверки поддержки. Новый платёж для него не создаётся.",
      });
    await createPayment(order, user.email);
    return c.json(publicOrder(ownedOrder(order.id, user.id)));
  });
  app.post("/api/orders/:id/sync", async (c) => {
    const user = await requireUser(c);
    rate(`sync:${user.id}`, 30);
    const order = ownedOrder(c.req.param("id"), user.id);
    try {
      await syncPayment(order);
    } catch {
      throw new HTTPException(502, {
        message: "Не удалось проверить оплату. Повторите позже.",
      });
    }
    return c.json(publicOrder(ownedOrder(order.id, user.id)));
  });
  app.post("/api/payments/webhook", async (c) => {
    const input = z
      .object({
        event: z.string().max(100),
        object: z.object({ id: z.string().max(100) }),
      })
      .parse(await c.req.json());
    const order = db
      .prepare("SELECT * FROM orders WHERE payment_id=? AND mode=?")
      .get(input.object.id, orderMode) as Order | undefined;
    if (
      !order ||
      ![
        "payment.succeeded",
        "payment.canceled",
        "payment.waiting_for_capture",
      ].includes(input.event)
    )
      return c.json({ ok: true });
    rate(`webhook:${order.id}`, 60);
    try {
      await syncPayment(order);
    } catch {
      return c.json({ error: "Повторите уведомление позже." }, 503);
    }
    return c.json({ ok: true });
  });
  app.post("/api/orders/:id/mock-payment", async (c) => {
    const user = await requireUser(c);
    rate(`mockpay:${user.id}`, 20);
    if (config.production || config.paymentMode !== "mock")
      throw new HTTPException(404);
    const order = ownedOrder(c.req.param("id"), user.id);
    const { outcome } = z
      .object({ outcome: z.enum(["succeeded", "canceled"]) })
      .parse(await c.req.json());
    transaction(db, () => {
      if (order.status !== "pending") return;
      db.prepare(
        "UPDATE orders SET status=?,paid_at=?,payment_url=NULL WHERE id=?",
      ).run(
        outcome === "succeeded" ? "paid" : "canceled",
        outcome === "succeeded" ? now() : null,
        order.id,
      );
      db.prepare("INSERT OR IGNORE INTO payment_events VALUES (?,?,?)").run(
        order.payment_id!,
        outcome,
        now(),
      );
      if (outcome === "succeeded")
        event("payment_succeeded", user.id, order.id);
    });
    return c.json(publicOrder(ownedOrder(order.id, user.id)));
  });
  app.post("/api/orders/:id/generate", async (c) => {
    const user = await requireUser(c);
    rate(`generation:${user.id}`, 8);
    const order = ownedOrder(c.req.param("id"), user.id);
    if (order.status !== "paid")
      throw new HTTPException(403, {
        message: "Прогноз доступен после подтверждения оплаты.",
      });
    const forecast = db
      .prepare("SELECT * FROM forecasts WHERE order_id=?")
      .get(order.id) as ForecastRow;
    if (forecast.status === "completed" || forecast.status === "generating")
      return c.json(publicOrder(order));
    if (order.mode !== orderMode)
      throw new HTTPException(409, {
        message:
          "Заказ из другого режима магазина. Новая генерация для него недоступна; сохранённый прогноз остаётся в кабинете.",
      });
    const lock = db
      .prepare(
        "UPDATE forecasts SET status='generating',started_at=?,attempts=attempts+1,error=NULL WHERE order_id=? AND status IN ('pending','failed')",
      )
      .run(now(), order.id);
    if (!lock.changes) return c.json(publicOrder(order));
    try {
      const content = await generateForecast(
        config,
        JSON.parse(order.params!) as Parameters,
        fetcher,
      );
      transaction(db, () => {
        db.prepare(
          "UPDATE forecasts SET status='completed',content=?,mode=?,completed_at=?,error=NULL WHERE order_id=?",
        ).run(JSON.stringify(content), config.aiMode, now(), order.id);
        event("generation_succeeded", user.id, order.id);
      });
    } catch {
      db.prepare(
        "UPDATE forecasts SET status='failed',error='Не удалось подготовить прогноз. Оплата сохранена. Попробуйте ещё раз без доплаты.' WHERE order_id=?",
      ).run(order.id);
    }
    return c.json(publicOrder(ownedOrder(order.id, user.id)));
  });
  app.delete("/api/account", async (c) => {
    await requireUser(c);
    const { confirmation } = z
      .object({ confirmation: z.literal("УДАЛИТЬ") })
      .parse(await c.req.json());
    if (!confirmation) throw new HTTPException(400);
    const response = await auth.api.deleteUser({
      headers: c.req.raw.headers,
      body: {},
      asResponse: true,
    });
    return response;
  });
  app.all("/api/*", (c) => c.json({ error: "Маршрут не найден." }, 404));
  app.onError((error, c) => {
    if (error instanceof HTTPException)
      return c.json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return c.json({ error: "Проверьте введённые данные." }, 400);
    // No raw errors, request bodies, OAuth tokens, or personal data in application logs.
    console.error("API_REQUEST_FAILED");
    return c.json(
      { error: "Не удалось выполнить запрос. Попробуйте ещё раз." },
      500,
    );
  });
  return { app, db, auth, close: () => db.close() };
}
