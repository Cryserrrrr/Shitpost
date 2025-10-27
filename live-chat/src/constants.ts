export const APP_NAMES = {
  main: "Meme Studio App",
  overlay: "Meme Studio App (Overlay)",
} as const;

export const SOCKET_CONFIG = {
  transports: ["websocket", "polling"] as string[],
  timeout: 20000,
};

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

export const TEXT_POSITIONS = {
  top: 60,
  bottom: 20,
} as const;

export const TIMEOUT_LIMITS = {
  min: 1000,
  max: 30000,
  step: 1000,
} as const;
