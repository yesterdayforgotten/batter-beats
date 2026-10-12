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
  `
  CREATE TABLE songs (
    id            INTEGER PRIMARY KEY,
    title         TEXT NOT NULL,
    artist        TEXT NOT NULL DEFAULT '',
    original_name TEXT NOT NULL,
    duration_ms   INTEGER NOT NULL,
    uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE TABLE rosters (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE TABLE players (
    id              INTEGER PRIMARY KEY,
    roster_id       INTEGER NOT NULL REFERENCES rosters(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    number          TEXT NOT NULL DEFAULT '',
    lineup_position INTEGER NOT NULL,
    available       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE INDEX players_roster ON players(roster_id, lineup_position);
  -- A player's walkup songs. Only position 0 is used for now; the table allows
  -- several songs per player later.
  CREATE TABLE player_songs (
    id               INTEGER PRIMARY KEY,
    player_id        INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    song_id          INTEGER NOT NULL REFERENCES songs(id),
    position         INTEGER NOT NULL DEFAULT 0,
    start_ms         INTEGER NOT NULL DEFAULT 0,
    end_ms           INTEGER NOT NULL,
    fade_ms          INTEGER NOT NULL DEFAULT 3000,
    volume           REAL NOT NULL DEFAULT 1.0,
    gain_db          REAL NOT NULL DEFAULT 0,
    bass_db          REAL NOT NULL DEFAULT 0,
    treble_db        REAL NOT NULL DEFAULT 0,
    -- The cut clip file and what is baked into it.
    clip_file        TEXT,
    clip_offset_ms   INTEGER NOT NULL DEFAULT 0,
    clip_play_ms     INTEGER NOT NULL DEFAULT 0,
    clip_file_gain_db REAL NOT NULL DEFAULT 0,
    clip_max_gain_db REAL NOT NULL DEFAULT 0,
    clip_version     INTEGER NOT NULL DEFAULT 0,
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (player_id, position)
  );
  `,
  `
  -- When the lineup was last changed, as reported by the phone that changed it.
  -- Changes made offline arrive later; an older change never overwrites a newer one.
  ALTER TABLE rosters ADD COLUMN order_changed_at TEXT;
  ALTER TABLE players ADD COLUMN available_changed_at TEXT;
  `,
];

const current = db.pragma("user_version", { simple: true }) as number;
for (let v = current; v < migrations.length; v++) {
  db.transaction(() => {
    db.exec(migrations[v]);
    db.pragma(`user_version = ${v + 1}`);
  })();
}
