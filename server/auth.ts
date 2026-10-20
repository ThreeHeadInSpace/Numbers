import { betterAuth, type BetterAuthOptions } from "better-auth";
import { anonymous, genericOAuth } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";
import { APIError } from "better-auth/api";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.js";
import { transaction } from "./db.js";

export async function createAuth(config: Config, db: DatabaseSync) {
  const e = config.env;
  const options = {
    database: db,
    baseURL: config.appUrl,
    secret: config.secret,
    trustedOrigins: [
      config.appUrl,
      ...(config.providers.apple ? ["https://appleid.apple.com"] : []),
    ],
    socialProviders: {
      ...(config.providers.vk
        ? {
            vk: {
              clientId: e.VK_CLIENT_ID!,
              clientSecret: e.VK_CLIENT_SECRET!,
              disableDefaultScope: true,
              scope: ["email"],
            },
          }
        : {}),
      ...(config.providers.google
        ? {
            google: {
              clientId: e.GOOGLE_CLIENT_ID!,
              clientSecret: e.GOOGLE_CLIENT_SECRET!,
            },
          }
        : {}),
      ...(config.providers.apple
        ? {
            apple: {
              clientId: e.APPLE_CLIENT_ID!,
              clientSecret: e.APPLE_CLIENT_SECRET!,
              appBundleIdentifier: e.APPLE_APP_BUNDLE_ID,
            },
          }
        : {}),
    },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
    },
    advanced: {
      useSecureCookies: config.production,
      ipAddress: { ipAddressHeaders: ["x-chisla-client-ip"] },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.production,
      },
    },
    rateLimit: { enabled: true, window: 60, max: 30, storage: "database" },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          // Delete personal content, retaining only detached payment records. Exact retention must be set by the operator.
          const generating = db
            .prepare(
              "SELECT f.id FROM forecasts f JOIN orders o ON o.id=f.order_id WHERE o.user_id=? AND f.status='generating'",
            )
            .get(user.id);
          if (generating)
            throw new APIError("BAD_REQUEST", {
              message: "Дождитесь завершения генерации и повторите удаление.",
            });
          transaction(db, () => {
            db.prepare(
              "DELETE FROM forecasts WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)",
            ).run(user.id);
            db.prepare("DELETE FROM events WHERE user_id=? OR visitor_id IN (SELECT visitor_id FROM events WHERE user_id=?)").run(user.id, user.id);
            db.prepare("DELETE FROM profiles WHERE user_id=?").run(user.id);
            db.prepare(
              "DELETE FROM orders WHERE user_id=? AND mode='mock'",
            ).run(user.id);
            db.prepare(
              "UPDATE orders SET user_id=NULL, params=NULL, payment_url=NULL, creation_error=NULL, request_key=id WHERE user_id=?",
            ).run(user.id);
          });
        },
      },
    },
    plugins: [
      ...(config.demoAuth
        ? [
            anonymous({
              emailDomainName: "demo.invalid",
              generateName: () => "Исследователь",
            }),
          ]
        : []),
      ...(config.providers.yandex
        ? [
            genericOAuth({
              config: [
                {
                  providerId: "yandex",
                  clientId: e.YANDEX_CLIENT_ID!,
                  clientSecret: e.YANDEX_CLIENT_SECRET!,
                  authorizationUrl: "https://oauth.yandex.ru/authorize",
                  tokenUrl: "https://oauth.yandex.ru/token",
                  scopes: ["login:info", "login:email"],
                  pkce: true,
                  getUserInfo: async (tokens) => {
                    const response = await fetch(
                      "https://login.yandex.ru/info?format=json",
                      {
                        headers: {
                          Authorization: `OAuth ${tokens.accessToken}`,
                        },
                        signal: AbortSignal.timeout(10000),
                      },
                    );
                    if (!response.ok) return null;
                    const profile = (await response.json()) as {
                      id?: string;
                      default_email?: string;
                      display_name?: string;
                    };
                    if (!profile.id) return null;
                    return {
                      id: profile.id,
                      name: profile.display_name || "Исследователь",
                      email:
                        profile.default_email || `${profile.id}@yandex.invalid`,
                      emailVerified: false,
                    };
                  },
                },
              ],
            }),
          ]
        : []),
    ],
  } satisfies BetterAuthOptions;
  const migrations = await getMigrations(options);
  await migrations.runMigrations();
  const auth = betterAuth(options);
  await (await auth.$context).checkSchema?.();
  return auth;
}
