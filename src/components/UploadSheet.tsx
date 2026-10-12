import { useState } from "react";
import { upload } from "../api.ts";
import { TagEditor } from "./TagEditor.tsx";
import type { Song, TagSuggestions } from "../../shared/types.ts";
import { useLockPageScroll } from "../lockScroll.ts";

type FileState =
  | { status: "waiting" }
  | { status: "uploading"; progress: number }
  | { status: "done"; song: Song; existing: boolean }
  | { status: "failed"; error: string };

const formatSize = (bytes: number) =>
  bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;

/**
 * Bottom sheet for uploading several MP3s at once: lists the files, takes tags
 * that go on every one of them, then uploads them one after another. A file
 * that fails doesn't stop the rest.
 */
export function UploadSheet({
  files,
  suggestions,
  onUploaded,
  onClose,
}: {
  files: File[];
  suggestions: TagSuggestions;
  /** Called after each song is added (to refresh the list). */
  onUploaded(song: Song): void;
  onClose(): void;
}) {
  useLockPageScroll();
  const [tags, setTags] = useState<string[]>([]);
  const [states, setStates] = useState<FileState[]>(() => files.map(() => ({ status: "waiting" })));
  const [phase, setPhase] = useState<"choosing" | "uploading" | "finished">("choosing");

  const set = (i: number, s: FileState) => setStates((all) => all.map((x, j) => (j === i ? s : x)));

  async function start() {
    setPhase("uploading");
    for (let i = 0; i < files.length; i++) {
      set(i, { status: "uploading", progress: 0 });
      try {
        const r = await upload<{ song: Song; existing: boolean }>("/songs", files[i], (p) => set(i, { status: "uploading", progress: p }), {
          tags: JSON.stringify(tags),
        });
        set(i, { status: "done", song: r.song, existing: r.existing });
        onUploaded(r.song);
      } catch (err) {
        set(i, { status: "failed", error: (err as Error).message });
      }
    }
    setPhase("finished");
  }

  const done = states.filter((s) => s.status === "done" && !s.existing).length;
  const already = states.filter((s) => s.status === "done" && s.existing).length;
  const failed = states.filter((s) => s.status === "failed").length;
  const count = `${files.length} ${files.length === 1 ? "song" : "songs"}`;

  return (
    <div className="sheet-backdrop" onClick={phase === "uploading" ? undefined : onClose}>
      <div className="sheet" role="dialog" aria-label="Upload songs" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <span className="section-title grow">
            {phase === "choosing" ? `Upload ${count}` : phase === "uploading" ? `Uploading ${done + already + failed + 1} of ${files.length}…` : "Upload finished"}
          </span>
          {phase !== "uploading" && (
            <button className="link-button" onClick={onClose}>
              {phase === "finished" ? "Done" : "Cancel"}
            </button>
          )}
        </div>

        <div className="sheet-list">
          <ul className="upload-files">
            {files.map((f, i) => {
              const s = states[i];
              return (
                <li key={i} className={`upload-file ${s.status}`}>
                  <span className="stack grow" style={{ gap: 1, minWidth: 0 }}>
                    <span className="truncate" style={{ fontWeight: 700, fontSize: 14 }}>
                      {s.status === "done" ? s.song.title : f.name.replace(/\.mp3$/i, "")}
                    </span>
                    <span className={`small truncate ${s.status === "failed" ? "error-text" : "muted"}`}>
                      {s.status === "waiting" && formatSize(f.size)}
                      {s.status === "uploading" && (s.progress < 1 ? `Uploading… ${Math.round(s.progress * 100)}%` : "Adding to the library…")}
                      {s.status === "done" && `${s.existing ? "Already in the library" : "Added"}${s.song.artist ? ` · ${s.song.artist}` : ""}`}
                      {s.status === "failed" && s.error}
                    </span>
                  </span>
                  {s.status === "uploading" && (
                    <span className="upload-bar">
                      <span style={{ width: `${Math.round(s.progress * 100)}%` }} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {phase === "choosing" && (
            <div style={{ marginTop: 12 }}>
              <TagEditor tags={tags} suggestions={suggestions} onChange={setTags} />
              <p className="muted small" style={{ margin: "6px 0 0" }}>
                These tags go on every song in this upload. Titles and artists come from the files; fix any afterwards.
              </p>
            </div>
          )}
          {phase === "finished" && (
            <p className="muted small" style={{ margin: "12px 0 0" }}>
              {done} added{already ? `, ${already} already in the library` : ""}{failed ? `, ${failed} failed` : ""}.
              {tags.length ? ` Tagged ${tags.join(", ")}.` : ""}
            </p>
          )}
        </div>

        {phase === "choosing" && (
          <button className="primary" onClick={start}>
            Upload {count}
          </button>
        )}
      </div>
    </div>
  );
}
