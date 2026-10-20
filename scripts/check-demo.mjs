import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const directory = resolve("dist/pages");
const html = await readFile(join(directory, "index.html"), "utf8");
const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
  (match) => match[1],
);
assert.ok(assets.some((path) => path.endsWith(".js")));
assert.ok(
  assets.every((path) => path.startsWith("/Numbers/")),
  "Every HTML asset must use /Numbers/",
);
for (const asset of assets)
  await readFile(join(directory, asset.slice("/Numbers/".length)));
const files = await readdir(directory, { recursive: true });
assert.ok(files.includes(".nojekyll"));
assert.ok(
  !files.some((path) =>
    /(^|[\\/])(?:server|node_modules|\.env)(?:[\\/]|$)|\.sqlite/.test(path),
  ),
);
for (const file of files.filter((path) => /\.(js|css)$/.test(path))) {
  const content = await readFile(join(directory, file), "utf8");
  assert.doesNotMatch(
    content,
    /api\.deepseek\.com|api\.yookassa\.ru|BETTER_AUTH_SECRET|DEEPSEEK_API_KEY|YOOKASSA_SECRET_KEY|node:sqlite/,
  );
  if (file.endsWith(".css")) {
    assert.doesNotMatch(
      content,
      /url\(["']?\/fonts\//,
      "Font URLs must respect /Numbers/",
    );
    for (const match of content.matchAll(
      /url\(["']?(\/Numbers\/[^)'"\s]+)["']?\)/g,
    ))
      await readFile(join(directory, match[1].slice("/Numbers/".length)));
  }
}
console.log(
  "Pages artifact: /Numbers/ assets and fonts verified; no backend modules, credentials or provider endpoints.",
);
