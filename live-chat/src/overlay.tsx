import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { t } from "./i18n";
import { getServerUrl } from "./services/api";
import "./overlay.css";

interface MediaData {
  mediaType: "image" | "video" | "audio";
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
  const dynamicAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSrcNodeRef = useRef<AudioBufferSourceNode | null>(null);

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
    if (dynamicAudioRef.current) {
      dynamicAudioRef.current.pause();
      dynamicAudioRef.current.src = "";
      dynamicAudioRef.current = null;
    }
    if (audioSrcNodeRef.current) {
      try { audioSrcNodeRef.current.stop(); } catch {}
      audioSrcNodeRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
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

      // Save to history + auto-save to memes folder (skip if sent to self)
      const myUsername = localStorage.getItem("username");
      const isSelf = myUsername && data.senderName === myUsername;

      if (data.mediaBuffer && !isSelf) {
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

        if (data.mediaType === "image") {
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
      if (import.meta.env.DEV) console.log("[MEDIA] Type:", data.mediaType, "| MIME:", data.mimeType, "| Volume:", volume);

      // Helper: play audio — try ref element, then new Audio(), then AudioContext
      const playAudioBlob = async (base64: string, mime: string) => {
        const dataUrl = `data:${mime};base64,${base64}`;

        // Method 1: existing <audio> element with autoPlay
        if (audioRef.current) {
          try {
            audioRef.current.src = dataUrl;
            audioRef.current.volume = volume;
            await audioRef.current.play();
            return;
          } catch (e) {
            console.warn("[AUDIO] ref play failed:", e);
          }
        }

        // Method 2: dynamic new Audio()
        try {
          const a = new Audio(dataUrl);
          a.volume = volume;
          dynamicAudioRef.current = a;
          await a.play();
          return;
        } catch (e) {
          console.warn("[AUDIO] new Audio() failed:", e);
          dynamicAudioRef.current = null;
        }

        // Method 3: AudioContext
        try {
          const buf = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          if (ctx.state === "suspended") await ctx.resume();
          const decoded = await ctx.decodeAudioData(buf.slice(0));
          const src = ctx.createBufferSource();
          const gain = ctx.createGain();
          gain.gain.value = volume;
          src.buffer = decoded;
          src.connect(gain);
          gain.connect(ctx.destination);
          src.start(0);
          audioSrcNodeRef.current = src;
          audioCtxRef.current = ctx;
          src.onended = () => {
            audioSrcNodeRef.current = null;
            try { ctx.close(); } catch {}
            audioCtxRef.current = null;
          };
          return;
        } catch (e) {
          console.error("[AUDIO] All methods failed:", e);
        }
      };

      // For standalone audio: play the media itself
      if (data.mediaType === "audio" && data.mediaBuffer) {
        await playAudioBlob(data.mediaBuffer, data.mimeType);
      }

      // For images/videos with attached audio
      if (data.audioBuffer && data.audioMimeType) {
        await playAudioBlob(data.audioBuffer, data.audioMimeType);
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
      if (import.meta.env.DEV) console.log("Overlay connected");
      setConnectionStatus("Connected");
    });

    newSocket.on("disconnect", () => {
      setConnectionStatus("Disconnected");
    });

    newSocket.on("connect_error", (error) => {
      if (import.meta.env.DEV) console.error("Overlay connection error:", error.message);
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
      if (import.meta.env.DEV) console.log(`Shitpost received from ${data.senderName || "unknown"}!`);
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

  // Convert base64 media to Blob URL for efficient memory usage
  const mediaUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!media?.mediaBuffer) {
      if (mediaUrlRef.current) {
        URL.revokeObjectURL(mediaUrlRef.current);
        mediaUrlRef.current = null;
      }
      return;
    }
    try {
      const binary = atob(media.mediaBuffer);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: media.mimeType });
      const url = URL.createObjectURL(blob);
      mediaUrlRef.current = url;
    } catch {
      // fallback handled below
    }
    return () => {
      if (mediaUrlRef.current) {
        URL.revokeObjectURL(mediaUrlRef.current);
        mediaUrlRef.current = null;
      }
    };
  }, [media?.mediaBuffer, media?.mimeType]);

  if (!media || animState === "hidden") return null;

  const mediaUrl = mediaUrlRef.current || `data:${media.mimeType};base64,${media.mediaBuffer}`;

  return (
    <div className="overlay-container">
      {/* Audio element for overlay music */}
      <audio ref={audioRef} preload="auto" autoPlay />

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
          {media.mediaType === "audio" && (
            <div className="overlay-audio">
              <div className="audio-bars">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="audio-bar" style={{ animationDelay: `${i * 0.08}s` }} />
                ))}
              </div>
            </div>
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
