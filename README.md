# Tin Tanks

A four-player, top-down, cartoon WW2 tank scrap that runs in the browser.
Drive with **WASD**, fire with **SPACE**, use buildings and sandbags as cover.
Three hits and you're scrap; you respawn three seconds later on the spawn
point furthest from the enemy.

- **Client**: three.js, toon-shaded, orthographic camera that scrolls with your tank.
- **Server**: authoritative Node.js simulation over WebSocket, 30 Hz, max 4 tanks.
  It also serves the built client, so a session's join link is just `http://host:port/`.
- **Gameye**: one Dockerfile, non-root, single TCP port. Register it as an application
  with a TCP port binding on 8080 and start sessions through the API.

```
tin-tanks-claude/
├── shared/    rules, map layout and movement/collision physics used by both sides
├── server/    game simulation (game.js), WebSocket + static server (index.js), tests
├── client/    Vite + three.js browser client
├── tools/     bot.js — practice bot that joins a server and hunts players
└── Dockerfile multi-stage image for Gameye
```

## Run it locally

```bash
npm install
npm run build          # builds the client into client/dist
npm start              # serves game + client on http://localhost:8080/
```

Open <http://localhost:8080/> in up to four browser tabs, pick a call sign, hit DEPLOY.
For a sparring partner without a second human:

```bash
npm run bot -- ws://localhost:8080 --name=Fritz
```

For client development with hot reload, run `npm run dev:server` and `npm run dev:client`
and open <http://localhost:5173/> (the dev client connects to `ws://localhost:8080`).
Any client can be pointed at another server with `?server=host:port`.

```bash
npm test               # server simulation tests (node:test)
```

## Run it in Docker

```bash
npm run docker:build   # docker build -t tin-tanks-claude:local .
npm run docker:run     # docker run --rm -p 8080:8080 tin-tanks-claude:local
```

The server reads its port in this order: `--port=N` argument, `PORT` env var,
`GAMEYE_PORT_TCP_8080` when `NETWORK_MODE=host`, otherwise 8080. It exits after
`IDLE_SHUTDOWN_SECONDS` (default 300, `0` disables, or `--idle=N`) without players so
an abandoned Gameye session ends on its own. `/health` returns
JSON with player count, tick and uptime and backs the image HEALTHCHECK.

### Live player counts on Gameye

Set `GAMEYE_API_TOKEN` (and `GAMEYE_API_URL` when not on production, e.g. the
sandbox base) in the session's `env`, and the server reports every join and leave
to `PUT /session/player/join` and `DELETE /session/player/leave`. The session id
comes from the `GAMEYE_CONTAINER` variable Gameye injects. This keeps
`playerCount` on `GET /session` live, which is what the `playerCount[lt]` backfill
filter needs. Without a token the server runs normally and reports nothing.

## Host it on Gameye

Gameye nodes run linux/amd64, so build for that platform when pushing from an
Apple Silicon machine.

1. Build and push the image to a registry Gameye can pull from. A public build is
   published at `ghcr.io/capt-marbles/tin-tanks:0.1.0` (also `:latest`):

   ```bash
   docker build --platform linux/amd64 -t tin-tanks-claude:0.1.0-amd64 .
   docker tag tin-tanks-claude:0.1.0-amd64 ghcr.io/capt-marbles/tin-tanks:0.1.0
   docker push ghcr.io/capt-marbles/tin-tanks:0.1.0
   ```

   GHCR packages are private on first push; make it public under the package's
   settings on GitHub. Anonymous pulls can be checked with
   `docker manifest inspect ghcr.io/capt-marbles/tin-tanks:0.1.0` after `docker logout ghcr.io`.

2. In the Admin Panel create an application for the image with **bridge networking**
   and one port binding: **TCP 8080**. (For host networking instead, add
   `"env": {"NETWORK_MODE": "host"}` to the session request; the server then binds to
   the port Gameye injects as `GAMEYE_PORT_TCP_8080`.)

3. Start a session:

   ```bash
   curl -X POST https://api.production-gameye.gameye.net/session \
     -H "Authorization: Bearer $GAMEYE_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "id": "'$(uuidgen | tr A-Z a-z)'",
       "location": "europe",
       "image": "tin-tanks",
       "env": { "GAMEYE_API_TOKEN": "'$GAMEYE_TOKEN'" },
       "ttl": "1h"
     }'
   ```

4. The response contains `host` and a `ports` entry for container port 8080. Share
   `http://<host>:<ports[0].host>/` with your players. The server also logs this
   join link on startup when the `GAMEYE_IP` and `GAMEYE_PORT_TCP_8080` variables
   are present.

Session `args` are appended to the entrypoint (e.g. `"args": ["--port=8080"]`) and
session `env` values are visible to the process, matching the Gameye sample images.

### Why one TCP port and no TLS

Browsers cannot speak UDP, so the game uses WebSocket over TCP, which Gameye supports
as a `tcp` port binding. Sessions expose a raw IP and port without TLS, which is why
the game server serves the client itself: an `http://` page can open a `ws://` socket,
whereas a page hosted on HTTPS elsewhere could not. Put a TLS-terminating proxy or
Gameye ingress in front if you need `https://` links.

## Launcher (Cloudflare Worker)

`launcher/` is a small Worker that keeps the Gameye API token server-side and
turns a Play button into a match: it lists running `tin-tanks` sessions, joins the
fullest one with a free slot, or starts a new session (pinned to `GAMEYE_TAG`,
capped by `MAX_SESSIONS`), then sends the browser to `http://host:port/`.
Deployed at <https://tin-tanks-launcher.gameye.workers.dev>.

| Route | Purpose |
|---|---|
| `GET /` | Play page with live match list |
| `POST /api/play` | `{ url, fresh, session }` or `{ error }` |
| `GET /play` | Same as above but a 302 redirect, for a plain link |
| `GET /api/status` | Running sessions with player counts |

```bash
cd launcher
npx wrangler deploy
npx wrangler secret put GAMEYE_API_TOKEN     # once
```

Environment (region, image, tag, caps) lives in `launcher/wrangler.toml`. A
freshly started server answers within about six seconds; the page counts down
before redirecting.

## Graphics

The client renders through [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing)
with [N8AO](https://github.com/N8python/n8ao) screen-space ambient occlusion, bloom on
muzzle flashes and explosions, a saturation/contrast punch, a vignette and SMAA
anti-aliasing (`client/src/post.js`). Muzzle flashes and explosions also drive a
small pool of point lights, and moving tanks kick up dust. Press **G** to switch to a
plain direct render on slower machines; the choice is remembered per browser.

## How the netcode works

- The client sends an input bitmask 30 times a second with a sequence number.
- The server applies the latest input each tick, moves shells, resolves collisions,
  and broadcasts a compact snapshot every tick with the last sequence it processed.
- The client predicts its own tank with the shared `stepTank` function and replays
  unacknowledged inputs on every snapshot, so movement feels instant even at 100 ms+.
- Remote tanks are drawn 100 ms behind the newest snapshot and interpolated; shells
  are dead-reckoned from their last known position and heading.

## Tuning

Everything gameplay-related lives in `shared/src/constants.js` (speeds, damage,
cooldown, respawn time) and `shared/src/map.js` (buildings, sandbags, trees, spawns).
Buildings are axis-aligned boxes with a `kind` that picks the client-side model:
`house`, `barn`, `church`, `ruin`, `shed`, `sandbags`, `crates`.
