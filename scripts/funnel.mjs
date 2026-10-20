import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const db = new DatabaseSync(
  process.env.DATABASE_PATH || "./data/chisla.sqlite",
  { readOnly: true },
);
try {
  console.table(
    db
      .prepare(
        readFileSync(new URL("../sql/funnel.sql", import.meta.url), "utf8"),
      )
      .all(),
  );
} finally {
  db.close();
}
