import { Router } from "express";
import { requireRole } from "../auth.ts";
import { config } from "../config.ts";
import {
  announcementText,
  cleanStyle,
  currentStyle,
  currentVoice,
  setStyle,
  listVoices,
  refreshAllAnnouncements,
  sample,
  setSetting,
} from "../announcer.ts";
import { ANNOUNCER } from "../../shared/types.ts";

export const announcerRouter = Router();

// Which voice is in use, and the voices the engine offers.
announcerRouter.get("/announcer", requireRole("editor"), async (_req, res) => {
  let voices: string[] = [];
  let error: string | null = null;
  if (!config.ttsUrl) error = "The announcer is turned off on the server (TTS_URL is empty).";
  else {
    try {
      voices = await listVoices();
    } catch {
      error = "The announcer voice engine isn't reachable.";
    }
  }
  res.json({ voice: currentVoice(), style: currentStyle(), voices, error });
});

// Hear something in a voice (or the current one). Returns the MP3 itself.
announcerRouter.post("/announcer/sample", requireRole("editor"), async (req, res) => {
  const voice = typeof req.body?.voice === "string" && req.body.voice ? req.body.voice.slice(0, 100) : currentVoice();
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

// How every announcement is delivered (speed, energy, pitch, echo); every announcement is remade.
announcerRouter.put("/announcer/style", requireRole("admin"), (req, res) => {
  const style = cleanStyle(req.body);
  setStyle(style);
  void refreshAllAnnouncements();
  res.json({ style });
});

// Choose the announcer voice; every announcement is remade in it.
announcerRouter.put("/announcer/voice", requireRole("admin"), (req, res) => {
  const voice = typeof req.body?.voice === "string" ? req.body.voice.trim().slice(0, 100) : "";
  if (!voice) return res.status(400).json({ error: "Choose a voice." });
  setSetting("announcer_voice", voice);
  void refreshAllAnnouncements();
  res.json({ voice });
});
