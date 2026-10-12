export const ROLES = ["user", "editor", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  user: "Regular user",
  editor: "Editor",
  admin: "Admin",
};

export interface User {
  id: number;
  username: string;
  role: Role;
  createdAt: string;
}

export interface Song {
  id: number;
  title: string;
  artist: string;
  durationMs: number;
  /** Free-form labels (a team, a player, "warm-up"…) for finding songs. */
  tags: string[];
}

/** Limits on song tags, shared by the screens and the server. */
export const TAG_LIMITS = { maxTags: 12, maxLength: 40 };

/** Tidies a list of tags: trimmed, single spaces, no blanks or repeats (ignoring case), within the limits. */
export function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    const tag = String(t ?? "").replace(/\s+/g, " ").trim().slice(0, TAG_LIMITS.maxLength);
    if (tag && !out.some((o) => o.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, TAG_LIMITS.maxTags);
}

/** True when a song matches a search: words in its title, artist or tags. */
export function songMatches(song: Song, query: string): boolean {
  const hay = `${song.title} ${song.artist} ${song.tags.join(" ")}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** True when a song has every one of the chosen tags. */
export const hasTags = (song: Song, tags: string[]) =>
  tags.every((t) => song.tags.some((st) => st.toLowerCase() === t.toLowerCase()));

/** Limits shared by the player editor and the server. */
export const CLIP_LIMITS = {
  minLengthMs: 1000,
  maxLengthMs: 120_000,
  defaultLengthMs: 30_000,
  defaultFadeMs: 1500,
  maxFadeMs: 15_000,
  gainStepDb: 0.5,
  /** The lossless frame-gain step that MP3 files allow. */
  fileGainStepDb: 1.5,
  minGainDb: -20,
  maxGainDb: 24,
  toneMinDb: -12,
  toneMaxDb: 12,
} as const;

export interface Clip {
  /** player_songs row id */
  id: number;
  song: Song;
  startMs: number;
  endMs: number;
  fadeMs: number;
  /** 0–1 */
  volume: number;
  gainDb: number;
  bassDb: number;
  trebleDb: number;
  /** URL of the cut clip file, or null while it is being made. */
  url: string | null;
  /** Where playback starts inside the file (after the lead-in frames). */
  offsetMs: number;
  /** How much audio follows the start point in the file. */
  playMs: number;
  /** Gain already written into the file losslessly. The phone adds gainDb - fileGainDb. */
  fileGainDb: number;
  /** Largest gainDb that does not clip this clip. */
  maxGainDb: number;
  version: number;
}

/** A song in someone's between-innings playlist. */
export interface PlaylistSong extends Song {
  /** The whole original MP3. */
  url: string;
  sizeBytes: number;
}

/** A song as the Songs screen shows it: who uploaded it and where it's used. */
export interface LibrarySong extends Song {
  /** The whole original MP3. */
  url: string;
  uploadedBy: string | null;
  createdAt: string;
  /** Players who walk up to it. */
  players: { id: number; name: string; number: string; rosterId: number; rosterName: string; rosterColor: string }[];
  /** How many people's between-innings playlists have it. */
  playlists: number;
}

/** Tag ideas for the Songs screen: team and player names, then tags already in use. */
export interface TagSuggestions {
  teams: string[];
  players: string[];
  used: string[];
}

/** A shared playlist for the jukebox: songs in order. */
export interface Playlist {
  id: number;
  name: string;
  songs: PlaylistSong[];
}

export interface Announcement {
  url: string;
  durationMs: number;
}

export interface Player {
  id: number;
  rosterId: number;
  name: string;
  number: string;
  lineupPosition: number;
  available: boolean;
  clip: Clip | null;
  /** Spelling used only by the announcer; empty means use the name. */
  pronunciation: string;
  /** Announce this player (the team's switch also has to be on). */
  announce: boolean;
  /** How long after the announcement starts the song comes in. */
  songDelayMs: number;
  /** The announcement to play, or null when it's off, not made yet, or failed. */
  announcement: Announcement | null;
  announcementStatus: "ready" | "pending" | "off" | "error";
  announcementError: string | null;
}

/** How the announcer delivers every announcement (set by an admin). */
export type Energy = "calm" | "lively" | "hyped";
export interface AnnouncerStyle {
  /** Talking speed, 1 = normal. */
  speed: number;
  energy: Energy;
  /** Raise the voice by this many semitones; a little higher sounds more excited. */
  pitch: number;
  /** Stadium echo (Admin: Echo and Distance): how loud (0 = none … 1 = strong) and how far (0 = small field … 1 = big stadium). */
  reverb: number;
  reverbSize: number;
  /** ElevenLabs: emotional range, 0.25 (steady) to 2 (wild); shown as Range. */
  excitement: number;
  /**
   * ElevenLabs only: delivery cues the voice acts out, written exactly as sent,
   * e.g. "[shouting] [excited]" (before the announcement's text).
   */
  elevenTag: string;
}

/** Cues written the way ElevenLabs gets them: "[shouting] [excited]". */
export const formatCues = (cues: string[]) => cues.map((c) => `[${c}]`).join(" ");

/** The separate cues in a Cue box: split on [brackets] or commas, tidied, no repeats, at most 5. */
export function splitCues(text: string): string[] {
  const seen = new Set<string>();
  const cues: string[] = [];
  for (const raw of text.split(/[,[\]]+/)) {
    const cue = raw.trim().replace(/\s+/g, " ").slice(0, 40).trim();
    if (!cue || seen.has(cue.toLowerCase())) continue;
    seen.add(cue.toLowerCase());
    cues.push(cue);
    if (cues.length === 5) break;
  }
  return cues;
}
export const DEFAULT_STYLE: AnnouncerStyle = {
  speed: 1,
  energy: "lively",
  pitch: 0,
  reverb: 0,
  reverbSize: 0.6,
  excitement: 1,
  elevenTag: "[shouting] [excited]",
};
export const STYLE_LIMITS = {
  minSpeed: 0.8,
  maxSpeed: 1.4,
  maxPitch: 4,
  minExcitement: 0.25,
  maxExcitement: 2,
} as const;

/** The voice engines the announcer can use: ElevenLabs (ELEVENLABS_API_KEY) and/or Kokoro (TTS_URL). */
export type VoiceEngine = "elevenlabs" | "kokoro";

export interface AnnouncerVoice {
  id: string;
  name: string;
  detail: string;
  /** A short sample to hear the voice without spending credit (ElevenLabs). */
  previewUrl?: string;
  /** For filtering, where the engine says: "Male" / "Female", "American", "Young" / "Middle-aged" / "Older". */
  gender?: string;
  accent?: string;
  age?: string;
}

/** Filters for the voice list on the Admin screen. Empty = any. */
export interface VoiceFilters {
  gender?: string;
  accent?: string;
  age?: string;
}

export const ANNOUNCER = {
  defaultTemplate: "Now batting, number {number}, {name}",
  maxSongDelayMs: 10_000,
  /** How loud the song is while the voice speaks over it. */
  duckGain: 0.25,
  /** How long the song takes to come up to full volume after the voice. */
  duckReleaseMs: 700,
} as const;

export interface RosterSummary {
  id: number;
  name: string;
  /** One of TEAM_COLORS' ids. */
  color: string;
  playerCount: number;
  updatedAt: string;
}

export interface Roster {
  id: number;
  name: string;
  /** One of TEAM_COLORS' ids. */
  color: string;
  updatedAt: string;
  /** Announcer on for this team. */
  announce: boolean;
  /** Wording, with {number} and {name}. */
  announceTemplate: string;
  /** The team's announcer voice (for the engine in use) and delivery. */
  announcerVoice: string;
  announcerStyle: AnnouncerStyle;
  players: Player[];
}

/**
 * Team colours, used in place of the app's blue on a team's screens. Each is
 * tuned to stand out on the near-black background, so dark team colours
 * (navy, maroon, forest, black) are brighter here than on a jersey. `ink` is
 * the text on top of the colour.
 */
export const TEAM_COLORS = [
  { id: "red", name: "Red", accent: "#ff4d4d", ink: "#2b0000" },
  { id: "maroon", name: "Maroon", accent: "#d4506a", ink: "#2a0610" },
  { id: "orange", name: "Orange", accent: "#ff8a2b", ink: "#2b1100" },
  { id: "gold", name: "Gold", accent: "#f2b630", ink: "#2b1d00" },
  { id: "yellow", name: "Yellow", accent: "#ffe04a", ink: "#2b2400" },
  { id: "green", name: "Green", accent: "#36d46c", ink: "#00230c" },
  { id: "forest", name: "Forest", accent: "#4caf74", ink: "#00200d" },
  { id: "teal", name: "Teal", accent: "#22c7b8", ink: "#002622" },
  { id: "sky", name: "Sky blue", accent: "#5cc8ff", ink: "#001f2e" },
  { id: "blue", name: "Blue", accent: "#3d9bff", ink: "#00142b" },
  { id: "navy", name: "Navy", accent: "#6b82ff", ink: "#000a2b" },
  { id: "purple", name: "Purple", accent: "#a66bff", ink: "#170030" },
  { id: "pink", name: "Pink", accent: "#ff6fae", ink: "#2b0014" },
  { id: "silver", name: "Silver", accent: "#b9c2cf", ink: "#11161d" },
  { id: "white", name: "Black & white", accent: "#f2f3f5", ink: "#111214" },
] as const;

export const DEFAULT_TEAM_COLOR = "blue";

export const teamColor = (id: string | undefined) =>
  TEAM_COLORS.find((c) => c.id === id) ?? TEAM_COLORS.find((c) => c.id === DEFAULT_TEAM_COLOR)!;
