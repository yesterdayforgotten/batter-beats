// Keeps the screen on during a game.
//
// The Screen Wake Lock API does this on Android and on iPhone home-screen apps
// from iOS 18.4. Before that it is missing (iOS < 16.4) or doesn't work in
// home-screen apps (16.4–18.3), so older iPhones also play a tiny silent video
// on a loop, which stops the screen dimming.

type Sentinel = { release(): Promise<void>; released: boolean };
type WakeLockNavigator = Navigator & { wakeLock?: { request(type: "screen"): Promise<Sentinel> } };

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
      video.src = "/keep-awake.mp4";
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
