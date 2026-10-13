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
import { recutsIdle } from "./library.ts";
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

/** Replaces all data with what's in a backup file. Throws (changing nothing) if the file isn't a usable backup. */
export async function restoreBackup(file: string) {
  const unpacked = path.join(dirs.tmp, `restore-${crypto.randomUUID()}`);
  await fs.promises.mkdir(unpacked);
  try {
    try {
      await waitFor(tar(["-xf", file, "-C", unpacked, "--no-same-owner"], 60 * 60_000));
    } catch {
      throw new Error("That file isn't a Batter Beats backup.");
    }
    if (!fs.existsSync(path.join(unpacked, MANIFEST)) || !fs.existsSync(path.join(unpacked, DB_NAME))) {
      throw new Error("That file isn't a Batter Beats backup.");
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
  } finally {
    await fs.promises.rm(unpacked, { recursive: true, force: true });
  }
}
