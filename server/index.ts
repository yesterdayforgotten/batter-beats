import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config.ts";
import { db } from "./db.ts";
import { loadUser } from "./auth.ts";
import { ensureFirstAdmin } from "./users.ts";
import { authRouter } from "./routes/auth.ts";
import { usersRouter } from "./routes/users.ts";
import { rostersRouter } from "./routes/rosters.ts";
import { songsRouter } from "./routes/songs.ts";
import { announcerRouter } from "./routes/announcer.ts";
import { playlistRouter } from "./routes/playlist.ts";
import { adminRouter } from "./routes/admin.ts";
import { startAnnouncer } from "./announcer.ts";
import { ensureTools } from "./audio.ts";

await ensureFirstAdmin();
await ensureTools();

const app = express();
const server = http.createServer(app);

app.set("trust proxy", config.trustProxy);
app.disable("x-powered-by");
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

// Requests that change data must be sent by the app itself: as JSON, or for
// file uploads with our own header. A web page on another site cannot send
// either kind of request with the user's cookie, so this blocks cross-site
// request forgery.
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  // Another site can only send DELETE after the browser asks this server's
  // permission (a CORS preflight), which it never gives; and deletes have no body to check.
  if (req.method === "DELETE") return next();
  if (req.is("application/json")) return next();
  if (req.is("multipart/form-data") && req.get("x-batter-beats") === "1") return next();
  res.status(415).json({ error: "Requests must be JSON." });
});
app.use("/api", loadUser);
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
// For Docker's health check: is the server up and the database readable?
app.get("/api/health", (_req, res) => {
  db.prepare("SELECT 1").get();
  res.json({ ok: true });
});
// Which build the server is running, so phones can offer an update when theirs is older.
app.get("/api/version", (_req, res) => {
  res.set("Cache-Control", "no-store").json({ version: config.appVersion });
});
app.use("/api", rostersRouter);
app.use("/api", songsRouter);
app.use("/api", announcerRouter);
app.use("/api", playlistRouter);
app.use("/api", adminRouter);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
app.use("/api", (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: "Something went wrong on the server." });
});

if (config.isProduction) {
  const dist = path.resolve("dist");
  app.use(express.static(dist, { index: false }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  // Development: serve the screens through Vite on the same port, with hot
  // reload over the same server.
  const { createServer } = await import("vite");
  const vite = await createServer({
    // Vite refuses requests for unknown host names; the dev address behind the proxy is listed in DEV_HOSTS.
    server: { middlewareMode: true, hmr: { server }, allowedHosts: config.devHosts },
    appType: "custom",
  });
  app.use(vite.middlewares);
  app.get(/.*/, async (req, res, next) => {
    try {
      const template = fs.readFileSync(path.resolve("index.html"), "utf8");
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (err) {
      next(err);
    }
  });
}

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Batter Beats listening on http://0.0.0.0:${config.port}`);
  // Make any announcements that are missing or out of date (for example after the voice engine was down).
  startAnnouncer();
});
