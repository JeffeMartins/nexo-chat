import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
const base = process.env.API_URL || "http://localhost:8100";
const second = process.env.API2_URL || "http://localhost:8101";
const origin = "http://localhost:3100";
const tag = "a" + randomUUID().slice(0, 8);
const password = "Testing-only-password-2026!";
const sockets = [];
async function call(path, options = {}, actor) {
  const response = await fetch(base + path, {
    method: options.method || "GET",
    headers: {
      Origin: origin,
      ...(actor
        ? { Cookie: actor.cookie, "X-CSRF-Token": actor.csrfToken }
        : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* 204 and proxy errors can have no JSON body. */
  }
  return { status: response.status, data, headers: response.headers };
}
async function create(name) {
  const r = await call("/api/auth/register", {
    method: "POST",
    body: {
      email: tag + name + "@example.invalid",
      password,
      handle: tag + name,
      displayName: name + " Teste",
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const cookie = r.headers.getSetCookie()[0].split(";")[0];
  assert.match(r.headers.getSetCookie()[0], /HttpOnly/i);
  assert.match(r.headers.getSetCookie()[0], /SameSite=Lax/i);
  assert.equal(r.data.user.email, undefined);
  return { ...r.data, cookie };
}
async function connect(actor, url = base, override = {}) {
  const socket = io(url, {
    transports: ["websocket"],
    autoConnect: false,
    reconnection: false,
    extraHeaders: { Origin: origin, Cookie: actor.cookie },
    auth: { csrfToken: actor.csrfToken },
    ...override,
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("Socket connect timeout")),
      5000,
    );
    socket.once("connect", () => {
      clearTimeout(t);
      resolve();
    });
    socket.once("connect_error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    socket.connect();
  });
  return socket;
}
function event(socket, name, predicate = () => true, timeout = 7000) {
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      if (!predicate(data)) return;
      clearTimeout(t);
      socket.off(name, handler);
      resolve(data);
    };
    const t = setTimeout(() => {
      socket.off(name, handler);
      reject(new Error("Missing " + name));
    }, timeout);
    socket.on(name, handler);
  });
}
function emit(socket, payload) {
  return new Promise((resolve, reject) =>
    socket
      .timeout(5000)
      .emit("message:send", payload, (error, ack) =>
        error ? reject(error) : resolve(ack),
      ),
  );
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ana, bruno, carla, intruder, direct, group, anaSocket, brunoSocket;
before(async () => {
  ana = await create("ana");
  bruno = await create("bruno");
  carla = await create("carla");
  intruder = await create("intruso");
  anaSocket = await connect(ana);
  brunoSocket = await connect(bruno, second);
  direct = (
    await call(
      "/api/conversations/direct",
      { method: "POST", body: { userId: bruno.user.id } },
      ana,
    )
  ).data;
});
after(() => {
  for (const socket of sockets) socket.disconnect();
});
test("successful login rotates the previous browser session and disconnects its sockets", async () => {
  const previousSocket = await connect(intruder, second);
  const disconnected = event(previousSocket, "disconnect");
  const result = await call(
    "/api/auth/login",
    {
      method: "POST",
      body: { email: intruder.user.handle + "@example.invalid", password },
    },
    intruder,
  );
  assert.equal(result.status, 200);
  await disconnected;
  assert.equal((await call("/api/auth/me", {}, intruder)).status, 401);
  const next = {
    ...result.data,
    cookie: result.headers.getSetCookie()[0].split(";")[0],
  };
  assert.ok(
    next.cookie !== intruder.cookie,
    "The browser session token must rotate",
  );
  await connect(next);
  intruder = next;
});
test("auth, origin and CSRF protect REST and socket handshakes", async () => {
  assert.equal((await call("/api/conversations")).status, 401);
  assert.equal(
    (
      await call(
        "/api/conversations/direct",
        {
          method: "POST",
          body: { userId: carla.user.id },
          headers: { "X-CSRF-Token": "bad" },
        },
        ana,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/auth/login", {
        method: "POST",
        headers: { Origin: "https://attacker.invalid" },
        body: { email: "x@example.invalid", password },
      })
    ).status,
    403,
  );
  await assert.rejects(
    connect(ana, base, {
      extraHeaders: { Origin: "https://attacker.invalid", Cookie: ana.cookie },
    }),
  );
  await assert.rejects(
    connect(ana, base, { auth: { csrfToken: "0".repeat(64) } }),
  );
});
test("direct conversation is unique in both directions and normalized UUIDs", async () => {
  const reverse = await call(
    "/api/conversations/direct",
    { method: "POST", body: { userId: ana.user.id.toUpperCase() } },
    bruno,
  );
  assert.equal(reverse.data.id, direct.id);
  assert.equal(
    (await call("/api/conversations/" + direct.id + "/messages", {}, intruder))
      .status,
    404,
  );
});
test("two API instances deliver persisted messages through Redis and retries do not duplicate", async () => {
  const payload = {
    conversationId: direct.id,
    clientId: randomUUID(),
    body: "Mensagem entre instâncias",
  };
  const received = event(
    brunoSocket,
    "message:new",
    (m) => m.clientId === payload.clientId,
  );
  const a = await emit(anaSocket, payload);
  assert.equal(a.ok, true);
  assert.equal((await received).id, a.data.id);
  const b = await emit(anaSocket, payload);
  assert.equal(b.data.id, a.data.id);
  const history = await call(
    "/api/conversations/" + direct.id + "/messages",
    {},
    bruno,
  );
  assert.equal(
    history.data.items.filter((m) => m.clientId === payload.clientId).length,
    1,
  );
  const conflict = await emit(anaSocket, {
    ...payload,
    body: "Outro conteúdo",
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");
});
test("messages from disconnected clients are replayable with cursor and ordered history", async () => {
  brunoSocket.disconnect();
  const first = await emit(anaSocket, {
    conversationId: direct.id,
    clientId: randomUUID(),
    body: "Enquanto você estava fora 1",
  });
  await emit(anaSocket, {
    conversationId: direct.id,
    clientId: randomUUID(),
    body: "Enquanto você estava fora 2",
  });
  brunoSocket = await connect(bruno, second);
  const result = await call(
    "/api/conversations/" +
      direct.id +
      "/messages?after=" +
      first.data.sequence,
    {},
    bruno,
  );
  assert.equal(result.data.items.length, 1);
  assert.equal(result.data.items[0].body, "Enquanto você estava fora 2");
  const page = await call(
    "/api/conversations/" + direct.id + "/messages?limit=2",
    {},
    bruno,
  );
  assert.equal(page.data.items.length, 2);
  assert.equal(page.data.hasMore, true);
  assert.ok(
    BigInt(page.data.items[0].sequence) < BigInt(page.data.items[1].sequence),
  );
});
test("group membership gates writes and owner-only removal revokes future access", async () => {
  const r = await call(
    "/api/conversations/groups",
    {
      method: "POST",
      body: {
        title: "Grupo de teste",
        memberIds: [bruno.user.id, carla.user.id],
      },
    },
    ana,
  );
  assert.equal(r.status, 201);
  group = r.data;
  const forged = await emit(anaSocket, {
    conversationId: group.id,
    clientId: randomUUID(),
    body: "Oi",
    senderId: carla.user.id,
  });
  assert.equal(forged.ok, false);
  const badSocket = await connect(intruder);
  assert.equal(
    (
      await emit(badSocket, {
        conversationId: group.id,
        clientId: randomUUID(),
        body: "Não autorizado",
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await call(
        "/api/conversations/" + group.id + "/members/" + carla.user.id,
        { method: "DELETE" },
        bruno,
      )
    ).status,
    403,
  );
  const carlaSocket = await connect(carla, second);
  assert.equal(
    (
      await call(
        "/api/conversations/" + group.id + "/members/" + carla.user.id,
        { method: "DELETE" },
        ana,
      )
    ).status,
    204,
  );
  assert.equal(
    (await call("/api/conversations/" + group.id + "/messages", {}, carla))
      .status,
    404,
  );
  assert.equal(
    (
      await emit(carlaSocket, {
        conversationId: group.id,
        clientId: randomUUID(),
        body: "Depois da remoção",
      })
    ).ok,
    false,
  );
  let leaked = false;
  carlaSocket.on("message:new", (m) => {
    if (m.conversationId === group.id) leaked = true;
  });
  await emit(anaSocket, {
    conversationId: group.id,
    clientId: randomUUID(),
    body: "Somente os participantes atuais",
  });
  await pause(500);
  assert.equal(leaked, false);
});
test("presence survives one tab disconnect and logout disconnects all tabs of that session", async () => {
  const tab1 = await connect(carla);
  const tab2 = await connect(carla, second);
  await pause(200);
  tab1.disconnect();
  await pause(200);
  const p = await call("/api/presence?ids=" + carla.user.id, {}, ana);
  assert.equal(p.data.items[0].online, true);
  const disconnected = event(tab2, "disconnect");
  assert.equal(
    (await call("/api/auth/logout", { method: "POST" }, carla)).status,
    204,
  );
  await disconnected;
  assert.equal((await call("/api/auth/me", {}, carla)).status, 401);
  await assert.rejects(connect(carla));
});
test("read cursors are authorized, monotonic and exclude messages sent by the reader", async () => {
  const all = await call(
    "/api/conversations/" + direct.id + "/messages",
    {},
    bruno,
  );
  const last = all.data.items.at(-1).sequence;
  assert.equal(
    (
      await call(
        "/api/conversations/" + direct.id + "/read",
        { method: "POST", body: { sequence: last } },
        bruno,
      )
    ).status,
    204,
  );
  await call(
    "/api/conversations/" + direct.id + "/read",
    { method: "POST", body: { sequence: "0" } },
    bruno,
  );
  const list = await call("/api/conversations", {}, bruno);
  assert.equal(list.data.items.find((c) => c.id === direct.id).unreadCount, 0);
});
