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
  setStyle,
  setVoice,
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

// Switch engine (ElevenLabs or Kokoro); every announcement is remade.
announcerRouter.put("/announcer/engine", requireRole("admin"), (req, res) => {
  if (!setEngine(String(req.body?.engine ?? ""))) return res.status(400).json({ error: "That voice engine isn't set up." });
  void refreshAllAnnouncements();
  res.json({ engine: activeEngine()?.id });
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

// Search an engine's shared voice library (ElevenLabs).
announcerRouter.get("/announcer/library", requireRole("admin"), async (req, res) => {
  const engine = activeEngine();
  if (!engine?.searchLibrary) return res.status(400).json({ error: "This voice engine has no voice library." });
  try {
    const pick = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string).slice(0, 40) : undefined);
    res.json({
      voices: await engine.searchLibrary(String(req.query.q ?? "").slice(0, 100), {
        gender: pick("gender"),
        accent: pick("accent"),
        age: pick("age"),
      }),
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Add a library voice to the account, so it can be used.
announcerRouter.post("/announcer/library", requireRole("admin"), async (req, res) => {
  const engine = activeEngine();
  if (!engine?.addFromLibrary) return res.status(400).json({ error: "This voice engine has no voice library." });
  const { ownerId, voiceId, name } = req.body ?? {};
  if (typeof ownerId !== "string" || typeof voiceId !== "string") return res.status(400).json({ error: "Choose a voice." });
  try {
    await engine.addFromLibrary(ownerId, voiceId, String(name ?? "Library voice").slice(0, 60));
    res.json({ voices: await listVoices() });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
