import { Router } from "express";
import multer from "multer";
import { requireRole } from "../auth.ts";
import { removeQuietly } from "../audio.ts";
import { restoreBackup, sendBackup } from "../backup.ts";
import { dirs } from "../storage.ts";

// Admin only: download everything as one file, and restore from one.
export const adminRouter = Router();
adminRouter.use("/admin", requireRole("admin"));

const upload = multer({ dest: dirs.tmp, limits: { fileSize: 50 * 1024 ** 3, files: 1 } });

adminRouter.get("/admin/backup", async (_req, res, next) => {
  try {
    await sendBackup(res);
  } catch (err) {
    if (!res.headersSent) next(err);
    else res.destroy(err as Error);
  }
});

adminRouter.post("/admin/restore", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a backup file." });
  try {
    await restoreBackup(req.file.path);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  } finally {
    removeQuietly(req.file.path);
  }
});
