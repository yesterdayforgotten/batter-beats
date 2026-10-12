# Batter Beats

Walkup music for baseball and softball games. A web app you add to your phone's
home screen, served from your own server.

Work in progress. See [PLAN.md](PLAN.md) for the plan and current status.

## Running it

A ready-built image is published to `ghcr.io/yesterdayforgotten/batter-beats`
on every push to `main`. It includes everything it needs (Node, ffmpeg,
mp3gain). Start it with [docker-compose.yml](docker-compose.yml) (in Portainer:
Stacks → Add stack, paste the file), after setting an admin password in it.

All data (database, songs, clips) lives in the `/data` volume. Put the app
behind an https reverse proxy: adding it to a phone's home screen and storing
clips for offline use need https.

## Development

Requires Node.js 22, `ffmpeg` and `mp3gain`.

```sh
npm install
cp .env.example .env   # then edit .env
npm run dev            # http://localhost:8090
```

On first start, if the database has no users, an admin account is created. If
`ADMIN_PASSWORD` is empty in `.env`, a random password is printed in the log.
