# Shitpost

A desktop app to send memes (images/videos with text overlays and audio) directly to your friends' screens in real-time.

Built with **Tauri v2** + **React** + **Node.js** + **Socket.io** + **PostgreSQL**.

## Features

- Send images and videos with text overlays to friends' screens
- Video compression and trimming built-in
- Audio attachments on images
- Real-time presence (online/offline)
- Friend system with requests
- Groups with roles (owner, admin, member)
- Overlay window always on top (transparent, click-through)
- System tray with auto-start option
- i18n support (French / English)
- Refresh token auth (stay logged in for 30 days)

## Architecture

```
shitpost/
  live-chat/          # Tauri + React frontend
    src/              # React app (main window + overlay)
    src-tauri/        # Rust backend (Tauri v2)
  server/             # Node.js + Express + Socket.io + Prisma
    prisma/           # Database schema & migrations
    src/              # Server source code
```

## Prerequisites

- **Node.js** >= 18
- **Rust** (for Tauri) - [install](https://rustup.rs)
- **PostgreSQL** (or Docker)
- **pnpm** or **npm**

## Setup

### 1. Database

```bash
# With Docker
docker run -d --name shitpost-db \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=shitpost_db \
  -p 5432:5432 \
  postgres:16

# Or use an existing PostgreSQL instance
```

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

### Client

No environment variables needed. The server URL is configured at runtime via the UI and stored in `localStorage`.

## Deploying the Server (Coolify / VPS)

See [DEPLOY.md](./DEPLOY.md) for detailed instructions.

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Socket.io-client, Axios
- **Desktop**: Tauri v2 (Rust)
- **Backend**: Node.js, Express, Socket.io, Prisma ORM
- **Database**: PostgreSQL
- **Auth**: JWT access tokens (1h) + refresh tokens (30 days)

## License

[MIT](./LICENSE)
