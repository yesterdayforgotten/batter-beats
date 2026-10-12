import fs from "node:fs";
import { Router } from "express";
import { db } from "../db.ts";
import { requireRole } from "../auth.ts";
import { getSong } from "../library.ts";
import { songPath } from "../storage.ts";
import type { Playlist, PlaylistSong } from "../../shared/types.ts";

// Playlists for the jukebox: songs from the shared library, played whole.
// Shared by everyone; editors create and change them.
export const playlistRouter = Router();
playlistRouter.use("/playlists", requireRole("user"));
const editor = requireRole("editor");

function songsOf(playlistId: number): PlaylistSong[] {
  const rows = db
    .prepare("SELECT song_id FROM playlist_items WHERE playlist_id = ? ORDER BY position")
    .all(playlistId) as { song_id: number }[];
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

function getPlaylist(id: number): Playlist | undefined {
  const row = db.prepare("SELECT id, name FROM playlists WHERE id = ?").get(id) as { id: number; name: string } | undefined;
  return row && { ...row, songs: songsOf(row.id) };
}

const listPlaylists = (): Playlist[] =>
  (db.prepare("SELECT id FROM playlists ORDER BY name COLLATE NOCASE").all() as { id: number }[]).map((r) => getPlaylist(r.id)!);

const cleanName = (v: unknown) => String(v ?? "").trim().slice(0, 80);

playlistRouter.get("/playlists", (_req, res) => {
  res.json({ playlists: listPlaylists() });
});

playlistRouter.post("/playlists", editor, (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: "Give the playlist a name." });
  const id = Number(db.prepare("INSERT INTO playlists (name) VALUES (?)").run(name).lastInsertRowid);
  res.status(201).json({ playlist: getPlaylist(id) });
});

playlistRouter.patch("/playlists/:id", editor, (req, res) => {
  const playlist = getPlaylist(Number(req.params.id));
  if (!playlist) return res.status(404).json({ error: "Playlist not found." });
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: "Give the playlist a name." });
  db.prepare("UPDATE playlists SET name = ? WHERE id = ?").run(name, playlist.id);
  res.json({ playlist: getPlaylist(playlist.id) });
});

/** Replaces the playlist's songs, in this order. */
playlistRouter.put("/playlists/:id/songs", editor, (req, res) => {
  const playlist = getPlaylist(Number(req.params.id));
  if (!playlist) return res.status(404).json({ error: "Playlist not found." });
  const ids: number[] = Array.isArray(req.body?.songIds) ? ([...new Set(req.body.songIds.map(Number))] as number[]) : [];
  const valid = ids.filter((id) => getSong(id));
  const insert = db.prepare("INSERT INTO playlist_items (playlist_id, song_id, position) VALUES (?, ?, ?)");
  db.transaction(() => {
    db.prepare("DELETE FROM playlist_items WHERE playlist_id = ?").run(playlist.id);
    valid.forEach((id, i) => insert.run(playlist.id, id, i));
  })();
  res.json({ playlist: getPlaylist(playlist.id) });
});

playlistRouter.delete("/playlists/:id", editor, (req, res) => {
  db.prepare("DELETE FROM playlists WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});
