import { serve, getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createServer } from "node:http";
import { readConfig } from "./config.js";
import { createApplication } from "./app.js";

const config = readConfig({
  ...process.env,
  NODE_ENV:
    process.env.NODE_ENV ||
    (import.meta.url.endsWith(".js") ? "production" : "development"),
});
const runtime = await createApplication(config);
let stopVite: (() => Promise<void>) | undefined;
let server;
if (config.production) {
  runtime.app.get("*", serveStatic({ root: "./dist/client" }));
  runtime.app.get("*", serveStatic({ path: "./dist/client/index.html" }));
  server = serve({
    fetch: runtime.app.fetch,
    port: config.port,
    hostname: "0.0.0.0",
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  const handler = getRequestListener(runtime.app.fetch);
  server = createServer((req, res) => {
    if (req.url?.startsWith("/api/")) {
      void handler(req, res);
      return;
    }
    vite.middlewares(req, res, () => {
      void handler(req, res);
    });
  }).listen(config.port, "0.0.0.0");
  stopVite = () => vite.close();
}
console.log(
  `Числа: ${config.appUrl} | платежи: ${config.paymentMode} | генерация: ${config.aiMode}`,
);
const shutdown = () => {
  server.close(() => {
    runtime.close();
    void stopVite?.().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), config.aiTimeout + 5000).unref();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
