import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) {
  console.log(".env existente preservado.");
  process.exit(0);
}
writeFileSync(
  ".env",
  `DB_PASSWORD=${randomBytes(24).toString("hex")}\nREDIS_PASSWORD=${randomBytes(24).toString("hex")}\nAPP_ORIGIN=http://localhost:3100\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(".env criado com credenciais locais aleatórias.");
