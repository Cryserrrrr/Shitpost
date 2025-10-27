import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { ClientManager } from "./managers/ClientManager";
import {
  BroadcastMediaMessage,
  MediaShowMessage,
  ClientConnectionData,
  OverlaySendMessage,
} from "./types";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 20 * 1024 * 1024, // 20MB
  pingTimeout: 60000,
  pingInterval: 25000,
});

const clientManager = new ClientManager();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.get("/clients", (req, res) => {
  const clients = clientManager.getConnectedClients().map((client) => ({
    machineId: client.machineId,
    socketId: client.id,
    connectedAt: client.connectedAt,
    name: client.name,
  }));

  res.json({
    count: clientManager.getClientCount(),
    clients,
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    connectedClients: clientManager.getClientCount(),
  });
});

const validateRegistration = (data: ClientConnectionData): string | null => {
  if (!data.machineId) {
    return "Machine ID is required";
  }
  return null;
};

const validateOverlaySend = (message: OverlaySendMessage): string | null => {
  if (
    !message.targets ||
    !Array.isArray(message.targets) ||
    message.targets.length === 0
  ) {
    return "Targets are required and must be an array";
  }
  if (!message.b64) {
    return "Base64 image data is required";
  }
  if (
    !message.timeoutMs ||
    typeof message.timeoutMs !== "number" ||
    message.timeoutMs <= 0
  ) {
    return "Timeout must be a positive number";
  }
  return null;
};

const validateBroadcastMediaPayload = (payload: any): string | null => {
  const { targetIds, mediaType, mediaBuffer, duration } = payload;

  if (!targetIds || !Array.isArray(targetIds) || targetIds.length === 0) {
    return "Target IDs are required and must be an array";
  }
  if (!mediaType || !["image", "video"].includes(mediaType)) {
    return 'Media type must be "image" or "video"';
  }
  if (!mediaBuffer) {
    return "Media buffer is required";
  }
  if (mediaBuffer.length > 20 * 1024 * 1024) {
    // 20MB limit
    return "Media buffer is too large (max 20MB)";
  }
  if (!duration || typeof duration !== "number" || duration <= 0) {
    return "Duration must be a positive number";
  }
  return null;
};

const handleRegistration = (socket: any, data: ClientConnectionData) => {
  const error = validateRegistration(data);
  if (error) {
    socket.emit("error", { message: error });
    return;
  }

  const existingClient = clientManager.findClientBySocketId(socket.id);
  if (existingClient) {
    socket.emit("registered", { machineId: data.machineId });
    return;
  }

  clientManager.addClient(socket, data.machineId, data.name);
  socket.emit("registered", { machineId: data.machineId });

  // Broadcast updated client list to all clients
  clientManager.broadcastPresenceList();
};

const handleOverlaySend = (socket: any, message: OverlaySendMessage) => {
  const error = validateOverlaySend(message);
  if (error) {
    socket.emit("error", { message: error });
    return;
  }

  const { targets, b64, timeoutMs } = message;
  clientManager.broadcastToTargets(targets, "overlay:image", {
    b64,
    timeoutMs,
  });

  // Envoyer à tous les sockets connectés (pour l'overlay)
  io.emit("overlay:image", {
    b64,
    timeoutMs,
  });

  socket.emit("overlay:sent", {
    message: `Overlay image sent to ${targets.length} targets`,
    targets,
  });
};

const handleBroadcastMedia = (socket: any, message: any) => {
  console.log("Received broadcast_media:", {
    targetIds: message.targetIds,
    mediaType: message.mediaType,
    bufferLength: message.mediaBuffer?.length || 0,
    duration: message.duration,
  });

  const error = validateBroadcastMediaPayload(message);
  if (error) {
    console.log("Broadcast media validation error:", error);
    socket.emit("error", { message: error });
    return;
  }

  const { targetIds, mediaType, mediaBuffer, mimeType, duration, textOverlay } =
    message;
  const mediaShowMessage: MediaShowMessage = {
    type: "media:show",
    payload: { mediaType, mediaBuffer, mimeType, duration, textOverlay },
  };

  console.log("Broadcasting to targets:", targetIds);
  console.log("Media show message payload:", {
    mediaType,
    mimeType,
    bufferLength: mediaBuffer?.length || 0,
    duration,
    textOverlay,
  });

  // Envoyer aux clients enregistrés
  clientManager.broadcastToTargets(
    targetIds,
    "media:show",
    mediaShowMessage.payload
  );

  // Envoyer à tous les sockets connectés (pour l'overlay)
  io.emit("media:show", mediaShowMessage.payload);

  console.log("Broadcast completed");

  socket.emit("broadcast_sent", {
    message: `Media broadcast sent to ${targetIds.length} targets`,
    targetIds,
  });
};

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);
  socket.emit("presence:list", clientManager.getPresenceList());

  socket.on("register", (data: ClientConnectionData) => {
    console.log("Client registering:", socket.id, data);
    handleRegistration(socket, data);
  });

  socket.on("overlay:send", (message: OverlaySendMessage) => {
    console.log(
      "Received overlay:send from",
      socket.id,
      "targets:",
      message.targets?.length
    );
    handleOverlaySend(socket, message);
  });

  socket.on("broadcast_media", (message: any) => {
    console.log(
      "Received broadcast_media from",
      socket.id,
      "targets:",
      message.targetIds?.length
    );
    handleBroadcastMedia(socket, message);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    clientManager.removeClient(socket.id);

    // Broadcast updated client list to remaining clients
    clientManager.broadcastPresenceList();
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
