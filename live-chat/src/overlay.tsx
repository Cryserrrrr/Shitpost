import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { t } from "./i18n";
import "./overlay.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://127.0.0.1:3000";

interface MediaData {
  mediaType: "image" | "video";
  mediaBuffer: string;
  mimeType: string;
  duration: number;
  audioBuffer?: string;
  audioMimeType?: string;
  textOverlay?: {
    topText: string;
    bottomText: string;
    fontSize?: number;
    position?: "on" | "around";
  };
  senderName?: string;
}

type AnimState = "entering" | "visible" | "exiting" | "hidden";

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

function Overlay() {
  const [media, setMedia] = useState<MediaData | null>(null);
  const [animState, setAnimState] = useState<AnimState>("hidden");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState("Connecting...");

  const audioRef = useRef<HTMLAudioElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioBlobUrlRef = useRef<string | null>(null);
  const mediaBlobUrlRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
    if (enterTimeoutRef.current) clearTimeout(enterTimeoutRef.current);

    if (audioBlobUrlRef.current) {
      URL.revokeObjectURL(audioBlobUrlRef.current);
      audioBlobUrlRef.current = null;
    }
    if (mediaBlobUrlRef.current) {
      URL.revokeObjectURL(mediaBlobUrlRef.current);
      mediaBlobUrlRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
  }, []);

  const clearMedia = useCallback(() => {
    cleanup();
    setMedia(null);
    setAnimState("hidden");
  }, [cleanup]);

  const showMedia = useCallback(
    async (data: MediaData) => {
      // Clear any existing display
      cleanup();

      setMedia(data);
      setAnimState("entering");

      // After pop-in animation, set to visible
      enterTimeoutRef.current = setTimeout(() => {
        setAnimState("visible");
      }, 500);

      // Play audio if attached (for images with music)
      const volume = Math.min(Math.max(Number(localStorage.getItem("memeVolume") ?? 100), 0), 100) / 100;

      if (data.audioBuffer && data.audioMimeType) {
        try {
          const audioBlob = base64ToBlob(data.audioBuffer, data.audioMimeType);
          const audioUrl = URL.createObjectURL(audioBlob);
          audioBlobUrlRef.current = audioUrl;

          // Try AudioContext first (bypasses autoplay restrictions)
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const response = await fetch(audioUrl);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          const source = audioCtx.createBufferSource();
          const gainNode = audioCtx.createGain();
          gainNode.gain.value = volume;
          source.buffer = audioBuffer;
          source.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          source.start(0);
          console.log("[AUDIO] Playing via AudioContext, volume:", volume);

          // Clean up AudioContext when media ends
          const closeCtx = () => {
            source.stop();
            audioCtx.close();
          };
          source.onended = closeCtx;
        } catch (err) {
          console.error("[AUDIO] AudioContext failed, falling back to <audio>:", err);
          // Fallback to <audio> element
          if (audioRef.current) {
            audioRef.current.src = audioBlobUrlRef.current!;
            audioRef.current.volume = volume;
            audioRef.current.play().catch((e) => console.error("[AUDIO] play() failed:", e));
          }
        }
      }

      const duration = Math.min(Math.max(data.duration || 5000, 1000), 30000);

      // Start exit animation before end
      const exitDelay = Math.max(duration - 600, 200);
      exitTimeoutRef.current = setTimeout(() => {
        setAnimState("exiting");
      }, exitDelay);

      // Remove media after full duration
      timeoutRef.current = setTimeout(() => {
        clearMedia();
      }, duration);
    },
    [cleanup, clearMedia]
  );

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setConnectionStatus("Waiting for auth...");
      // Poll for token
      const interval = setInterval(() => {
        const t = localStorage.getItem("token");
        if (t) {
          clearInterval(interval);
          window.location.reload();
        }
      }, 2000);
      return () => clearInterval(interval);
    }

    const newSocket = io(SERVER_URL, {
      auth: { token },
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    newSocket.on("connect", () => {
      console.log("Overlay connected");
      setConnectionStatus("Connected");
    });

    newSocket.on("disconnect", () => {
      setConnectionStatus("Disconnected");
    });

    newSocket.on("connect_error", async (error) => {
      console.error("Overlay connection error:", error.message);
      setConnectionStatus("Error");
      if (error.message.includes("Authentication error")) {
        const refreshToken = localStorage.getItem("refreshToken");
        if (refreshToken) {
          try {
            const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
            const resp = await fetch(`${API_URL}/auth/refresh`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ refreshToken }),
            });
            if (resp.ok) {
              const data = await resp.json();
              localStorage.setItem("token", data.token);
              localStorage.setItem("refreshToken", data.refreshToken);
              newSocket.auth = { token: data.token };
              newSocket.connect();
            }
          } catch {}
        }
      }
    });

    newSocket.on("media:show", (data: MediaData) => {
      console.log(`Shitpost received from ${data.senderName || "unknown"}!`);
      showMedia(data);
    });

    setSocket(newSocket);

    return () => {
      cleanup();
      newSocket.disconnect();
    };
  }, [showMedia, cleanup]);

  const getAnimClass = () => {
    switch (animState) {
      case "entering":
        return "media-entering";
      case "visible":
        return "media-visible";
      case "exiting":
        return "media-exiting";
      default:
        return "";
    }
  };

  if (!media || animState === "hidden") return null;

  const mediaUrl = `data:${media.mimeType};base64,${media.mediaBuffer}`;

  return (
    <div className="overlay-container">
      {/* Audio element for image music */}
      <audio ref={audioRef} preload="auto" />

      {/* Media display with optional surrounding text */}
      <div className={`media-content ${getAnimClass()}`}>
        {/* "around" mode: text outside the media */}
        {media.textOverlay?.topText && media.textOverlay.position !== "on" && (
          <div className="text-around top" style={media.textOverlay.fontSize ? { fontSize: media.textOverlay.fontSize } : undefined}>
            {media.textOverlay.topText.toUpperCase()}
          </div>
        )}
        <div className="media-wrapper" style={{ position: "relative" }}>
          {media.mediaType === "image" && (
            <img src={mediaUrl} alt="" className="overlay-image" />
          )}
          {media.mediaType === "video" && (
            <video
              src={mediaUrl}
              autoPlay
              className="overlay-video"
              ref={(el) => {
                if (el) el.volume = Math.min(Math.max(Number(localStorage.getItem("memeVolume") ?? 100), 0), 100) / 100;
              }}
              onEnded={() => {
                /* let timeout handle removal */
              }}
            />
          )}
          {/* "on" mode: text overlaid on the media */}
          {media.textOverlay?.position === "on" && media.textOverlay.topText && (
            <div className="text-on top" style={media.textOverlay.fontSize ? { fontSize: media.textOverlay.fontSize } : undefined}>
              {media.textOverlay.topText.toUpperCase()}
            </div>
          )}
          {media.textOverlay?.position === "on" && media.textOverlay.bottomText && (
            <div className="text-on bottom" style={media.textOverlay.fontSize ? { fontSize: media.textOverlay.fontSize } : undefined}>
              {media.textOverlay.bottomText.toUpperCase()}
            </div>
          )}
        </div>
        {/* "around" mode: text outside the media */}
        {media.textOverlay?.bottomText && media.textOverlay.position !== "on" && (
          <div className="text-around bottom" style={media.textOverlay.fontSize ? { fontSize: media.textOverlay.fontSize } : undefined}>
            {media.textOverlay.bottomText.toUpperCase()}
          </div>
        )}
      </div>

      {/* Sender badge */}
      {media.senderName && (
        <div className={`sender-badge ${getAnimClass()}`}>
          {t("overlay.from")} {media.senderName}
        </div>
      )}

      {/* Dev status */}
      {import.meta.env.DEV && (
        <div className="dev-status">
          {connectionStatus} | {socket?.connected ? "OK" : "OFF"}
        </div>
      )}
    </div>
  );
}

export default Overlay;
