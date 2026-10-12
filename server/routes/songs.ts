import fs from "node:fs";
import { Router } from "express";
import multer from "multer";
import { requireRole } from "../auth.ts";
import { addSong, deleteSong, editTagsOf, getSong, listLibrary, listSongs, renameSong, setSongTags, tagSuggestions, UserError } from "../library.ts";
import { cleanTags } from "../../shared/types.ts";
import { announcementPath, clipPath, dirs, peaksPath, songPath } from "../storage.ts";

export const songsRouter = Router();
songsRouter.use(requireRole("user"));

const upload = multer({
  dest: dirs.tmp,
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
});

songsRouter.get("/songs", (_req, res) => {
  res.json({ songs: listSongs() });
});

// The Songs screen: every song with where it's used; rename; delete.
songsRouter.get("/songs/library", requireRole("editor"), (_req, res) => {
  res.json({ songs: listLibrary(), suggestions: tagSuggestions() });
});

// Many songs at once (the Music screen's Select): { songIds, add: [...], remove: [...] }.
songsRouter.post("/songs/tags", requireRole("editor"), (req, res) => {
  const songIds = Array.isArray(req.body?.songIds) ? req.body.songIds.map(Number).filter(Number.isInteger) : [];
  if (songIds.length === 0) return res.status(400).json({ error: "Choose some songs first." });
  res.json({ songs: editTagsOf(songIds, cleanTags(req.body?.add), cleanTags(req.body?.remove)) });
});

songsRouter.put("/songs/:id/tags", requireRole("editor"), (req, res) => {
  const song = getSong(Number(req.params.id));
  if (!song) return res.status(404).json({ error: "Song not found." });
  res.json({ song: setSongTags(song.id, cleanTags(req.body?.tags)) });
});

songsRouter.patch("/songs/:id", requireRole("editor"), (req, res) => {
  const song = getSong(Number(req.params.id));
  if (!song) return res.status(404).json({ error: "Song not found." });
  const title = req.body?.title === undefined ? song.title : String(req.body.title).trim().slice(0, 200);
  const artist = req.body?.artist === undefined ? song.artist : String(req.body.artist).trim().slice(0, 200);
  try {
    res.json({ song: renameSong(song.id, title, artist) });
  } catch (err) {
    if (err instanceof UserError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

songsRouter.delete("/songs/:id", requireRole("editor"), (req, res) => {
  const song = getSong(Number(req.params.id));
  if (!song) return res.status(404).json({ error: "Song not found." });
  try {
    deleteSong(song.id);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof UserError) return res.status(409).json({ error: err.message });
    throw err;
  }
});

songsRouter.post("/songs", requireRole("editor"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an MP3 file to upload." });
  try {
    // Browsers send the file name as UTF-8, but multer reads it as Latin-1, which garbles
    // anything beyond plain ASCII (curly quotes, accents). Reinterpret the bytes.
    const name = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    let song = await addSong(req.file.path, name, req.user!.id);
    // Tags for a batch of uploads come along as a JSON list in a "tags" field.
    if (req.body?.tags) {
      let tags: unknown = [];
      try {
        tags = JSON.parse(String(req.body.tags));
      } catch {
        // ignore unreadable tags; the song itself is fine
      }
      song = setSongTags(song.id, cleanTags(tags)) ?? song;
    }
    res.status(201).json({ song });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message.includes("MP3") ? (err as Error).message : "That file isn't an MP3 we can use." });
  }
});

songsRouter.get("/songs/:id/peaks", (req, res) => {
  const song = getSong(Number(req.params.id));
  if (!song) return res.status(404).json({ error: "Song not found." });
  res.type("application/json").set("Cache-Control", "private, max-age=31536000, immutable");
  fs.createReadStream(peaksPath(song.id)).on("error", () => res.status(404).end()).pipe(res);
});

// Clip files never change once written (each re-cut gets a new name), so
// phones may keep them forever.
// Whole songs, for between-innings playlists. Originals are never modified,
// so phones may keep them. Range requests let phones start playing at once.
songsRouter.get("/media/songs/:file", (req, res) => {
  const m = /^(\d+)\.mp3$/.exec(String(req.params.file));
  if (!m) return res.status(404).end();
  res.sendFile(songPath(Number(m[1])), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=31536000, immutable" },
  }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// Announcement files are named after what they say, so they never change either.
songsRouter.get("/media/announcements/:file", (req, res) => {
  const file = String(req.params.file);
  if (!/^\d+-[0-9a-f]{12}\.mp3$/.test(file)) return res.status(404).end();
  res.sendFile(announcementPath(file), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=31536000, immutable" },
  }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

songsRouter.get("/media/clips/:file", (req, res) => {
  const file = String(req.params.file);
  if (!/^\d+-\d+\.mp3$/.test(file)) return res.status(404).end();
  res.sendFile(clipPath(file), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=31536000, immutable" },
  }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});
