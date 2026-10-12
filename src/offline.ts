// What this phone keeps for game mode without a connection:
// - the rosters it was told to keep (as JSON, in localStorage),
// - their clip files (in Cache Storage, served by the service worker and the audio engine),
// - lineup changes made while offline, waiting to be sent.
//
// Each phone chooses which rosters it keeps. The server stays the master copy:
// whenever the app is open with a connection, kept rosters are refreshed and
// only clips the phone doesn't already have are downloaded (clip file names
// change whenever a clip is re-cut).

import { api, isNetworkError } from "./api.ts";
import type { Player, Roster } from "../shared/types.ts";

export const CLIP_CACHE = "bb-clips";

const KEPT_KEY = "bb.offline.rosters";
const rosterKey = (id: number) => `bb.offline.roster.${id}`;
const QUEUE_KEY = "bb.offline.queue";

// ── Small helpers around storage that may be blocked or full ─────────────

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full; the data simply isn't kept.
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

const hasCaches = () => typeof caches !== "undefined";

// ── Listeners, so screens update when something changes in the background ─

type Listener = () => void;
const listeners = new Set<Listener>();
export function onOfflineChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

// ── Which rosters this phone keeps ───────────────────────────────────────

export const keptIds = (): number[] => read<number[]>(KEPT_KEY, []);
export const isKept = (id: number) => keptIds().includes(id);
export const savedRoster = (id: number): Roster | null => read<Roster | null>(rosterKey(id), null);
export const savedRosters = (): Roster[] => keptIds().map(savedRoster).filter((r): r is Roster => !!r);

/** Stores a fresh copy of a roster if this phone keeps it. */
export function saveIfKept(roster: Roster) {
  if (isKept(roster.id)) write(rosterKey(roster.id), roster);
}

/** Every audio file game mode needs for a roster: clips and announcements. */
const clipUrls = (roster: Roster) =>
  roster.players.flatMap((p) => [p.clip?.url, p.announcement?.url].filter((u): u is string => !!u));

/** How many of a roster's clips are on the phone. */
export async function clipProgress(roster: Roster): Promise<{ done: number; total: number }> {
  const urls = clipUrls(roster);
  if (!hasCaches()) return { done: 0, total: urls.length };
  const cache = await caches.open(CLIP_CACHE);
  const present = await Promise.all(urls.map((u) => cache.match(u)));
  return { done: present.filter(Boolean).length, total: urls.length };
}

const downloading = new Map<number, { done: number; total: number }>();
/** Progress of a download in progress, or null. */
export const downloadProgress = (id: number) => downloading.get(id) ?? null;

/** Downloads any of the roster's clips the phone doesn't have yet. */
async function downloadClips(roster: Roster) {
  if (!hasCaches()) throw new Error("This browser can't store clips. Use the https address.");
  const cache = await caches.open(CLIP_CACHE);
  const urls = clipUrls(roster);
  const progress = { done: 0, total: urls.length };
  downloading.set(roster.id, progress);
  notify();
  try {
    for (const url of urls) {
      if (!(await cache.match(url))) {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`A clip didn't download (${res.status}).`);
        await cache.put(url, res);
      }
      progress.done++;
      notify();
    }
  } finally {
    downloading.delete(roster.id);
    notify();
  }
}

/** Deletes clips that no kept roster uses any more. */
async function pruneClips() {
  if (!hasCaches()) return;
  const wanted = new Set(savedRosters().flatMap(clipUrls).map((u) => new URL(u, location.href).href));
  const cache = await caches.open(CLIP_CACHE);
  for (const req of await cache.keys()) if (!wanted.has(req.url)) await cache.delete(req);
}

/**
 * Makes sure the app itself opens without a connection: fetches the page and
 * everything it has loaded so far, so the service worker stores them.
 */
async function storeAppShell() {
  const urls = new Set(["/"]);
  for (const e of performance.getEntriesByType("resource")) {
    const u = new URL(e.name);
    if (u.origin === location.origin && !u.pathname.startsWith("/api/")) urls.add(u.pathname + u.search);
  }
  await Promise.all([...urls].map((u) => fetch(u, { credentials: "same-origin" }).catch(() => null)));
}

/** Keeps a roster on this phone: saves it and downloads its clips. */
export async function keepOffline(id: number) {
  const { roster } = await api<{ roster: Roster }>(`/rosters/${id}`);
  write(KEPT_KEY, [...new Set([...keptIds(), id])]);
  write(rosterKey(id), roster);
  notify();
  // Ask the browser not to clear our storage when space runs low (Android; iPhone home-screen apps are exempt anyway).
  void navigator.storage?.persist?.().catch(() => false);
  await Promise.all([downloadClips(roster), storeAppShell()]);
}

/** Stops keeping a roster on this phone and frees its clips. */
export async function forgetOffline(id: number) {
  write(
    KEPT_KEY,
    keptIds().filter((k) => k !== id),
  );
  remove(rosterKey(id));
  notify();
  await pruneClips();
}

/** Refreshes every kept roster from the server and downloads only what changed. Quietly gives up without a connection. */
export async function refreshKept() {
  await flushQueue();
  for (const id of keptIds()) {
    try {
      const { roster } = await api<{ roster: Roster }>(`/rosters/${id}`, { timeoutMs: 8000 });
      write(rosterKey(id), roster);
      await downloadClips(roster);
    } catch (err) {
      if (isNetworkError(err)) return;
      // The roster was deleted on the server: stop keeping it.
      if ((err as { status?: number }).status === 404) await forgetOffline(id);
    }
  }
  await pruneClips();
  notify();
}

// ── Lineup changes, sent now or queued until there's a connection ────────

type LineupChange =
  | { kind: "order"; rosterId: number; playerIds: number[]; changedAt: string }
  | { kind: "available"; rosterId: number; playerId: number; available: boolean; changedAt: string };

const queue = (): LineupChange[] => read<LineupChange[]>(QUEUE_KEY, []);
export const pendingChanges = () => queue().length;

let flushing: Promise<void> | null = null;

/** Sends queued lineup changes in the order they were made. Stops at the first one that can't reach the server. */
export function flushQueue(): Promise<void> {
  flushing ??= (async () => {
    try {
      for (let q = queue(); q.length > 0; q = queue()) {
        const change = q[0];
        try {
          if (change.kind === "order") {
            const r = await api<{ roster: Roster }>(`/rosters/${change.rosterId}/order`, {
              method: "PUT",
              body: { playerIds: change.playerIds, changedAt: change.changedAt },
              timeoutMs: 8000,
            });
            saveIfKept(r.roster);
          } else {
            await api(`/players/${change.playerId}/available`, {
              method: "PUT",
              body: { available: change.available, changedAt: change.changedAt },
              timeoutMs: 8000,
            });
          }
        } catch (err) {
          if (isNetworkError(err)) return; // still offline; try again later
          // The server refused it (for example, the player was deleted): drop it.
        }
        write(QUEUE_KEY, queue().slice(1));
        notify();
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

function applyChange(roster: Roster, change: LineupChange): Roster {
  if (change.kind === "available") {
    return {
      ...roster,
      players: roster.players.map((p) => (p.id === change.playerId ? { ...p, available: change.available } : p)),
    };
  }
  const byId = new Map(roster.players.map((p) => [p.id, p]));
  const ordered = change.playerIds.map((id) => byId.get(id)).filter((p): p is Player => !!p);
  const rest = roster.players.filter((p) => !change.playerIds.includes(p.id));
  return { ...roster, players: [...ordered, ...rest].map((p, i) => ({ ...p, lineupPosition: i })) };
}

/**
 * Changes the lineup: applies it on the phone straight away (and to the kept
 * copy), then sends it, or queues it if there's no connection.
 * Returns the updated roster.
 */
export function changeLineup(
  roster: Roster,
  change: { kind: "order"; playerIds: number[] } | { kind: "available"; playerId: number; available: boolean },
): Roster {
  const full = { ...change, rosterId: roster.id, changedAt: new Date().toISOString() } as LineupChange;
  const updated = applyChange(roster, full);
  saveIfKept(updated);
  write(QUEUE_KEY, [...queue(), full]);
  notify();
  void flushQueue();
  return updated;
}

/** Applies changes still waiting to be sent, so a roster fetched from the server shows what this phone did. */
export function withPendingChanges(roster: Roster): Roster {
  return queue()
    .filter((c) => c.rosterId === roster.id)
    .reduce(applyChange, roster);
}

/** Everything this phone has stored for offline use; cleared when signing out. */
export async function clearAll() {
  for (const id of keptIds()) remove(rosterKey(id));
  remove(KEPT_KEY);
  remove(QUEUE_KEY);
  if (hasCaches()) await caches.delete(CLIP_CACHE);
  notify();
}

// Send queued changes and refresh kept rosters whenever the connection comes back.
// A change can also be queued while the phone still has signal (the server was
// restarting, or a request timed out), when no "online" event will come; so
// while anything is waiting, try again every 20 seconds and on returning to the app.
const RETRY_QUEUE_MS = 20_000;
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void refreshKept());
  window.setInterval(() => {
    if (queue().length > 0) void flushQueue();
  }, RETRY_QUEUE_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && queue().length > 0) void flushQueue();
  });
}
