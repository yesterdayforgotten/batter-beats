// Backup and restore: everything in one file.
//
// A backup is a plain .tar of the data folder: a consistent copy of the
// database plus the songs, waveforms, clips and announcements. (MP3s don't
// shrink when compressed, so it isn't.) Restoring replaces all of it; the
// data it replaces is kept in tmp/before-restore-… until the next restore.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Response } from "express";
import { config } from "./config.ts";
import { DB_FILE, db, openDatabase, reopenDatabase } from "./db.ts";
import { dirs } from "./storage.ts";
import { announcerIdle, refreshAllAnnouncements } from "./announcer.ts";
import { fingerprintOldSongs, recutsIdle } from "./library.ts";
import { setPaused } from "./maintenance.ts";

/** Folders in the data folder that a backup holds (everything except tmp). */
const FOLDERS = ["songs", "peaks", "clips", "announcements"] as const;
const DB_NAME = path.basename(DB_FILE);
const MANIFEST = "batter-beats-backup.json";

/** Runs tar; it's stopped if it takes longer than `timeoutMs` (a stuck tar would otherwise hang the request). */
function tar(args: string[], timeoutMs: number, cwd?: string) {
  return spawn("tar", args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, killSignal: "SIGKILL" });
}

/** Waits for tar to finish. `okCodes`: exit codes that count as success. */
function waitFor(child: ReturnType<typeof spawn>, okCodes = [0]): Promise<void> {
  return new Promise((resolve, reject) => {
    let err = "";
    child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code !== null && okCodes.includes(code) ? resolve() : reject(new Error(`tar failed: ${err.slice(-300)}`)),
    );
  });
}

/** Streams a backup file to the browser. */
export async function sendBackup(res: Response) {
  const staging = path.join(dirs.tmp, `backup-${crypto.randomUUID()}`);
  await fs.promises.mkdir(staging);
  try {
    // A consistent copy of the database, even while the app is in use.
    await db.backup(path.join(staging, DB_NAME));
    await fs.promises.writeFile(
      path.join(staging, MANIFEST),
      JSON.stringify({ app: "batter-beats", version: config.appVersion, createdAt: new Date().toISOString() }, null, 2),
    );
    const date = new Date().toISOString().slice(0, 10);
    res.set({
      "Content-Type": "application/x-tar",
      "Content-Disposition": `attachment; filename="batter-beats-backup-${date}.tar"`,
      "Cache-Control": "no-store",
    });
    // Files can be replaced while the backup runs (a clip re-cut, an announcement remade): tar
    // skips those quietly (exit code 1 means "some files changed") instead of failing.
    const child = tar(
      [
        "-cf", "-",
        "--ignore-failed-read", "--warning=no-file-changed", "--warning=no-file-removed",
        "-C", config.dataDir, ...FOLDERS, "-C", staging, MANIFEST, DB_NAME,
      ],
      6 * 60 * 60_000,
    );
    // The download was cancelled: stop tar, or it would wait forever with nowhere to write.
    res.on("close", () => {
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    child.stdout!.pipe(res);
    await waitFor(child, [0, 1]);
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
}

/** What may be inside a backup: these names at the top, and in each folder only files the app itself names. */
const ALLOWED_FILES: Record<(typeof FOLDERS)[number], RegExp> = {
  songs: /^\d+\.mp3$/,
  peaks: /^\d+\.json$/,
  clips: /^\d+-\d+\.mp3$/,
  announcements: /^\d+-[0-9a-f]+\.mp3$/,
};
const NOT_A_BACKUP = "That file isn't a Batter Beats backup.";

/** Is this archive path one a backup could contain? (Folders, then files inside them.) */
function allowedPath(entry: string): boolean {
  const parts = entry.replace(/^\.\//, "").replace(/\/$/, "").split("/");
  if (parts.length === 1) return parts[0] === MANIFEST || parts[0] === DB_NAME || (FOLDERS as readonly string[]).includes(parts[0]);
  if (parts.length === 2 && parts[0] in ALLOWED_FILES) return ALLOWED_FILES[parts[0] as (typeof FOLDERS)[number]].test(parts[1]);
  return false;
}

/**
 * Checks a backup before anything is unpacked: only ordinary files and folders,
 * with the expected names. A link inside a backup could otherwise make the app
 * serve, overwrite or delete files outside its data folder (even while unpacking).
 */
async function checkContents(file: string) {
  const child = tar(["-tvf", file], 10 * 60_000);
  let listing = "";
  child.stdout!.on("data", (d: Buffer) => (listing += d.toString()));
  try {
    await waitFor(child);
  } catch {
    throw new Error(NOT_A_BACKUP);
  }
  for (const line of listing.split("\n").filter(Boolean)) {
    // GNU tar's verbose list: type and permissions, owner, size, date, time, name.
    const m = /^(\S)\S*\s+\S+\s+\d+\s+\S+\s+\S+\s+(.+)$/.exec(line);
    if (!m) throw new Error(NOT_A_BACKUP);
    const [, type, name] = m;
    if (type !== "-" && type !== "d") throw new Error(`${NOT_A_BACKUP} (It contains a link or special file.)`);
    if (!allowedPath(name)) throw new Error(`${NOT_A_BACKUP} (It contains something unexpected: ${name.slice(0, 80)}.)`);
  }
}

/** After unpacking, the same check on disk: nothing but ordinary files and folders. */
async function checkUnpacked(dir: string) {
  for (const entry of await fs.promises.readdir(dir, { recursive: true })) {
    const st = await fs.promises.lstat(path.join(dir, entry));
    if (!(st.isFile() || st.isDirectory()) || !allowedPath(entry)) throw new Error(`${NOT_A_BACKUP} (It contains a link or special file.)`);
  }
}

/** Replaces all data with what's in a backup file. Throws (changing nothing) if the file isn't a usable backup. */
export async function restoreBackup(file: string) {
  const unpacked = path.join(dirs.tmp, `restore-${crypto.randomUUID()}`);
  await fs.promises.mkdir(unpacked);
  try {
    await checkContents(file);
    try {
      await waitFor(tar(["-xf", file, "-C", unpacked, "--no-same-owner", "--no-same-permissions"], 60 * 60_000));
    } catch {
      throw new Error(NOT_A_BACKUP);
    }
    await checkUnpacked(unpacked);
    if (!fs.existsSync(path.join(unpacked, MANIFEST)) || !fs.existsSync(path.join(unpacked, DB_NAME))) {
      throw new Error(NOT_A_BACKUP);
    }
    // Check the database opens, upgrade it if it's from an older version, and that someone can sign in.
    const check = openDatabase(path.join(unpacked, DB_NAME));
    const admins = (check.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
    check.close();
    if (admins === 0) throw new Error("That backup has no admin account, so nobody could manage it.");

    // Swap: move the current data aside, move the backup in, reopen.
    const aside = path.join(dirs.tmp, `before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    await fs.promises.mkdir(aside);
    const names = [...FOLDERS, DB_NAME];
    // Pause everything that uses the database or the data folders (requests get "try again
    // in a minute"), and let announcements and clip cuts already under way finish first.
    setPaused(true);
    try {
      await announcerIdle();
      await recutsIdle();
      db.close();
      try {
        for (const name of names) {
          const from = path.join(config.dataDir, name);
          if (fs.existsSync(from)) await fs.promises.rename(from, path.join(aside, name));
        }
        for (const extra of ["-wal", "-shm"]) await fs.promises.rm(DB_FILE + extra, { force: true });
        for (const name of names) {
          const from = path.join(unpacked, name);
          if (fs.existsSync(from)) await fs.promises.rename(from, path.join(config.dataDir, name));
          else if (name !== DB_NAME) await fs.promises.mkdir(path.join(config.dataDir, name), { recursive: true });
        }
        reopenDatabase();
      } catch (err) {
        // Put everything back as it was.
        for (const name of names) {
          const kept = path.join(aside, name);
          if (fs.existsSync(kept)) {
            await fs.promises.rm(path.join(config.dataDir, name), { recursive: true, force: true });
            await fs.promises.rename(kept, path.join(config.dataDir, name));
          }
        }
        reopenDatabase();
        throw err;
      }
    } finally {
      setPaused(false);
    }

    // Keep only the newest set of replaced data.
    for (const entry of await fs.promises.readdir(dirs.tmp)) {
      const full = path.join(dirs.tmp, entry);
      if (entry.startsWith("before-restore-") && full !== aside) await fs.promises.rm(full, { recursive: true, force: true });
    }
    void refreshAllAnnouncements();
    void fingerprintOldSongs().catch(() => {}); // songs in an older backup have no fingerprint yet
  } finally {
    await fs.promises.rm(unpacked, { recursive: true, force: true });
  }
}
