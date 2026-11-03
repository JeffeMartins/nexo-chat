import { createClient } from "redis";
import { config } from "./config.js";
import { AppError } from "./errors.js";
export const redis = createClient({
  url: config.REDIS_URL,
  socket: { connectTimeout: 3000 },
  disableOfflineQueue: true,
});
export const publisher = redis.duplicate();
export const subscriber = redis.duplicate();
for (const client of [redis, publisher, subscriber])
  client.on("error", () => {
    /* readiness/presence expose dependency status without logging credentials */
  });
const script =
  "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n";
export async function limit(key: string, max: number, windowMs: number) {
  if (!redis.isReady)
    throw new AppError(
      503,
      "DEPENDENCY_UNAVAILABLE",
      "Serviço temporariamente indisponível.",
    );
  let n;
  try {
    n = await redis.eval(script, {
      keys: ["conversa:limit:" + key],
      arguments: [String(windowMs)],
    });
  } catch {
    throw new AppError(
      503,
      "DEPENDENCY_UNAVAILABLE",
      "Serviço temporariamente indisponível.",
    );
  }
  if (Number(n) > max)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Aguarde um instante antes de tentar novamente.",
    );
}
export async function online(
  ids: string[],
): Promise<Map<string, boolean | null>> {
  const result = new Map<string, boolean | null>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        result.set(
          id,
          redis.isReady
            ? (await redis.zCount(
                "conversa:presence:" + id,
                Date.now(),
                "+inf",
              )) > 0
            : null,
        );
      } catch {
        result.set(id, null);
      }
    }),
  );
  return result;
}
const beatScript =
  "redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); local n=redis.call('ZCARD',KEYS[1]); redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3]); redis.call('EXPIRE',KEYS[1],60); return n";
export async function heartbeat(userId: string, connectionId: string) {
  return (
    Number(
      await redis.eval(beatScript, {
        keys: ["conversa:presence:" + userId],
        arguments: [
          String(Date.now()),
          String(Date.now() + 45000),
          connectionId,
        ],
      }),
    ) === 0
  );
}
export async function disconnectPresence(userId: string, connectionId: string) {
  await redis.zRem("conversa:presence:" + userId, connectionId);
  await redis.zRemRangeByScore(
    "conversa:presence:" + userId,
    "-inf",
    Date.now(),
  );
  return (await redis.zCard("conversa:presence:" + userId)) === 0;
}
