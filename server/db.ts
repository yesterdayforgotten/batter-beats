import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.ts";

export const db = new Database(path.join(config.dataDir, "batter-beats.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Each entry upgrades the database by one version. Never edit an entry that
// has shipped; add a new one instead.
const migrations: string[] = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('user', 'editor', 'admin')),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE TABLE sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_seen   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    user_agent  TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  `,
];

const current = db.pragma("user_version", { simple: true }) as number;
for (let v = current; v < migrations.length; v++) {
  db.transaction(() => {
    db.exec(migrations[v]);
    db.pragma(`user_version = ${v + 1}`);
  })();
}
