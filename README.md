# Shitpost

A desktop app to send memes (images/videos with text overlays and audio) directly to your friends' screens in real-time.

Built with **Tauri v2** + **React** + **Node.js** + **Socket.io** + **PostgreSQL**.

## Features

- Send images, videos and audio with text overlays to friends' screens
- Video compression, trimming and multi-segment looping
- Audio overlay attachments on images with volume/trim controls
- Real-time presence (online/offline/DND)
- Friend system with requests and invite codes (`#CODE`)
- User blocking (blocks friend requests, group invites and media)
- Groups with roles (owner, admin, member) and invite codes
- Overlay window always on top (transparent, click-through)
- Send/receive history with download support
- Local memes library with auto-save
- System tray with auto-start option
- Multi-monitor overlay support
- i18n support (French / English)
- Refresh token auth (stay logged in for 30 days)
- Auto-updater (NSIS installer with signature verification)
- Account deletion (RGPD compliant)

## Architecture

```
shitpost/
  live-chat/          # Tauri + React frontend
    src/              # React app (main window + overlay)
    src-tauri/        # Rust backend (Tauri v2)
  server/             # Node.js + Express + Socket.io + Prisma
    prisma/           # Database schema & migrations
    src/              # Server source code
  docker/             # Docker Compose (PostgreSQL + Redis)
```

## Prerequisites

- **Node.js** >= 18
- **Rust** (for Tauri) - [install](https://rustup.rs)
- **PostgreSQL** (or Docker)
- **Redis** (optional, falls back to in-memory)
- **pnpm** or **npm**

## Setup

### 1. Database & Redis (Docker)

```bash
cd docker
docker compose up -d
```

This starts PostgreSQL 16 and Redis 7. Or use existing instances.

### 2. Server

```bash
cd server
cp .env.example .env
# Edit .env with your database URL and a random JWT_SECRET
npm install
npx prisma migrate deploy
npx prisma generate
npm run dev
```

### 3. Client (Tauri app)

```bash
cd live-chat
npm install
npm run tauri dev
```

> **No `.env` needed for the client.** The server URL is configured directly in the app at first launch (login/register screen). You can change it anytime in Settings.

### Building for production

```bash
cd live-chat
npm run tauri build
# Output in src-tauri/target/release/bundle/
```

## Environment Variables

### Server (`server/.env`)

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | - |
| `JWT_SECRET` | Secret for JWT signing (use a long random string) | - |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | `development` or `production` | `development` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | `http://localhost:1420,...` |
| `REDIS_URL` | Redis connection string (optional) | - |
| `FORCE_HTTPS` | Force HTTPS redirect in production | `false` |

### Client

No environment variables needed. The server URL is configured at runtime via the UI and stored in `localStorage`.

## Deploying the Server (Coolify / VPS)

See [DEPLOY.md](./DEPLOY.md) for detailed instructions.

## Security

- HTTPS redirect (configurable via `FORCE_HTTPS`)
- Security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy)
- Rate limiting on all API routes (Redis-backed or in-memory)
- Input validation and sanitization on all endpoints
- Bcrypt password hashing (10 rounds)
- Case-insensitive unique usernames
- Server-side media size limits (100MB media, 10MB audio, 50 targets max)
- JWT access tokens (1h) + refresh token rotation (30 days)
- Account deletion with password confirmation
- User blocking system

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Socket.io-client, Axios
- **Desktop**: Tauri v2 (Rust)
- **Backend**: Node.js, Express, Socket.io, Prisma ORM
- **Database**: PostgreSQL
- **Cache**: Redis (optional, in-memory fallback)
- **Auth**: JWT access tokens (1h) + refresh tokens (30 days) + bcrypt

## License

[MIT](./LICENSE)
