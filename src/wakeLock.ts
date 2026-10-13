// Keeps the screen on during a game.
//
// The Screen Wake Lock API does this on Android and on iPhone home-screen apps
// from iOS 18.4. Before that it is missing (iOS < 16.4) or doesn't work in
// home-screen apps (16.4–18.3), so older iPhones also play a tiny silent video
// on a loop, which stops the screen dimming.

type Sentinel = { release(): Promise<void>; released: boolean };
type WakeLockNavigator = Navigator & { wakeLock?: { request(type: "screen"): Promise<Sentinel> } };

/** A tiny silent looping video (public/keep-awake.mp4), as a data URL. */
const KEEP_AWAKE_VIDEO = "data:video/mp4;base64,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";

let wanted = false;
let sentinel: Sentinel | null = null;
let video: HTMLVideoElement | null = null;

function iosVersion(): number | null {
  const m = navigator.userAgent.match(/OS (\d+)_(\d+)[_ ].*like Mac OS X/);
  return m ? Number(m[1]) + Number(m[2]) / 100 : null;
}

const needsVideo = () => {
  const v = iosVersion();
  return v !== null && v < 18.04;
};

async function requestLock() {
  const wl = (navigator as WakeLockNavigator).wakeLock;
  if (!wl || (sentinel && !sentinel.released)) return;
  try {
    sentinel = await wl.request("screen");
  } catch {
    // Refused (for example, the page is hidden). Tried again on the next tap or when visible.
  }
}

function onVisible() {
  if (wanted && document.visibilityState === "visible") {
    void requestLock();
    void video?.play().catch(() => {});
  }
}

/** Call from a tap: browsers only allow the video fallback to start from one. */
export function keepAwake() {
  if (!wanted) {
    wanted = true;
    document.addEventListener("visibilitychange", onVisible);
  }
  void requestLock();
  if (needsVideo()) {
    if (!video) {
      video = document.createElement("video");
      // Built in (1.7 KB) rather than fetched: it then also works offline, where the
      // service worker can't serve the range requests Safari makes for video.
      video.src = KEEP_AWAKE_VIDEO;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("aria-hidden", "true");
      Object.assign(video.style, { position: "fixed", width: "1px", height: "1px", opacity: "0.01", pointerEvents: "none", bottom: "0" });
      document.body.appendChild(video);
    }
    if (video.paused) void video.play().catch(() => {});
  }
}

/**
 * Asks to keep the screen on straight away, without a tap: works where the
 * Screen Wake Lock API does (Android, iOS 18.4+). Older iPhones still need the
 * first tap (keepAwake) for the video fallback.
 */
export function keepAwakeEarly() {
  if (!wanted) {
    wanted = true;
    document.addEventListener("visibilitychange", onVisible);
  }
  void requestLock();
}

/** Lets the screen sleep again (leaving game mode). */
export function allowSleep() {
  wanted = false;
  document.removeEventListener("visibilitychange", onVisible);
  void sentinel?.release().catch(() => {});
  sentinel = null;
  if (video) {
    video.pause();
    video.remove();
    video = null;
  }
}
