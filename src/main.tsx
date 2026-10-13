import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { AuthProvider } from "./auth.tsx";
// Latin-only font files, bundled with the app so they also work offline.
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import "@fontsource/big-shoulders-display/latin-800";
import "@fontsource/big-shoulders-display/latin-900";
import "./styles.css";

// The visible height of the screen, for sheets: iOS 15 has no "dvh", and its
// plain "vh" includes the area behind Safari's toolbars, which hid the bottom
// of long sheets. Measured here instead, and kept up to date.
function setAppHeight() {
  document.documentElement.style.setProperty("--app-h", `${window.innerHeight}px`);
}
setAppHeight();
window.addEventListener("resize", setAppHeight);
window.addEventListener("orientationchange", setAppHeight);

// The service worker lets the app open without a connection. Browsers only
// allow it on https (and on the server's own address).
if ("serviceWorker" in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
