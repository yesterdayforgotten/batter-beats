# Batter Beats

Walkup music for baseball and softball games. A web app you add to your phone's
home screen, served from your own server.

Work in progress. See [PLAN.md](PLAN.md) for the plan and current status.

## Development

Requires Node.js 22, `ffmpeg` and `mp3gain`.

```sh
npm install
cp .env.example .env   # then edit .env
npm run dev            # http://localhost:8090
```

On first start, if the database has no users, an admin account is created. If
`ADMIN_PASSWORD` is empty in `.env`, a random password is printed in the log.
