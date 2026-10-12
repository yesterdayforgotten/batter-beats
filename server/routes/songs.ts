import fs from "node:fs";
import { Router } from "express";
import multer from "multer";
import { requireRole } from "../auth.ts";
import { addSong, getSong, listSongs } from "../library.ts";
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

songsRouter.post("/songs", requireRole("editor"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an MP3 file to upload." });
  try {
    // Browsers send the file name as UTF-8, but multer reads it as Latin-1, which garbles
    // anything beyond plain ASCII (curly quotes, accents). Reinterpret the bytes.
    const name = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const song = await addSong(req.file.path, name, req.user!.id);
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
