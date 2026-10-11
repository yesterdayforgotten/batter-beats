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
- An https dev address is planned but not set up yet (the owner's Apache reverse proxy will forward to port 8090, and must pass WebSockets for hot reload). Home-screen install and offline storage only work over https, so phases 1 to 3 can be tested over plain http on the home network, but phase 4 needs the https address first. Remind the owner before phase 4.
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
- Gain: a slider that boosts or cuts the clip losslessly (details under "Audio"). Manual only. No automatic levelling anywhere.
- Tone: bass and treble knobs, heard live in the preview.
- Announcer timing: how long after the voice starts the song comes in.

**Between-innings playlist**
- Pick songs from the server's library to add or remove. Editors and admins can upload new MP3s here.

**Admin**
- Users and roles, announcer voice (with a button to hear a sample announcement in each voice), backup and restore.

## Audio

**Cutting clips.** The server cuts each clip from the original MP3 at MP3 frame boundaries and copies the frames unchanged (for example `ffmpeg -c copy`). The original upload is never modified, so clips can always be re-cut. When the start or length changes, re-cut and re-apply the gain.

**Gain.** The owner uses MP3Gain today and wants the same lossless method: rewriting the gain value stored in each MP3 frame. Notes:
- This method moves in fixed steps of 1.5 dB, so the slider should step in 1.5 dB.
- Gain belongs to the clip, not the song. Measure the loudest peak of the clip only, and stop the slider at the largest boost that does not clip. A quiet section may therefore go louder than the whole song could.
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

**Phase 1 (server foundation): built, waiting for the owner to test on phones.**

Done in phase 1:
- Stack: Express 5 + better-sqlite3 server (`server/`), React 19 + Vite client (`src/`), shared types in `shared/`. Run with `npm run dev`: one process on port 8090 serves the API and the screens, with hot reload (Vite in middleware mode, HMR on the same server).
- Build target `safari15` in `vite.config.ts`.
- Database in `DATA_DIR` (default `./data`, git-ignored). Schema changes go in the `migrations` list in `server/db.ts`.
- Users with roles user / editor / admin. Passwords hashed with Node's built-in scrypt. First admin created on first start from `ADMIN_USERNAME`/`ADMIN_PASSWORD`, or a random password printed to the log.
- Sign-in: random session token in an httpOnly cookie, stored hashed in `sessions`. Cookie lasts 400 days (browser maximum) and is renewed daily on use, so phones stay signed in until sign-out.
- Admin "Users" screen: add user, change role (can't remove the last admin), reset password. Admins change their own password the same way.
- Protections: login lockout after 10 failures per address for 15 minutes; mutating API calls must be JSON (blocks cross-site forgery).
- Resetting a password does not sign out that user's existing phones (owner approved).

Checked so far:
- `mp3gain` 1.6.2 and `ffmpeg` 5.1 are installed in the dev container.
- No browser is installed in the container; for screenshots a headless Chromium was downloaded to `~/.cache/ms-playwright` with missing libraries unpacked into the session scratchpad (not part of the repo).

Next: owner tests phase 1 on iPhone 6s, newer iPhone and Android, then phase 2.
