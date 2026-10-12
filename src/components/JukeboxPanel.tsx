import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronIcon, PlayIcon, SoundBars } from "./Icons.tsx";
import { jukebox, setJukeboxSettings, type JukeboxSettings, type JukeboxState } from "../playlist.ts";
import type { Playlist } from "../../shared/types.ts";

const formatLength = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/**
 * Game mode's Jukebox tab: choose the team's playlist, tap any song to play
 * it (the playlist carries on from there), shuffle or in order, and this
 * phone's jukebox volume and fade-out length.
 */
export function JukeboxPanel({
  playlists,
  selected,
  state,
  settings,
  editor,
  onSelect,
  onPlay,
}: {
  playlists: Playlist[];
  selected: Playlist | null;
  state: JukeboxState;
  settings: JukeboxSettings;
  editor: boolean;
  onSelect(id: number): void;
  onPlay(playlist: Playlist, songId?: number): void;
}) {
  const [showSettings, setShowSettings] = useState(false);
  if (playlists.length === 0) {
    return (
      <div className="stack" style={{ gap: 10 }}>
        <p className="empty">No playlists yet.</p>
        {editor && (
          <Link to="/playlists" className="innings-setup">
            Make a playlist
          </Link>
        )}
      </div>
    );
  }
  const nowId = state.status !== "stopped" && state.playlist.id === selected?.id ? state.song.id : null;
  const nextId = state.status === "stopped" && selected ? jukebox.upNext(selected)?.id : null;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10 }}>
        <select
          className="grow"
          aria-label="Playlist"
          value={selected?.id ?? ""}
          onChange={(e) => onSelect(Number(e.target.value))}
        >
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.songs.length})
            </option>
          ))}
        </select>
      </div>

      <div className="segmented" role="radiogroup" aria-label="Play order">
        {[
          { shuffle: true, label: "Shuffle" },
          { shuffle: false, label: "In order" },
        ].map((o) => (
          <button
            key={o.label}
            role="radio"
            aria-checked={settings.shuffle === o.shuffle}
            className={settings.shuffle === o.shuffle ? "on" : ""}
            onClick={() => setJukeboxSettings({ shuffle: o.shuffle })}
          >
            {o.label}
          </button>
        ))}
      </div>

      {selected && selected.songs.length === 0 && <p className="empty">This playlist has no songs yet.</p>}
      {selected && selected.songs.length > 0 && (
        <ol className="jukebox-songs">
          {selected.songs.map((s, i) => {
            const now = s.id === nowId;
            return (
              <li key={s.id}>
                <button className={`jukebox-song${now ? " now" : ""}`} onClick={() => onPlay(selected, s.id)}>
                  <span className="playlist-pos">{now ? <SoundBars /> : i + 1}</span>
                  <span className="stack grow" style={{ gap: 1, minWidth: 0 }}>
                    <span className="song-title truncate">{s.title}</span>
                    <span className="song-meta truncate">
                      {s.artist ? `${s.artist} · ` : ""}
                      {formatLength(s.durationMs)}
                    </span>
                  </span>
                  {s.id === nextId && <span className="tag next-tag">Up next</span>}
                  {!now && (
                    <span className="jukebox-play" aria-hidden>
                      <PlayIcon />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <button className="section-toggle settings-toggle" aria-expanded={showSettings} onClick={() => setShowSettings((o) => !o)}>
        <span className={`toggle-chevron${showSettings ? " open" : ""}`} aria-hidden>
          <ChevronIcon />
        </span>
        <span className="grow" style={{ textAlign: "left" }}>
          Jukebox settings
        </span>
        <span className="muted small">
          {Math.round(settings.volume * 100)}% · fade {settings.fadeSec} s
        </span>
      </button>
      {showSettings && (
      <div className="card stack" style={{ gap: 10 }}>
        <span className="field-label">On this phone</span>
        <label className="slider-row">
          <span>Volume</span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(e) => setJukeboxSettings({ volume: Number(e.target.value) })}
          />
          <span className="slider-value">{Math.round(settings.volume * 100)}%</span>
        </label>
        <label className="slider-row">
          <span>Stop fades over</span>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={settings.fadeSec}
            onChange={(e) => setJukeboxSettings({ fadeSec: Number(e.target.value) })}
          />
          <span className="slider-value">{settings.fadeSec} s</span>
        </label>
        <span className="muted small">Walkups always play at full volume; the jukebox fades out quickly when you tap a batter.</span>
      </div>
      )}
    </div>
  );
}
