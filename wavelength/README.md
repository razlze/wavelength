# Wavelength (web)

Party game: one **Psychic** per round picks a spectrum (e.g. Hot ↔ Cold); only they see the hidden target on the dial. Everyone else moves the shared needle and submits; then scores are revealed. The room leader advances rounds.

## Stack

- **Next.js 16** (App Router) + **Tailwind**
- **PostgreSQL** via **Prisma 7** + `@prisma/adapter-pg`
- **Socket.IO** on a **custom Node server** (`server.ts`) — required for real-time play (serverless-only hosts like Vercel/Netlify won’t run this without refactoring).
- **Production hosting**: Render Web Service
- **Production DB**: Neon Postgres

## Setup

1. Copy `.env.example` → `.env` and set `DATABASE_URL` (local Postgres for dev, Neon for production) and a strong `JWT_SECRET`.

2. Push schema and seed theme presets:

   ```bash
   npx prisma db push
   npm run db:seed
   ```

3. Dev (Next + Socket.IO on port 3000):

   ```bash
   npm run dev
   ```

4. Production:

   ```bash
   npm run build
   npm start
   ```

## Production ops / maintenance notes

This app runs Socket.IO from a **custom Node server** (`server.ts`) alongside Next.js. That means you need a host that supports **long-lived processes and WebSockets** (not serverless-only hosting).

### Deployment architecture

- **App host**: Render Web Service (Node process)
  - Runs `npm start` which starts the custom server in `server.ts` (Next.js + Socket.IO on the same port).
  - If this repo is a monorepo, set Render’s **Root Directory** to `wavelength` (the folder containing `package.json`).
- **Production database**: Neon Postgres
  - Accessed via `DATABASE_URL` from the Node server (Prisma + `pg` adapter).

Request flow:

- Browser loads the Next.js app from Render.
- Browser opens a Socket.IO connection to the same origin (`/socket.io/`).
- Server persists durable state to Postgres (rooms/players/rounds/guesses) and keeps some real-time runtime state in memory.

### Required environment variables

- **`DATABASE_URL`**: Postgres connection string (use your managed DB provider’s “direct” URL for a long-running server).
- **`JWT_SECRET`**: required in production. Set to a strong random string (min 32 chars). Rotating this will invalidate existing player tokens.
- **`NEXT_PUBLIC_APP_ORIGIN`**: the deployed site origin (scheme + host only), e.g. `https://YOUR-SERVICE.onrender.com`.
  - This is used for Socket.IO CORS in production.
  - Do not include a path or trailing slash.

### Database schema changes

This repo currently uses **`prisma db push`** (no `prisma/migrations/` directory). That’s fast for early development, but it means:

- There is **no migration history** committed to the repo.
- You should be careful with schema changes (especially destructive ones).

If you want safer, repeatable production schema evolution, switch to **Prisma Migrate** (`prisma migrate dev` locally + `prisma migrate deploy` in production).

### Seed behavior

`npm run db:seed` seeds only starter `ThemePreset` rows, and only when the table is empty. It does not create rooms/players/rounds.

### Scaling limitations

Real-time game state includes **in-memory runtime state per room** (see `RoomRuntime` in `src/lib/game/types.ts`). If you run more than one server instance, you’ll need:

- **Sticky sessions** for Socket.IO, and
- A shared adapter/state layer (commonly Redis) if you want horizontal scaling.

### Common production issues

- **Socket connection failing (CORS)**: verify `NEXT_PUBLIC_APP_ORIGIN` matches the browser’s actual origin exactly.
- **Cold starts / sleeping hosts**: free tiers may spin down on inactivity; first request after sleep can be slow. Active WebSocket traffic should keep the service awake on most hosts.
- **DB connectivity**: ensure your managed DB requires TLS parameters (many providers do) and that your `DATABASE_URL` includes them if needed.

## Scripts

| Script            | Description                        |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Custom server + hot reload         |
| `npm run build`   | Prisma generate + Next build       |
| `npm start`       | Production server                  |
| `npm test`        | Vitest (scoring + shuffle helpers) |
| `npm run db:push` | Apply schema to DB                 |
| `npm run db:seed` | Theme presets                      |

## Production notes

- **Rate limiting**: in-memory per IP on create/join APIs (replace with Redis for multi-instance).
- **Logging**: JSON lines via `src/lib/logger.ts`.
- **Errors**: add Sentry when you want (wizard integrates with Next; keep DSN in env).
- **Scale-out**: multiple Node processes need sticky sessions or Redis adapter for Socket.IO (see “Scaling limitations” above).

## License

Not affiliated with the Wavelength board game. For personal / educational use.
