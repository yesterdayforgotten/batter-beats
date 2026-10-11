import { Router } from "express";
import {
  clearFailures,
  endSession,
  isLockedOut,
  recordFailure,
  requireRole,
  startSession,
} from "../auth.ts";
import { verifyPassword } from "../passwords.ts";
import { findUserByName, toUser } from "../users.ts";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const ip = req.ip ?? "unknown";
  if (isLockedOut(ip)) {
    return res.status(429).json({ error: "Too many failed attempts. Try again in 15 minutes." });
  }
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const row = username ? findUserByName(username) : undefined;
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    recordFailure(ip);
    return res.status(401).json({ error: "Wrong username or password." });
  }
  clearFailures(ip);
  startSession(req, res, row.id);
  res.json({ user: toUser(row) });
});

authRouter.post("/logout", (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

authRouter.get("/me", requireRole("user"), (req, res) => {
  res.json({ user: req.user });
});
