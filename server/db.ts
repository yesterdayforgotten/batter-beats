import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.ts";

export const DB_FILE = path.join(config.dataDir, "batter-beats.db");

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
  `
  -- Announcer. Wording and on/off per team; spelling, on/off and song timing per player.
  ALTER TABLE rosters ADD COLUMN announce_enabled INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE rosters ADD COLUMN announce_template TEXT NOT NULL DEFAULT 'Now batting, number {number}, {name}';
  ALTER TABLE players ADD COLUMN pronunciation TEXT NOT NULL DEFAULT '';
  ALTER TABLE players ADD COLUMN announce_enabled INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE players ADD COLUMN song_delay_ms INTEGER NOT NULL DEFAULT 0;
  -- The generated announcement: file, what it was made from (so it is only remade when that changes), length.
  ALTER TABLE players ADD COLUMN announce_file TEXT;
  ALTER TABLE players ADD COLUMN announce_key TEXT;
  ALTER TABLE players ADD COLUMN announce_ms INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN announce_error TEXT;
  -- App-wide settings (for example the announcer voice).
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  -- Each user's own between-innings playlist, from the shared library.
  CREATE TABLE playlist_songs (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id  INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (user_id, song_id)
  );
  `,
  `
  -- Each team's announcer voice (one per engine, as JSON {"elevenlabs": "<voice id>"}) and
  -- delivery (JSON, as AnnouncerStyle). Empty means the app-wide defaults.
  ALTER TABLE rosters ADD COLUMN announcer_voices TEXT;
  ALTER TABLE rosters ADD COLUMN announcer_style TEXT;
  `,
  `
  -- Each team's colour, one of TEAM_COLORS' ids.
  ALTER TABLE rosters ADD COLUMN color TEXT NOT NULL DEFAULT 'blue';
  `,
  `
  -- Free-form tags on songs (a team, a player, "warm-up"…), for finding and filtering them.
  CREATE TABLE song_tags (
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (song_id, tag)
  );
  `,
  `
  -- Playlists are shared by everyone (editors manage them) and there can be many.
  -- Each user's old personal playlist becomes a shared one named after them.
  CREATE TABLE playlists (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE TABLE playlist_items (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, song_id)
  );
  INSERT INTO playlists (id, name)
    SELECT u.id, u.username || '''s playlist' FROM users u
    WHERE EXISTS (SELECT 1 FROM playlist_songs ps WHERE ps.user_id = u.id);
  INSERT INTO playlist_items (playlist_id, song_id, position)
    SELECT user_id, song_id, position FROM playlist_songs;
  DROP TABLE playlist_songs;
  `,
  `
  -- A fingerprint of each song's audio frames (not its tags), to recognise the
  -- same recording uploaded again. Filled in at startup for songs from before.
  ALTER TABLE songs ADD COLUMN audio_hash TEXT;
  CREATE INDEX songs_audio_hash ON songs(audio_hash);
  `,
  `
  -- Players deleted in the last few minutes, so a delete can be undone: their
  -- row and clip settings as JSON (their files are kept until it's purged).
  CREATE TABLE deleted_players (
    id         INTEGER PRIMARY KEY,
    roster_id  INTEGER NOT NULL,
    data       TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  `,
  `
  -- The announcer's built-in defaults changed (Hyped energy and new cues, for
  -- new teams). Delivery settings saved before then, and the app-wide ones if
  -- never saved, keep the earlier defaults, so existing announcements stay as
  -- they are (and aren't all remade, spending voice credits).
  INSERT OR IGNORE INTO settings (key, value) VALUES ('announcer_style', '{"speed":1,"energy":"lively","pitch":0,"reverb":0,"reverbSize":0.6,"excitement":1,"elevenTag":"[shouting] [excited]"}');
  UPDATE settings SET value = json_set(value,
      '$.energy', coalesce(json_extract(value, '$.energy'), 'lively'),
      '$.elevenTag', coalesce(json_extract(value, '$.elevenTag'), '[shouting] [excited]'))
    WHERE key = 'announcer_style' AND json_valid(value);
  UPDATE rosters SET announcer_style = json_set(announcer_style,
      '$.energy', coalesce(json_extract(announcer_style, '$.energy'), 'lively'),
      '$.elevenTag', coalesce(json_extract(announcer_style, '$.elevenTag'), '[shouting] [excited]'))
    WHERE announcer_style IS NOT NULL AND json_valid(announcer_style);
  `,
];

/** Opens a database file and brings it up to the current version. */
export function openDatabase(file: string): Database.Database {
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  const current = d.pragma("user_version", { simple: true }) as number;
  if (current > migrations.length) {
    d.close();
    throw new Error("This database is from a newer version of Batter Beats.");
  }
  for (let v = current; v < migrations.length; v++) {
    d.transaction(() => {
      d.exec(migrations[v]);
      d.pragma(`user_version = ${v + 1}`);
    })();
  }
  return d;
}

// `let`, so a restore can swap in a different database; modules that import
// `db` always see the current one.
export let db = openDatabase(DB_FILE);

/**
 * An id for a new player or player-song row. SQLite would reuse the highest id
 * when that row was just deleted, but a deleted player can still be brought
 * back for a few minutes, and their files (named after these ids) are only
 * cleared later; so ids in those snapshots are skipped too.
 */
export function freshId(table: "players" | "player_songs"): number {
  const max = (sql: string) => ((db.prepare(sql).get() as { m: number | null }).m ?? 0);
  const deleted =
    table === "players"
      ? max("SELECT max(id) AS m FROM deleted_players")
      : max("SELECT max(json_extract(s.value, '$.id')) AS m FROM deleted_players d, json_each(d.data, '$.songs') s");
  return Math.max(max(`SELECT max(id) AS m FROM ${table}`), deleted) + 1;
}

/** Reopens the database file (after a restore has replaced it). */
export function reopenDatabase() {
  db = openDatabase(DB_FILE);
}
