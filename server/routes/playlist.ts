import fs from "node:fs";
import { Router } from "express";
import { db } from "../db.ts";
import { requireRole } from "../auth.ts";
import { getSong } from "../library.ts";
import { songPath } from "../storage.ts";
import type { PlaylistSong } from "../../shared/types.ts";

// Each user's between-innings playlist: songs from the shared library, played
// whole and shuffled. Everyone can build their own.
export const playlistRouter = Router();
playlistRouter.use("/playlist", requireRole("user"));

function playlistOf(userId: number): PlaylistSong[] {
  const rows = db
    .prepare("SELECT song_id FROM playlist_songs WHERE user_id = ? ORDER BY position")
    .all(userId) as { song_id: number }[];
  return rows.flatMap(({ song_id }) => {
    const song = getSong(song_id);
    if (!song) return [];
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(songPath(song_id)).size;
    } catch {
      return [];
    }
    return [{ ...song, url: `/api/media/songs/${song_id}.mp3`, sizeBytes }];
  });
}

playlistRouter.get("/playlist", (req, res) => {
  res.json({ songs: playlistOf(req.user!.id) });
});

playlistRouter.put("/playlist", (req, res) => {
  const ids: number[] = Array.isArray(req.body?.songIds) ? [...new Set(req.body.songIds.map(Number))] as number[] : [];
  const valid = ids.filter((id) => getSong(id));
  const insert = db.prepare("INSERT INTO playlist_songs (user_id, song_id, position) VALUES (?, ?, ?)");
  db.transaction(() => {
    db.prepare("DELETE FROM playlist_songs WHERE user_id = ?").run(req.user!.id);
    valid.forEach((id, i) => insert.run(req.user!.id, id, i));
  })();
  res.json({ songs: playlistOf(req.user!.id) });
});
