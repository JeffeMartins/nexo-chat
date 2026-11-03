import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
const origin = "http://localhost:3100";
const tag = "e" + randomUUID().slice(0, 8);
const password = "Browser-only-password-2026!";
const actors = [
  { handle: tag + "ana", displayName: "Ana Souza" },
  { handle: tag + "bia", displayName: "Bia Martins" },
  { handle: tag + "caio", displayName: "Caio Lima" },
];
test.beforeAll(async ({ request }) => {
  for (const actor of actors) {
    const r = await request.post("/api/auth/register", {
      headers: { Origin: origin },
      data: { ...actor, email: actor.handle + "@example.invalid", password },
    });
    expect(r.status()).toBe(201);
  }
});
async function login(page: Page, index: number) {
  await page.goto("/");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill(actors[index].handle + "@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Entrar na conversa", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Conversas", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".connection-banner")).toHaveCount(0);
}
test("cadastro real pelo formulário e logout", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByLabel("Seu nome", { exact: true }).fill("Visitante Teste");
  await page.getByLabel("Nome de usuário", { exact: true }).fill(tag + "novo");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill(tag + "novo@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Criar minha conta" }).click();
  await expect(
    page.getByRole("heading", { name: "Conversas", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sair da conta" }).click();
  await expect(
    page.getByRole("button", { name: "Entrar na conversa", exact: true }),
  ).toBeVisible();
});
test("duas pessoas conversam, veem presença e recuperam o histórico após reload", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const ana = await a.newPage(),
    bia = await b.newPage();
  try {
    await login(ana, 0);
    await login(bia, 1);
    await ana.getByRole("button", { name: "Nova conversa" }).click();
    await ana
      .getByRole("textbox", { name: "Buscar pessoas" })
      .fill(actors[1].handle);
    await ana
      .locator(".person-option")
      .filter({ hasText: "@" + actors[1].handle })
      .click();
    await ana
      .getByRole("button", { name: "Começar conversa", exact: true })
      .click();
    await expect(
      ana.getByRole("heading", { name: "Bia Martins", exact: true }),
    ).toBeVisible();
    const message = "Um olá de verdade " + tag;
    await ana
      .getByRole("textbox", { name: "Mensagem", exact: true })
      .fill(message);
    await ana.getByRole("button", { name: "Enviar mensagem" }).click();
    await bia
      .locator(".conversation-item")
      .filter({ hasText: "Ana Souza" })
      .click();
    await expect(
      bia.getByTestId("message").filter({ hasText: message }),
    ).toHaveCount(1);
    await expect(ana.locator(".chat-header")).toContainText("Online agora");
    await bia
      .getByRole("textbox", { name: "Mensagem", exact: true })
      .fill("Bom conversar com você.");
    await bia.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(
      ana.getByTestId("message").filter({ hasText: "Bom conversar com você." }),
    ).toHaveCount(1);
    await bia.reload();
    await bia
      .locator(".conversation-item")
      .filter({ hasText: "Ana Souza" })
      .click();
    await expect(
      bia.getByTestId("message").filter({ hasText: message }),
    ).toHaveCount(1);
  } finally {
    await a.close();
    await b.close();
  }
});
test("grupo com três pessoas recebe mensagens e permite gerenciar participantes", async ({
  browser,
}) => {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    for (let i = 0; i < 3; i++) await login(pages[i], i);
    const [ana, bia, caio] = pages;
    await ana.getByRole("button", { name: "Nova conversa" }).click();
    await ana.getByRole("button", { name: "Um grupo", exact: true }).click();
    await ana.getByLabel("Nome do grupo").fill("Café com a turma " + tag);
    for (const index of [1, 2]) {
      await ana
        .getByRole("textbox", { name: "Buscar pessoas" })
        .fill(actors[index].handle);
      await ana
        .locator(".person-option")
        .filter({ hasText: "@" + actors[index].handle })
        .click();
    }
    await ana.getByRole("button", { name: "Criar grupo", exact: true }).click();
    await expect(ana.locator(".chat-header")).toContainText("3 participantes");
    await ana
      .getByRole("textbox", { name: "Mensagem", exact: true })
      .fill("Bem-vindos ao nosso grupo!");
    await ana.getByRole("button", { name: "Enviar mensagem" }).click();
    for (const page of [bia, caio]) {
      await page
        .locator(".conversation-item")
        .filter({ hasText: "Café com a turma " + tag })
        .click();
      await expect(
        page
          .getByTestId("message")
          .filter({ hasText: "Bem-vindos ao nosso grupo!" }),
      ).toBeVisible();
    }
    await ana.getByRole("button", { name: "Detalhes da conversa" }).click();
    ana.once("dialog", (d) => void d.accept());
    await ana
      .getByRole("button", { name: "Remover Caio Lima", exact: true })
      .click();
    await expect(ana.locator(".chat-header")).toContainText("2 participantes");
    await expect(
      caio.getByRole("heading", { name: "Perto, mesmo de longe." }),
    ).toBeVisible();
  } finally {
    for (const c of contexts) await c.close();
  }
});
test("login e conversa têm acessibilidade automatizada e layout móvel sem overflow", async ({
  page,
}) => {
  await page.goto("/");
  const loginAudit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(loginAudit.violations).toEqual([]);
  await login(page, 0);
  const chatAudit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(chatAudit.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".conversation-item")
    .filter({ hasText: "Bia Martins" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Mensagem", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".artifacts/chat-mobile.png", fullPage: true });
});
