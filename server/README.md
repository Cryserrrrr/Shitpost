# Shitpost Server

Node.js + Express + Socket.io + Prisma server for real-time media broadcasting.

## Features

- JWT authentication with refresh token rotation
- Real-time media broadcast via Socket.io (images, videos, audio)
- Friend system (requests, invite codes, blocking)
- Group system (roles, invites, invite codes)
- Presence system (online/offline/DND)
- Redis caching with in-memory fallback
- Rate limiting (Redis-backed or in-memory)
- Input validation and sanitization
- Security headers and HTTPS redirect
- Account deletion (RGPD compliant)

## Setup

```bash
npm install
cp .env.example .env
# Edit .env
npx prisma migrate deploy
npx prisma generate
npm run dev
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | - |
| `JWT_SECRET` | Secret for JWT signing | - |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | `development` or `production` | `development` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | - |
| `REDIS_URL` | Redis connection string (optional) | - |
| `FORCE_HTTPS` | Force HTTPS redirect | `false` |

## API Routes

### Auth (`/api/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | No | Register (username 2-20 chars, password 6-128 chars) |
| POST | `/login` | No | Login |
| POST | `/refresh` | No | Refresh access token |
| GET | `/me` | Yes | Get current user |
| POST | `/logout` | Yes | Logout (revokes refresh tokens) |
| DELETE | `/account` | Yes | Delete account (requires password) |

### Friends (`/api/friends`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | List friends |
| GET | `/pending` | Yes | List pending friend requests |
| GET | `/invite-code` | Yes | Get my invite code |
| GET | `/resolve/:code` | Yes | Resolve invite code to username |
| GET | `/blocked` | Yes | List blocked users |
| POST | `/request` | Yes | Send friend request by username |
| POST | `/add-direct` | Yes | Send friend request by invite code |
| POST | `/accept/:id` | Yes | Accept friend request |
| POST | `/decline/:id` | Yes | Decline friend request |
| POST | `/block/:id` | Yes | Block a user |
| POST | `/unblock/:id` | Yes | Unblock a user |
| DELETE | `/:id` | Yes | Remove friend |

### Groups (`/api/groups`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | List my groups |
| POST | `/` | Yes | Create group |
| PATCH | `/:id` | Yes | Rename group (admin/owner) |
| DELETE | `/:id` | Yes | Delete group (owner) |
| POST | `/:id/members` | Yes | Invite member (admin/owner) |
| DELETE | `/:id/members/:userId` | Yes | Kick member (admin/owner) |
| PATCH | `/:id/members/:userId/role` | Yes | Set member role (owner) |
| POST | `/:id/leave` | Yes | Leave group |
| GET | `/invites/pending` | Yes | List pending group invites |
| POST | `/invites/:id/accept` | Yes | Accept group invite |
| POST | `/invites/:id/decline` | Yes | Decline group invite |
| POST | `/join/:code` | Yes | Join group via invite code |
| GET | `/resolve/:code` | Yes | Resolve group invite code |

### Other

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | No | Health check (uptime, connections, Redis status) |

## Socket.io Events

### Client -> Server

| Event | Payload | Description |
|---|---|---|
| `broadcast_media` | `{ targetIds, mediaType, mediaBuffer, mimeType, duration, textOverlay?, audioBuffer?, audioMimeType? }` | Send media to targets |
| `status:set_dnd` | `boolean` | Toggle DND mode |

### Server -> Client

| Event | Payload | Description |
|---|---|---|
| `media:show` | `{ mediaType, mediaBuffer, mimeType, duration, textOverlay?, audioBuffer?, audioMimeType?, senderName }` | Display received media |
| `media:sent` | `{ results: [{ targetId, delivered, dnd, blocked }] }` | Delivery report |
| `media:error` | `{ message }` | Media validation error |
| `presence:online_friends` | `string[]` | List of online friend IDs (on connect) |
| `presence:update` | `{ userId, username, status }` | Friend status change |
| `friends:request_received` | `{ id, requesterId, requester, status }` | Incoming friend request |
| `friends:request_accepted` | `{ friend, online, dnd }` | Friend request accepted |
| `friends:removed` | `{ userId }` | Friend removed or blocked |
| `groups:invite_received` | `{ id, group, inviter }` | Incoming group invite |
| `groups:member_joined` | `{ groupId, user }` | Member joined group |
| `status:dnd_updated` | `boolean` | DND status confirmed |

## Media Limits

- Max media size: 100MB
- Max audio overlay: 10MB
- Max targets per broadcast: 50
- Max HTTP body: 25MB

## Database Schema

See `prisma/schema.prisma` for the full schema. Models:

- **User** — username, password (bcrypt), status, inviteCode
- **Friendship** — requester/addressee with status (pending/accepted/blocked)
- **Group** — name, description, owner, inviteCode
- **GroupMember** — userId, groupId, role (owner/admin/member)
- **GroupInvite** — group invite with status (pending/accepted/declined)
- **RefreshToken** — JWT refresh token with expiry

## Production

```bash
npm run build
npm start
```
