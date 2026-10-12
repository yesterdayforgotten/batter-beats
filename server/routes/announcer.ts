import { Router } from "express";
import { requireRole } from "../auth.ts";
import { engines } from "../voiceEngines.ts";
import {
  activeEngine,
  announcementText,
  cleanStyle,
  currentStyle,
  currentVoice,
  listVoices,
  refreshAllAnnouncements,
  sample,
  setEngine,
} from "../announcer.ts";
import { ANNOUNCER, type AnnouncerVoice } from "../../shared/types.ts";

export const announcerRouter = Router();

// The engines available, the one in use, its voices, the chosen voice and the delivery settings.
announcerRouter.get("/announcer", requireRole("editor"), async (_req, res) => {
  const engine = activeEngine();
  let voices: AnnouncerVoice[] = [];
  let error: string | null = null;
  if (!engine) error = "No announcer voice engine is set up on the server (TTS_URL or MURF_API_KEY).";
  else {
    try {
      voices = await listVoices();
    } catch (err) {
      // Cloud engines explain themselves (wrong key, missing permission, no credit).
      error =
        engine.id === "elevenlabs"
          ? (err as Error).message
          : "The announcer voice engine isn't reachable. If it was just started, it may still be loading.";
    }
  }
  res.json({
    engine: engine?.id ?? null,
    engines: engines.map((e) => ({ id: e.id, label: e.label })),
    // Which delivery settings this engine can use.
    controls: { speed: !!engine && engine.speed !== "none", pitch: !!engine && engine.pitch !== "none" },
    voice: currentVoice(),
    style: currentStyle(),
    voices,
    error,
  });
});

// This month's credits left with the voice service; null when the engine is free or the
// key isn't allowed to read them (the note by Listen is then simply left out).
announcerRouter.get("/announcer/credits", requireRole("editor"), async (_req, res) => {
  const engine = activeEngine();
  try {
    res.json({ credits: engine?.credits ? await engine.credits() : null });
  } catch {
    res.json({ credits: null });
  }
});

// Switch engine (ElevenLabs or Kokoro); every announcement is remade.
announcerRouter.put("/announcer/engine", requireRole("admin"), (req, res) => {
  if (!setEngine(String(req.body?.engine ?? ""))) return res.status(400).json({ error: "That voice engine isn't set up." });
  void refreshAllAnnouncements();
  res.json({ engine: activeEngine()?.id });
});

// Hear something in a voice (or the current one). Returns the MP3 itself.
announcerRouter.post("/announcer/sample", requireRole("editor"), async (req, res) => {
  const voice = typeof req.body?.voice === "string" ? req.body.voice.slice(0, 100) : currentVoice();
  // A team's wording (with its cues), filled in with a sample player.
  const template =
    typeof req.body?.template === "string" && req.body.template.includes("{name}")
      ? req.body.template.slice(0, 200)
      : ANNOUNCER.defaultTemplate;
  const text =
    typeof req.body?.text === "string" && req.body.text.trim()
      ? req.body.text.trim().slice(0, 300)
      : announcementText(template, "Melody", "12");
  try {
    // A style can be tried out before it's saved.
    const style = req.body?.style === undefined ? currentStyle() : cleanStyle(req.body.style);
    const mp3 = await sample(text, voice, style);
    res.set({ "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }).send(mp3);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

