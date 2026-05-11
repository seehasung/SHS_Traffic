import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db';
import { jwtSecretPath } from './paths';

const JWT_ALG = 'HS256';
const SESSION_COOKIE = 'agent_session';
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30일

let _secret: Uint8Array | null = null;
function secret(): Uint8Array {
  if (_secret) return _secret;
  const p = jwtSecretPath();
  if (fs.existsSync(p)) {
    _secret = new Uint8Array(fs.readFileSync(p));
  } else {
    const buf = new Uint8Array(64);
    require('node:crypto').webcrypto.getRandomValues(buf);
    fs.writeFileSync(p, Buffer.from(buf));
    _secret = buf;
  }
  return _secret!;
}

export interface SessionPayload {
  uid: number;
  email: string;
  isAdmin: boolean;
  role: 'admin' | 'worker';
  workerId?: string;
  assignedGroupNames?: string[];
}

export async function issueSessionCookie(res: Response, payload: SessionPayload) {
  const token = await new SignJWT({ ...payload } as Record<string, unknown>)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secret());
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_SEC * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE);
}

export async function readSession(req: Request): Promise<SessionPayload | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      uid: payload.uid as number,
      email: payload.email as string,
      isAdmin: !!payload.isAdmin,
      role: (payload.role as 'admin' | 'worker') ?? 'admin',
      workerId: payload.workerId as string | undefined,
      assignedGroupNames: payload.assignedGroupNames as string[] | undefined,
    };
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await readSession(req);
  if (!session) return res.status(401).json({ error: 'UNAUTHORIZED' });
  (req as any).session = session;
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session as SessionPayload | undefined;
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'ADMIN_ONLY' });
  next();
}

export function isFirstRun(): boolean {
  const row = db().prepare(`SELECT COUNT(1) AS c FROM users`).get() as { c: number };
  return row.c === 0;
}

export function createUser(email: string, password: string, isAdmin: boolean) {
  const hash = bcrypt.hashSync(password, 10);
  db()
    .prepare(`INSERT INTO users(email, password_hash, is_admin, created_at) VALUES(?, ?, ?, ?)`)
    .run(email, hash, isAdmin ? 1 : 0, Date.now());
}

export function verifyLogin(email: string, password: string): SessionPayload | null {
  const row = db()
    .prepare(`SELECT id, email, password_hash, is_admin FROM users WHERE email = ?`)
    .get(email) as { id: number; email: string; password_hash: string; is_admin: number } | undefined;
  if (!row) return null;
  const ok = bcrypt.compareSync(password, row.password_hash);
  if (!ok) return null;
  return { uid: row.id, email: row.email, isAdmin: !!row.is_admin, role: 'admin' };
}

export function verifyWorkerLogin(loginId: string, password: string): SessionPayload | null {
  const row = db()
    .prepare(`SELECT id, name, login_id, login_password, assigned_group_names FROM workers WHERE login_id = ?`)
    .get(loginId) as { id: string; name: string; login_id: string; login_password: string; assigned_group_names: string } | undefined;
  if (!row) return null;
  if (row.login_password !== password) return null;
  const assignedGroupNames: string[] = JSON.parse(row.assigned_group_names || '[]');
  return {
    uid: -1,
    email: row.login_id,
    isAdmin: false,
    role: 'worker',
    workerId: row.id,
    assignedGroupNames,
  };
}
