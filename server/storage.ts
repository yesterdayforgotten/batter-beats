import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";

// Everything lives under the one data folder, so copying it is a full backup.
export const dirs = {
  songs: path.join(config.dataDir, "songs"),
  peaks: path.join(config.dataDir, "peaks"),
  clips: path.join(config.dataDir, "clips"),
  announcements: path.join(config.dataDir, "announcements"),
  tmp: path.join(config.dataDir, "tmp"),
};

for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });

export const songPath = (songId: number) => path.join(dirs.songs, `${songId}.mp3`);
export const peaksPath = (songId: number) => path.join(dirs.peaks, `${songId}.json`);
export const clipPath = (file: string) => path.join(dirs.clips, path.basename(file));
export const announcementPath = (file: string) => path.join(dirs.announcements, path.basename(file));
