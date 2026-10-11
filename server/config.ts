import fs from "node:fs";
import path from "node:path";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const env = process.env;

export const config = {
  port: Number(env.PORT || 8090),
  dataDir: path.resolve(env.DATA_DIR || "./data"),
  adminUsername: env.ADMIN_USERNAME || "admin",
  adminPassword: env.ADMIN_PASSWORD || "",
  trustProxy: env.TRUST_PROXY || "loopback, linklocal, uniquelocal",
  isProduction: env.NODE_ENV === "production",
};

fs.mkdirSync(config.dataDir, { recursive: true });
