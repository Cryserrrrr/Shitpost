export const APP_NAMES = {
  main: "Meme Studio",
  overlay: "Meme Studio (Overlay)",
} as const;

export const SOCKET_CONFIG = {
  transports: ["websocket"] as string[],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
};

export const TIMEOUT_LIMITS = {
  min: 1000,
  max: 30000,
  step: 500,
} as const;

export const IMAGE_OPTIONS = {
  maxWidth: 800,
  maxHeight: 600,
  quality: 0.8,
} as const;

export const TEXT_CONFIG = {
  font: "48px Impact",
  fillStyle: "white",
  strokeStyle: "black",
  lineWidth: 3,
  textAlign: "center" as CanvasTextAlign,
} as const;
