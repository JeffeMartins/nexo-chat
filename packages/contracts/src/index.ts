import { z } from "zod";
export const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (v) =>
        Array.from(v).every((character) => {
          const code = character.charCodeAt(0);
          return code >= 32 || code === 9 || code === 10 || code === 13;
        }),
      "Caracteres inválidos",
    );
export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(128),
  })
  .strict();
export const signupSchema = loginSchema.extend({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,24}$/),
  displayName: text(60).refine((v) => v.length >= 2),
});
export const sendSchema = z
  .object({ conversationId: uuid, clientId: uuid, body: text(4000) })
  .strict();
export const directSchema = z.object({ userId: uuid }).strict();
export const groupSchema = z
  .object({ title: text(80), memberIds: z.array(uuid).min(2).max(49) })
  .strict();
export const memberSchema = z.object({ userId: uuid }).strict();
export type User = { id: string; handle: string; displayName: string };
export type DirectoryUser = User & { online: boolean | null };
export type Message = {
  id: string;
  sequence: string;
  conversationId: string;
  clientId: string;
  body: string;
  sender: User;
  createdAt: string;
};
export type Conversation = {
  id: string;
  kind: "DIRECT" | "GROUP";
  title: string | null;
  createdBy: string;
  members: User[];
  lastMessage: Message | null;
  unreadCount: number;
};
export type SessionView = { user: User; csrfToken: string; expiresAt: string };
export type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
