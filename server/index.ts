import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config.ts";
import "./db.ts";
import { loadUser } from "./auth.ts";
import { ensureFirstAdmin } from "./users.ts";
import { authRouter } from "./routes/auth.ts";
import { usersRouter } from "./routes/users.ts";
import { rostersRouter } from "./routes/rosters.ts";
import { songsRouter } from "./routes/songs.ts";
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
  if (req.is("application/json")) return next();
  if (req.is("multipart/form-data") && req.get("x-batter-beats") === "1") return next();
  res.status(415).json({ error: "Requests must be JSON." });
});
app.use("/api", loadUser);
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api", rostersRouter);
app.use("/api", songsRouter);
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
    server: { middlewareMode: true, hmr: { server } },
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
});
