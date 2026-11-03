import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { db, transaction } from "./db.js";
try {
  await transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('conversa:migrations'))",
    );
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ DEFAULT now())",
    );
    for (const name of (await readdir("migrations"))
      .filter((n) => /^\d+_[a-z_]+\.sql$/.test(n))
      .sort()) {
      const sql = await readFile("migrations/" + name, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error("Migration checksum mismatch: " + name);
        continue;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      console.log("Applied migration", name);
    }
  });
} finally {
  await db.end();
}
