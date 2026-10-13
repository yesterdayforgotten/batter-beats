import { Router, type NextFunction, type Request, type Response } from "express";
import { db } from "../db.ts";
import { requireRole } from "../auth.ts";
import { removeQuietly } from "../audio.ts";
import { announcementPath, clipPath } from "../storage.ts";
import { cleanStyle, currentStyle, refreshAnnouncements, refreshRosterAnnouncements, setTeamAnnouncer } from "../announcer.ts";
import { ANNOUNCER, TEAM_COLORS } from "../../shared/types.ts";
import {
  getPlayer,
  getRoster,
  listRosters,
  setPlayerSong,
  touchRoster,
  updateClip,
  UserError,
  type ClipSettings,
} from "../library.ts";

export const rostersRouter = Router();
rostersRouter.use(requireRole("user"));

const editor = requireRole("editor");

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
/** Passes errors from async handlers on, and shows UserError messages to the user. */
function handle(fn: Handler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof UserError) res.status(400).json({ error: err.message });
      else next(err);
    }
  };
}

function removeClipFiles(where: string, id: number) {
  const files = db
    .prepare(
      `SELECT ps.clip_file FROM player_songs ps JOIN players p ON p.id = ps.player_id
       WHERE ${where} = ? AND ps.clip_file IS NOT NULL`,
    )
    .all(id) as { clip_file: string }[];
  for (const f of files) removeQuietly(clipPath(f.clip_file));
  const spoken = db
    .prepare(`SELECT p.announce_file FROM players p WHERE ${where} = ? AND p.announce_file IS NOT NULL`)
    .all(id) as { announce_file: string }[];
  for (const f of spoken) removeQuietly(announcementPath(f.announce_file));
}

// ── Rosters ──────────────────────────────────────────────────────────────

rostersRouter.get("/rosters", (_req, res) => {
  res.json({ rosters: listRosters() });
});

rostersRouter.post("/rosters", editor, (req, res) => {
  const name = text(req.body?.name, 80);
  if (!name) return res.status(400).json({ error: "Give the team a name." });
  // New teams start with the default wording and Hyped energy (the rest of the delivery follows the app-wide settings).
  const id = Number(
    db
      .prepare("INSERT INTO rosters (name, announce_template, announcer_style) VALUES (?, ?, ?)")
      .run(name, ANNOUNCER.defaultTemplate, JSON.stringify(cleanStyle({ ...currentStyle(), energy: "hyped" })))
      .lastInsertRowid,
  );
  res.status(201).json({ roster: getRoster(id) });
});

rostersRouter.get("/rosters/:id", (req, res) => {
  const roster = getRoster(Number(req.params.id));
  if (!roster) return res.status(404).json({ error: "Team not found." });
  res.json({ roster });
});

rostersRouter.patch("/rosters/:id", editor, (req, res) => {
  const id = Number(req.params.id);
  const roster = getRoster(id);
  if (!roster) return res.status(404).json({ error: "Team not found." });
  const name = req.body?.name === undefined ? roster.name : text(req.body.name, 80);
  if (!name) return res.status(400).json({ error: "Give the team a name." });
  const announce = req.body?.announce === undefined ? roster.announce : !!req.body.announce;
  const template =
    req.body?.announceTemplate === undefined
      ? roster.announceTemplate
      : text(req.body.announceTemplate, 200) || ANNOUNCER.defaultTemplate;
  if (!template.includes("{name}")) return res.status(400).json({ error: "The wording needs {name} where the name goes." });
  const color = req.body?.color === undefined ? roster.color : String(req.body.color);
  if (!TEAM_COLORS.some((c) => c.id === color)) return res.status(400).json({ error: "That isn't one of the team colours." });
  db.prepare("UPDATE rosters SET name = ?, color = ?, announce_enabled = ?, announce_template = ? WHERE id = ?").run(
    name,
    color,
    announce ? 1 : 0,
    template,
    id,
  );
  touchRoster(id);
  void refreshRosterAnnouncements(id);
  res.json({ roster: getRoster(id) });
});

rostersRouter.delete("/rosters/:id", editor, (req, res) => {
  const id = Number(req.params.id);
  removeClipFiles("p.roster_id", id);
  db.prepare("DELETE FROM rosters WHERE id = ?").run(id);
  res.json({ ok: true });
});

/**
 * When a lineup change was made, from the request (phones send it, since a
 * change made offline arrives later). Defaults to now; never later than now.
 */
function changedAt(value: unknown): string {
  const now = new Date();
  const t = typeof value === "string" ? new Date(value) : now;
  return (isNaN(t.getTime()) || t > now ? now : t).toISOString();
}

// The team's announcer voice and/or delivery; its announcements are remade.
rostersRouter.put("/rosters/:id/announcer", editor, (req, res) => {
  const id = Number(req.params.id);
  if (!getRoster(id)) return res.status(404).json({ error: "Team not found." });
  const voice = typeof req.body?.voice === "string" ? req.body.voice.trim().slice(0, 100) : undefined;
  const style = req.body?.style;
  const template =
    typeof req.body?.announceTemplate === "string" ? text(req.body.announceTemplate, 200) || ANNOUNCER.defaultTemplate : undefined;
  if (voice === undefined && style === undefined && template === undefined) {
    return res.status(400).json({ error: "Nothing to change." });
  }
  if (template !== undefined && !template.includes("{name}")) {
    return res.status(400).json({ error: "The wording needs {name} where the name goes." });
  }
  // Wording, voice and delivery are saved together, so the announcements are remade once.
  if (template !== undefined) db.prepare("UPDATE rosters SET announce_template = ? WHERE id = ?").run(template, id);
  setTeamAnnouncer(id, { voice, style });
  touchRoster(id);
  void refreshRosterAnnouncements(id);
  res.json({ roster: getRoster(id) });
});

// Batting order. Everyone can reorder the lineup (it's part of running a game), not just editors.
// If a newer order is already saved, this one is ignored: the most recent change wins.
rostersRouter.put("/rosters/:id/order", (req, res) => {
  const rosterId = Number(req.params.id);
  const roster = getRoster(rosterId);
  if (!roster) return res.status(404).json({ error: "Team not found." });
  const at = changedAt(req.body?.changedAt);
  const saved = db.prepare("SELECT order_changed_at FROM rosters WHERE id = ?").get(rosterId) as {
    order_changed_at: string | null;
  };
  if (saved.order_changed_at && saved.order_changed_at > at) return res.json({ roster, applied: false });

  // Players added or removed since the phone last saw the roster: keep the
  // order it sent for the ones it knew, and the others where they already were.
  const sent: number[] = Array.isArray(req.body?.playerIds) ? req.body.playerIds.map(Number) : [];
  const known = new Set(roster.players.map((p) => p.id));
  const ids = [...new Set(sent.filter((id) => known.has(id)))];
  for (const p of roster.players) if (!ids.includes(p.id)) ids.push(p.id);

  const set = db.prepare("UPDATE players SET lineup_position = ? WHERE id = ?");
  db.transaction(() => {
    ids.forEach((id, i) => set.run(i, id));
    db.prepare("UPDATE rosters SET order_changed_at = ? WHERE id = ?").run(at, rosterId);
  })();
  touchRoster(rosterId);
  res.json({ roster: getRoster(rosterId), applied: true });
});

// ── Players ──────────────────────────────────────────────────────────────

rostersRouter.post("/rosters/:id/players", editor, (req, res) => {
  const rosterId = Number(req.params.id);
  if (!getRoster(rosterId)) return res.status(404).json({ error: "Team not found." });
  const name = text(req.body?.name, 80);
  const number = text(req.body?.number, 4);
  if (!name) return res.status(400).json({ error: "Enter the player's name." });
  const { next } = db
    .prepare("SELECT COALESCE(MAX(lineup_position), -1) + 1 AS next FROM players WHERE roster_id = ?")
    .get(rosterId) as { next: number };
  const id = Number(
    db
      .prepare("INSERT INTO players (roster_id, name, number, lineup_position) VALUES (?, ?, ?, ?)")
      .run(rosterId, name, number, next).lastInsertRowid,
  );
  touchRoster(rosterId);
  void refreshAnnouncements([id]);
  res.status(201).json({ player: getPlayer(id) });
});

rostersRouter.get("/players/:id", (req, res) => {
  const player = getPlayer(Number(req.params.id));
  if (!player) return res.status(404).json({ error: "Player not found." });
  res.json({ player });
});

rostersRouter.patch("/players/:id", editor, (req, res) => {
  const player = getPlayer(Number(req.params.id));
  if (!player) return res.status(404).json({ error: "Player not found." });
  const b = req.body ?? {};
  const name = b.name === undefined ? player.name : text(b.name, 80);
  const number = b.number === undefined ? player.number : text(b.number, 4);
  const pronunciation = b.pronunciation === undefined ? player.pronunciation : text(b.pronunciation, 200);
  const announce = b.announce === undefined ? player.announce : !!b.announce;
  const delay = b.songDelayMs === undefined ? player.songDelayMs : Number(b.songDelayMs);
  if (!name) return res.status(400).json({ error: "Enter the player's name." });
  if (!Number.isFinite(delay)) return res.status(400).json({ error: "The song timing isn't a number." });
  db.prepare(
    `UPDATE players SET name = ?, number = ?, pronunciation = ?, announce_enabled = ?, song_delay_ms = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
  ).run(name, number, pronunciation, announce ? 1 : 0, Math.round(Math.max(0, Math.min(delay, ANNOUNCER.maxSongDelayMs))), player.id);
  touchRoster(player.rosterId);
  void refreshAnnouncements([player.id]);
  res.json({ player: getPlayer(player.id) });
});

// Brings the player's announcement up to date and waits for it, for the editor's "Listen" button.
rostersRouter.post("/players/:id/announcement", editor, async (req, res) => {
  const player = getPlayer(Number(req.params.id));
  if (!player) return res.status(404).json({ error: "Player not found." });
  await refreshAnnouncements([player.id]);
  res.json({ player: getPlayer(player.id) });
});

// Sitting a player out for today's game is part of running a game, so any signed-in user can do it.
// As with the order, an older change never overwrites a newer one.
rostersRouter.put("/players/:id/available", (req, res) => {
  const player = getPlayer(Number(req.params.id));
  if (!player) return res.status(404).json({ error: "Player not found." });
  const at = changedAt(req.body?.changedAt);
  const saved = db.prepare("SELECT available_changed_at FROM players WHERE id = ?").get(player.id) as {
    available_changed_at: string | null;
  };
  if (saved.available_changed_at && saved.available_changed_at > at) return res.json({ player, applied: false });
  db.prepare("UPDATE players SET available = ?, available_changed_at = ? WHERE id = ?").run(
    req.body?.available ? 1 : 0,
    at,
    player.id,
  );
  touchRoster(player.rosterId);
  res.json({ player: getPlayer(player.id), applied: true });
});

rostersRouter.delete("/players/:id", editor, (req, res) => {
  const player = getPlayer(Number(req.params.id));
  if (!player) return res.status(404).json({ error: "Player not found." });
  removeClipFiles("p.id", player.id);
  db.prepare("DELETE FROM players WHERE id = ?").run(player.id);
  touchRoster(player.rosterId);
  res.json({ ok: true });
});

rostersRouter.put(
  "/players/:id/song",
  editor,
  handle(async (req, res) => {
    const player = getPlayer(Number(req.params.id));
    if (!player) return res.status(404).json({ error: "Player not found." });
    await setPlayerSong(player.id, Number(req.body?.songId));
    res.json({ player: getPlayer(player.id) });
  }),
);

rostersRouter.patch(
  "/players/:id/clip",
  editor,
  handle(async (req, res) => {
    const player = getPlayer(Number(req.params.id));
    if (!player) return res.status(404).json({ error: "Player not found." });
    const keys: (keyof ClipSettings)[] = ["startMs", "endMs", "fadeMs", "volume", "gainDb", "bassDb", "trebleDb"];
    const changes: Partial<ClipSettings> = {};
    for (const k of keys) if (req.body?.[k] !== undefined) changes[k] = Number(req.body[k]);
    await updateClip(player.id, changes);
    res.json({ player: getPlayer(player.id) });
  }),
);
