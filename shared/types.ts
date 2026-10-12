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
}

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
  playerCount: number;
  updatedAt: string;
}

export interface Roster {
  id: number;
  name: string;
  updatedAt: string;
  /** Announcer on for this team. */
  announce: boolean;
  /** Wording, with {number} and {name}. */
  announceTemplate: string;
  players: Player[];
}
