import express from "express";
import helmet from "helmet";
import pino from "pino";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { z } from "zod";
import {
  uuid,
  loginSchema,
  signupSchema,
  directSchema,
  groupSchema,
  sendSchema,
  memberSchema,
} from "@conversa/contracts";
import type { Ack, Message } from "@conversa/contracts";
import { config } from "./config.js";
import { db, transaction } from "./db.js";
import { AppError } from "./errors.js";
import {
  redis,
  publisher,
  subscriber,
  limit,
  online,
  heartbeat,
  disconnectPresence,
} from "./redis.js";
import {
  sessionFromCookie,
  requireOrigin,
  requireCsrf,
  issueSession,
  clearSession,
  authenticate,
  register,
  sameToken,
} from "./auth.js";
import type { Session } from "./auth.js";
import * as chats from "./conversations.js";
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: ["password", "cookie", "csrfToken", "token", "authorization"],
});
db.on("error", () => logger.error("Database pool failure"));
await db.query("SELECT 1");
await Promise.all([redis.connect(), publisher.connect(), subscriber.connect()]);
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const http = createServer(app);
const io = new Server(http, {
  transports: ["websocket"],
  maxHttpBufferSize: 16384,
  allowRequest: (req, done) =>
    done(null, req.headers.origin === config.APP_ORIGIN),
  pingInterval: 15000,
  pingTimeout: 10000,
});
io.adapter(createAdapter(publisher, subscriber, { key: "conversa:sockets" }));
app.use(helmet());
app.use(express.json({ limit: "16kb" }));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Request-ID", randomUUID());
  res.on("finish", () => {
    if (!req.path.startsWith("/health"))
      logger.info(
        { method: req.method, path: req.path, status: res.statusCode },
        "http",
      );
  });
  next();
});
app.get("/health/live", (_req, res) =>
  res.json({ status: "UP", instance: config.INSTANCE_ID }),
);
app.get("/health/ready", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    if (!redis.isReady || !publisher.isReady || !subscriber.isReady)
      throw new Error();
    res.json({ status: "UP" });
  } catch {
    res.status(503).json({ status: "UNAVAILABLE" });
  }
});
const auth = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  try {
    res.locals.session = await sessionFromCookie(req.headers.cookie);
    await limit("http:" + res.locals.session.user.id, 180, 10000);
    next();
  } catch (error) {
    next(error);
  }
};
const csrf = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  try {
    requireCsrf(req, res.locals.session);
    next();
  } catch (error) {
    next(error);
  }
};
const session = (res: express.Response) => res.locals.session as Session;
const notify = (ids: string[], event: string, data: unknown) => {
  for (const id of new Set(ids)) io.to("user:" + id).emit(event, data);
};
const rotatePreviousSession = async (req: express.Request) => {
  let previous: Session;
  try {
    previous = await sessionFromCookie(req.headers.cookie);
  } catch (error) {
    if (error instanceof AppError && error.status === 401) return;
    throw error;
  }
  await db.query("DELETE FROM sessions WHERE token_hash=$1", [
    previous.tokenHash,
  ]);
  io.in("session:" + previous.tokenHash).disconnectSockets(true);
};
app.post("/api/auth/register", async (req, res) => {
  requireOrigin(req);
  await limit("auth:" + req.ip, 40, 600000);
  const input = signupSchema.parse(req.body);
  const user = await register(input);
  await rotatePreviousSession(req);
  res.status(201).json(await issueSession(user, res));
});
app.post("/api/auth/login", async (req, res) => {
  requireOrigin(req);
  await limit("auth:" + req.ip, 40, 600000);
  const input = loginSchema.parse(req.body);
  const user = await authenticate(input.email, input.password);
  await rotatePreviousSession(req);
  res.json(await issueSession(user, res));
});
app.get("/api/auth/me", auth, (_req, res) => {
  const s = session(res);
  res.json({
    user: s.user,
    csrfToken: s.csrfToken,
    expiresAt: s.expiresAt.toISOString(),
  });
});
app.post("/api/auth/logout", auth, csrf, async (_req, res) => {
  const s = session(res);
  await db.query("DELETE FROM sessions WHERE token_hash=$1", [s.tokenHash]);
  io.in("session:" + s.tokenHash).disconnectSockets(true);
  clearSession(res);
  res.status(204).end();
});
app.get("/api/users", auth, async (req, res) => {
  const q = z
    .string()
    .max(60)
    .parse(req.query.q ?? "");
  const users = await chats.publicUsers(q, session(res).user.id);
  const presence = await online(users.map((u) => u.id));
  res.json({
    items: users.map((u) => ({ ...u, online: presence.get(u.id) ?? null })),
  });
});
app.get("/api/presence", auth, async (req, res) => {
  const ids = z
    .array(uuid)
    .max(50)
    .parse(
      String(req.query.ids || "")
        .split(",")
        .filter(Boolean),
    );
  const presence = await online(ids);
  res.json({
    items: ids.map((id) => ({ userId: id, online: presence.get(id) ?? null })),
  });
});
app.get("/api/conversations", auth, async (_req, res) =>
  res.json({ items: await chats.list(session(res).user.id) }),
);
app.post("/api/conversations/direct", auth, csrf, async (req, res) => {
  await limit("create:" + session(res).user.id, 20, 60000);
  const { userId } = directSchema.parse(req.body);
  const id = await chats.createDirect(session(res).user.id, userId);
  notify(await chats.memberIds(id), "conversation:changed", {
    conversationId: id,
  });
  res.status(201).json(await chats.detail(id, session(res).user.id));
});
app.post("/api/conversations/groups", auth, csrf, async (req, res) => {
  await limit("create:" + session(res).user.id, 20, 60000);
  const input = groupSchema.parse(req.body);
  const id = await chats.createGroup(
    session(res).user.id,
    input.title,
    input.memberIds,
  );
  notify(await chats.memberIds(id), "conversation:changed", {
    conversationId: id,
  });
  res.status(201).json(await chats.detail(id, session(res).user.id));
});
app.get("/api/conversations/:id/messages", auth, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const seq = z.string().regex(/^[1-9][0-9]{0,17}$/);
  const query = z
    .object({
      after: seq.optional(),
      before: seq.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    })
    .refine((q) => !(q.after && q.before))
    .parse(req.query);
  res.json(await chats.history(id, session(res).user.id, query));
});
app.post("/api/conversations/:id/read", auth, csrf, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const { sequence } = z
    .object({ sequence: z.string().regex(/^[0-9]{1,18}$/) })
    .strict()
    .parse(req.body);
  await chats.markRead(id, session(res).user.id, sequence);
  res.status(204).end();
});
app.post("/api/conversations/:id/members", auth, csrf, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const { userId } = memberSchema.parse(req.body);
  notify(
    await chats.changeMember(id, session(res).user.id, userId, false),
    "conversation:changed",
    { conversationId: id },
  );
  res.status(204).end();
});
app.delete(
  "/api/conversations/:id/members/:userId",
  auth,
  csrf,
  async (req, res) => {
    const id = uuid.parse(req.params.id);
    const userId = uuid.parse(req.params.userId);
    notify(
      await chats.changeMember(id, session(res).user.id, userId, true),
      "conversation:changed",
      { conversationId: id },
    );
    res.status(204).end();
  },
);
app.use((_req, res) =>
  res
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Recurso não encontrado." } }),
);
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION",
          message: "Confira os dados informados.",
        },
      });
      return;
    }
    if (error instanceof AppError) {
      res
        .status(error.status)
        .json({ error: { code: error.code, message: error.message } });
      return;
    }
    const status = (error as { status?: number })?.status;
    if (status === 413 || status === 400) {
      res.status(status).json({
        error: { code: "INVALID_BODY", message: "Requisição inválida." },
      });
      return;
    }
    logger.error(
      { name: error instanceof Error ? error.name : "UnknownError" },
      "Request failed",
    );
    res.status(503).json({
      error: {
        code: "UNAVAILABLE",
        message: "Serviço temporariamente indisponível.",
      },
    });
  },
);
io.use(async (socket, next) => {
  try {
    const s = await sessionFromCookie(socket.request.headers.cookie);
    const token = z.string().length(64).parse(socket.handshake.auth.csrfToken);
    if (!sameToken(token, s.csrfToken)) throw new Error();
    await limit("connect:" + s.user.id, 40, 60000);
    socket.data.session = s;
    next();
  } catch {
    next(new Error("UNAUTHENTICATED"));
  }
});
io.on("connection", (socket) => {
  const s = socket.data.session as Session;
  const connectionId = randomUUID();
  void socket.join(["user:" + s.user.id, "session:" + s.tokenHash]);
  const refreshPresence = async () => {
    try {
      if (redis.isReady && (await heartbeat(s.user.id, connectionId)))
        io.emit("presence:changed", { userId: s.user.id, online: true });
    } catch {
      /* presence becomes unknown through the HTTP snapshot */
    }
  };
  void refreshPresence();
  const beat = setInterval(() => void refreshPresence(), 15000);
  const expiry = setTimeout(
    () => socket.disconnect(true),
    Math.max(0, s.expiresAt.getTime() - Date.now()),
  );
  let packetWindow = Date.now();
  let packetCount = 0;
  socket.use(async (packet, next) => {
    if (Date.now() - packetWindow >= 10000) {
      packetWindow = Date.now();
      packetCount = 0;
    }
    packetCount++;
    // Reject unsupported events and floods before they can queue database work.
    if (
      !["message:send", "typing:start"].includes(String(packet[0])) ||
      packetCount > 80
    ) {
      socket.disconnect(true);
      return;
    }
    try {
      await sessionFromCookie(socket.request.headers.cookie);
      next();
    } catch {
      socket.disconnect(true);
    }
  });
  socket.on(
    "message:send",
    async (
      input: unknown,
      ack: ((result: Ack<Message>) => void) | undefined,
    ) => {
      const reply = (value: Ack<Message>) => {
        if (typeof ack === "function") ack(value);
      };
      try {
        await limit("send:" + s.user.id, 30, 10000);
        const body = sendSchema.parse(input);
        const message = await chats.send(s.user.id, body);
        reply({ ok: true, data: message });
      } catch (error) {
        const e =
          error instanceof AppError
            ? error
            : new AppError(
                error instanceof z.ZodError ? 400 : 503,
                error instanceof z.ZodError ? "VALIDATION" : "UNAVAILABLE",
                error instanceof z.ZodError
                  ? "Mensagem inválida."
                  : "Não foi possível enviar agora.",
              );
        reply({ ok: false, error: { code: e.code, message: e.message } });
      }
    },
  );
  socket.on("typing:start", async (input: unknown) => {
    try {
      const { conversationId } = z
        .object({ conversationId: uuid })
        .strict()
        .parse(input);
      await limit("typing:" + s.user.id, 8, 5000);
      await chats.authorize(conversationId, s.user.id);
      notify(
        (await chats.memberIds(conversationId)).filter(
          (id) => id !== s.user.id,
        ),
        "typing:changed",
        { conversationId, user: s.user },
      );
    } catch {
      /* transient indicator; no message write */
    }
  });
  socket.on("disconnect", () => {
    clearInterval(beat);
    clearTimeout(expiry);
    void disconnectPresence(s.user.id, connectionId)
      .then((last) => {
        if (last)
          io.emit("presence:changed", { userId: s.user.id, online: false });
      })
      .catch(() => {});
  });
});
let dispatching = false;
const dispatch = async () => {
  if (dispatching || !publisher.isReady || !subscriber.isReady) return;
  dispatching = true;
  try {
    await transaction(async (c) => {
      const batch = await c.query(
        "SELECT id,message_id FROM outbox WHERE published_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 50",
      );
      for (const item of batch.rows) {
        const result = await c.query(chats.messageSelect + " WHERE m.id=$1", [
          item.message_id,
        ]);
        const row = result.rows[0];
        if (row) {
          const message = chats.view(row);
          notify(
            await chats.memberIds(message.conversationId, c),
            "message:new",
            message,
          );
        }
        await c.query("UPDATE outbox SET published_at=now() WHERE id=$1", [
          item.id,
        ]);
      }
    });
  } catch {
    logger.warn("Outbox attempt deferred");
  } finally {
    dispatching = false;
  }
};
const outbox = setInterval(() => void dispatch(), 250);
const cleanup = setInterval(() => {
  void db.query("DELETE FROM sessions WHERE expires_at<now()").catch(() => {});
  void db
    .query("DELETE FROM outbox WHERE published_at<now()-interval '7 days'")
    .catch(() => {});
}, 3600000);
http.listen(config.PORT, "0.0.0.0", () =>
  logger.info(
    { port: config.PORT, instance: config.INSTANCE_ID },
    "Conversa API ready",
  ),
);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(outbox);
  clearInterval(cleanup);
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await Promise.allSettled([
    publisher.quit(),
    subscriber.quit(),
    redis.quit(),
    db.end(),
  ]);
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
