import { Socket } from "socket.io";

export interface MediaShowPayload {
  mediaType: "image" | "video";
  mediaBuffer: string;
  mimeType: string;
  duration: number;
  audioBuffer?: string;
  audioMimeType?: string;
  textOverlay?: {
    topText: string;
    bottomText: string;
  };
  senderName?: string;
}

export interface BroadcastMediaMessage {
  targetIds: string[];
  mediaType: "image" | "video";
  mediaBuffer: string;
  mimeType: string;
  duration: number;
  audioBuffer?: string;
  audioMimeType?: string;
  textOverlay?: {
    topText: string;
    bottomText: string;
  };
}

export interface OverlaySendMessage {
  targets: string[];
  b64: string;
  timeoutMs: number;
}

export interface PresenceUpdate {
  userId: string;
  status: "online" | "offline";
  username?: string;
}
