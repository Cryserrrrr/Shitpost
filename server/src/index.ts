import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { AuthService } from "./services/AuthService";
import { FriendsService } from "./services/FriendsService";
import { prisma } from "./services/PrismaService";
import { initRedis, isRedisAvailable, getRedisClient, cacheGet, cacheSet, cacheDel, cacheDelPattern } from "./services/RedisService";
import authRoutes from "./routes/AuthRoutes";
import friendsRoutes from "./routes/FriendsRoutes";
import groupsRoutes from "./routes/GroupsRoutes";
import { BroadcastMediaMessage } from "./types";
import { httpsRedirect, securityHeaders } from "./middleware/SecurityMiddleware";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const app = express();
app.set("trust proxy", 1);
const httpServer = createServer(app);

const EXTRA_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  if (origin.includes("tauri")) return true;
  if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return true;
  console.log("[CORS] Blocked origin:", origin);
  return EXTRA_ORIGINS.includes(origin);
};

console.log("[CONFIG] Extra allowed origins:", EXTRA_ORIGINS);

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) callback(null, true);
      else callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  allowEIO3: true,
  maxHttpBufferSize: 100 * 1024 * 1024,
  pingTimeout: 60000,
  pingInterval: 25000,
});

const PORT = process.env.PORT || 3000;

// Rate limiting (Redis store attached after init)
let rateLimitStore: any = undefined; // undefined = default MemoryStore

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
  get store() { return rateLimitStore; },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many auth attempts, please try again later" },
  get store() { return rateLimitStore; },
});

// Security middleware
app.use(httpsRedirect);
app.use(securityHeaders);

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) callback(null, true);
    else callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Make io accessible from routes
app.set("io", io);

// Routes with rate limiting
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/friends", apiLimiter, friendsRoutes);
app.use("/api/groups", apiLimiter, groupsRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), connections: userSockets.size, redis: isRedisAvailable() });
});

// Error logging middleware (no user data leaked)
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(err.status || 500).json({ message: "Internal server error" });
});

// Cached friends lookup (60s TTL)
async function getCachedFriends(userId: string): Promise<any[]> {
  const cacheKey = `friends:${userId}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return JSON.parse(cached);
  const friends = await FriendsService.getFriends(userId);
  await cacheSet(cacheKey, JSON.stringify(friends), 60);
  return friends;
}

// Track online users: userId -> socketId[]
const userSockets = new Map<string, string[]>();
app.set("userSockets", userSockets);

const addUserSocket = (userId: string, socketId: string) => {
  const sockets = userSockets.get(userId) || [];
  if (!sockets.includes(socketId)) {
    sockets.push(socketId);
    userSockets.set(userId, sockets);
  }
};

const removeUserSocket = (userId: string, socketId: string) => {
  const sockets = userSockets.get(userId) || [];
  const filtered = sockets.filter((id) => id !== socketId);
  if (filtered.length > 0) {
    userSockets.set(userId, filtered);
  } else {
    userSockets.delete(userId);
  }
  return filtered.length === 0; // true if user fully disconnected
};

// Socket.io auth middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    console.log("[AUTH] No token provided");
    return next(new Error("Authentication error: No token provided"));
  }

  const decoded = AuthService.verifyToken(token);
  if (!decoded?.userId) {
    console.log("[AUTH] Invalid token:", token.substring(0, 20) + "...");
    return next(new Error("Authentication error: Invalid token"));
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, username: true },
    });
    if (!user) {
      console.log(`[AUTH] User not found for id: ${decoded.userId}`);
      return next(new Error("Authentication error: User not found"));
    }

    socket.data.userId = user.id;
    socket.data.username = user.username;
    next();
  } catch (err) {
    console.error("[AUTH] Database error:", err);
    next(new Error("Authentication error: Database error"));
  }
});

io.engine.on("connection_error", (err: any) => {
  console.log("[SOCKET] Connection error:", err.message, err.code, err.context);
});

io.on("connection", async (socket) => {
  const userId = socket.data.userId;
  const username = socket.data.username;
  console.log(`[+] ${username} (${userId}) connected`);

  addUserSocket(userId, socket.id);
  socket.join(`user:${userId}`);

  // Mark user online (preserve DND if set)
  let currentStatus = "online";
  try {
    const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (dbUser?.status === "dnd") {
      currentStatus = "dnd";
    } else {
      await prisma.user.update({
        where: { id: userId },
        data: { status: "online" },
      });
    }
  } catch {}

  // Notify friends that this user is online
  try {
    const friends = await getCachedFriends(userId);
    for (const friend of friends) {
      io.to(`user:${friend.id}`).emit("presence:update", {
        userId,
        username,
        status: currentStatus,
      });
    }

    // Send list of currently online friends to this user
    const onlineFriendIds = friends
      .filter((f: any) => userSockets.has(f.id))
      .map((f: any) => f.id);
    socket.emit("presence:online_friends", onlineFriendIds);
  } catch {}

  // Handle DND toggle
  socket.on("status:set_dnd", async (enabled: boolean) => {
    const newStatus = enabled ? "dnd" : "online";
    try {
      await prisma.user.update({ where: { id: userId }, data: { status: newStatus } });
      const friends = await getCachedFriends(userId);
      for (const friend of friends) {
        io.to(`user:${friend.id}`).emit("presence:update", { userId, username, status: newStatus });
      }
      socket.emit("status:dnd_updated", enabled);
    } catch {}
  });

  // Handle media broadcast (memes!)
  socket.on("broadcast_media", async (message: BroadcastMediaMessage) => {
    const { targetIds, mediaType, mediaBuffer, mimeType, duration, textOverlay, audioBuffer, audioMimeType } = message;

    if (!targetIds || !Array.isArray(targetIds) || targetIds.length === 0) return;
    if (!mediaBuffer || !mediaType) return;

    // Server-side media size limits
    const MAX_MEDIA_SIZE = 100 * 1024 * 1024; // 100MB
    const MAX_AUDIO_SIZE = 10 * 1024 * 1024; // 10MB
    const MAX_TARGETS = 50;

    const mediaSize = typeof mediaBuffer === "string" ? mediaBuffer.length * 0.75 : 0;
    const audioSize = audioBuffer ? (typeof audioBuffer === "string" ? audioBuffer.length * 0.75 : 0) : 0;

    if (mediaSize > MAX_MEDIA_SIZE) {
      socket.emit("media:error", { message: "Media file too large (max 100MB)" });
      return;
    }
    if (audioSize > MAX_AUDIO_SIZE) {
      socket.emit("media:error", { message: "Audio file too large (max 10MB)" });
      return;
    }
    if (targetIds.length > MAX_TARGETS) {
      socket.emit("media:error", { message: `Too many targets (max ${MAX_TARGETS})` });
      return;
    }

    const payload = {
      mediaType,
      mediaBuffer,
      mimeType: mimeType || (mediaType === "image" ? "image/png" : "video/mp4"),
      duration: Math.min(Math.max(duration || 5000, 1000), 30000),
      textOverlay,
      audioBuffer,
      audioMimeType,
      senderName: username,
    };

    console.log(`[>] ${username} sends ${mediaType} to ${targetIds.length} target(s)`);

    // Check DND status and blocked users for all targets
    const dndUsers = new Set<string>();
    const blockedUsers = new Set<string>();
    try {
      const [dndResult, blockedResult] = await Promise.all([
        prisma.user.findMany({
          where: { id: { in: targetIds }, status: "dnd" },
          select: { id: true },
        }),
        prisma.friendship.findMany({
          where: {
            status: "blocked",
            OR: [
              { requesterId: userId, addresseeId: { in: targetIds } },
              { requesterId: { in: targetIds }, addresseeId: userId },
            ],
          },
          select: { requesterId: true, addresseeId: true },
        }),
      ]);
      for (const u of dndResult) dndUsers.add(u.id);
      for (const b of blockedResult) {
        blockedUsers.add(b.requesterId === userId ? b.addresseeId : b.requesterId);
      }
    } catch {}

    for (const targetId of targetIds) {
      if (!dndUsers.has(targetId) && !blockedUsers.has(targetId)) {
        io.to(`user:${targetId}`).emit("media:show", payload);
      }
    }

    // Report delivery status per target
    const results = targetIds.map((id) => ({
      targetId: id,
      delivered: userSockets.has(id) && !dndUsers.has(id) && !blockedUsers.has(id),
      dnd: dndUsers.has(id),
      blocked: blockedUsers.has(id),
    }));
    socket.emit("media:sent", { results });
  });

  // Handle disconnect
  socket.on("disconnect", async () => {
    console.log(`[-] ${username} (${userId}) disconnected`);
    const fullyOffline = removeUserSocket(userId, socket.id);

    if (fullyOffline) {
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { status: "offline" },
        });

        const friends = await getCachedFriends(userId);
        for (const friend of friends) {
          io.to(`user:${friend.id}`).emit("presence:update", {
            userId,
            username,
            status: "offline",
          });
        }
      } catch {}
    }
  });
});

async function startServer() {
  // Init Redis (optional — falls back to in-memory if REDIS_URL not set)
  await initRedis();

  // Setup Socket.io Redis adapter if Redis is available
  if (isRedisAvailable()) {
    try {
      const { createAdapter } = await import("@socket.io/redis-adapter");
      const redisClient = getRedisClient()!;
      const pubClient = redisClient.duplicate();
      const subClient = redisClient.duplicate();
      await pubClient.connect();
      await subClient.connect();
      io.adapter(createAdapter(pubClient, subClient));
      console.log("[SOCKET] Using Redis adapter");
    } catch (err: any) {
      console.warn("[SOCKET] Redis adapter setup failed:", err.message, "— using default adapter");
    }

    // Setup Redis-backed rate limiting
    try {
      const { default: RedisStore } = await import("rate-limit-redis");
      const redisClient = getRedisClient()!;
      rateLimitStore = new RedisStore({
        sendCommand: (...args: string[]) => redisClient.sendCommand(args),
      });
      console.log("[RATE-LIMIT] Using Redis store");
    } catch (err: any) {
      console.warn("[RATE-LIMIT] Redis store setup failed:", err.message, "— using memory store");
    }
  }

  httpServer.listen(PORT, () => {
    console.log(`Shitpost Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
