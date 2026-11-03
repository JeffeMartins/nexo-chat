import { z } from "zod";
const env = z
  .object({
    DATABASE_URL: z.string().min(10),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    APP_ORIGIN: z.string().url().default("http://localhost:3100"),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    INSTANCE_ID: z.string().default("api-1"),
  })
  .parse(process.env);
const origin = new URL(env.APP_ORIGIN);
if (env.APP_ORIGIN !== origin.origin)
  throw new Error("APP_ORIGIN must be an exact origin without path");
if (
  origin.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(origin.hostname)
)
  throw new Error("Public origins require HTTPS");
export const config = {
  ...env,
  secureCookie: origin.protocol === "https:",
  sessionMs: 7 * 24 * 60 * 60 * 1000,
};
