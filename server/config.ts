import fs from "node:fs";
import path from "node:path";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const env = process.env;

export const config = {
  port: Number(env.PORT || 8090),
  dataDir: path.resolve(env.DATA_DIR || "./data"),
  adminUsername: env.ADMIN_USERNAME || "admin",
  adminPassword: env.ADMIN_PASSWORD || "",
  /** Extra host names the dev server answers to (for example the https dev address), comma-separated. */
  devHosts: (env.DEV_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean),
  /** Build identifier, set in the Docker image. "dev" when running from source. */
  appVersion: env.APP_VERSION || "dev",
  /** Which voice engine the announcer uses: "kokoro" or "chatterbox". */
  ttsEngine: env.TTS_ENGINE === "chatterbox" ? ("chatterbox" as const) : ("kokoro" as const),
  /** Murf (paid cloud voices). Set the key to offer Murf as an announcer engine. */
  murfApiKey: env.MURF_API_KEY || "",
  murfUrl: (env.MURF_URL || "https://api.murf.ai").replace(/\/+$/, ""),
  /** Where the self-hosted voice engine is. Empty turns it off. */
  ttsUrl: (env.TTS_URL ?? (env.TTS_ENGINE === "chatterbox" ? "http://chatterbox:4123" : "http://kokoro:8880")).replace(/\/+$/, ""),
  trustProxy: env.TRUST_PROXY || "loopback, linklocal, uniquelocal",
  isProduction: env.NODE_ENV === "production",
};

fs.mkdirSync(config.dataDir, { recursive: true });
