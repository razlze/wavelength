# Wavelength (web)

Party game: one **Psychic** per round picks a spectrum (e.g. Hot ↔ Cold); only they see the hidden target on the dial. Everyone else moves the shared needle and submits; then scores are revealed. The room leader advances rounds.

## Stack

- **Next.js 16** (App Router) + **Tailwind**
- **PostgreSQL** via **Prisma 7** + `@prisma/adapter-pg`
- **Socket.IO** on a **custom Node server** (`server.ts`) — required for real-time play (Vercel serverless alone won’t host this socket server; use Fly.io, Render, Railway free tiers, or a small VPS).

## Setup

1. Copy `.env.example` → `.env` and set `DATABASE_URL` (e.g. Supabase free Postgres) and a strong `JWT_SECRET`.

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

## Scripts

| Script        | Description                          |
| ------------- | ------------------------------------ |
| `npm run dev` | Custom server + hot reload           |
| `npm run build` | Prisma generate + Next build        |
| `npm start`   | Production server                   |
| `npm test`    | Vitest (scoring + shuffle helpers)  |
| `npm run db:push` | Apply schema to DB              |
| `npm run db:seed` | Theme presets                    |

## Production notes

- **Rate limiting**: in-memory per IP on create/join APIs (replace with Redis for multi-instance).
- **Logging**: JSON lines via `src/lib/logger.ts`.
- **Errors**: add Sentry when you want (wizard integrates with Next; keep DSN in env).
- **Scale-out**: multiple Node processes need sticky sessions or Redis adapter for Socket.IO.

## License

Not affiliated with the Wavelength board game. For personal / educational use.
