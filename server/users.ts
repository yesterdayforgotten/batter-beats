import { db } from "./db.ts";
import { config } from "./config.ts";
import { hashPassword, randomPassword } from "./passwords.ts";
import type { Role, User } from "../shared/types.ts";

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  created_at: string;
}

export function toUser(row: UserRow): User {
  return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at };
}

export function findUserById(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function findUserByName(username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

export function listUsers(): User[] {
  const rows = db.prepare("SELECT * FROM users ORDER BY username COLLATE NOCASE").all() as UserRow[];
  return rows.map(toUser);
}

export function countAdmins(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
}

export async function createUser(username: string, password: string, role: Role): Promise<User> {
  const hash = await hashPassword(password);
  const info = db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
    .run(username, hash, role);
  return toUser(findUserById(Number(info.lastInsertRowid))!);
}

/** Creates the first admin when the database has no users yet. */
export async function ensureFirstAdmin(): Promise<void> {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (n > 0) return;
  const password = config.adminPassword || randomPassword();
  await createUser(config.adminUsername, password, "admin");
  console.log("────────────────────────────────────────────");
  console.log(` First admin account created`);
  console.log(`   username: ${config.adminUsername}`);
  if (config.adminPassword) console.log("   password: (the ADMIN_PASSWORD from your settings)");
  else console.log(`   password: ${password}`);
  console.log(" Sign in and change it from the Users screen.");
  console.log("────────────────────────────────────────────");
}
