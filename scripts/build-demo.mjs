import { writeFile } from "node:fs/promises";

// Never read .env files or expose server configuration in the public Pages artifact.
process.env.NODE_ENV = "production";
const { build } = await import("vite");
await build({ mode: "pages-demo" });
await writeFile("dist/pages/.nojekyll", "");
