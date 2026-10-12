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
  trustProxy: env.TRUST_PROXY || "loopback, linklocal, uniquelocal",
  isProduction: env.NODE_ENV === "production",
};

fs.mkdirSync(config.dataDir, { recursive: true });
