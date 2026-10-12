import { Router, type NextFunction, type Request, type Response } from "express";
import { db } from "../db.ts";
import { requireRole } from "../auth.ts";
import { removeQuietly } from "../audio.ts";
import { clipPath } from "../storage.ts";
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
}

// ── Rosters ──────────────────────────────────────────────────────────────

rostersRouter.get("/rosters", (_req, res) => {
  res.json({ rosters: listRosters() });
});

rostersRouter.post("/rosters", editor, (req, res) => {
  const name = text(req.body?.name, 80);
  if (!name) return res.status(400).json({ error: "Give the team a name." });
  const id = Number(db.prepare("INSERT INTO rosters (name) VALUES (?)").run(name).lastInsertRowid);
  res.status(201).json({ roster: getRoster(id) });
});

rostersRouter.get("/rosters/:id", (req, res) => {
  const roster = getRoster(Number(req.params.id));
  if (!roster) return res.status(404).json({ error: "Team not found." });
  res.json({ roster });
});

rostersRouter.patch("/rosters/:id", editor, (req, res) => {
  const id = Number(req.params.id);
  if (!getRoster(id)) return res.status(404).json({ error: "Team not found." });
  const name = text(req.body?.name, 80);
  if (!name) return res.status(400).json({ error: "Give the team a name." });
  db.prepare("UPDATE rosters SET name = ? WHERE id = ?").run(name, id);
  touchRoster(id);
  res.json({ roster: getRoster(id) });
});

rostersRouter.delete("/rosters/:id", editor, (req, res) => {
  const id = Number(req.params.id);
  removeClipFiles("p.roster_id", id);
  db.prepare("DELETE FROM rosters WHERE id = ?").run(id);
  res.json({ ok: true });
});

// Batting order. Everyone can reorder the lineup (it's part of running a game), not just editors.
rostersRouter.put("/rosters/:id/order", (req, res) => {
  const rosterId = Number(req.params.id);
  const roster = getRoster(rosterId);
  if (!roster) return res.status(404).json({ error: "Team not found." });
  const ids = Array.isArray(req.body?.playerIds) ? req.body.playerIds.map(Number) : [];
  const current = new Set(roster.players.map((p) => p.id));
  if (ids.length !== current.size || new Set(ids).size !== ids.length || !ids.every((id: number) => current.has(id))) {
    return res.status(409).json({ error: "The roster changed on another phone. Reload and try again." });
  }
  const set = db.prepare("UPDATE players SET lineup_position = ? WHERE id = ?");
  db.transaction(() => ids.forEach((id: number, i: number) => set.run(i, id)))();
  touchRoster(rosterId);
  res.json({ roster: getRoster(rosterId) });
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
  const name = req.body?.name === undefined ? player.name : text(req.body.name, 80);
  const number = req.body?.number === undefined ? player.number : text(req.body.number, 4);
  if (!name) return res.status(400).json({ error: "Enter the player's name." });
  db.prepare(
    "UPDATE players SET name = ?, number = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
  ).run(name, number, player.id);
  touchRoster(player.rosterId);
  res.json({ player: getPlayer(player.id) });
});

// Sitting a player out for today's game is part of running a game, so any signed-in user can do it.
rostersRouter.put("/players/:id/available", (req, res) => {
  const player = getPlayer(Number(req.params.id));
  if (!player) return res.status(404).json({ error: "Player not found." });
  db.prepare("UPDATE players SET available = ? WHERE id = ?").run(req.body?.available ? 1 : 0, player.id);
  touchRoster(player.rosterId);
  res.json({ player: getPlayer(player.id) });
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
