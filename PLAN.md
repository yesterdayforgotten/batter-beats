# Batter Beats: build plan and handoff

Written 2026-10-10 by the planning session. You (Claude Code in the `batter-beats-dev` container) are the builder. Read this whole file before writing any code. Everything under "Decisions" was agreed with the owner; do not change it without asking.

## What we're building

Batter Beats is a web app that plays walkup music at baseball and softball games. It is added to the home screen on Android and iPhone (a progressive web app, PWA) and is served from the owner's own server in Docker. Team setup happens on the server. Each phone keeps its own copy of the short clips, so game mode works with no signal at the field.

The code will be public on GitHub under the MIT licence, in a repo named `batter-beats`.

## Working with the owner

- The owner is not a software specialist. Explain things in plain words and define any jargon the first time you use it.
- Work one phase at a time (see "Build order"). At the end of each phase, tell the owner exactly what to try on the phones, then wait for feedback before starting the next phase.
- If something is not covered here, ask. Do not add features that are not listed.
- The owner wants a smooth, obvious interface with no extra taps. During a game, everything is one tap.
- Commit to git after each working step, with clear messages.
- Keep the "Status" section at the bottom of this file current, so a fresh session can pick up where the last one stopped.
- This repo will be public. Never commit passwords, tokens, real domain names, server addresses or personal details. Use a `.env` file that is git-ignored, plus a `.env.example`.
- Ask the owner what name to put on the MIT licence.

## Your environment

- Container image `node:22-bookworm`. You run as the user `node`, with no root access. Code lives in `/workspace`.
- `ffmpeg` is installed. `mp3gain` was attempted at container start; check with `command -v mp3gain`.
- You cannot install system packages or start other containers. If you need either, tell the owner what to add to the Portainer stack and why.
- Run the dev server on `0.0.0.0:8090` with hot reload. That is the only published port, so the API and the screens must share it in development.
- An https dev address is set up (2026-10-12): the owner's Apache forwards it to port 8090 with WebSockets (hot reload works through it), using a wildcard Let's Encrypt certificate. Its host name is in `DEV_HOSTS` in the git-ignored `.env`; never commit it. Home-screen install and offline storage only work over https, so phases 1 to 3 can be tested over plain http on the home network, but phase 4 needs the https address first. Remind the owner before phase 4.
- Pushing to GitHub needs credentials the owner has not set up yet. Commit locally until then.

## Decisions

| Topic | Choice |
| --- | --- |
| Type of app | PWA added to the home screen. Not native. The same code may later be wrapped in a native shell if iPhone limits become a problem. |
| Server | Self-hosted, Docker, behind the owner's existing https domain |
| Built with | TypeScript, React, SQLite. Pick sensible common libraries. |
| Accounts | Multiple users. Only an admin creates accounts: no open sign-up, no invite links, no password emails. An admin resets passwords. The first admin is created when the server first starts. |
| Sign-in | Phones stay signed in until the user signs out. Game mode must keep working offline without re-checking with the server. |
| Roster visibility | Every user sees every roster |
| Roles | Regular user, editor, admin (table below) |
| Music source | MP3 files uploaded to the server into one shared library, reusable across rosters |
| What phones store | Only each player's trimmed clip (about 30 seconds) and announcement, roughly 15 MB per roster. Full MP3s stay on the server. |
| Audio quality | Clips are cut and gain-adjusted losslessly, never re-encoded. Fade, volume, bass and treble are applied on the phone at playback. |
| Songs per player | One for now. Design the data so a player can have several later. |
| Lineup | One shared batting order per roster (not per user). Reorderable. Players can be marked unavailable. |
| Announcer | Spoken "Now batting, number X, name", generated on the server as an audio file |
| Between-innings music | One playlist per user, shuffled |
| Sound effects | None |
| Backup | The server is the master copy. Admins can download everything as one file and restore from it. No cloud backup. |
| Offline | Only game mode works offline. All editing needs a connection. |
| Visual style | Agreed 2026-10-11 from mockups: "Floodlight". Near-black background (#08090b, cards #15171c / #1d2027), one electric-blue accent (#3d9bff; dark text #00142b on blue fills), Big Shoulders Display for big numbers and headings, Manrope for body text. Lineup is a full-width list; playing batter is a solid blue row labelled "At bat · tap to fade" with small moving sound bars; next batter has a blue outline and an "On deck" tag; unavailable players sit under "Bench today" (renamed "Unavailable" 2026-10-12). Player editor is compact: one line per sound control (gain stepper, volume, fade-out, bass, treble sliders). Mockups: the owner's private "Batter Beats UI ideas" design canvas, page "Fresh dark ideas", look D. |

### Roles

| What they can do | Regular user | Editor | Admin |
| --- | --- | --- | --- |
| See all rosters and download them for offline use | Yes | Yes | Yes |
| Run game mode: play walkups, reorder the lineup, mark players unavailable | Yes | Yes | Yes |
| Build their own between-innings playlist from songs on the server | Yes | Yes | Yes |
| Upload MP3s; create and edit rosters, players, songs, clip and announcer settings | No | Yes | Yes |
| Create users, set roles, reset passwords | No | No | Yes |
| Choose the announcer voice, download and restore backups | No | No | Yes |

## Screens

The app opens on the roster list. One tap from there is game mode. Setup lives on separate screens.

**Rosters**
- A list of every roster. Tap one to open its game mode.
- A "download for offline" switch per roster, with a tick once everything is on the phone. Each phone chooses which rosters it keeps; nothing downloads automatically.
- Editors also see buttons to add and edit rosters.

**Game mode**
- The lineup is a list of large buttons in batting order, each showing number and name.
- Tap a player: the announcement and song play. Tap again: the song fades out.
- The next batter is highlighted automatically.
- Unavailable players are greyed out, moved to the bottom and skipped by the automatic highlight.
- One button starts and stops the user's between-innings playlist. Tapping a batter fades it out.
- The screen stays awake for the whole game.
- An "edit lineup" switch allows dragging players into a new order and marking them unavailable. It is off by default so nothing moves by accident.
- Show a small version number, and an "update" button when a newer version of the app is available, so the owner always knows which build is on the phone.

**Player editor (editors only)**
- Name and number.
- A "say it like this" spelling used only by the announcer, with a listen button that plays the result straight away. The name shown on the lineup never changes.
- Song: upload an MP3 or reuse one from the library.
- Clip: a waveform with draggable start and end handles, fade-out length, volume, and a preview button. The preview must sound exactly like game mode, including every setting below.
- Gain: a − / + stepper, 0.5 dB per tap (details under "Audio"). Manual only. No automatic levelling anywhere.
- Tone: bass and treble sliders (owner prefers sliders to knobs), heard live in the preview.
- Announcer timing: how long after the voice starts the song comes in.

**Between-innings playlist**
- Pick songs from the server's library to add or remove. Editors and admins can upload new MP3s here.

**Admin**
- Users and roles, announcer voice (with a button to hear a sample announcement in each voice), backup and restore.

## Audio

**Cutting clips.** The server cuts each clip from the original MP3 at MP3 frame boundaries and copies the frames unchanged (for example `ffmpeg -c copy`). The original upload is never modified, so clips can always be re-cut. When the start or length changes, re-cut and re-apply the gain.

**Gain.** The owner uses MP3Gain today and wants the same lossless method: rewriting the gain value stored in each MP3 frame. Notes:
- The frame gain can only move in fixed steps of 1.5 dB (verified 2026-10-11 with `mp3gain` in this container: one step = exactly 1.5 dB; MP3Gain's decimal "target" values are rounded to these steps).
- **Agreed 2026-10-11 (owner chose "option 1"):** the gain control is a − / + stepper that moves **0.5 dB per tap**. The server writes the largest 1.5 dB multiple at or below the setting into the clip losslessly; the phone applies the remainder (0, 0.5 or 1.0 dB) as a Web Audio gain at playback. Preview and game mode use the same split. Example: +5.0 dB = +4.5 dB in the file + 0.5 dB on the phone.
- The file part is always the largest 1.5 dB multiple at or below the setting (floor), so the phone's remainder is always 0, +0.5 or +1.0 dB.
- Gain belongs to the clip, not the song. Measure the loudest peak of the clip only, and stop the + button at the largest total boost (in 0.5 dB steps) that does not clip. A quiet section may therefore go louder than the whole song could.
- Apply gain to the cut clip file, never to the original.

**Playback on the phone.** Use the Web Audio API. Fade-out and volume are gain ramps; bass and treble are low-shelf and high-shelf filters. Prepare the audio when a roster opens so a tap plays instantly. Audio must start from a user tap on iPhone.

**Announcer mix.** By default the song starts quietly under the voice and rises to full volume when the voice ends. Per player, an editor can delay the song so it comes in partway through the voice or after it.

**Between innings.** Shuffled order. Fades out when a batter is tapped.

## Announcer

- The server turns each announcement into an audio file, so the phone plays it like any other clip and it works offline.
- **Voice engine:** try Kokoro first (free, open source, Apache licence, runs on an ordinary CPU, fixed set of voices). If the owner is not happy with it, the fallback is Chatterbox (voice cloning from a short sample; wants a graphics card, which the server can have).
- The voice engine runs in its own container. The app talks to it through one small interface so it can be swapped by changing configuration, not code.
- **Wording:** each roster has a template, default "Now batting, number {number}, {name}". Regenerate an announcement whenever the name, number, pronunciation or template changes.
- **Off switch:** announcements can be turned off for a whole roster or one player.
- The owner wants a natural voice with options that sound like a stadium announcer.

## Offline and sync

- The server holds the master copy. Each phone holds a working copy of the rosters it downloaded.
- Lineup changes made at the field are saved on the phone and sent to the server the next time the app is open with a connection. If two people changed the same lineup, the most recent change wins.
- When opened with a connection, the app downloads only what changed.
- iPhone: the app must be added to the home screen. This exempts it from Safari's rule that clears stored data after a week without use.

## Phones to support

- **iPhone 6s on iOS 15** is the owner's everyday test phone. Set the build target so the app runs on iOS 15 Safari.
- A newer iPhone on the current iOS, used for final checks. Phase 4 must pass on this phone before the app is trusted at a game.
- An Android phone.
- Keeping the screen awake: the Screen Wake Lock feature works in iPhone home-screen apps only from iOS 18.4. It was broken in home-screen apps from 16.4 to 18.3 and is missing before 16.4. Add a fallback for older iPhones, and note that the owner will set Auto-Lock to Never on the 6s while testing.

## Server and Docker (the finished product)

- Two containers started with one command: the app and the voice engine.
- One data folder holds everything: the database (a single file), the original MP3s, the cut clips and the generated announcements. Updating containers never touches it. Copying that folder is a full backup.
- The app sits behind whatever already serves the owner's https certificate.

## Build order

Each phase ends in something the owner can try.

1. **Server foundation:** accounts, the three roles, sign-in that persists. Test: sign in from an iPhone and an Android phone.
2. **Rosters and players:** create and edit teams, upload songs, cut clips with preview, gain, tone.
3. **Game mode:** lineup buttons, tap to play, fades, automatic next batter, reorder, unavailable players.
4. **Offline:** download rosters to the phone, add to home screen, sync lineup changes, version number and update button. This is the riskiest phase. Test: a full mock game in airplane mode on every phone.
5. **Announcer:** voice engine, generated announcements, pronunciation tuning, timing control.
6. **Between-innings playlist.**
7. **Admin extras:** backup and restore, voice choice, production Docker setup, and setup instructions for GitHub.

## Things to check during the build

These were not verified during planning. Test each one and tell the owner what you find.

- Whether `mp3gain` is installed in this container. If not, tell the owner, or propose another way to rewrite the frame gain losslessly.
- Whether a frame-boundary cut produces a clean start. MP3 frames can borrow data from earlier frames, which may cause a brief glitch at the start of a cut clip.
- The real storage limit for a home-screen web app on iPhone.
- Whether the iPhone ring/silent switch mutes Web Audio playback, and the workaround if it does.
- Which wake-lock fallback works on iOS 15.
- Whether Kokoro accepts exact phonetic spellings, as an advanced option beside "say it like this".
- Which Kokoro container image or server to use.

## Open questions for the owner

- Should the between-innings playlist work offline? Built 2026-10-12 without waiting for an answer (the owner asked to carry on): it streams by default, and each phone has a "Keep on this phone" switch on the Playlist screen. Confirm with the owner that this is what they want.
- ~~What name goes on the MIT licence?~~ Answered: `yesterdayforgotten` (owner's GitHub username). Also used as the git author name.

## Status

**Phase 1 (server foundation): built.**
**Phase 7 (admin extras): built 2026-10-12.** All seven phases are built; what's left is the owner's phone testing and listening to the real voice engine.
**Phase 6 (between-innings playlist): built 2026-10-12, waiting for the owner to test on phones.**
**Phase 5 (announcer): built 2026-10-12, waiting for the owner to add the voice engine container and listen.**
**Phase 4 (offline): built 2026-10-12, waiting for the owner to test on phones** (a full mock game in airplane mode on every phone, per the build order).
**Phase 3 (game mode): built 2026-10-12.** Owner has not yet reported phone results.
**Phase 2 (rosters and players): built.** Owner tested on the Pixel 9 (2026-10-12): preview plays, curved fade sounds better, drag-to-reorder works. iPhone checks (silent switch, 6s on iOS 15) postponed by the owner; do them before trusting game mode at a field.

### Phase 1 notes
- Stack: Express 5 + better-sqlite3 server (`server/`), React 19 + Vite client (`src/`), shared types in `shared/`. `npm run dev` runs one process on port 8090 serving the API and the screens with hot reload (Vite in middleware mode, HMR on the same server).
- Build target `safari15` in `vite.config.ts`.
- Database in `DATA_DIR` (default `./data`, git-ignored). Schema changes go in the `migrations` list in `server/db.ts`.
- Users with roles user / editor / admin; passwords hashed with Node's scrypt. First admin from `ADMIN_USERNAME`/`ADMIN_PASSWORD`, or a random password printed to the log.
- Sign-in: random session token in an httpOnly cookie, stored hashed. 400-day cookie renewed daily on use.
- Admin "Users" screen: add user, change role (can't remove the last admin), reset password (does not sign out existing phones; owner approved).
- Protections: login lockout after 10 failures per address for 15 minutes; mutating API calls must be JSON, or multipart with the `X-Batter-Beats: 1` header (cross-site forgery).

### Phase 2 notes
- Floodlight style everywhere (`src/styles.css`); fonts bundled from @fontsource (latin subsets) so they will work offline.
- Tables: `songs` (shared library), `rosters`, `players` (with `lineup_position`, `available` ready for phase 3), `player_songs` (position 0 only for now; holds clip settings and what is baked into the clip file).
- Data folder layout: `songs/<id>.mp3` (originals, never modified), `peaks/<id>.json` (waveform, 20 points/s), `clips/<playerSongId>-<version>.mp3` (cut clips; new name on every re-cut so phones can cache forever), `tmp/`.
- Cutting (`server/mp3.ts`): our own MP3 frame scanner copies whole frames; no ffmpeg re-encode. **Checked:** a frame-boundary cut with no lead-in glitches for the first ~100 ms (bit reservoir); with ≥2 lead-in frames the played audio is sample-identical to the original. We copy 4 lead-in frames and store `clip_offset_ms`; the phone starts playback there, with a 15 ms fade-in against clicks.
- Gain (`server/library.ts`): peak of the played part measured with ffmpeg; max gain = headroom floored to 0.5 dB; file part applied with `mp3gain -g <steps> -c -q -s s` on the cut clip. Verified a −3.0 dB setting measured exactly −3.0 dB.
- Known small offset: cut clips have no LAME header, so a browser may play them ~25 ms later than the waveform suggests. Not audible for walkups; preview and game mode use the same file.
- Adding players (changed 2026-10-12 at the owner's request): the roster editor's "Add player" form stays open after each add, clears and refocuses the number box, so a whole team can be typed in one go. It does not jump to the player editor or ask for a song; players without one show "No song yet", and the song is chosen later by tapping the player.
- Batting order (added 2026-10-12 at the owner's request): the roster editor has a "Reorder" button that shows grab bars on each row; drag to reorder, "Done" to finish. Saved straight away through `PUT /api/rosters/:id/order` (any signed-in user, since the lineup is reorderable in game mode too). The drag list is `src/components/SortableList.tsx`, built on pointer events, with auto-scroll near the screen edges; game mode's "edit lineup" switch should reuse it.
- Player editor autosaves every change (no Save button; shows "Saving… / Saved ✓"). Mockup had a Save button; changed to remove a tap. Tell the owner.
- Audio engine (`src/audio/engine.ts`) shared by preview and (later) game mode: source → low-shelf 150 Hz → high-shelf 3.5 kHz → level (volume × remainder gain) → envelope (fade in/out). Tap again fades out over the clip's fade length (0.3–5 s).
- iPhone silent switch: engine loops a silent `<audio>` element on iOS and sets `navigator.audioSession.type = "playback"` where available, so the switch should not mute playback. **Not yet verified on a real iPhone.**
- Announcer fields (pronunciation, timing, on/off) are not built yet: phase 5.
- Roster screen (`/rosters/:id`) is a read-only lineup until game mode in phase 3.

### App icon
- Agreed 2026-10-12: "P2a", a blue home plate at regulation proportions (as tall as wide) with five dark sound bars, on the near-black background. Files in `public/`: `favicon.svg` and `favicon.ico` (browser tab), `apple-touch-icon.png` (iPhone home screen, 180 px, square; iOS rounds the corners), `icon-192.png` and `icon-512.png`, and `icon-maskable-*.png` (plate shrunk to fit Android's circle crop). `public/manifest.webmanifest` (added 2026-10-12) gives the installed app its name, the near-black background and theme colour (Android's start-up screen) and these icons.

### GitHub and Docker (done early, 2026-10-12, at the owner's request)
- Repo: `github.com/yesterdayforgotten/batter-beats` (public), remote `origin`.
- `Dockerfile`: multi-stage; builds the screens, keeps production dependencies only, runs `node server/index.ts` (Node 22 strips TypeScript types itself, so server code must avoid enums and other non-erasable syntax). Includes ffmpeg, mp3gain and tini; runs as `node`; data in `/data`; health check on `/api/health`.
- `.github/workflows/docker.yml` publishes `ghcr.io/yesterdayforgotten/batter-beats` (`latest`, short SHA, and version tags `v*`) on each push to `main`.
- Dev container: `Dockerfile.dev` (Node 22, ffmpeg, mp3gain, headless-browser libraries) published as `ghcr.io/yesterdayforgotten/batter-beats-dev` by `.github/workflows/docker-dev.yml` when it changes. Its start-up (`scripts/dev-container-start.sh`) installs Claude into the mounted home on first run, starts the dev server, then runs the Claude loop. `/workspace` and `/home/node` are host folders, so switching images keeps sessions and credentials.
- `docker-compose.yml` is the production stack for Portainer; the voice engine container joins it in phase 5.

### Dev environment notes
- `mp3gain` 1.6.2 and `ffmpeg` 5.1 are installed in the dev container.
- No browser in the container; for screenshots a headless Chromium was downloaded to `~/.cache/ms-playwright` with missing libraries unpacked into the session scratchpad (not part of the repo).
- The dev server runs from `scripts/dev-server.sh`, which restarts it if it stops and logs to `dev-server.log` (git-ignored). Start it detached so it outlives Claude's own background tasks: `setsid scripts/dev-server.sh > /dev/null 2>&1 < /dev/null &`. To start it on every container restart, the owner was asked (2026-10-12) to add that same line to the Portainer stack's command, right after `cd /workspace`.

### Phase 3 notes
- Wording agreed 2026-10-12: the main list is "Teams" (new/edit/delete team); "roster" means a team's list of players.
- Game mode is `src/pages/GamePage.tsx` at `/rosters/:id` (tapping a team on the main screen). Batting order and availability come from the server's shared lineup; editors get a ⋮ to the team editor.
- Tap a batter: they become "at bat" (solid blue) and their song plays; tap again to fade out over the clip's fade length. Tapping a different batter fades the current song in 0.5 s and starts theirs. After the song ends, the at-bat row stays blue ("tap to play again"). Players with no song can still be tapped to move the lineup on.
- "On deck" (blue outline) is the next available player after the one at bat, wrapping to the top. The at-bat player is remembered per phone (localStorage) so a reload doesn't lose the place.
- Reorder mode, opened from the ⋮ menu in the header (2026-10-12: was an "Edit lineup" switch; the menu also has Edit Team for editors, and a Done button closes the mode): drag to reorder (same list as the team editor), "Sit out" moves a player to "Unavailable" (was "Bench today"), "Back in" returns them. Saved to the server at once: `PUT /api/rosters/:id/order` and `PUT /api/players/:id/available`, open to all signed-in users. Offline queuing of these comes in phase 4.
- Memory: every clip file is downloaded when game mode opens (~1 MB each), but only the 4 most recently used are kept decoded (~10 MB each); the on-deck batter is decoded ahead so a tap plays instantly.
- Screen awake: Screen Wake Lock API, plus on iOS before 18.4 a tiny muted looping video (`public/keep-awake.mp4`), both started by the first tap. **Not yet verified on a real iPhone**; the owner sets Auto-Lock to Never on the 6s meanwhile.
- Version number and update button are left for phase 4, with the offline work.
- Tested in headless Chromium at phone size: tap/fade/switch/end states, on-deck skipping a benched player, wrap-around, reload.

### Phase 4 notes
- Each team on the Teams screen has an "Offline" switch (per phone). Turning it on saves the roster (localStorage) and downloads its clips into Cache Storage `bb-clips`; the switch shows "3/12" while downloading and a tick when every clip is on the phone. Turning it off removes the roster and any clips no other kept team uses. Signing out clears everything kept.
- `src/offline.ts` holds all of this, plus the lineup queue. Kept rosters are refreshed whenever the app opens or the connection returns; only clips the phone lacks are downloaded (clip names change on every re-cut).
- Service worker `public/sw.js`: serves kept clips from the phone; stores the app's own files as they load (built `/assets/` are served stored-first; everything else network-first); the page itself is network-first with a 4 s fallback to the stored copy. Turning Offline on also re-fetches every file the page has loaded, so the app opens offline even if it was first loaded before the service worker took over. Lookups use `ignoreVary`: the dev server marks responses `Vary: Origin`, which otherwise hid stored copies.
- Without a connection: the Teams screen lists the kept teams with a notice; game mode plays from the phone ("No connection. Playing from this phone."); editing screens need a connection. The signed-in user is remembered on the phone (`bb.user`), so the app opens signed in offline.
- Lineup changes in game mode apply on the phone at once and go through a queue: sent straight away, or kept until the connection returns (the screen says how many are waiting). Each change carries the time it was made; the server ignores a change older than the one it already has (`rosters.order_changed_at`, `players.available_changed_at`), so the most recent change wins. An order sent for a roster that has since gained or lost players is merged, not refused.
- Version: `v<package version> · <build>`, where the build is the short commit id set by GitHub Actions (`APP_VERSION`), or "dev". Shown under the Teams screen and at the bottom of game mode. `GET /api/version` reports the server's build; when it differs, an Update button reloads the app.
- Tested in headless Chromium, in dev mode and with a production build: keep a team, reopen with no connection, play, sit a player out offline, reload offline, reconnect and confirm the server got the change; older changes ignored; Update button appears.
- **Not yet verified on real phones**, in particular: iPhone storage limits for home-screen apps, and that iOS keeps the service worker and Cache Storage across days (being a home-screen app should exempt it from Safari's 7-day clearing).

### Phase 5 notes
- **Current state (2026-10-12, after much trying):** the announcer uses **ElevenLabs** (Eleven v4, `ELEVENLABS_API_KEY`) with **Kokoro** as the free self-hosted fallback (`TTS_URL`). **Chatterbox and Murf were removed** at the owner's request (Chatterbox: 40–60 s per announcement on the owner's i7-2600K; Murf: the owner preferred ElevenLabs). Their notes below are history. Engines say how they handle speed and pitch (`native`, `after` with ffmpeg, or `none`): ElevenLabs ignores speed (tested: `voice_settings.speed` had no effect on v3) and gets neither, so those sliders are hidden and the cue carries pace/energy. The ElevenLabs cue is free text with tap/hover suggestions. Reverb went through echo-based versions (tinny) and convolution (too loud, then "warehouse"). **Then replaced by a stadium echo (2026-10-12):** even calibrated (it had been ~15 dB louder than the voice, fixed), the owner said reverb sounded "like an empty warehouse, not a stadium". Right: reverb is an enclosed-space sound and a ballpark is open air. The effect (Admin: **Echo** and **Distance**) is now the dry voice plus three delayed copies: the first at 90 ms (small field) to 250 ms (big stadium), then ≈2× and 3× that, each 6 dB quieter and duller (250 Hz–~3 kHz). Echo sets the first echo from ~34 dB under the voice (5%) to 10 dB under (100%). No convolution any more. `REVERB_VERSION` in the announcement key remakes only announcements that use it. **Speech cache (owner's idea, 2026-10-12):** the engine's raw recording is kept in `data/speech-cache/` (sha1 of engine, voice, spoken text and every style setting except echo and after-the-fact speed/pitch; newest 500 kept, a cache, not in backups), so changing only the echo, in Listen or for every announcement, never asks ElevenLabs again. Same settings also give the same take. ElevenLabs itself has no reverb setting. Cues are stored and shown exactly as sent, "[shouting] [excited]" (typing "shouting, excited" is converted on leaving the box). Model choice v4 (default) / v3: both 1 credit per character (v4 Turbo is 0.5). Measured 2026-10-12 with Adam, same line: on v3 cues changed little; on v4 [shouting] clearly added edge, [excited] and the pair less, none least. Suggestions are now only emotion/delivery words (descriptions like "stadium PA announcer" did little). Pace on v4: `voice_settings.speed` 0.8/1.0/1.2 made no difference (all ~3.2 s), but cues do: `[slowly]` ~3.9 s, `[speaking quickly]` ~2.95 s (two takes each). Suggestions now: shouting, excited, booming, with emphasis (last two untested, owner's request), enthusiastic, proud, dramatic, speaking quickly, slowly. Library voices David, Tyler, John (energetic) and Guy (upbeat) were added to the owner's ElevenLabs account, but **free plans can't use library voices through the API** (402 paid_plan_required: add $5 credit or Starter); the app now says so instead of "out of credits". **Then (owner's request) removed:** the four library voices (deleted from the account), the in-app library search, and the v3 option. ElevenLabs now always uses `eleven_v4`, and the voice list leaves out library ("professional") voices; only ElevenLabs' own 21 voices show. Restore from git history if the owner moves to a paid plan, and announcements are saved at 128 kbps (was 96).
- Voice engine: Kokoro-FastAPI (`ghcr.io/remsky/kokoro-fastapi-cpu`), port 8880, OpenAI-style `POST /v1/audio/speech` (`model: "kokoro"`, `input`, `voice`, `response_format: "mp3"`) and `GET /v1/audio/voices`. The app talks to it only through `server/announcer.ts`, at `TTS_URL` (default `http://kokoro:8880`; empty turns the announcer off). Swapping engines means changing that one file and the URL.
- **Checked (Kokoro docs):** exact pronunciations are written in the input as `[Word](/IPA/)`, e.g. `[Siobhan](/ʃɪvˈɔːn/)`. The "Say it like this" field passes text through unchanged, so plain respellings ("Kay-den") and this syntax both work. Not yet heard with the real engine.
- Each player's announcement is an MP3 in `data/announcements/<playerId>-<key>.mp3`, where the key is a hash of voice + text, so it's remade only when the voice, wording, name, number or spelling changes. Made one at a time in the background (on every change, and at server start for anything missing or out of date), loudness-matched with ffmpeg `loudnorm` (speech may be re-encoded; songs never are). `POST /api/players/:id/announcement` waits for it (the editor's Listen button).
- Wording per team (`{number}`, `{name}`; must include `{name}`); players with no number skip the "number …" part. Announcer on/off per team and per player. Default voice `am_michael`; stored in the new `settings` table (`announcer_voice`), chosen by an admin in phase 7. API for that already exists: `GET /api/announcer`, `POST /api/announcer/sample`, `PUT /api/announcer/voice`.
- Playback (`Playback` in `src/audio/engine.ts`): the voice starts at once; the song starts `songDelayMs` later (per player, 0–10 s, the "Song in" slider), plays at 25% under the voice and rises to full over 0.7 s when the voice ends. Tap fades both. Announcements are kept offline with the clips. A player with an announcement but no song still gets announced.
- Loudness: ffmpeg's `loudnorm` misjudges clips under ~3 s (the first real announcements came out at about −34 dB mean), so `normalizeVoice` measures integrated loudness with `ebur128` and applies the gain directly to reach −13 LUFS, with `alimiter` at −1.5 dB (results measure about −15 LUFS). Under a ducked song (−12 dB) the voice sits well above the music. `PROCESSING` in `announcer.ts` is part of each announcement's key: bump it when processing changes so existing announcements are remade.
- Delivery (added 2026-10-12, owner: "they sound not excited"): Kokoro has no emotion setting, so an admin-set style (`settings.announcer_style`, part of every announcement's key) offers Energy calm/lively/hyped (punctuation: "…, Ava." / "…, Ava!" / "Now batting! Number 12! Ava!"; default lively), Speed 0.8–1.4 (Kokoro's `speed`), Pitch lift 0–4 semitones (ffmpeg `rubberband` with formants preserved) and a stadium echo (`aecho`). Admin → Announcer voice → Delivery, with Listen to try a mix before saving (`POST /api/announcer/sample` accepts a `style`), and `PUT /api/announcer/style`. Real emotion control would need Chatterbox (owner chose to tune Kokoro instead).
- **Switched to Chatterbox (2026-10-12, owner's choice after Kokoro "still sounds bored"; no GPU yet, can add one).** `server/voiceEngines.ts` holds both engines behind one interface; `TTS_ENGINE` (`chatterbox` | `kokoro`) and `TTS_URL` pick one, so Kokoro remains available. Chatterbox (travisvn/chatterbox-tts-api, AGPL-3.0, port 4123): `POST /v1/audio/speech` with `exaggeration` (0.25–2, "Excite"), `cfg_weight` ("Pace", lower = slower/more dramatic), returns WAV; `GET/POST /voices` voice library (upload `voice_file` + `voice_name`), and "Built-in voice" = no voice named. It has no speed setting, so speed is applied afterwards with rubberband `tempo`. Timeout 5 min per announcement (CPU). The chosen voice is stored per engine (`announcer_voice` for Kokoro, `announcer_voice_chatterbox`). Admins can add a voice from a 10–30 s recording (`POST /api/announcer/voices`).
- **Murf as a second engine (2026-10-12, owner: "keep the option of Chatterbox, but also have the option for Murf").** Walkout Song DJ appears to use Murf (its forum has a "Murf.Ai Error" thread and voices named Natalie and Miles). With `MURF_API_KEY` set, Admin shows a Chatterbox | Murf switch (`settings.announcer_engine`; `PUT /api/announcer/engine` remakes everything). Murf API: `POST https://api.murf.ai/v1/speech/generate` (header `api-key`; `voiceId`, `style`, `rate` −50…50 from our speed, `format: MP3`, `encodeAsBase64: true` so Murf keeps no copy), `GET /v1/speech/voices` (English voices; styles from `supportedLocales[locale].availableStyles`; cached an hour). Style is chosen per voice ("Promo" etc.); a saved style the voice lacks isn't sent. Pricing checked 2026-10-12: about $0.03 per 1,000 characters (≈ $0.02 per 15-player team), $10 free credit advertised. Tested against a stand-in, then **with the real Murf (2026-10-12, owner's key in the dev stack, never in the repo)**: 162 voices, 82 English (42 male); about 2–3 s per announcement. Miles and Edmund have a "Sports Commentary" style. Samples sent to the owner: Miles and Edmund (Sports Commentary), Wayne, Ken and Cooper (Promo). Also fixed: Listen could return before an announcement whose settings changed mid-way was remade; the queue now remakes until it's current.
- **ElevenLabs as a third engine (2026-10-12, owner added `ELEVENLABS_API_KEY`).** Docs site blocks automated readers; API taken from the official Python SDK (github.com/elevenlabs/elevenlabs-python). Speech: `POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`, header `xi-api-key`, `model_id: "eleven_v3"`, delivery cue written before the text (`[excited] Now batting…`, Admin "Cue", presets or your own), `voice_settings.stability` 0 / 0.5 / 1 from the Excite slider (shown as Range: Wild / Natural / Steady). Speed applied afterwards. Voices: `GET /v2/voices` (21 of ElevenLabs' own). Shared library: `GET /v1/shared-voices` (search, previews free) and `POST /v1/voices/add/{owner}/{voice}` ("Find more voices" on Admin). The key needs Text to Speech and Voices (read and write) permissions; errors say which is missing. Real samples sent (Brian with [excited], [shouting], [sports announcer]): 1–2 s each. Library has many "Bob" voices (e.g. "Bob - Deep and Insightful"); Walkout Song DJ's Bob may be one of them, unconfirmed.
- Voice filters (2026-10-12, owner request): engines report gender / accent / age in common words (`normGender`, `normAccent` incl. Murf locales like en-UK → British, `normAge`); Admin shows Gender / Accent / Age dropdowns over the voice list (default Male, reset per engine; the voice in use always shows) and over the ElevenLabs library search (passed to `/v1/shared-voices` as its own labels). Chatterbox voices carry no such details, so no filters there.
- Reverb (owner asked for it to be tunable): amount 0–1 and size 0–1 (room → ballpark), a five-tap `aecho` spaced by size, trailing silence trimmed; replaces the earlier on/off echo (a saved `echo: true` becomes 40%).
- The Chatterbox project publishes no image, so `.github/workflows/chatterbox.yml` builds its CPU Dockerfile unchanged from a pinned commit and publishes `ghcr.io/yesterdayforgotten/chatterbox-tts-api:cpu`. A GPU image is for when the owner adds a graphics card (its `docker/Dockerfile.gpu`, plus an NVIDIA device reservation in the stack).
- Tested: real Kokoro (reverb sizes change the tail, settings save), and Chatterbox via a stand-in with the same API (excitement/pace passed through, voice upload, choosing it remakes announcements, Admin screen). **Not yet run with the real Chatterbox.**
- **Real Chatterbox, first run (2026-10-12, CPU):** loads in ~80 s (after its model download) and uses ~4.9 GB of memory, but its default multilingual model failed every request on CPU ("Sizes of tensors must match…", "expected Tensor … got NoneType", even with no settings). Stacks now set `USE_MULTILINGUAL_MODEL=false` for the original English model. With the English model it works: ~60 s to load, ~4 GB memory, and **40–60 s per announcement** on the owner's server (Intel i7-2600K, 4 cores / 8 threads, 24 GB RAM). Both dev players' announcements were made by the automatic retry. Samples sent to the owner: lively/excite 1.0, hyped/excite 1.5/slow/45% ballpark reverb, hyped/excite 2.0/+1 pitch/60% reverb.
- The voice engine and the app start together, so announcements made before Kokoro is ready fail; `startAnnouncer()` retries failed ones every 30 s.
- **Checked with the real Kokoro (2026-10-12, dev stack):** announcements generate (about 2.2 s for "Now batting, number 12, Test"), the voice list loads (`am_v0…` duplicates hidden on the Admin screen), retry after an unreachable engine works. Not yet listened to by the owner.
- Tested against a stand-in for Kokoro (same API, returns a tone): generation, regeneration on changes, wording with and without numbers, team/player off, offline storage, game mode, Listen and Preview.

- **Per-team announcer (2026-10-12, owner's request):** each team has its own voice and delivery, set in Edit team → Announcer next to the wording (`rosters.announcer_voices` JSON per engine, `rosters.announcer_style` JSON; `PUT /api/rosters/:id/announcer`, editors). Teams that haven't chosen use the earlier app-wide settings as defaults (`currentVoice`/`currentStyle`). Admin keeps only the engine choice. The shared UI is `src/components/AnnouncerSettings.tsx`; Listen speaks the team's own wording (`template` in `POST /api/announcer/sample`). Cues can also go inside the wording (e.g. `[drawn out] Now batting, …`); Kokoro gets them stripped. **Credits lesson (2026-10-12, the free 10,000 ran out):** ElevenLabs' history showed that saving the wording on leaving the box remade every player on each edit, and Listen often spoke the *previous* wording (it read the saved one, which tapping Listen was still saving). Now the wording is a draft like the delivery: Listen speaks exactly what's typed, and Use these settings saves wording + delivery together through `PUT /api/rosters/:id/announcer` (one remake). A recording already on its way is shared, not requested twice. Sample name is "Melody".

### Phase 6 notes
- Each user has their own playlist (`playlist_songs`), built on the Playlist screen (link in the top menu) from the shared library; editors can upload there too. `GET/PUT /api/playlist`; whole songs at `/api/media/songs/<id>.mp3` (originals, immutable, range requests).
- Game mode has a "Between innings" button at the bottom (sticky): starts a fresh shuffle, shows the song, reshuffles after the last song; tap again to fade out. Tapping a batter fades it out over 1.5 s (same curve as walkups); starting it fades out a walkup that's still playing.
- Whole songs stream through one `<audio>` element routed through Web Audio for the fades (iPhones ignore `<audio>` volume), not decoded into memory like clips. `src/playlist.ts`.
- Offline: "Keep on this phone" downloads the playlist's songs into Cache Storage `bb-songs` (size shown) and keeps them in step with the playlist; offline, kept songs play from the phone and others are skipped. The playlist itself is remembered on the phone. Signing out clears it.
- Tested in headless Chromium: build a playlist, keep it, start/stop in game mode, fade on batter tap, play offline from the phone.

### Phase 7 notes
- Admin screen (`/admin`, "Admin" in the top menu, admins only): link to Users; announcer voice (English Kokoro voices, male first; Listen plays "Now batting, number 12, Alex Rivera"; Use switches and remakes every announcement); backup.
- Backup: `GET /api/admin/backup` streams a plain `.tar` of the data folder (consistent database copy via SQLite's backup, plus songs, peaks, clips, announcements and a `batter-beats-backup.json` marker). Restore: `POST /api/admin/restore` unpacks to tmp, checks it's a backup whose database opens (upgrading an older one) and has an admin, then closes the database, moves current data to `tmp/before-restore-<time>` (only the newest kept), moves the backup in and reopens; any failure puts everything back. `db` is `export let` so the reopen reaches every module.
- Fixed while testing: the request safety check refused DELETE requests (they have no body), so Delete team and Remove player never worked. DELETEs are now allowed: other sites can't send them without a CORS preflight, which the server never grants.
- README is now the setup guide (stack, https proxy, first sign-in, phones, updating, backups, settings).
- Tested on a test server: backup download, bad file refused with nothing changed, restore brings back deleted data and files, regular users refused; Admin screen Listen/Use/download/restore in headless Chromium. Offline test re-run with announcements (stored and played offline).

Next: owner tests on phones (iPhone 6s, newer iPhone, Pixel), including a full mock game in airplane mode, and adds the Kokoro container to the dev stack to hear the real voices.
