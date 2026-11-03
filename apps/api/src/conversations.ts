import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Message, Conversation, User } from "@conversa/contracts";
import { db, transaction } from "./db.js";
import { AppError, missing } from "./errors.js";
type MessageRow = {
  id: string;
  seq: string;
  conversation_id: string;
  client_id: string;
  body: string;
  sender_id: string;
  handle: string;
  display_name: string;
  created_at: Date;
};
export const messageSelect =
  "SELECT m.*,u.handle,u.display_name FROM messages m JOIN users u ON u.id=m.sender_id";
export const view = (r: MessageRow): Message => ({
  id: r.id,
  sequence: r.seq,
  conversationId: r.conversation_id,
  clientId: r.client_id,
  body: r.body,
  sender: { id: r.sender_id, handle: r.handle, displayName: r.display_name },
  createdAt: r.created_at.toISOString(),
});
export async function authorize(
  conversationId: string,
  userId: string,
  client: pg.Pool | pg.PoolClient = db,
) {
  const r = await client.query(
    "SELECT c.* FROM conversations c JOIN members x ON x.conversation_id=c.id WHERE c.id=$1 AND x.user_id=$2",
    [conversationId, userId],
  );
  if (!r.rowCount) throw missing();
  return r.rows[0] as {
    id: string;
    kind: "DIRECT" | "GROUP";
    title: string | null;
    created_by: string;
  };
}
export async function memberIds(
  id: string,
  client: pg.Pool | pg.PoolClient = db,
): Promise<string[]> {
  return (
    await client.query<{ user_id: string }>(
      "SELECT user_id FROM members WHERE conversation_id=$1",
      [id],
    )
  ).rows.map((r) => r.user_id);
}
export async function detail(
  id: string,
  userId: string,
): Promise<Conversation> {
  const c = await authorize(id, userId);
  const members = await db.query(
    "SELECT u.id,u.handle,u.display_name FROM users u JOIN members m ON m.user_id=u.id WHERE m.conversation_id=$1 ORDER BY u.display_name",
    [id],
  );
  const latest = await db.query<MessageRow>(
    messageSelect + " WHERE m.conversation_id=$1 ORDER BY m.seq DESC LIMIT 1",
    [id],
  );
  const unread = await db.query(
    "SELECT count(*)::int AS n FROM messages m JOIN members x ON x.conversation_id=m.conversation_id WHERE x.user_id=$1 AND m.conversation_id=$2 AND m.seq>x.last_read_seq AND m.sender_id<>$1",
    [userId, id],
  );
  return {
    id: c.id,
    kind: c.kind,
    title: c.title,
    createdBy: c.created_by,
    members: members.rows.map((r) => ({
      id: r.id,
      handle: r.handle,
      displayName: r.display_name,
    })),
    lastMessage: latest.rows[0] ? view(latest.rows[0]) : null,
    unreadCount: unread.rows[0].n,
  };
}
export async function list(userId: string) {
  const { rows } = await db.query(
    `SELECT c.*,
  (SELECT json_agg(json_build_object('id',u.id,'handle',u.handle,'displayName',u.display_name) ORDER BY u.display_name)
   FROM members x JOIN users u ON u.id=x.user_id WHERE x.conversation_id=c.id) AS people,
  (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.seq>self.last_read_seq AND m.sender_id<>$1) AS unread,
  CASE WHEN last.id IS NULL THEN NULL ELSE json_build_object('id',last.id,'sequence',last.seq::text,'conversationId',c.id,'clientId',last.client_id,'body',last.body,'createdAt',last.created_at,'sender',json_build_object('id',last.sender_id,'handle',last.handle,'displayName',last.display_name)) END AS latest
  FROM members self JOIN conversations c ON c.id=self.conversation_id
  LEFT JOIN LATERAL (SELECT m.*,u.handle,u.display_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=c.id ORDER BY m.seq DESC LIMIT 1) last ON true
  WHERE self.user_id=$1 ORDER BY COALESCE(last.created_at,c.created_at) DESC,c.id LIMIT 50`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    createdBy: r.created_by,
    members: r.people,
    lastMessage: r.latest,
    unreadCount: r.unread,
  })) as Conversation[];
}
export async function createDirect(userId: string, other: string) {
  if (userId === other)
    throw new AppError(400, "INVALID_MEMBER", "Escolha outra pessoa.");
  return transaction(async (c) => {
    if (!(await c.query("SELECT id FROM users WHERE id=$1", [other])).rowCount)
      throw new AppError(404, "USER_NOT_FOUND", "Pessoa não encontrada.");
    const key = [userId, other].sort().join(":");
    const { rows } = await c.query(
      "INSERT INTO conversations(id,kind,direct_key,created_by) VALUES($1,'DIRECT',$2,$3) ON CONFLICT(direct_key) DO UPDATE SET direct_key=excluded.direct_key RETURNING id",
      [randomUUID(), key, userId],
    );
    const id: string = rows[0].id;
    for (const member of [userId, other])
      await c.query(
        "INSERT INTO members(conversation_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, member],
      );
    return id;
  });
}
export async function createGroup(
  userId: string,
  title: string,
  others: string[],
) {
  const ids = [...new Set([userId, ...others])];
  if (ids.length < 3 || ids.length > 50)
    throw new AppError(
      400,
      "INVALID_MEMBERS",
      "Escolha entre 2 e 49 outras pessoas.",
    );
  return transaction(async (c) => {
    if (
      (await c.query("SELECT id FROM users WHERE id=ANY($1::uuid[])", [ids]))
        .rowCount !== ids.length
    )
      throw new AppError(
        400,
        "INVALID_MEMBERS",
        "Uma pessoa selecionada não existe.",
      );
    const id = randomUUID();
    await c.query(
      "INSERT INTO conversations(id,kind,title,created_by) VALUES($1,'GROUP',$2,$3)",
      [id, title, userId],
    );
    for (const member of ids)
      await c.query(
        "INSERT INTO members(conversation_id,user_id) VALUES($1,$2)",
        [id, member],
      );
    return id;
  });
}
export async function history(
  id: string,
  userId: string,
  cursor: { after?: string; before?: string; limit: number },
) {
  await authorize(id, userId);
  const order = cursor.after ? "ASC" : "DESC";
  const params: unknown[] = [id];
  let filter = "";
  if (cursor.after) {
    params.push(cursor.after);
    filter = " AND m.seq>$2::bigint";
  } else if (cursor.before) {
    params.push(cursor.before);
    filter = " AND m.seq<$2::bigint";
  }
  params.push(cursor.limit + 1);
  const result = await db.query<MessageRow>(
    messageSelect +
      ` WHERE m.conversation_id=$1${filter} ORDER BY m.seq ${order} LIMIT $${params.length}`,
    params,
  );
  const hasMore = result.rows.length > cursor.limit;
  const rows = result.rows.slice(0, cursor.limit);
  if (order === "DESC") rows.reverse();
  return { items: rows.map(view), hasMore };
}
export async function send(
  userId: string,
  input: { conversationId: string; clientId: string; body: string },
): Promise<Message> {
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      userId + ":" + input.clientId,
    ]);
    await c.query("SELECT id FROM conversations WHERE id=$1 FOR UPDATE", [
      input.conversationId,
    ]);
    await authorize(input.conversationId, userId, c);
    const old = await c.query<MessageRow>(
      messageSelect + " WHERE m.sender_id=$1 AND m.client_id=$2",
      [userId, input.clientId],
    );
    if (old.rows[0]) {
      if (
        old.rows[0].conversation_id !== input.conversationId ||
        old.rows[0].body !== input.body
      )
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Identificador já usado em outra mensagem.",
        );
      return view(old.rows[0]);
    }
    const id = randomUUID();
    await c.query(
      "INSERT INTO messages(id,conversation_id,sender_id,client_id,body) VALUES($1,$2,$3,$4,$5)",
      [id, input.conversationId, userId, input.clientId, input.body],
    );
    await c.query("INSERT INTO outbox(message_id) VALUES($1)", [id]);
    const result = await c.query<MessageRow>(messageSelect + " WHERE m.id=$1", [
      id,
    ]);
    return view(result.rows[0]!);
  });
}
export async function changeMember(
  id: string,
  ownerId: string,
  memberId: string,
  remove: boolean,
) {
  return transaction(async (c) => {
    await c.query("SELECT id FROM conversations WHERE id=$1 FOR UPDATE", [id]);
    const conversation = await authorize(id, ownerId, c);
    if (conversation.kind !== "GROUP" || conversation.created_by !== ownerId)
      throw new AppError(
        403,
        "FORBIDDEN",
        "Somente quem criou o grupo pode gerenciar participantes.",
      );
    if (memberId === ownerId)
      throw new AppError(
        400,
        "OWNER_REQUIRED",
        "A pessoa que criou o grupo deve permanecer nele.",
      );
    const ids = await memberIds(id, c);
    if (remove) {
      await c.query(
        "DELETE FROM members WHERE conversation_id=$1 AND user_id=$2",
        [id, memberId],
      );
    } else {
      if (ids.length >= 50)
        throw new AppError(
          400,
          "GROUP_FULL",
          "O grupo atingiu 50 participantes.",
        );
      if (
        !(await c.query("SELECT id FROM users WHERE id=$1", [memberId]))
          .rowCount
      )
        throw new AppError(404, "USER_NOT_FOUND", "Pessoa não encontrada.");
      await c.query(
        "INSERT INTO members(conversation_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, memberId],
      );
    }
    return [...new Set([...ids, memberId])];
  });
}
export async function markRead(id: string, userId: string, sequence: string) {
  await authorize(id, userId);
  await db.query(
    "UPDATE members SET last_read_seq=GREATEST(last_read_seq,LEAST($3::bigint,COALESCE((SELECT max(seq) FROM messages WHERE conversation_id=$1),0))) WHERE conversation_id=$1 AND user_id=$2",
    [id, userId, sequence],
  );
}
export async function publicUsers(
  query: string,
  selfId: string,
): Promise<User[]> {
  const result = await db.query(
    "SELECT id,handle,display_name FROM users WHERE id<>$1 AND (strpos(lower(handle),lower($2))>0 OR strpos(lower(display_name),lower($2))>0) ORDER BY display_name LIMIT 30",
    [selfId, query],
  );
  return result.rows.map((r) => ({
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
  }));
}
