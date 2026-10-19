# Ludo Online — Astro + Cloudflare Workers

Real-time multiplayer Ludo for up to 4 players. Empty slots are filled by bots that play automatically.

## Architecture

| Layer | Technology |
|-------|-----------|
| Framework | Astro 5 (SSR, output: server) |
| Runtime | Cloudflare Workers |
| Game state + WebSockets | Cloudflare Durable Objects |
| Bot scheduling | DO Alarms |

## How it works

1. Host creates a game → gets a unique link.
2. Share the link with up to 3 friends.
3. Any unfilled slot is played by a bot.
4. Game state lives in a Durable Object; real-time updates via hibernatable WebSockets.

## Local development

```bash
npm install
npm run dev          # Astro dev server (UI only; DO requires wrangler dev)
```

For full local multiplayer with Durable Objects:
```bash
npm run build
npx wrangler dev     # runs the full worker locally
```

## Deploy to Cloudflare

```bash
# Login once
npx wrangler login

# Build + deploy
npm run deploy
```

The first deploy creates the Durable Object migration (`v1 / GameRoom`).

## Project structure

```
src/
  lib/ludo.ts          # Pure game logic (shared)
  do/GameRoom.ts       # Durable Object: state + WebSocket + alarms
  pages/
    index.astro        # Landing page (create / join)
    game/[id].astro    # Game page (board + WebSocket client)
    api/create.ts      # POST /api/create → { id }
    api/ws/[id].ts     # GET  /api/ws/:id → WebSocket upgrade proxy to DO
astro.config.mjs       # Astro + Cloudflare adapter; post-build DO injection
wrangler.toml          # Workers config, DO bindings, migrations
```
