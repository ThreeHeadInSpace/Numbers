import { resolve, posix } from "node:path";
import { randomBytes } from "node:crypto";

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  const appUrl = env.APP_URL || "http://localhost:3000";
  const paymentMode = env.PAYMENT_MODE || (production ? "yookassa" : "mock");
  const aiMode = env.AI_MODE || (production ? "deepseek" : "mock");
  const livePayments = env.LIVE_PAYMENTS_ENABLED === "true";
  const demoAuth = !production && env.DEMO_AUTH_ENABLED !== "false";
  const secret =
    env.BETTER_AUTH_SECRET || randomBytes(48).toString("base64url");
  const dbPath =
    env.DATABASE_PATH ||
    (production ? "/data/chisla.sqlite" : "./data/chisla.sqlite");
  if (
    !["mock", "yookassa"].includes(paymentMode) ||
    !["mock", "deepseek"].includes(aiMode)
  )
    throw new Error("Некорректный PAYMENT_MODE или AI_MODE");
  if (
    production &&
    (!appUrl.startsWith("https://") ||
      !env.BETTER_AUTH_SECRET ||
      secret.length < 32 ||
      !posix.normalize(dbPath).startsWith("/data/"))
  )
    throw new Error(
      "Production требует HTTPS APP_URL, постоянный BETTER_AUTH_SECRET (32+ символа) и DATABASE_PATH в /data/",
    );
  if (production && env.DEMO_AUTH_ENABLED === "true")
    throw new Error("Демоавторизация запрещена в production");
  if (livePayments && !production)
    throw new Error("Реальные платежи разрешены только в production с HTTPS");
  if (
    livePayments &&
    (paymentMode !== "yookassa" ||
      aiMode !== "deepseek" ||
      env.LEGAL_READY !== "true")
  )
    throw new Error(
      "Реальная оплата требует YooKassa, DeepSeek и LEGAL_READY=true",
    );
  if (
    paymentMode === "yookassa" &&
    (!env.YOOKASSA_SHOP_ID || !env.YOOKASSA_SECRET_KEY)
  )
    throw new Error("Заполните ключи тестового или реального магазина ЮKassa");
  if (
    paymentMode === "yookassa" &&
    !livePayments &&
    !env.YOOKASSA_SECRET_KEY?.startsWith("test_")
  )
    throw new Error(
      "При выключенных реальных платежах разрешён только test_ ключ ЮKassa",
    );
  if (livePayments && !env.YOOKASSA_SECRET_KEY?.startsWith("live_"))
    throw new Error("Для реальных платежей требуется live_ ключ ЮKassa");
  if (aiMode === "deepseek" && !env.DEEPSEEK_API_KEY)
    throw new Error("Заполните DEEPSEEK_API_KEY");
  if (livePayments && !env.YOOKASSA_TAX_SYSTEM_CODE)
    throw new Error(
      "Для реальной оплаты укажите YOOKASSA_TAX_SYSTEM_CODE для чеков",
    );
  if (production && paymentMode === "mock")
    throw new Error(
      "Локальная имитация платежей запрещена в production. Используйте тестовый магазин ЮKassa.",
    );
  const providers = {
    vk: !!(env.VK_CLIENT_ID && env.VK_CLIENT_SECRET),
    yandex: !!(env.YANDEX_CLIENT_ID && env.YANDEX_CLIENT_SECRET),
    google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    apple:
      env.APPLE_ENABLED === "true" &&
      !!(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET),
  };
  if (production && !Object.values(providers).some(Boolean))
    throw new Error("Для production подключите хотя бы один OAuth-провайдер");
  const port = Number(env.PORT || 3000);
  const aiTimeout = Number(env.AI_TIMEOUT_MS || 45000);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(aiTimeout) || aiTimeout < 10 || aiTimeout > 120000)
    throw new Error("Проверьте PORT (1–65535) и AI_TIMEOUT_MS (10–120000)");
  return {
    production,
    appUrl: new URL(appUrl).origin,
    port,
    dbPath: resolve(dbPath),
    secret,
    paymentMode,
    aiMode,
    livePayments,
    demoAuth,
    providers,
    price: 14900,
    shopId: env.YOOKASSA_SHOP_ID || "",
    paymentSecret: env.YOOKASSA_SECRET_KEY || "",
    taxSystemCode: Number(env.YOOKASSA_TAX_SYSTEM_CODE || 1),
    vatCode: Number(env.YOOKASSA_VAT_CODE || 1),
    aiKey: env.DEEPSEEK_API_KEY || "",
    aiTimeout,
    aiMaxTokens: 3600,
    mockAiFailure: env.MOCK_AI_FAILURE === "true",
    env,
  };
}
export type Config = ReturnType<typeof readConfig>;
