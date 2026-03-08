import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { getServerUrl } from "./services/api";
import "./overlay.css";

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
  const socketRef = useRef<Socket | null>(null);
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

      // Save to history + auto-save to memes folder
      if (data.mediaBuffer) {
        try {
          const { addHistoryEntry } = await import("./services/historyDb");
          await addHistoryEntry({
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            senderName: data.senderName || "unknown",
            direction: "received",
            mediaType: data.mediaType,
            mimeType: data.mimeType,
            mediaBase64: data.mediaBuffer,
            textOverlay: data.textOverlay,
          });
        } catch (err) {
          console.error("Failed to save to history:", err);
        }

        if (data.mediaType !== "video") {
          try {
            const { saveToMemesFolder } = await import("./services/memesUtils");
            const ext = data.mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
            const sender = data.senderName?.replace(/[^a-zA-Z0-9]/g, "_") || "unknown";
            const filename = `${sender}_${Date.now()}.${ext}`;
            const binary = atob(data.mediaBuffer);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            await saveToMemesFolder(bytes, filename);
          } catch (err) {
            console.error("Auto-save received meme failed:", err);
          }
        }
      }

      setMedia(data);
      setAnimState("entering");

      // After pop-in animation, set to visible
      enterTimeoutRef.current = setTimeout(() => {
        setAnimState("visible");
      }, 500);

      // Play audio
      const volume = Math.min(Math.max(Number(localStorage.getItem("memeVolume") ?? 100), 0), 100) / 100;
      console.log("[MEDIA] Type:", data.mediaType, "| MIME:", data.mimeType, "| Volume:", volume, "| Buffer size:", data.mediaBuffer?.length);

      // For images with attached audio
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

  // Connect socket helper
  const connectSocket = useCallback((token: string) => {
    // Disconnect existing socket if any
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const newSocket = io(getServerUrl(), {
      auth: { token },
      transports: ["websocket", "polling"],
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

    newSocket.on("connect_error", (error) => {
      console.error("Overlay connection error:", error.message);
      setConnectionStatus("Error");
      if (error.message.includes("Authentication error")) {
        // Don't refresh here — the main window handles refresh.
        // Wait 3s then retry with whatever token is in localStorage.
        setTimeout(() => {
          const freshToken = localStorage.getItem("token");
          if (freshToken) {
            newSocket.auth = { token: freshToken };
            newSocket.connect();
          }
        }, 3000);
      }
    });

    newSocket.on("media:show", (data: MediaData) => {
      console.log(`Shitpost received from ${data.senderName || "unknown"}!`);
      showMedia(data);
    });

    socketRef.current = newSocket;
  }, [showMedia]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      connectSocket(token);
    } else {
      setConnectionStatus("Waiting for auth...");
    }

    // Listen for token changes from the main window
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "token") {
        if (e.newValue) {
          // Token was refreshed or set — update socket auth and reconnect if needed
          if (socketRef.current) {
            socketRef.current.auth = { token: e.newValue };
            if (!socketRef.current.connected) {
              socketRef.current.connect();
            }
          } else {
            connectSocket(e.newValue);
          }
        } else {
          // Token removed (logout) — disconnect
          if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
          }
          setConnectionStatus("Waiting for auth...");
        }
      }
    };

    // Wake/sleep recovery
    const handleOnline = () => {
      if (socketRef.current && !socketRef.current.connected) {
        const currentToken = localStorage.getItem("token");
        if (currentToken) {
          socketRef.current.auth = { token: currentToken };
          socketRef.current.connect();
        }
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("online", handleOnline);

    // Health check every 30s
    const healthInterval = setInterval(() => {
      if (socketRef.current && !socketRef.current.connected) {
        handleOnline();
      }
    }, 30000);

    return () => {
      cleanup();
      clearInterval(healthInterval);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("online", handleOnline);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [connectSocket, cleanup]);

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
              playsInline
              className="overlay-video"
              ref={(el) => {
                if (el) {
                  el.volume = Math.min(Math.max(Number(localStorage.getItem("memeVolume") ?? 100), 0), 100) / 100;
                }
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
          {connectionStatus} | {socketRef.current?.connected ? "OK" : "OFF"}
        </div>
      )}
    </div>
  );
}

export default Overlay;
