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
import authRoutes from "./routes/AuthRoutes";
import friendsRoutes from "./routes/FriendsRoutes";
import groupsRoutes from "./routes/GroupsRoutes";
import { BroadcastMediaMessage } from "./types";

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

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many auth attempts, please try again later" },
});

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
  res.json({ status: "ok", uptime: process.uptime(), connections: userSockets.size });
});

// Track online users: userId -> socketId[]
const userSockets = new Map<string, string[]>();

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

  // Mark user online
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { status: "online" },
    });
  } catch {}

  // Notify friends that this user is online
  try {
    const friends = await FriendsService.getFriends(userId);
    for (const friend of friends) {
      io.to(`user:${friend.id}`).emit("presence:update", {
        userId,
        username,
        status: "online",
      });
    }

    // Send list of currently online friends to this user
    const onlineFriendIds = friends
      .filter((f: any) => userSockets.has(f.id))
      .map((f: any) => f.id);
    socket.emit("presence:online_friends", onlineFriendIds);
  } catch {}

  // Handle media broadcast (memes!)
  socket.on("broadcast_media", (message: BroadcastMediaMessage) => {
    const { targetIds, mediaType, mediaBuffer, mimeType, duration, textOverlay, audioBuffer, audioMimeType } = message;

    if (!targetIds || !Array.isArray(targetIds) || targetIds.length === 0) return;
    if (!mediaBuffer || !mediaType) return;

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

    for (const targetId of targetIds) {
      io.to(`user:${targetId}`).emit("media:show", payload);
    }

    // Report delivery status per target
    const results = targetIds.map((id) => ({
      targetId: id,
      delivered: userSockets.has(id),
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

        const friends = await FriendsService.getFriends(userId);
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

httpServer.listen(PORT, () => {
  console.log(`Shitpost Server running on port ${PORT}`);
});
