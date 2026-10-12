import { Router } from "express";
import multer from "multer";
import { requireRole } from "../auth.ts";
import { config } from "../config.ts";
import { removeQuietly } from "../audio.ts";
import { dirs } from "../storage.ts";
import { engine } from "../voiceEngines.ts";
import {
  announcementText,
  cleanStyle,
  currentStyle,
  currentVoice,
  listVoices,
  refreshAllAnnouncements,
  sample,
  setStyle,
  setVoice,
} from "../announcer.ts";
import { ANNOUNCER, type AnnouncerVoice } from "../../shared/types.ts";

export const announcerRouter = Router();

const upload = multer({ dest: dirs.tmp, limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

// The engine in use, its voices, the chosen voice and the delivery settings.
announcerRouter.get("/announcer", requireRole("editor"), async (_req, res) => {
  let voices: AnnouncerVoice[] = [];
  let error: string | null = null;
  if (!config.ttsUrl) error = "The announcer is turned off on the server (TTS_URL is empty).";
  else {
    try {
      voices = await listVoices();
    } catch {
      error = "The announcer voice engine isn't reachable. If it was just started, it may still be loading.";
    }
  }
  res.json({ engine: engine.id, canAddVoices: engine.canAddVoices, voice: currentVoice(), style: currentStyle(), voices, error });
});

// Hear something in a voice (or the current one). Returns the MP3 itself.
announcerRouter.post("/announcer/sample", requireRole("editor"), async (req, res) => {
  const voice = typeof req.body?.voice === "string" ? req.body.voice.slice(0, 100) : currentVoice();
  const text =
    typeof req.body?.text === "string" && req.body.text.trim()
      ? req.body.text.trim().slice(0, 300)
      : announcementText(ANNOUNCER.defaultTemplate, "Alex Rivera", "12");
  try {
    // A style can be tried out before it's saved.
    const style = req.body?.style === undefined ? currentStyle() : cleanStyle(req.body.style);
    const mp3 = await sample(text, voice, style);
    res.set({ "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }).send(mp3);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// How every announcement is delivered; every announcement is remade.
announcerRouter.put("/announcer/style", requireRole("admin"), (req, res) => {
  const style = cleanStyle(req.body);
  setStyle(style);
  void refreshAllAnnouncements();
  res.json({ style });
});

// Choose the announcer voice; every announcement is remade in it.
announcerRouter.put("/announcer/voice", requireRole("admin"), (req, res) => {
  if (typeof req.body?.voice !== "string") return res.status(400).json({ error: "Choose a voice." });
  const voice = req.body.voice.trim().slice(0, 100);
  setVoice(voice);
  void refreshAllAnnouncements();
  res.json({ voice });
});

// Teach the engine a new voice from a recording (Chatterbox).
announcerRouter.post("/announcer/voices", requireRole("admin"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a recording." });
  try {
    const name = String(req.body?.name ?? "").trim().replace(/[^\w -]/g, "").slice(0, 60);
    if (!name) return res.status(400).json({ error: "Give the voice a name." });
    if (!engine.canAddVoices) return res.status(400).json({ error: "This voice engine can't learn new voices." });
    await engine.addVoice(name, req.file.path, Buffer.from(req.file.originalname, "latin1").toString("utf8"));
    res.status(201).json({ voices: await listVoices() });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  } finally {
    removeQuietly(req.file.path);
  }
});
