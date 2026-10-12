import { Router } from "express";
import { db } from "../db.ts";
import { requireRole } from "../auth.ts";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../passwords.ts";
import { countAdmins, createUser, findUserById, findUserByName, listUsers } from "../users.ts";
import { ROLES, type Role } from "../../shared/types.ts";

export const usersRouter = Router();
usersRouter.use(requireRole("admin"));

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{2,40}$/;

function parseRole(value: unknown): Role | null {
  return ROLES.includes(value as Role) ? (value as Role) : null;
}

function passwordProblem(password: string): string | null {
  return password.length < MIN_PASSWORD_LENGTH
    ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    : null;
}

usersRouter.get("/", (_req, res) => {
  res.json({ users: listUsers() });
});

usersRouter.post("/", async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const role = parseRole(req.body?.role);
  if (!USERNAME_PATTERN.test(username)) {
    return res.status(400).json({
      error: "Username must be 2–40 characters: letters, numbers, dots, dashes or underscores.",
    });
  }
  if (!role) return res.status(400).json({ error: "Choose a role." });
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  if (findUserByName(username)) {
    return res.status(409).json({ error: "That username is already taken." });
  }
  const user = await createUser(username, password, role);
  res.status(201).json({ user });
});

usersRouter.patch("/:id", async (req, res) => {
  const target = findUserById(Number(req.params.id));
  if (!target) return res.status(404).json({ error: "User not found." });

  if (req.body?.role !== undefined) {
    const role = parseRole(req.body.role);
    if (!role) return res.status(400).json({ error: "Choose a role." });
    if (target.role === "admin" && role !== "admin" && countAdmins() <= 1) {
      return res.status(400).json({ error: "There must always be at least one admin." });
    }
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, target.id);
  }

  if (req.body?.password !== undefined) {
    const password = String(req.body.password);
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      await hashPassword(password),
      target.id,
    );
  }

  res.json({ users: listUsers() });
});

// Removing someone signs them out everywhere (their sessions go with them);
// songs they uploaded stay. Admins can't remove themselves or the last admin.
usersRouter.delete("/:id", (req, res) => {
  const target = findUserById(Number(req.params.id));
  if (!target) return res.status(404).json({ error: "User not found." });
  if (target.id === req.user!.id) return res.status(400).json({ error: "You can't remove yourself." });
  if (target.role === "admin" && countAdmins() <= 1) {
    return res.status(400).json({ error: "There must always be at least one admin." });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
  res.json({ users: listUsers() });
});
