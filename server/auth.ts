import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db.ts";
import { findUserById, toUser } from "./users.ts";
import type { Role, User } from "../shared/types.ts";

export const SESSION_COOKIE = "bb_session";
// Browsers cap cookie lifetimes at 400 days. The cookie is renewed on use, so
// a phone that opens the app at least once a year stays signed in until the
// user signs out.
const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionTokenHash?: string;
    }
  }
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(req: Request, res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

export function startSession(req: Request, res: Response, userId: number) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token_hash, user_id, user_agent) VALUES (?, ?, ?)").run(
    hashToken(token),
    userId,
    req.get("user-agent")?.slice(0, 300) ?? null,
  );
  setSessionCookie(req, res, token);
}

export function endSession(req: Request, res: Response) {
  if (req.sessionTokenHash) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(req.sessionTokenHash);
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Looks up the signed-in user, if any. Never rejects the request. */
export function loadUser(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || !token) return next();

  const tokenHash = hashToken(token);
  const session = db
    .prepare("SELECT user_id, last_seen FROM sessions WHERE token_hash = ?")
    .get(tokenHash) as { user_id: number; last_seen: string } | undefined;
  if (!session) return next();

  const row = findUserById(session.user_id);
  if (!row) return next();

  req.user = toUser(row);
  req.sessionTokenHash = tokenHash;

  if (Date.now() - Date.parse(session.last_seen) > RENEW_AFTER_MS) {
    db.prepare(
      "UPDATE sessions SET last_seen = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE token_hash = ?",
    ).run(tokenHash);
    setSessionCookie(req, res, token);
  }
  next();
}

const RANK: Record<Role, number> = { user: 0, editor: 1, admin: 2 };

/** Rejects the request unless the user is signed in with at least this role. */
export function requireRole(minimum: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Please sign in." });
    if (RANK[req.user.role] < RANK[minimum]) {
      return res.status(403).json({ error: "You don't have permission to do that." });
    }
    next();
  };
}

// Slows down password guessing: after too many failed sign-ins from one
// address, further attempts are refused for a while.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; since: number }>();

export function isLockedOut(ip: string): boolean {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.since > FAILURE_WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordFailure(ip: string) {
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.since > FAILURE_WINDOW_MS) {
    failures.set(ip, { count: 1, since: Date.now() });
  } else {
    entry.count++;
  }
}

export function clearFailures(ip: string) {
  failures.delete(ip);
}
