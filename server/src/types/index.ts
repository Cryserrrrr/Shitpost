import { Socket } from "socket.io";

export interface ClientInfo {
  id: string;
  machineId: string;
  socket: Socket;
  connectedAt: Date;
  name?: string;
}

export interface ClientPresence {
  id: string;
  name: string;
}

export interface MediaPayload {
  targetIds: string[];
  mediaType: "image" | "video";
  mediaBuffer: Buffer | string; // Buffer or base64 string
  mimeType?: string; // MIME type for video files
  duration: number; // Duration in seconds
}

export interface BroadcastMediaMessage {
  type: "broadcast_media";
  payload: MediaPayload;
}

export interface MediaShowMessage {
  type: "media:show";
  payload: {
    mediaType: "image" | "video";
    mediaBuffer: Buffer | string;
    mimeType?: string;
    duration: number;
    textOverlay?: {
      topText: string;
      bottomText: string;
    };
  };
}

export interface ClientConnectionData {
  machineId: string;
  name?: string;
}

export interface OverlaySendMessage {
  targets: string[];
  b64: string;
  timeoutMs: number;
}
