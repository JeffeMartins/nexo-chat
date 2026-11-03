import { chromium } from "@playwright/test";
import { io } from "socket.io-client";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
const origin = "http://localhost:3100";
const base = "http://localhost:8100";
const password = randomBytes(20).toString("hex");
const prefix = "demo" + randomBytes(3).toString("hex");
const actors = [];
const sockets = [];
let browser;
async function call(path, method = "GET", body, actor) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      ...(actor
        ? { Cookie: actor.cookie, "X-CSRF-Token": actor.csrfToken }
        : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error("Screenshot setup failed: " + r.status);
  const data = await r.json();
  return { ...data, cookie: r.headers.getSetCookie()[0]?.split(";")[0] };
}
try {
  for (const [handle, displayName] of [
    ["ana", "Ana Souza"],
    ["bia", "Bia Martins"],
    ["caio", "Caio Lima"],
  ])
    actors.push(
      await call("/api/auth/register", "POST", {
        handle: prefix + handle,
        email: prefix + handle + "@example.invalid",
        displayName,
        password,
      }),
    );
  for (const actor of actors) {
    const socket = io(base, {
      transports: ["websocket"],
      extraHeaders: { Origin: origin, Cookie: actor.cookie },
      auth: { csrfToken: actor.csrfToken },
      autoConnect: false,
    });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
      socket.connect();
    });
  }
  const direct = await call(
    "/api/conversations/direct",
    "POST",
    { userId: actors[1].user.id },
    actors[0],
  );
  const group = await call(
    "/api/conversations/groups",
    "POST",
    {
      title: "Café com a turma",
      memberIds: [actors[1].user.id, actors[2].user.id],
    },
    actors[0],
  );
  const send = (index, conversationId, body) =>
    new Promise((resolve, reject) =>
      sockets[index]
        .timeout(5000)
        .emit(
          "message:send",
          { conversationId, body, clientId: randomUUID() },
          (error, ack) =>
            error || !ack.ok
              ? reject(error || new Error("Send failed"))
              : resolve(ack),
        ),
    );
  await send(1, direct.id, "Oi, Ana! Que bom te encontrar por aqui. ☀️");
  await send(0, direct.id, "Bom ter você por perto. Vamos reunir a turma?");
  await send(
    0,
    group.id,
    "Pessoal, criei esse espaço para a gente ficar mais perto. Sejam bem-vindos! 👋",
  );
  await send(
    1,
    group.id,
    "Amei a ideia! Uma boa conversa sempre deixa o dia melhor.",
  );
  await send(
    2,
    group.id,
    "Já me senti em casa. Que tal marcarmos um café essa semana? ☕",
  );
  await send(0, group.id, "Combinado! Quinta à tarde funciona para vocês?");
  await send(1, group.id, "Por mim, perfeito. Já estou animada!");
  mkdirSync("docs/images", { recursive: true });
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const [name, value] = actors[0].cookie.split("=");
  await context.addCookies([
    {
      name,
      value,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "networkidle" });
  await page
    .locator(".conversation-item")
    .filter({ hasText: "Café com a turma" })
    .click();
  await page.getByRole("button", { name: "Detalhes da conversa" }).click();
  await page.getByTestId("message").last().waitFor();
  await page.screenshot({
    path: "docs/images/chat-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Fechar detalhes" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/images/chat-mobile.png",
    fullPage: true,
  });
  const authContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const authPage = await authContext.newPage();
  await authPage.goto(origin, { waitUntil: "networkidle" });
  await authPage.screenshot({ path: "docs/images/login.png", fullPage: true });
  console.log(
    "Screenshots gerados com usuários e mensagens fictícios. Nenhuma credencial foi escrita em disco.",
  );
} finally {
  for (const socket of sockets) socket.disconnect();
  await browser?.close();
}
