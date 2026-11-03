import { describe, it, expect } from "vitest";
import { sendSchema, signupSchema, groupSchema } from "@nexo/contracts";
import { mergeMessages } from "../../apps/web/src/messages";
import type { Message } from "@nexo/contracts";
const id = "6fb4473a-20ad-4c49-b065-7e787875749f";
describe("untrusted chat input", () => {
  it("normalizes IDs and text without accepting control characters or forged sender", () => {
    expect(
      sendSchema.parse({
        conversationId: id.toUpperCase(),
        clientId: id,
        body: "  Olá!  ",
      }).body,
    ).toBe("Olá!");
    expect(
      sendSchema.parse({
        conversationId: id.toUpperCase(),
        clientId: id,
        body: "Olá",
      }).conversationId,
    ).toBe(id);
    expect(
      sendSchema.safeParse({
        conversationId: id,
        clientId: id,
        body: "Oi",
        senderId: id,
      }).success,
    ).toBe(false);
    expect(
      sendSchema.safeParse({ conversationId: id, clientId: id, body: "\0" })
        .success,
    ).toBe(false);
    expect(
      sendSchema.safeParse({
        conversationId: id,
        clientId: id,
        body: "x".repeat(4001),
      }).success,
    ).toBe(false);
  });
  it("rejects unsafe registration and undersized groups", () => {
    expect(
      signupSchema.safeParse({
        email: "x@y.com",
        password: "short",
        handle: "ana",
        displayName: "Ana",
      }).success,
    ).toBe(false);
    expect(
      groupSchema.safeParse({ title: "Grupo", memberIds: [id] }).success,
    ).toBe(false);
  });
});
describe("ack/event/history reconciliation", () => {
  const message = (n: string): Message => ({
    id: n,
    clientId: n,
    sequence: n,
    conversationId: id,
    body: "Olá",
    createdAt: "2026-11-03T12:00:00Z",
    sender: { id, handle: "ana", displayName: "Ana" },
  });
  it("deduplicates ack, event and HTTP replay and sorts beyond JS safe integers", () => {
    const a = message("9007199254740993"),
      b = message("9007199254740994");
    expect(mergeMessages([b], [a, b, b]).map((m) => m.sequence)).toEqual([
      a.sequence,
      b.sequence,
    ]);
  });
});
