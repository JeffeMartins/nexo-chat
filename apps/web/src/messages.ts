import type { Message } from "@conversa/contracts";
export function mergeMessages(
  previous: Message[],
  incoming: Message[],
): Message[] {
  const byId = new Map(previous.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()]
    .sort((a, b) =>
      BigInt(a.sequence) < BigInt(b.sequence)
        ? -1
        : BigInt(a.sequence) > BigInt(b.sequence)
          ? 1
          : 0,
    )
    .slice(-300);
}
