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
| Visual style | Agreed 2026-10-11 from mockups: "Floodlight". Near-black background (#08090b, cards #15171c / #1d2027), one electric-blue accent (#3d9bff; dark text #00142b on blue fills), Big Shoulders Display for big numbers and headings, Manrope for body text. Lineup is a full-width list; playing batter is a solid blue row labelled "At bat · tap to fade" with small moving sound bars; next batter has a blue outline and an "On deck" tag; unavailable players sit under "Bench today". Player editor is compact: one line per sound control (gain stepper, volume, fade-out, bass, treble sliders). Mockups: the owner's private "Batter Beats UI ideas" design canvas, page "Fresh dark ideas", look D. |

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

- Should the between-innings playlist work offline? That would mean storing whole songs on the phone, several MB each, on top of the clips. Ask before phase 6.
- ~~What name goes on the MIT licence?~~ Answered: `yesterdayforgotten` (owner's GitHub username). Also used as the git author name.

## Status

**Phase 1 (server foundation): built.**
**Phase 3 (game mode): built 2026-10-12, waiting for the owner to test on phones.**
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
- Agreed 2026-10-12: "P2a", a blue home plate at regulation proportions (as tall as wide) with five dark sound bars, on the near-black background. Files in `public/`: `favicon.svg` and `favicon.ico` (browser tab), `apple-touch-icon.png` (iPhone home screen, 180 px, square; iOS rounds the corners), `icon-192.png` and `icon-512.png` (ready for the Android app manifest in phase 4).

### Dev environment notes
- `mp3gain` 1.6.2 and `ffmpeg` 5.1 are installed in the dev container.
- No browser in the container; for screenshots a headless Chromium was downloaded to `~/.cache/ms-playwright` with missing libraries unpacked into the session scratchpad (not part of the repo).
- The dev server runs from `scripts/dev-server.sh`, which restarts it if it stops and logs to `dev-server.log` (git-ignored). Start it detached so it outlives Claude's own background tasks: `setsid scripts/dev-server.sh > /dev/null 2>&1 < /dev/null &`. To start it on every container restart, the owner was asked (2026-10-12) to add that same line to the Portainer stack's command, right after `cd /workspace`.

### Phase 3 notes
- Wording agreed 2026-10-12: the main list is "Teams" (new/edit/delete team); "roster" means a team's list of players.
- Game mode is `src/pages/GamePage.tsx` at `/rosters/:id` (tapping a team on the main screen). Batting order and availability come from the server's shared lineup; editors get a ⋮ to the team editor.
- Tap a batter: they become "at bat" (solid blue) and their song plays; tap again to fade out over the clip's fade length. Tapping a different batter fades the current song in 0.5 s and starts theirs. After the song ends, the at-bat row stays blue ("tap to play again"). Players with no song can still be tapped to move the lineup on.
- "On deck" (blue outline) is the next available player after the one at bat, wrapping to the top. The at-bat player is remembered per phone (localStorage) so a reload doesn't lose the place.
- "Edit lineup" switch (off by default): drag to reorder (same list as the team editor), "Sit out" moves a player to "Bench today", "Back in" returns them. Saved to the server at once: `PUT /api/rosters/:id/order` and `PUT /api/players/:id/available`, open to all signed-in users. Offline queuing of these comes in phase 4.
- Memory: every clip file is downloaded when game mode opens (~1 MB each), but only the 4 most recently used are kept decoded (~10 MB each); the on-deck batter is decoded ahead so a tap plays instantly.
- Screen awake: Screen Wake Lock API, plus on iOS before 18.4 a tiny muted looping video (`public/keep-awake.mp4`), both started by the first tap. **Not yet verified on a real iPhone**; the owner sets Auto-Lock to Never on the 6s meanwhile.
- Version number and update button are left for phase 4, with the offline work.
- Tested in headless Chromium at phone size: tap/fade/switch/end states, on-deck skipping a benched player, wrap-around, reload.

Next: owner tests phase 3 on phones, then phase 4 (offline; needs the https address first).
