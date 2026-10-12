import { useEffect, useState } from "react";
import { api } from "../api.ts";

/**
 * The app's version and build, so the owner always knows what's on the phone,
 * plus an Update button when the server has a newer build.
 */
export function AppVersion() {
  const [newer, setNewer] = useState(false);

  useEffect(() => {
    if (__APP_BUILD__ === "dev") return; // the dev server reloads the app itself
    const check = () => {
      if (document.visibilityState !== "visible") return;
      api<{ version: string }>("/version", { timeoutMs: 5000 })
        .then((r) => setNewer(r.version !== __APP_BUILD__ && r.version !== "dev"))
        .catch(() => {}); // offline: nothing to compare with
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  return (
    <div className="app-version">
      <span>
        v{__APP_VERSION__} · {__APP_BUILD__}
      </span>
      {newer && (
        <button className="small-button primary" onClick={() => location.reload()}>
          Update
        </button>
      )}
    </div>
  );
}
