# Deploying Shitpost Server on Coolify

This guide covers deploying the **server** on a VPS using [Coolify](https://coolify.io).

## Prerequisites

- A VPS with Coolify installed
- A domain name (e.g. `api.shitpost.example.com`)
- The server code pushed to a Git repository (GitHub, GitLab, etc.)

## Step 1: Create a PostgreSQL database

1. In Coolify dashboard, go to **Resources** > **New** > **Database** > **PostgreSQL**
2. Configure:
   - Name: `shitpost-db`
   - Database: `shitpost_db`
   - Username: `postgres`
   - Password: (generate a strong one)
3. Deploy the database
4. Note the **internal URL** (something like `postgresql://postgres:password@shitpost-db:5432/shitpost_db`)

## Step 2: Create the server application

1. Go to **Resources** > **New** > **Application**
2. Select your Git source and repository
3. Configure:
   - **Build Pack**: Nixpacks (auto-detected) or Dockerfile
   - **Base Directory**: `server` (important: the server code is in the `server/` subfolder)
   - **Build Command**: `npm install && npx prisma generate && npx prisma migrate deploy && npm run build`
   - **Start Command**: `npm start`
   - **Port**: `3000`

## Step 2b: Create a Redis instance (optional but recommended)

1. In Coolify dashboard, go to **Resources** > **New** > **Database** > **Redis**
2. Configure:
   - Name: `shitpost-redis`
3. Deploy and note the internal URL (e.g. `redis://shitpost-redis:6379`)

Redis is used for caching (friends list, rate limiting) and Socket.io adapter (multi-instance). If not configured, the server falls back to in-memory stores.

## Step 3: Set environment variables

In the application settings, add these environment variables:

```
DATABASE_URL=postgresql://postgres:password@shitpost-db:5432/shitpost_db?schema=public
JWT_SECRET=<generate with: openssl rand -hex 64>
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=tauri://localhost,https://your-domain.com
REDIS_URL=redis://shitpost-redis:6379
FORCE_HTTPS=true
```

> Replace `shitpost-db` with the actual internal hostname of your database from Step 1.

## Step 4: Configure networking

1. Add your domain (e.g. `api.shitpost.example.com`)
2. Enable **HTTPS** (Let's Encrypt)
3. Enable **WebSocket support** - this is critical for Socket.io
   - In Coolify, this is usually automatic with Traefik

## Step 5: Deploy

Click **Deploy** and wait for the build to complete.

Verify the server is running:
```bash
curl https://api.shitpost.example.com/health
# Should return: {"status":"ok","uptime":...,"connections":0,"redis":true}
```

## Step 6: Build and distribute the Tauri app

No `.env` is needed for the client. The server URL is configured at runtime by the user.

```bash
cd live-chat
npm run tauri build
```

The installer will be in `src-tauri/target/release/bundle/`.

When users launch the app for the first time, the server URL configuration panel will appear on the login/register screen. They enter your server URL (e.g. `https://api.shitpost.example.com`) and can change it later in Settings.

## Alternative: Dockerfile

If Nixpacks doesn't work, create `server/Dockerfile`:

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
```

Then in Coolify, set **Build Pack** to **Dockerfile** and **Base Directory** to `server`.

## Updating

Push to your Git repository and Coolify will auto-deploy (if auto-deploy is enabled), or click **Deploy** manually.

## Troubleshooting

- **WebSocket errors**: Make sure WebSocket support is enabled in your reverse proxy (Traefik/Nginx)
- **Database connection refused**: Check that the database hostname matches the internal Coolify network name
- **CORS errors**: Add the Tauri app origin (`tauri://localhost`) to `ALLOWED_ORIGINS`
- **Large media fails**: The server accepts up to 100MB via Socket.io. Your reverse proxy might have a lower limit - increase it if needed
