import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { parse, serialize } from "cookie";
import argon2 from "argon2";
import type { Request, Response } from "express";
import type { SessionView, User } from "@nexo/contracts";
import { db } from "./db.js";
import { config } from "./config.js";
import { AppError } from "./errors.js";
export const cookieName = "conversa_session";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export type Session = {
  tokenHash: string;
  csrfToken: string;
  expiresAt: Date;
  user: User;
};
export function sameToken(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function sessionFromCookie(
  cookie: string | undefined,
): Promise<Session> {
  const raw = parse(cookie || "")[cookieName];
  if (!raw || !/^([a-f0-9]{64})$/.test(raw))
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Entre na sua conta para continuar.",
    );
  const { rows } = await db.query(
    "SELECT s.*,u.handle,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()",
    [hash(raw)],
  );
  const r = rows[0];
  if (!r)
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Sua sessão expirou. Entre novamente.",
    );
  return {
    tokenHash: r.token_hash,
    csrfToken: r.csrf_token,
    expiresAt: r.expires_at,
    user: { id: r.user_id, handle: r.handle, displayName: r.display_name },
  };
}
export function requireOrigin(req: Request) {
  if (req.headers.origin !== config.APP_ORIGIN)
    throw new AppError(403, "ORIGIN_REJECTED", "Origem não permitida.");
}
export function requireCsrf(req: Request, session: Session) {
  requireOrigin(req);
  const token = req.get("X-CSRF-Token") || "";
  if (!sameToken(token, session.csrfToken))
    throw new AppError(
      403,
      "CSRF_REJECTED",
      "Atualize a página e tente novamente.",
    );
}
export async function issueSession(
  user: User,
  res: Response,
): Promise<SessionView> {
  const token = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + config.sessionMs);
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,$4)",
    [hash(token), user.id, csrfToken, expiresAt],
  );
  res.setHeader(
    "Set-Cookie",
    serialize(cookieName, token, {
      httpOnly: true,
      secure: config.secureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: config.sessionMs / 1000,
    }),
  );
  return { user, csrfToken, expiresAt: expiresAt.toISOString() };
}
export function clearSession(res: Response) {
  res.setHeader(
    "Set-Cookie",
    serialize(cookieName, "", {
      httpOnly: true,
      secure: config.secureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    }),
  );
}
let hashing = 0;
export async function passwordWork<T>(work: () => Promise<T>) {
  if (hashing >= 2)
    throw new AppError(
      429,
      "AUTH_BUSY",
      "Muitas tentativas. Aguarde um instante.",
    );
  hashing++;
  try {
    return await work();
  } finally {
    hashing--;
  }
}
export const hashPassword = (password: string) =>
  passwordWork(() =>
    argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    }),
  );
export async function authenticate(
  email: string,
  password: string,
): Promise<User> {
  const { rows } = await db.query("SELECT * FROM users WHERE email=$1", [
    email,
  ]);
  const r = rows[0];
  // Unknown users do equivalent expensive work to reduce timing-based enumeration.
  const valid = r
    ? await passwordWork(() => argon2.verify(r.password_hash, password))
    : await passwordWork(async () => {
        await argon2.hash(password, {
          type: argon2.argon2id,
          memoryCost: 65536,
          timeCost: 3,
          parallelism: 1,
        });
        return false;
      });
  if (!r || !valid)
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "E-mail ou senha incorretos.",
    );
  return { id: r.id, handle: r.handle, displayName: r.display_name };
}
export async function register(input: {
  email: string;
  password: string;
  handle: string;
  displayName: string;
}): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  const user = {
    id: randomUUID(),
    handle: input.handle,
    displayName: input.displayName,
  };
  try {
    await db.query(
      "INSERT INTO users(id,email,handle,display_name,password_hash) VALUES($1,$2,$3,$4,$5)",
      [user.id, input.email, user.handle, user.displayName, passwordHash],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new AppError(
        409,
        "ACCOUNT_UNAVAILABLE",
        "Não foi possível criar a conta com esses dados.",
      );
    throw error;
  }
  return user;
}
