import { useEffect, useRef, useState, useCallback } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { useAuth } from "./contexts/AuthContext";
import { useLang } from "./contexts/LangContext";
import api, { getServerUrl, setServerUrl, refreshAuthToken } from "./services/api";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import { Icons } from "./components/Icons";
import Titlebar from "./components/Titlebar";
import MemesTab from "./components/MemesTab";
import HistoryTab from "./components/HistoryTab";


const TIMEOUT_LIMITS = { min: 1000, maxImage: 10000, maxVideo: 30000, step: 500 } as const;

const AVATAR_COLORS = [
  "#ff6b9d", "#2de2e6", "#ffd700", "#ff8c42",
  "#53d769", "#b854d4", "#ff4757", "#00d2d3",
];

function getAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface MediaData {
  type: "image" | "video";
  data: string;
  mimeType: string;
}

interface AudioData {
  data: string;
  mimeType: string;
  name: string;
}

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { token, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-dark)" }}>
        <div className="animate-float">
          <Icons.Broadcast size={48} className="text-[var(--accent-cyan)]" />
        </div>
      </div>
    );
  }
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

function MainChat() {
  const { user, token, logout } = useAuth();
  const { t, lang, setLang } = useLang();
  const navigate = useNavigate();
  const socketRef = useRef<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [friends, setFriends] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [onlineFriendIds, setOnlineFriendIds] = useState<string[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [mediaData, setMediaData] = useState<MediaData | null>(null);
  const [audioData, setAudioData] = useState<AudioData | null>(null);
  const [textData, setTextData] = useState({ topText: "", bottomText: "" });
  const [textSize, setTextSize] = useState(48);
  const [textPosition, setTextPosition] = useState<"on" | "around">("on");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [activeTab, setActiveTab] = useState<"media" | "memes" | "history" | "social" | "settings">("media");
  const [isDragging, setIsDragging] = useState(false);
  const [memeVolume, setMemeVolume] = useState(() => {
    const saved = localStorage.getItem("memeVolume");
    return saved !== null ? Number(saved) : 100;
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [modal, setModal] = useState<{ type: "createGroup" | "addMember" | "manageGroup"; groupId?: string } | null>(null);
  const [modalInput, setModalInput] = useState("");
  const [autostart, setAutostart] = useState(false);
  const [monitors, setMonitors] = useState<{ name: string; width: number; height: number; x: number; y: number }[]>([]);
  const [selectedMonitor, setSelectedMonitor] = useState(0);
  const [compressing, setCompressing] = useState(false);
  const [compressProgress, setCompressProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [previewMuted, setPreviewMuted] = useState(true);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const [globalDragging, setGlobalDragging] = useState(false);
  const [dropProgress, setDropProgress] = useState<{ current: number; total: number } | null>(null);
  const [groupInvites, setGroupInvites] = useState<any[]>([]);
  const [serverModal, setServerModal] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState("");
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [inviteLinkInput, setInviteLinkInput] = useState("");
  const [inviteLinkModal, setInviteLinkModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; friendId: string; friendName: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [friendsRes, groupsRes, pendingRes, groupInvitesRes] = await Promise.all([
        api.get("/friends"),
        api.get("/groups"),
        api.get("/friends/pending"),
        api.get("/groups/invites/pending"),
      ]);
      setFriends(friendsRes.data);
      setGroups(groupsRes.data);
      setPendingRequests(pendingRes.data);
      setGroupInvites(groupInvitesRes.data);
    } catch (err) {
      console.error("Failed to fetch data", err);
    }
  }, []);

  // Stable ref for logout so the socket useEffect never re-runs due to logout changing
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  // Create socket once at mount (reads token from localStorage, not React state)
  useEffect(() => {
    const initialToken = localStorage.getItem("token");
    if (!initialToken) return;

    const serverUrl = getServerUrl();
    const newSocket = io(serverUrl, {
      auth: { token: initialToken },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socketRef.current = newSocket;

    newSocket.on("connect", () => {
      setSocketConnected(true);
    });

    newSocket.on("disconnect", (reason) => {
      setSocketConnected(false);
      if (reason === "io server disconnect") {
        const currentToken = localStorage.getItem("token");
        if (currentToken) {
          newSocket.auth = { token: currentToken };
          newSocket.connect();
        }
      }
    });

    newSocket.on("connect_error", async (err) => {
      setSocketConnected(false);
      if (err.message.includes("Authentication error")) {
        const newToken = await refreshAuthToken();
        if (newToken) {
          newSocket.auth = { token: newToken };
          newSocket.connect();
        } else {
          logoutRef.current();
        }
      }
    });

    newSocket.on("reconnect_attempt", () => {
      const currentToken = localStorage.getItem("token");
      if (currentToken) {
        newSocket.auth = { token: currentToken };
      }
    });

    newSocket.on("presence:online_friends", (ids: string[]) => {
      setOnlineFriendIds(ids);
    });

    newSocket.on("presence:update", (data: { userId: string; status: string }) => {
      setOnlineFriendIds((prev) => {
        if (data.status === "online") {
          return prev.includes(data.userId) ? prev : [...prev, data.userId];
        }
        return prev.filter((id) => id !== data.userId);
      });
    });

    // Real-time friend request updates
    newSocket.on("friends:request_received", (data: any) => {
      setPendingRequests((prev) => {
        if (prev.some((r: any) => r.id === data.id)) return prev;
        return [...prev, data];
      });
    });

    newSocket.on("friends:request_accepted", (data: { friend: any }) => {
      setFriends((prev) => {
        if (prev.some((f: any) => f.id === data.friend.id)) return prev;
        return [...prev, data.friend];
      });
    });

    // Real-time group invite updates
    newSocket.on("groups:invite_received", (data: any) => {
      setGroupInvites((prev) => {
        if (prev.some((i: any) => i.id === data.id)) return prev;
        return [...prev, data];
      });
    });

    newSocket.on("groups:member_joined", () => {
      // Refresh groups to get updated member list
      api.get("/groups").then((res) => setGroups(res.data)).catch(() => {});
    });

    newSocket.on("media:sent", (data: { results: Array<{ targetId: string; delivered: boolean }> }) => {
      const allDelivered = data.results?.every((r: { delivered: boolean }) => r.delivered) ?? true;
      const offlineCount = data.results?.filter((r: { delivered: boolean }) => !r.delivered).length ?? 0;
      if (allDelivered) {
        setSendStatus(t("media.sent"));
      } else {
        setSendStatus(`${t("media.sent")} (${offlineCount} offline)`);
      }
      setTimeout(() => setSendStatus(null), 2000);
    });

    fetchData();

    const refreshInterval = setInterval(async () => {
      const newToken = await refreshAuthToken();
      if (newToken && socketRef.current) {
        socketRef.current.auth = { token: newToken };
      }
    }, 50 * 60 * 1000);

    const handleOnline = () => {
      if (socketRef.current && !socketRef.current.connected) {
        const currentToken = localStorage.getItem("token");
        if (currentToken) {
          socketRef.current.auth = { token: currentToken };
          socketRef.current.connect();
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleOnline();
      }
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(refreshInterval);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      newSocket.disconnect();
      socketRef.current = null;
    };
  }, [fetchData]);

  // Disconnect socket on logout
  useEffect(() => {
    if (!token && socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocketConnected(false);
    }
  }, [token]);

  // Load autostart status + monitors list
  useEffect(() => {
    const invoke = (window as any).__TAURI__?.core?.invoke;
    if (invoke) {
      invoke("get_autostart").then((v: boolean) => {
        setAutostart(v);
        if (!v && !localStorage.getItem("autostartInitialized")) {
          invoke("set_autostart", { enabled: true }).then(() => setAutostart(true)).catch(() => {});
        }
        localStorage.setItem("autostartInitialized", "true");
      }).catch(() => {});
      invoke("list_monitors").then((m: any[]) => {
        setMonitors(m);
        const saved = localStorage.getItem("overlayMonitor");
        if (saved !== null) {
          const idx = Number(saved);
          setSelectedMonitor(idx);
          if (m[idx]) {
            invoke("set_overlay_monitor", { x: m[idx].x, y: m[idx].y, width: m[idx].width, height: m[idx].height }).catch(() => {});
          }
        }
      }).catch(() => {});
    }
  }, []);

  // Preview with text overlay
  const createPreview = useCallback(
    async (media: MediaData, text: { topText: string; bottomText: string }) => {
      if (media.type !== "image" || (!text.topText && !text.bottomText)) {
        return media.data;
      }

      return new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) { resolve(media.data); return; }

          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);

          const fontSize = Math.max(Math.round(textSize * (img.width / 800)), 16);
          ctx.font = `bold ${fontSize}px Impact, Charcoal, sans-serif`;
          ctx.textAlign = "center";
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = fontSize / 10;
          ctx.fillStyle = "#ffffff";

          if (text.topText) {
            const t = text.topText.toUpperCase();
            ctx.strokeText(t, canvas.width / 2, fontSize + 10);
            ctx.fillText(t, canvas.width / 2, fontSize + 10);
          }
          if (text.bottomText) {
            const t = text.bottomText.toUpperCase();
            ctx.strokeText(t, canvas.width / 2, canvas.height - 20);
            ctx.fillText(t, canvas.width / 2, canvas.height - 20);
          }

          resolve(canvas.toDataURL("image/png", 1.0));
        };
        img.src = media.data;
      });
    },
    [textSize]
  );

  useEffect(() => {
    if (!mediaData) { setPreviewUrl(null); return; }
    if (mediaData.type === "image" && textPosition === "on") {
      createPreview(mediaData, textData).then(setPreviewUrl);
    } else {
      setPreviewUrl(mediaData.data);
    }
  }, [mediaData, textData, textPosition, textSize, createPreview]);

  // Sync preview video volume with settings
  useEffect(() => {
    if (previewVideoRef.current) previewVideoRef.current.volume = memeVolume / 100;
  }, [memeVolume]);

  // Clamp duration when switching media type
  useEffect(() => {
    const max = mediaData?.type === "video" ? TIMEOUT_LIMITS.maxVideo : TIMEOUT_LIMITS.maxImage;
    setTimeoutMs((prev) => Math.min(prev, max));
  }, [mediaData?.type]);

  const loadMediaFile = useCallback((file: File, dataUrl: string) => {
    const isVideo = file.type.startsWith("video/");
    setMediaData({ type: isVideo ? "video" : "image", data: dataUrl, mimeType: file.type });
    if (isVideo) {
      const v = document.createElement("video");
      v.src = dataUrl;
      v.onloadedmetadata = () => {
        const dur = v.duration;
        setVideoDuration(dur);
        setTrimStart(0);
        const maxTrim = Math.min(dur, TIMEOUT_LIMITS.maxVideo / 1000);
        setTrimEnd(maxTrim);
        setTimeoutMs(Math.round(maxTrim * 1000));
      };
    } else {
      setVideoDuration(0);
      setTrimStart(0);
      setTrimEnd(0);
    }
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (re) => loadMediaFile(file, re.target?.result as string);
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [loadMediaFile]);

  const handleAudioUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (re) => {
      const result = re.target?.result as string;
      setAudioData({
        data: result.split(",")[1],
        mimeType: file.type,
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
    if (audioInputRef.current) audioInputRef.current.value = "";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
        const reader = new FileReader();
        reader.onload = (re) => loadMediaFile(file, re.target?.result as string);
        reader.readAsDataURL(file);
      }
    },
    [loadMediaFile]
  );

  // Global drag & drop via Tauri API
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"];
    const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".avi", ".mkv"];
    const ALL_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS];
    const isMedia = (p: string) => ALL_EXTS.some((ext) => p.toLowerCase().endsWith(ext));
    const isVideo = (p: string) => VIDEO_EXTS.some((ext) => p.toLowerCase().endsWith(ext));

    (async () => {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      unlisten = await getCurrentWebviewWindow().onDragDropEvent(async (event) => {
        if (event.payload.type === "enter") {
          setGlobalDragging(true);
        } else if (event.payload.type === "leave") {
          setGlobalDragging(false);
        } else if (event.payload.type === "drop") {
          setGlobalDragging(false);
          const paths = event.payload.paths.filter(isMedia);
          if (paths.length === 0) return;

          const memesFolder = localStorage.getItem("memesFolder");
          const { readFile } = await import("@tauri-apps/plugin-fs");
          const { saveToMemesFolder, isFileDuplicateInMemes } = await import("./services/memesUtils");

          // Save all files to memes folder with progress (skip duplicates)
          if (memesFolder) {
            setDropProgress({ current: 0, total: paths.length });
            try {
              for (let i = 0; i < paths.length; i++) {
                const isDup = await isFileDuplicateInMemes(paths[i]);
                if (!isDup) {
                  const bytes = await readFile(paths[i]);
                  const fileName = paths[i].split("\\").pop() || paths[i].split("/").pop() || `file_${i}`;
                  await saveToMemesFolder(new Uint8Array(bytes), fileName, true);
                }
                setDropProgress({ current: i + 1, total: paths.length });
              }
            } catch (err) {
              console.error("Failed to save to memes folder:", err);
            }
            setTimeout(() => setDropProgress(null), 800);
          }

          // If single file, load into shitpost
          if (paths.length === 1) {
            try {
              const bytes = await readFile(paths[0]);
              const u8 = new Uint8Array(bytes);
              let binary = "";
              for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
              const base64 = btoa(binary);
              const fileName = paths[0].split("\\").pop() || "";
              const isVid = isVideo(fileName);
              const ext = fileName.split(".").pop()?.toLowerCase() || "";
              const mimeMap: Record<string, string> = {
                jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
                webp: "image/webp", bmp: "image/bmp", avif: "image/avif",
                mp4: "video/mp4", webm: "video/webm", mov: "video/mp4",
                avi: "video/x-msvideo", mkv: "video/x-matroska",
              };
              const mime = mimeMap[ext] || (isVid ? "video/mp4" : "image/png");
              const dataUrl = `data:${mime};base64,${base64}`;

              setMediaData({ type: isVid ? "video" : "image", data: dataUrl, mimeType: mime });
              setAudioData(null);
              setTextData({ topText: "", bottomText: "" });
              setPreviewMuted(true);
              if (isVid) {
                const v = document.createElement("video");
                v.src = dataUrl;
                v.onloadedmetadata = () => {
                  const dur = v.duration;
                  setVideoDuration(dur);
                  setTrimStart(0);
                  const maxTrim = Math.min(dur, TIMEOUT_LIMITS.maxVideo / 1000);
                  setTrimEnd(maxTrim);
                  setTimeoutMs(Math.round(maxTrim * 1000));
                };
              } else {
                setVideoDuration(0);
                setTrimStart(0);
                setTrimEnd(0);
              }
              setActiveTab("media");
            } catch (err) {
              console.error("Failed to load dropped file:", err);
            }
          } else {
            setSendStatus(`${paths.length} shitposts ${t("memes.added").toLowerCase()}`);
            setTimeout(() => setSendStatus(null), 2000);
          }
        }
      });
    })();

    return () => { if (unlisten) unlisten(); };
  }, [t]);

  const compressVideo = useCallback(async (dataUrl: string, start: number, end: number): Promise<string> => {
    const MAX_WIDTH = 1280;
    const MAX_HEIGHT = 720;

    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.playsInline = true;
      video.muted = false;
      video.volume = 1;
      video.src = dataUrl;

      video.onloadedmetadata = () => {
        let w = video.videoWidth;
        let h = video.videoHeight;
        if (w > MAX_WIDTH || h > MAX_HEIGHT) {
          const ratio = Math.min(MAX_WIDTH / w, MAX_HEIGHT / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        w = w % 2 === 0 ? w : w - 1;
        h = h % 2 === 0 ? h : h - 1;

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;

        const stream = canvas.captureStream(30);
        try {
          const audioCtx = new AudioContext();
          const source = audioCtx.createMediaElementSource(video);
          const dest = audioCtx.createMediaStreamDestination();
          source.connect(dest);
          dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
          console.log("[COMPRESS] Audio tracks added:", dest.stream.getAudioTracks().length);
        } catch (e) {
          console.warn("[COMPRESS] No audio track captured:", e);
        }

        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm";
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 });

        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: "video/webm" });
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Failed to read compressed video"));
          reader.readAsDataURL(blob);
        };

        recorder.onerror = () => reject(new Error("MediaRecorder error"));

        const clipDuration = end - start;
        let lastProgress = 0;

        const drawFrame = () => {
          if (video.paused || video.ended || video.currentTime >= end) {
            ctx.drawImage(video, 0, 0, w, h);
            video.pause();
            setTimeout(() => recorder.stop(), 100);
            return;
          }
          ctx.drawImage(video, 0, 0, w, h);
          const progress = Math.round(((video.currentTime - start) / clipDuration) * 100);
          if (progress !== lastProgress) {
            lastProgress = progress;
            setCompressProgress(Math.min(progress, 100));
          }
          requestAnimationFrame(drawFrame);
        };

        // Seek to trim start, then play
        video.currentTime = start;
        video.onseeked = () => {
          recorder.start();
          video.play().then(drawFrame).catch(reject);
          video.onseeked = null;
        };
      };

      video.onerror = () => reject(new Error("Video load error"));
    });
  }, []);

  const handleSend = useCallback(async () => {
    if (!socketRef.current?.connected || selectedTargets.length === 0 || !mediaData) return;

    const hasText = textData.topText || textData.bottomText;
    let mediaBuffer: string;
    let mimeType = mediaData.mimeType;

    if (mediaData.type === "image" && hasText && textPosition === "on") {
      const rendered = await createPreview(mediaData, textData);
      mediaBuffer = rendered.split(",")[1];
      mimeType = "image/png";
    } else if (mediaData.type === "video") {
      // Compress video before sending
      setCompressing(true);
      setCompressProgress(0);
      try {
        const compressed = await compressVideo(mediaData.data, trimStart, trimEnd);
        mediaBuffer = compressed.split(",")[1];
        mimeType = "video/webm";
      } catch (err) {
        console.error("Video compression failed:", err);
        setSendStatus(t("media.compress_error"));
        setCompressing(false);
        return;
      }
      setCompressing(false);
    } else {
      mediaBuffer = mediaData.data.split(",")[1];
    }

    socketRef.current.emit("broadcast_media", {
      targetIds: selectedTargets,
      mediaType: mediaData.type,
      mediaBuffer,
      mimeType,
      duration: timeoutMs,
      textOverlay: hasText && (textPosition === "around" || mediaData.type === "video") ? { ...textData, fontSize: textSize, position: textPosition } : undefined,
      audioBuffer: mediaData.type === "image" ? audioData?.data : undefined,
      audioMimeType: mediaData.type === "image" ? audioData?.mimeType : undefined,
    });

    // Save to history
    const rawBase64 = mediaData.data.split(",")[1];
    try {
      const { addHistoryEntry } = await import("./services/historyDb");
      const hasText = textData.topText || textData.bottomText;
      await addHistoryEntry({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        senderName: user?.username || "me",
        direction: "sent",
        mediaType: mediaData.type,
        mimeType: mediaData.mimeType,
        mediaBase64: rawBase64,
        textOverlay: hasText ? { ...textData, fontSize: textSize, position: textPosition } : undefined,
      });
    } catch (err) {
      console.error("Failed to save to history:", err);
    }

    // Auto-save raw media to memes folder (skip duplicates)
    try {
      const { saveToMemesFolder } = await import("./services/memesUtils");
      const bytes = Uint8Array.from(atob(rawBase64), (c) => c.charCodeAt(0));
      const ext = mediaData.mimeType.split("/")[1]?.replace("jpeg", "jpg") || (mediaData.type === "video" ? "mp4" : "png");
      const filename = `shitpost_${Date.now()}.${ext}`;
      await saveToMemesFolder(bytes, filename);
    } catch (err) {
      console.error("Auto-save to memes folder failed:", err);
    }
  }, [selectedTargets, mediaData, textData, timeoutMs, audioData, createPreview, compressVideo, trimStart, trimEnd]);

  const handleTargetToggle = (id: string) => {
    setSelectedTargets((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  const handleSelectGroup = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const memberIds = group.members.map((m: any) => m.userId).filter((id: string) => id !== user?.id);
    const allSelected = memberIds.every((id: string) => selectedTargets.includes(id));
    if (allSelected) {
      setSelectedTargets((prev) => prev.filter((t) => !memberIds.includes(t)));
    } else {
      setSelectedTargets((prev) => Array.from(new Set([...prev, ...memberIds])));
    }
  };

  const handleSendFriendRequest = async () => {
    if (!searchQuery.trim()) return;
    try {
      await api.post("/friends/request", { username: searchQuery });
      setSearchQuery("");
      fetchData();
      setSendStatus(t("friends.request_sent"));
      setTimeout(() => setSendStatus(null), 2000);
    } catch (err: any) {
      setSendStatus(err.response?.data?.message || t("general.error"));
      setTimeout(() => setSendStatus(null), 3000);
    }
  };

  const handleAcceptFriend = async (id: string) => {
    try { await api.post(`/friends/accept/${id}`); fetchData(); } catch {}
  };

  const handleDeclineFriend = async (id: string) => {
    try { await api.post(`/friends/decline/${id}`); fetchData(); } catch {}
  };

  const handleCreateGroup = () => {
    setModalInput("");
    setModal({ type: "createGroup" });
  };

  const handleAddMember = (groupId: string) => {
    setModalInput("");
    setModal({ type: "addMember", groupId });
  };

  const handleManageGroup = (groupId: string) => {
    setModal({ type: "manageGroup", groupId });
  };

  const handleAcceptGroupInvite = async (inviteId: string) => {
    try {
      await api.post(`/groups/invites/${inviteId}/accept`);
      setGroupInvites((prev) => prev.filter((i: any) => i.id !== inviteId));
      fetchData();
    } catch {}
  };

  const handleDeclineGroupInvite = async (inviteId: string) => {
    try {
      await api.post(`/groups/invites/${inviteId}/decline`);
      setGroupInvites((prev) => prev.filter((i: any) => i.id !== inviteId));
    } catch {}
  };

  const handleModalSubmit = async () => {
    if (!modalInput.trim()) return;
    try {
      if (modal?.type === "createGroup") {
        await api.post("/groups", { name: modalInput });
        fetchData();
      } else if (modal?.type === "addMember" && modal.groupId) {
        await api.post(`/groups/${modal.groupId}/members`, { username: modalInput });
        setSendStatus(t("groups.invite_sent"));
        setTimeout(() => setSendStatus(null), 2000);
      }
      setModal(null);
    } catch (err: any) {
      setSendStatus(err.response?.data?.message || t("general.error"));
      setTimeout(() => setSendStatus(null), 3000);
    }
  };

  const handleInviteLink = useCallback((link: string) => {
    const trimmed = link.trim();

    // Friend link: shitpost://friend/USERNAME
    const friendMatch = trimmed.match(/^shitpost:\/\/friend\/(.+)$/);
    if (friendMatch) {
      const username = decodeURIComponent(friendMatch[1]);
      if (username === user?.username) return;
      setConfirmAction({
        message: `${t("friends.confirm_add")}\n${username}`,
        onConfirm: async () => {
          try {
            await api.post("/friends/add-direct", { username });
            fetchData();
            setSendStatus(t("friends.accept"));
            setTimeout(() => setSendStatus(null), 2000);
          } catch (err: any) {
            setSendStatus(err.response?.data?.message || t("general.error"));
            setTimeout(() => setSendStatus(null), 3000);
          }
          setConfirmAction(null);
        },
      });
      return;
    }

    // Group link: shitpost://group/INVITE_CODE
    const groupMatch = trimmed.match(/^shitpost:\/\/group\/(.+)$/);
    if (groupMatch) {
      const code = groupMatch[1];
      // Resolve group info first
      api.get(`/groups/resolve/${code}`).then((res) => {
        const { groupName, memberCount } = res.data;
        setConfirmAction({
          message: `${t("groups.invites")}\n${groupName} (${memberCount} ${t("groups.members").toLowerCase()})`,
          onConfirm: async () => {
            try {
              await api.post(`/groups/join/${code}`);
              fetchData();
              setSendStatus(t("friends.accept"));
              setTimeout(() => setSendStatus(null), 2000);
            } catch (err: any) {
              setSendStatus(err.response?.data?.message || t("general.error"));
              setTimeout(() => setSendStatus(null), 3000);
            }
            setConfirmAction(null);
          },
        });
      }).catch(() => {
        setSendStatus(t("general.error"));
        setTimeout(() => setSendStatus(null), 2000);
      });
      return;
    }
  }, [user, fetchData, t]);

  // Deep link handler
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/plugin-deep-link").then(({ onOpenUrl }) => {
      onOpenUrl((urls) => {
        for (const url of urls) {
          handleInviteLink(url);
        }
        // Bring main window to front
        const win = (window as any).__TAURI__?.window;
        if (win) {
          const main = win.getCurrentWindow?.() || win.getCurrent?.();
          main?.show?.();
          main?.setFocus?.();
        }
      }).then((fn) => { unlisten = fn; });
    }).catch(() => {});
    return () => { unlisten?.(); };
  }, [handleInviteLink]);

  const handleKickMember = async (groupId: string, userId: string) => {
    try {
      await api.delete(`/groups/${groupId}/members/${userId}`);
      fetchData();
    } catch (err: any) {
      setSendStatus(err.response?.data?.message || t("general.error"));
      setTimeout(() => setSendStatus(null), 3000);
    }
  };

  const handleSetRole = async (groupId: string, userId: string, role: "admin" | "member") => {
    try {
      await api.patch(`/groups/${groupId}/members/${userId}/role`, { role });
      fetchData();
    } catch (err: any) {
      setSendStatus(err.response?.data?.message || t("general.error"));
      setTimeout(() => setSendStatus(null), 3000);
    }
  };

  const handleRenameGroup = async (groupId: string, newName: string) => {
    try {
      await api.patch(`/groups/${groupId}`, { name: newName });
      fetchData();
    } catch (err: any) {
      setSendStatus(err.response?.data?.message || t("general.error"));
      setTimeout(() => setSendStatus(null), 3000);
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    try {
      await api.delete(`/friends/${friendId}`);
      setSelectedTargets((prev) => prev.filter((id) => id !== friendId));
      fetchData();
    } catch (err: any) {
      setSendStatus(err.response?.data?.message || t("general.error"));
      setTimeout(() => setSendStatus(null), 3000);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await api.delete(`/groups/${groupId}`);
      fetchData();
      setModal(null);
    } catch (err: any) {
      setSendStatus(err.response?.data?.message || t("general.error"));
      setTimeout(() => setSendStatus(null), 3000);
    }
  };

  const handleLeaveGroup = async (groupId: string) => {
    try {
      await api.post(`/groups/${groupId}/leave`);
      fetchData();
      setModal(null);
    } catch (err: any) {
      setSendStatus(err.response?.data?.message || t("general.error"));
      setTimeout(() => setSendStatus(null), 3000);
    }
  };

  const getMyRole = (group: any) => {
    return group.members?.find((m: any) => m.userId === user?.id)?.role || "member";
  };

  const onlineCount = friends.filter((f) => onlineFriendIds.includes(f.id)).length;

  return (
    <div
      className="min-h-screen flex flex-col relative"
      style={{ background: "var(--bg-dark)" }}
    >
      {/* Global drop overlay */}
      {globalDragging && (
        <div
          className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-none"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
        >
          <div className="flex flex-col items-center gap-4 animate-bounce-in">
            <div className="rounded-2xl p-6" style={{ background: "var(--bg-card)", border: "3px dashed var(--accent-orange)", boxShadow: "var(--shadow-cartoon)" }}>
              <Icons.Upload size={56} className="text-[var(--accent-orange)]" />
            </div>
            <p className="font-cartoon text-xl" style={{ color: "var(--accent-orange)" }}>
              {t("memes.drop_here")}
            </p>
          </div>
        </div>
      )}

      {/* Drop progress bar */}
      {dropProgress && (
        <div className="absolute top-0 left-0 right-0 z-[101]">
          <div
            className="h-1 transition-all duration-300 ease-out"
            style={{
              width: `${(dropProgress.current / dropProgress.total) * 100}%`,
              background: "var(--accent-orange)",
              boxShadow: "0 0 10px var(--accent-orange)",
            }}
          />
        </div>
      )}

      <Titlebar>
        {/* Connection status */}
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: socketConnected ? "var(--accent-green)" : "var(--accent-red)" }}
          title={socketConnected ? t("general.connected") : t("friends.offline")}
        />
        {/* User */}
        <div className="flex items-center gap-1.5">
          <div
            className="cartoon-avatar"
            style={{ background: getAvatarColor(user?.username || ""), width: 24, height: 24, fontSize: 10 }}
          >
            {user?.username?.[0]?.toUpperCase()}
          </div>
          <span className="font-bold text-xs" style={{ color: "var(--text-white)" }}>
            {user?.username}
          </span>
        </div>
      </Titlebar>

      {/* Tabs */}
      <nav className="px-6 py-3 flex gap-2" style={{ background: "var(--bg-dark)" }}>
        {[
          { id: "media", label: "Shitpost", icon: Icons.Media, color: "var(--accent-pink)" },
          { id: "memes", label: t("memes.title"), icon: Icons.Gallery, color: "var(--accent-orange)" },
          { id: "history", label: t("history.title"), icon: Icons.Clock, color: "var(--accent-purple)" },
          { id: "social", label: t("sidebar.friends"), icon: Icons.Users, color: "var(--accent-cyan)" },
          { id: "settings", label: t("sidebar.settings"), icon: Icons.Settings, color: "var(--accent-yellow)" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className="cartoon-tab flex items-center gap-2 relative"
            style={
              activeTab === tab.id
                ? { background: tab.color, color: "#000", borderColor: "#000", boxShadow: "var(--shadow-cartoon-sm)" }
                : {}
            }
          >
            <tab.icon size={18} />
            {tab.label}
            {tab.id === "social" && (pendingRequests.length + groupInvites.length) > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-white font-bold"
                style={{ background: "var(--accent-red)", fontSize: 10, padding: "0 4px", border: "2px solid #000" }}
              >
                {pendingRequests.length + groupInvites.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Toast */}
      {sendStatus && (
        <div
          className="fixed top-4 right-4 z-50 cartoon-badge animate-bounce-in"
          style={{ background: "var(--accent-green)", color: "#000", fontSize: 14, padding: "8px 16px" }}
        >
          {sendStatus}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => setModal(null)}
        >
          <div
            className="cartoon-card p-6 w-full max-w-md animate-bounce-in"
            style={{ maxHeight: "85vh", display: "flex", flexDirection: "column" }}
            onClick={(e) => e.stopPropagation()}
          >
            {modal.type === "createGroup" && (
              <>
                <h2 className="font-cartoon text-lg mb-4" style={{ color: "var(--accent-purple)" }}>
                  {t("groups.create")}
                </h2>
                <label className="text-xs font-bold mb-1 block" style={{ color: "var(--text-muted)" }}>
                  {t("groups.name").toUpperCase()}
                </label>
                <input
                  type="text"
                  value={modalInput}
                  onChange={(e) => setModalInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleModalSubmit()}
                  className="cartoon-input w-full mb-4"
                  placeholder="Ex: The boys"
                  autoFocus
                />
                <div className="flex gap-3">
                  <button onClick={() => setModal(null)} className="cartoon-btn flex-1 py-2.5" style={{ background: "var(--bg-input)", color: "var(--text-gray)" }}>
                    {t("general.cancel")}
                  </button>
                  <button onClick={handleModalSubmit} disabled={!modalInput.trim()} className="cartoon-btn flex-1 py-2.5"
                    style={{ background: "var(--accent-purple)", color: "#fff", opacity: modalInput.trim() ? 1 : 0.5 }}>
                    {t("general.confirm")}
                  </button>
                </div>
              </>
            )}

            {modal.type === "addMember" && (
              <>
                <h2 className="font-cartoon text-lg mb-4" style={{ color: "var(--accent-cyan)" }}>
                  {t("groups.add_member")}
                </h2>
                {(() => {
                  const group = groups.find((g) => g.id === modal.groupId);
                  const memberIds = group?.members?.map((m: any) => m.userId) || [];
                  const availableFriends = friends.filter((f) => !memberIds.includes(f.id));
                  return availableFriends.length > 0 ? (
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {availableFriends.map((friend) => (
                        <div
                          key={friend.id}
                          onClick={async () => {
                            try {
                              await api.post(`/groups/${modal.groupId}/members`, { username: friend.username });
                              setSendStatus(t("groups.invite_sent"));
                              setTimeout(() => setSendStatus(null), 2000);
                              setModal(null);
                            } catch (err: any) {
                              setSendStatus(err.response?.data?.message || t("general.error"));
                              setTimeout(() => setSendStatus(null), 3000);
                            }
                          }}
                          className="friend-item cursor-pointer"
                        >
                          <div className="cartoon-avatar" style={{ background: getAvatarColor(friend.username), width: 32, height: 32, fontSize: 12 }}>
                            {friend.username[0].toUpperCase()}
                          </div>
                          <span className="flex-1 text-sm font-bold">{friend.username}</span>
                          <span className="text-xs font-bold" style={{ color: "var(--accent-cyan)" }}>+ {t("groups.add_member")}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-center py-4" style={{ color: "var(--text-muted)" }}>
                      {t("friends.all_in_group")}
                    </p>
                  );
                })()}
                <button onClick={() => setModal(null)} className="cartoon-btn w-full py-2.5 mt-4" style={{ background: "var(--bg-input)", color: "var(--text-gray)" }}>
                  {t("general.close")}
                </button>
              </>
            )}

            {modal.type === "manageGroup" && (() => {
              const group = groups.find((g) => g.id === modal.groupId);
              if (!group) return null;
              const myRole = getMyRole(group);
              const isOwner = myRole === "owner";
              const isAdmin = myRole === "admin";
              const canManage = isOwner || isAdmin;

              return (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-cartoon text-lg" style={{ color: "var(--accent-purple)" }}>
                      {t("groups.manage")}
                    </h2>
                    <span className="text-xs px-2 py-0.5 rounded font-bold" style={{
                      background: isOwner ? "var(--accent-yellow)" : isAdmin ? "var(--accent-cyan)" : "var(--bg-card)",
                      color: isOwner || isAdmin ? "#000" : "var(--text-gray)",
                    }}>
                      {isOwner ? t("groups.owner") : isAdmin ? t("groups.admin") : t("groups.member")}
                    </span>
                  </div>

                  {/* Rename */}
                  {canManage && (
                    <div className="mb-4">
                      <label className="text-xs font-bold mb-1 block" style={{ color: "var(--text-muted)" }}>{t("groups.name").toUpperCase()}</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          defaultValue={group.name}
                          id="rename-group-input"
                          className="cartoon-input flex-1 text-sm"
                        />
                        <button
                          onClick={() => {
                            const input = document.getElementById("rename-group-input") as HTMLInputElement;
                            if (input?.value.trim() && input.value !== group.name) {
                              handleRenameGroup(group.id, input.value.trim());
                            }
                          }}
                          className="cartoon-btn px-3 py-1 text-xs"
                          style={{ background: "var(--accent-cyan)", color: "#000" }}
                        >
                          {t("groups.rename")}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Copy group invite link */}
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`shitpost://group/${group.inviteCode}`);
                      setSendStatus(t("groups.link_copied"));
                      setTimeout(() => setSendStatus(null), 2000);
                    }}
                    className="cartoon-btn w-full py-1.5 text-xs mb-3"
                    style={{ background: "var(--bg-input)", fontSize: 11 }}
                  >
                    <Icons.Link size={12} className="inline mr-1" /> {t("groups.copy_link")}
                  </button>

                  {/* Members list */}
                  <label className="text-xs font-bold mb-2 block" style={{ color: "var(--text-muted)" }}>
                    {t("groups.members").toUpperCase()} ({group.members?.length || 0})
                  </label>
                  <div className="space-y-1 overflow-y-auto mb-4" style={{ maxHeight: 280 }}>
                    {group.members?.sort((a: any, b: any) => {
                      const order: Record<string, number> = { owner: 0, admin: 1, member: 2 };
                      return (order[a.role] ?? 2) - (order[b.role] ?? 2);
                    }).map((m: any) => {
                      const isMe = m.userId === user?.id;
                      const memberRole = m.role;
                      return (
                        <div key={m.userId} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: "var(--bg-input)" }}>
                          <div className="cartoon-avatar" style={{ background: getAvatarColor(m.user?.username || ""), width: 30, height: 30, fontSize: 11 }}>
                            {m.user?.username?.[0]?.toUpperCase()}
                          </div>
                          <span className="flex-1 text-sm font-bold">{m.user?.username} {isMe ? `(${t("general.you")})` : ""}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{
                            background: memberRole === "owner" ? "var(--accent-yellow)" : memberRole === "admin" ? "var(--accent-cyan)" : "var(--bg-card)",
                            color: memberRole === "owner" || memberRole === "admin" ? "#000" : "var(--text-muted)",
                            fontSize: 10,
                          }}>
                            {memberRole === "owner" ? t("groups.owner") : memberRole === "admin" ? t("groups.admin") : t("groups.member")}
                          </span>

                          {/* Role actions */}
                          {!isMe && memberRole !== "owner" && (
                            <div className="flex gap-1">
                              {isOwner && memberRole === "member" && (
                                <button
                                  onClick={() => handleSetRole(group.id, m.userId, "admin")}
                                  className="text-xs px-1.5 py-0.5 rounded font-bold"
                                  style={{ background: "var(--accent-cyan)", color: "#000", fontSize: 10 }}
                                  title={t("groups.promote_admin")}
                                >
                                  {t("groups.admin")}
                                </button>
                              )}
                              {isOwner && memberRole === "admin" && (
                                <button
                                  onClick={() => handleSetRole(group.id, m.userId, "member")}
                                  className="text-xs px-1.5 py-0.5 rounded font-bold"
                                  style={{ background: "var(--bg-card)", color: "var(--text-gray)", fontSize: 10 }}
                                  title={t("groups.demote_member")}
                                >
                                  {t("groups.demote_member")}
                                </button>
                              )}
                              {((isOwner) || (isAdmin && memberRole === "member")) && (
                                <button
                                  onClick={() => handleKickMember(group.id, m.userId)}
                                  className="text-xs px-1.5 py-0.5 rounded font-bold"
                                  style={{ background: "var(--accent-red)", color: "#fff", fontSize: 10 }}
                                  title={t("groups.kick")}
                                >
                                  {t("groups.kick")}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {!isOwner && (
                      <button
                        onClick={() => handleLeaveGroup(group.id)}
                        className="cartoon-btn flex-1 py-2 text-xs"
                        style={{ background: "var(--accent-orange)", color: "#fff" }}
                      >
                        {t("groups.leave")}
                      </button>
                    )}
                    {isOwner && (
                      <button
                        onClick={() => setConfirmAction({
                          message: t("groups.delete") + " ?",
                          onConfirm: () => { handleDeleteGroup(group.id); setConfirmAction(null); setModal(null); },
                        })}
                        className="cartoon-btn flex-1 py-2 text-xs"
                        style={{ background: "var(--accent-red)", color: "#fff" }}
                      >
                        {t("groups.delete")}
                      </button>
                    )}
                    <button onClick={() => setModal(null)} className="cartoon-btn flex-1 py-2 text-xs" style={{ background: "var(--bg-input)", color: "var(--text-gray)" }}>
                      {t("general.close")}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Friend context menu */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
        >
          <div
            className="absolute cartoon-card py-1"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
              minWidth: 160,
              boxShadow: "var(--shadow-cartoon)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setConfirmAction({
                  message: `${t("friends.remove")} ${contextMenu.friendName} ?`,
                  onConfirm: () => { handleRemoveFriend(contextMenu.friendId); setConfirmAction(null); },
                });
                setContextMenu(null);
              }}
              className="w-full text-left px-4 py-2 text-xs hover:opacity-80 flex items-center gap-2"
              style={{ color: "var(--accent-red)" }}
            >
              <Icons.Trash size={12} /> {t("friends.remove")}
            </button>
          </div>
        </div>
      )}

      {/* Invite link modal */}
      {inviteLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setInviteLinkModal(false)}>
          <div className="cartoon-card p-6 w-full" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-cartoon text-base mb-4 text-center" style={{ color: "var(--accent-cyan)" }}>
              {t("friends.paste_link")}
            </h3>
            <input
              value={inviteLinkInput}
              onChange={(e) => setInviteLinkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && inviteLinkInput.trim()) {
                  handleInviteLink(inviteLinkInput.trim());
                  setInviteLinkInput("");
                  setInviteLinkModal(false);
                }
              }}
              placeholder="shitpost://friend/... or shitpost://group/..."
              className="cartoon-input w-full mb-4 text-sm"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (inviteLinkInput.trim()) {
                    handleInviteLink(inviteLinkInput.trim());
                    setInviteLinkInput("");
                    setInviteLinkModal(false);
                  }
                }}
                className="cartoon-btn flex-1 py-2.5 text-sm"
                style={{ background: "var(--accent-cyan)", color: "#000" }}
              >
                {t("general.confirm")}
              </button>
              <button
                onClick={() => setInviteLinkModal(false)}
                className="cartoon-btn flex-1 py-2.5 text-sm"
                style={{ background: "var(--bg-input)", color: "var(--text-gray)" }}
              >
                {t("general.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="cartoon-card p-6 w-full" style={{ maxWidth: 360 }}>
            <p className="font-bold text-center mb-4">{confirmAction.message}</p>
            <div className="flex gap-2">
              <button
                onClick={confirmAction.onConfirm}
                className="cartoon-btn flex-1 py-2.5 text-sm"
                style={{ background: "var(--accent-red)", color: "#fff" }}
              >
                {t("general.confirm")}
              </button>
              <button
                onClick={() => setConfirmAction(null)}
                className="cartoon-btn flex-1 py-2.5 text-sm"
                style={{ background: "var(--bg-input)", color: "var(--text-gray)" }}
              >
                {t("general.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content - no page scroll, everything fits */}
      <main className="flex-1 flex overflow-hidden p-4 pt-0 gap-4">
        {/* Left - Content area */}
        <div className="flex-1 flex flex-col overflow-hidden gap-4">
          {activeTab === "media" && (
            <div className="cartoon-card p-4 flex-1 flex flex-row gap-4 overflow-hidden min-h-0">
              {/* Left: Preview */}
              <div
                className={`flex flex-col items-center justify-center rounded-2xl overflow-hidden min-h-0 min-w-0 ${isDragging ? "dragging" : ""}`}
                style={{ flex: "1 1 50%", background: "var(--bg-input)", border: "2px dashed var(--border-card)" }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
                onDragLeave={(e) => { e.stopPropagation(); setIsDragging(false); }}
                onDrop={(e) => { e.stopPropagation(); handleDrop(e); }}
              >
                {previewUrl ? (
                  <div className="relative w-full" style={{ flex: "1 1 0%", minHeight: 0 }}>
                    {mediaData?.type === "image" ? (
                      <img src={previewUrl} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
                    ) : (
                      <video
                        ref={(el) => {
                          (previewVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
                          if (el) el.volume = memeVolume / 100;
                        }}
                        src={previewUrl}
                        autoPlay
                        muted={previewMuted}
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
                        onLoadedMetadata={() => {
                          if (previewVideoRef.current && trimStart > 0) {
                            previewVideoRef.current.currentTime = trimStart;
                          }
                        }}
                        onTimeUpdate={() => {
                          const v = previewVideoRef.current;
                          if (v && trimEnd > 0 && v.currentTime >= trimEnd) {
                            v.currentTime = trimStart;
                            v.play();
                          }
                        }}
                      />
                    )}
                    {/* Text overlay preview (for videos, or images in "around" mode) */}
                    {(mediaData?.type === "video" || textPosition === "around") && (textData.topText || textData.bottomText) && (
                      <>
                        {textData.topText && (
                          <div style={{
                            position: "absolute", top: 8, left: 0, right: 0, textAlign: "center", zIndex: 1,
                            fontSize: textSize * 0.45, fontWeight: 900, fontFamily: "'Impact', 'Charcoal', sans-serif",
                            color: "#fff", letterSpacing: 1,
                            textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000",
                            pointerEvents: "none",
                          }}>
                            {textData.topText.toUpperCase()}
                          </div>
                        )}
                        {textData.bottomText && (
                          <div style={{
                            position: "absolute", bottom: 8, left: 0, right: 0, textAlign: "center", zIndex: 1,
                            fontSize: textSize * 0.45, fontWeight: 900, fontFamily: "'Impact', 'Charcoal', sans-serif",
                            color: "#fff", letterSpacing: 1,
                            textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000",
                            pointerEvents: "none",
                          }}>
                            {textData.bottomText.toUpperCase()}
                          </div>
                        )}
                      </>
                    )}
                    {mediaData?.type === "video" && (
                      <button
                        onClick={() => setPreviewMuted((m) => !m)}
                        className="absolute top-2 left-2 w-7 h-7 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(0,0,0,0.7)", border: "2px solid rgba(255,255,255,0.3)", zIndex: 2, pointerEvents: "auto", cursor: "pointer" }}
                      >
                        {previewMuted ? <Icons.Muted size={14} className="text-white" /> : <Icons.Volume size={14} className="text-white" />}
                      </button>
                    )}
                    <button
                      onClick={() => { setMediaData(null); setAudioData(null); setTextData({ topText: "", bottomText: "" }); setPreviewMuted(true); }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ background: "var(--accent-red)", border: "2px solid #000", boxShadow: "var(--shadow-cartoon-sm)", zIndex: 2 }}
                    >
                      <Icons.Close size={14} className="text-white" />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center p-4">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 animate-float"
                      style={{ background: "var(--bg-card)", border: "3px solid var(--border-card)" }}
                    >
                      <Icons.Upload size={28} style={{ color: "var(--text-muted)" }} />
                    </div>
                    <p className="font-bold text-sm mb-1" style={{ color: "var(--text-gray)" }}>
                      {t("media.drop_here")}
                    </p>
                    <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept="image/*,video/*" />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="cartoon-btn px-5 py-2 text-sm"
                      style={{ background: "var(--accent-cyan)", color: "#000" }}
                    >
                      {t("media.choose_file")}
                    </button>
                  </div>
                )}
              </div>

              {/* Right: Controls */}
              <div className="flex flex-col gap-3 min-w-0" style={{ flex: "0 0 260px" }}>
                <h2 className="font-cartoon text-base flex items-center gap-2" style={{ color: "var(--accent-pink)" }}>
                  <Icons.Media size={18} /> {t("media.your_shitpost")}
                </h2>

                {/* Text inputs */}
                <div>
                  <label className="text-xs font-bold mb-1 block" style={{ color: "var(--text-muted)" }}>{t("media.top_text").toUpperCase()}</label>
                  <input
                    type="text"
                    value={textData.topText}
                    onChange={(e) => setTextData((p) => ({ ...p, topText: e.target.value }))}
                    className="cartoon-input w-full text-xs py-1.5"
                    placeholder="IMPACT TEXT..."
                  />
                </div>
                <div>
                  <label className="text-xs font-bold mb-1 block" style={{ color: "var(--text-muted)" }}>{t("media.bottom_text").toUpperCase()}</label>
                  <input
                    type="text"
                    value={textData.bottomText}
                    onChange={(e) => setTextData((p) => ({ ...p, bottomText: e.target.value }))}
                    className="cartoon-input w-full text-xs py-1.5"
                    placeholder="BOTTOM TEXT..."
                  />
                </div>

                {/* Text position */}
                {(textData.topText || textData.bottomText) && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => setTextPosition("on")}
                      className="cartoon-btn px-3 py-1 text-xs flex-1"
                      style={{
                        background: textPosition === "on" ? "var(--accent-yellow)" : "var(--bg-input)",
                        color: textPosition === "on" ? "#000" : "var(--text-gray)",
                        borderColor: textPosition === "on" ? "#000" : "var(--border-card)",
                      }}
                    >
                      {t("media.text_on")}
                    </button>
                    <button
                      onClick={() => setTextPosition("around")}
                      className="cartoon-btn px-3 py-1 text-xs flex-1"
                      style={{
                        background: textPosition === "around" ? "var(--accent-cyan)" : "var(--bg-input)",
                        color: textPosition === "around" ? "#000" : "var(--text-gray)",
                        borderColor: textPosition === "around" ? "#000" : "var(--border-card)",
                      }}
                    >
                      {t("media.text_around")}
                    </button>
                  </div>
                )}

                {/* Text size */}
                {(textData.topText || textData.bottomText) && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold" style={{ color: "var(--text-muted)" }}>{t("media.text_size").toUpperCase()}</label>
                      <span className="text-xs font-bold" style={{ color: "var(--text-gray)" }}>{textSize}px</span>
                    </div>
                    <input
                      type="range"
                      min={16}
                      max={120}
                      step={2}
                      value={textSize}
                      onChange={(e) => setTextSize(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>
                )}

                {/* Audio */}
                {mediaData?.type === "image" && (
                  <div>
                    <input ref={audioInputRef} type="file" className="hidden" onChange={handleAudioUpload} accept="audio/*" />
                    <button
                      onClick={() => audioInputRef.current?.click()}
                      className="cartoon-btn w-full px-3 py-1.5 text-xs flex items-center justify-center gap-1.5"
                      style={{ background: "var(--accent-purple)", color: "#fff" }}
                    >
                      <Icons.Music size={13} />
                      {audioData ? audioData.name : t("media.choose_audio")}
                    </button>
                    {audioData && (
                      <button
                        onClick={() => setAudioData(null)}
                        className="cartoon-btn w-full px-3 py-1 text-xs mt-1"
                        style={{ background: "var(--bg-input)", color: "var(--accent-red)" }}
                      >
                        {t("media.remove_audio")}
                      </button>
                    )}
                  </div>
                )}

                {/* Video Trim */}
                {mediaData?.type === "video" && videoDuration > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                        <Icons.Clock size={13} /> DECOUPE
                      </label>
                      <span
                        className="cartoon-badge text-xs"
                        style={{ background: "var(--accent-cyan)", color: "#000", borderColor: "#000", padding: "1px 8px" }}
                      >
                        {trimStart.toFixed(1)}s → {trimEnd.toFixed(1)}s ({(trimEnd - trimStart).toFixed(1)}s)
                      </span>
                    </div>
                    <div
                      className="relative rounded-lg"
                      style={{ height: 32, background: "var(--bg-input)", border: "2px solid var(--border-card)", cursor: "default", userSelect: "none" }}
                      onMouseDown={(e) => {
                        const track = e.currentTarget;
                        const rect = track.getBoundingClientRect();
                        const pxToTime = (px: number) => Math.max(0, Math.min(videoDuration, (px / rect.width) * videoDuration));
                        const clickTime = pxToTime(e.clientX - rect.left);
                        const startPx = (trimStart / videoDuration) * rect.width;
                        const endPx = (trimEnd / videoDuration) * rect.width;
                        const mouseX = e.clientX - rect.left;

                        const HANDLE_ZONE = 12;
                        let mode: "start" | "end" | "move";
                        if (Math.abs(mouseX - startPx) <= HANDLE_ZONE) {
                          mode = "start";
                        } else if (Math.abs(mouseX - endPx) <= HANDLE_ZONE) {
                          mode = "end";
                        } else if (mouseX > startPx && mouseX < endPx) {
                          mode = "move";
                        } else {
                          // Click outside: snap nearest handle
                          mode = Math.abs(clickTime - trimStart) < Math.abs(clickTime - trimEnd) ? "start" : "end";
                        }

                        const clipLen = trimEnd - trimStart;
                        const moveOffset = clickTime - trimStart;

                        const onMove = (ev: MouseEvent) => {
                          const t = pxToTime(ev.clientX - rect.left);
                          const maxClip = TIMEOUT_LIMITS.maxVideo / 1000;
                          if (mode === "start") {
                            const v = Math.max(0, Math.min(t, trimEnd - 0.5));
                            const newEnd = trimEnd;
                            if (newEnd - v > maxClip) return;
                            setTrimStart(v);
                            setTimeoutMs(Math.min(Math.round((newEnd - v) * 1000), TIMEOUT_LIMITS.maxVideo));
                            if (previewVideoRef.current) previewVideoRef.current.currentTime = v;
                          } else if (mode === "end") {
                            const v = Math.min(videoDuration, Math.max(t, trimStart + 0.5));
                            const clamped = Math.min(v, trimStart + maxClip);
                            setTrimEnd(clamped);
                            setTimeoutMs(Math.min(Math.round((clamped - trimStart) * 1000), TIMEOUT_LIMITS.maxVideo));
                            if (previewVideoRef.current) previewVideoRef.current.currentTime = Math.max(clamped - 0.3, trimStart);
                          } else {
                            // Move both handles keeping same clip length
                            let newStart = t - moveOffset;
                            newStart = Math.max(0, Math.min(newStart, videoDuration - clipLen));
                            setTrimStart(newStart);
                            setTrimEnd(newStart + clipLen);
                            if (previewVideoRef.current) previewVideoRef.current.currentTime = newStart;
                          }
                        };

                        const onUp = () => {
                          window.removeEventListener("mousemove", onMove);
                          window.removeEventListener("mouseup", onUp);
                        };

                        window.addEventListener("mousemove", onMove);
                        window.addEventListener("mouseup", onUp);
                        onMove(e.nativeEvent);
                      }}
                    >
                      {/* Inactive zone left */}
                      <div
                        className="absolute top-0 bottom-0 left-0 rounded-l-md"
                        style={{
                          width: `${(trimStart / videoDuration) * 100}%`,
                          background: "rgba(0,0,0,0.35)",
                        }}
                      />
                      {/* Active zone */}
                      <div
                        className="absolute top-0 bottom-0"
                        style={{
                          left: `${(trimStart / videoDuration) * 100}%`,
                          width: `${((trimEnd - trimStart) / videoDuration) * 100}%`,
                          background: "var(--accent-cyan)",
                          opacity: 0.3,
                          cursor: "grab",
                        }}
                      />
                      {/* Inactive zone right */}
                      <div
                        className="absolute top-0 bottom-0 right-0 rounded-r-md"
                        style={{
                          width: `${((videoDuration - trimEnd) / videoDuration) * 100}%`,
                          background: "rgba(0,0,0,0.35)",
                        }}
                      />
                      {/* Start handle */}
                      <div
                        className="absolute top-0 bottom-0 flex items-center justify-center"
                        style={{
                          left: `${(trimStart / videoDuration) * 100}%`,
                          transform: "translateX(-50%)",
                          width: 14,
                          cursor: "ew-resize",
                          zIndex: 4,
                        }}
                      >
                        <div style={{ width: 4, height: 18, borderRadius: 2, background: "var(--accent-cyan)", border: "1px solid #000" }} />
                      </div>
                      {/* End handle */}
                      <div
                        className="absolute top-0 bottom-0 flex items-center justify-center"
                        style={{
                          left: `${(trimEnd / videoDuration) * 100}%`,
                          transform: "translateX(-50%)",
                          width: 14,
                          cursor: "ew-resize",
                          zIndex: 4,
                        }}
                      >
                        <div style={{ width: 4, height: 18, borderRadius: 2, background: "var(--accent-pink)", border: "1px solid #000" }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Duration (images only) */}
                {mediaData?.type !== "video" && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                        <Icons.Clock size={13} /> {t("media.duration").toUpperCase()}
                      </label>
                      <span
                        className="cartoon-badge text-xs"
                        style={{ background: "var(--accent-yellow)", color: "#000", borderColor: "#000", padding: "1px 8px" }}
                      >
                        {(timeoutMs / 1000).toFixed(1)}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={TIMEOUT_LIMITS.min}
                      max={TIMEOUT_LIMITS.maxImage}
                      step={TIMEOUT_LIMITS.step}
                      value={Math.min(timeoutMs, TIMEOUT_LIMITS.maxImage)}
                      onChange={(e) => setTimeoutMs(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>
                )}

                {/* Send */}
                <button
                  onClick={handleSend}
                  disabled={selectedTargets.length === 0 || !mediaData || compressing}
                  className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2 mt-auto"
                  style={{
                    background: compressing
                      ? "linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))"
                      : "linear-gradient(135deg, var(--accent-pink), var(--accent-orange))",
                    color: "#fff",
                  }}
                >
                  {compressing ? (
                    <>{t("media.compress")} {compressProgress}%</>
                  ) : (
                    <>
                      <Icons.Send size={16} />
                      {t("media.send")} ({selectedTargets.length})
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {activeTab === "memes" && (
            <MemesTab
              t={t}
              onStatus={(msg) => {
                setSendStatus(msg);
                setTimeout(() => setSendStatus(null), 2000);
              }}
              onSelectMeme={(dataUrl, mimeType, isVideo) => {
                setMediaData({ type: isVideo ? "video" : "image", data: dataUrl, mimeType });
                setAudioData(null);
                setTextData({ topText: "", bottomText: "" });
                setPreviewMuted(true);
                if (isVideo) {
                  const v = document.createElement("video");
                  v.src = dataUrl;
                  v.onloadedmetadata = () => {
                    const dur = v.duration;
                    setVideoDuration(dur);
                    setTrimStart(0);
                    const maxTrim = Math.min(dur, TIMEOUT_LIMITS.maxVideo / 1000);
                    setTrimEnd(maxTrim);
                    setTimeoutMs(Math.round(maxTrim * 1000));
                  };
                } else {
                  setVideoDuration(0);
                  setTrimStart(0);
                  setTrimEnd(0);
                }
                setActiveTab("media");
              }}
            />
          )}

          {activeTab === "history" && (
            <HistoryTab
              t={t}
              onStatus={(msg) => {
                setSendStatus(msg);
                setTimeout(() => setSendStatus(null), 2000);
              }}
              onSelectMeme={(dataUrl, mimeType, isVideo) => {
                setMediaData({ type: isVideo ? "video" : "image", data: dataUrl, mimeType });
                setAudioData(null);
                setTextData({ topText: "", bottomText: "" });
                setPreviewMuted(true);
                if (isVideo) {
                  const v = document.createElement("video");
                  v.src = dataUrl;
                  v.onloadedmetadata = () => {
                    const dur = v.duration;
                    setVideoDuration(dur);
                    setTrimStart(0);
                    const maxTrim = Math.min(dur, TIMEOUT_LIMITS.maxVideo / 1000);
                    setTrimEnd(maxTrim);
                    setTimeoutMs(Math.round(maxTrim * 1000));
                  };
                } else {
                  setVideoDuration(0);
                  setTrimStart(0);
                  setTrimEnd(0);
                }
                setActiveTab("media");
              }}
            />
          )}

          {activeTab === "social" && (
            <div className="flex-1 flex flex-col gap-4 overflow-hidden">
              {/* Add friend */}
              <div className="cartoon-card p-4 flex-shrink-0">
                <h2 className="font-cartoon text-base mb-3 flex items-center gap-2" style={{ color: "var(--accent-cyan)" }}>
                  <Icons.Users size={18} /> {t("friends.add")}
                </h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendFriendRequest()}
                    placeholder={t("friends.username_placeholder")}
                    className="cartoon-input flex-1"
                  />
                  <button
                    onClick={handleSendFriendRequest}
                    className="cartoon-btn px-5"
                    style={{ background: "var(--accent-cyan)", color: "#000" }}
                  >
                    {t("friends.send")}
                  </button>
                </div>
                {/* Copy & paste invite links */}
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`shitpost://friend/${user?.username}`);
                      setSendStatus(t("friends.link_copied"));
                      setTimeout(() => setSendStatus(null), 2000);
                    }}
                    className="cartoon-btn flex-1 py-1.5 text-xs"
                    style={{ background: "var(--bg-input)", fontSize: 11 }}
                  >
                    <Icons.Link size={12} className="inline mr-1" /> {t("friends.copy_link")}
                  </button>
                  <button
                    onClick={() => { setInviteLinkInput(""); setInviteLinkModal(true); }}
                    className="cartoon-btn flex-1 py-1.5 text-xs"
                    style={{ background: "var(--bg-input)", fontSize: 11 }}
                  >
                    <Icons.Download size={12} className="inline mr-1" /> {t("friends.paste_link")}
                  </button>
                </div>
              </div>

              {/* Scrollable content for pending + groups */}
              <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
                {/* Pending requests */}
                {pendingRequests.length > 0 && (
                  <div className="cartoon-card p-4" style={{ borderColor: "var(--accent-orange)" }}>
                    <h3 className="font-cartoon text-sm mb-3" style={{ color: "var(--accent-orange)" }}>
                      {t("friends.pending").toUpperCase()} ({pendingRequests.length})
                    </h3>
                    <div className="space-y-2">
                      {pendingRequests.map((req) => (
                        <div key={req.id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: "var(--bg-input)" }}>
                          <div className="flex items-center gap-3">
                            <div className="cartoon-avatar" style={{ background: getAvatarColor(req.requester?.username || req.sender?.username || ""), width: 32, height: 32, fontSize: 12 }}>
                              {(req.requester?.username || req.sender?.username)?.[0]?.toUpperCase()}
                            </div>
                            <span className="font-bold text-sm">{req.requester?.username || req.sender?.username}</span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAcceptFriend(req.id)}
                              className="cartoon-btn px-3 py-1 text-xs"
                              style={{ background: "var(--accent-green)", color: "#000" }}
                            >
                              {t("friends.accept")}
                            </button>
                            <button
                              onClick={() => handleDeclineFriend(req.id)}
                              className="cartoon-btn px-3 py-1 text-xs"
                              style={{ background: "var(--accent-red)", color: "#fff" }}
                            >
                              {t("friends.decline")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Group invites */}
                {groupInvites.length > 0 && (
                  <div className="cartoon-card p-4" style={{ borderColor: "var(--accent-purple)" }}>
                    <h3 className="font-cartoon text-sm mb-3" style={{ color: "var(--accent-purple)" }}>
                      {t("groups.invites").toUpperCase()} ({groupInvites.length})
                    </h3>
                    <div className="space-y-2">
                      {groupInvites.map((inv: any) => (
                        <div key={inv.id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: "var(--bg-input)" }}>
                          <div className="min-w-0">
                            <span className="font-bold text-sm">{inv.group?.name}</span>
                            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                              {t("groups.invited_by")} {inv.inviter?.username}
                            </p>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <button
                              onClick={() => handleAcceptGroupInvite(inv.id)}
                              className="cartoon-btn px-3 py-1 text-xs"
                              style={{ background: "var(--accent-green)", color: "#000" }}
                            >
                              {t("friends.accept")}
                            </button>
                            <button
                              onClick={() => handleDeclineGroupInvite(inv.id)}
                              className="cartoon-btn px-3 py-1 text-xs"
                              style={{ background: "var(--accent-red)", color: "#fff" }}
                            >
                              {t("friends.decline")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Groups */}
                <div className="cartoon-card p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-cartoon text-base flex items-center gap-2" style={{ color: "var(--accent-purple)" }}>
                      <Icons.Broadcast size={18} /> {t("sidebar.groups")}
                    </h2>
                    <button
                      onClick={handleCreateGroup}
                      className="cartoon-btn px-4 py-1 text-xs"
                      style={{ background: "var(--accent-purple)", color: "#fff" }}
                    >
                      + {t("groups.create")}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {groups.map((g) => {
                      const myRole = getMyRole(g);
                      return (
                        <div key={g.id} className="p-4 rounded-xl" style={{ background: "var(--bg-input)", border: "2px solid var(--border-card)" }}>
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold">{g.name}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{
                                background: myRole === "owner" ? "var(--accent-yellow)" : myRole === "admin" ? "var(--accent-cyan)" : "var(--bg-card)",
                                color: myRole === "owner" || myRole === "admin" ? "#000" : "var(--text-gray)",
                                fontSize: 10,
                              }}>
                                {myRole === "owner" ? t("groups.owner") : myRole === "admin" ? t("groups.admin") : t("groups.member")}
                              </span>
                            </div>
                            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--bg-card)", color: "var(--text-gray)" }}>
                              {g.members?.length || 0}
                            </span>
                          </div>
                          <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
                            {g.members?.map((m: any) => {
                              const badge = m.role === "owner" ? " (owner)" : m.role === "admin" ? " (admin)" : "";
                              return (m.user?.username || "") + badge;
                            }).filter(Boolean).join(", ") || t("groups.no_groups")}
                          </div>
                          <div className="flex gap-2">
                            {(myRole === "owner" || myRole === "admin") && (
                              <button
                                onClick={() => handleAddMember(g.id)}
                                className="text-xs font-bold" style={{ color: "var(--accent-cyan)" }}
                              >
                                + {t("groups.add_member")}
                              </button>
                            )}
                            <button
                              onClick={() => handleManageGroup(g.id)}
                              className="text-xs font-bold" style={{ color: "var(--accent-purple)" }}
                            >
                              {t("groups.manage")}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {groups.length === 0 && (
                      <p className="col-span-2 text-center py-6 text-sm" style={{ color: "var(--text-muted)" }}>
                        {t("groups.no_groups")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "settings" && (
            <div className="cartoon-card p-5 flex-1 overflow-y-auto space-y-4">
              <h2 className="font-cartoon text-xl" style={{ color: "var(--accent-yellow)" }}>
                {t("settings.title")}
              </h2>
              <div className="p-4 rounded-xl" style={{ background: "var(--bg-input)", border: "2px solid var(--border-card)" }}>
                <p className="text-xs font-bold mb-1" style={{ color: "var(--text-muted)" }}>{t("settings.username").toUpperCase()}</p>
                <p className="font-bold">{user?.username}</p>
              </div>
              <div className="p-4 rounded-xl" style={{ background: "var(--bg-input)", border: "2px solid var(--border-card)" }}>
                <p className="text-xs font-bold mb-1" style={{ color: "var(--text-muted)" }}>{t("settings.user_id").toUpperCase()}</p>
                <code className="text-xs" style={{ color: "var(--accent-cyan)" }}>{user?.id}</code>
              </div>
              <div className="p-4 rounded-xl" style={{ background: "var(--bg-input)", border: "2px solid var(--border-card)" }}>
                <p className="text-xs font-bold mb-1" style={{ color: "var(--text-muted)" }}>{t("settings.server").toUpperCase()}</p>
                {serverModal ? (
                  <div className="space-y-2">
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("settings.server_url").toUpperCase()}</p>
                    <input
                      type="text"
                      value={serverUrlInput}
                      onChange={(e) => setServerUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && serverUrlInput.trim()) {
                          setServerUrl(serverUrlInput.trim());
                          window.location.reload();
                        }
                      }}
                      placeholder={t("settings.server_url_placeholder")}
                      className="cartoon-input w-full text-xs"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (serverUrlInput.trim()) {
                            setServerUrl(serverUrlInput.trim());
                            window.location.reload();
                          }
                        }}
                        className="cartoon-btn flex-1 py-1.5 text-xs"
                        style={{ background: "var(--accent-green)", color: "#000" }}
                      >
                        {t("settings.server_connect")}
                      </button>
                      <button
                        onClick={() => setServerModal(false)}
                        className="cartoon-btn flex-1 py-1.5 text-xs"
                        style={{ background: "var(--bg-card)" }}
                      >
                        {t("general.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <code className="text-xs flex-1" style={{ color: "var(--accent-cyan)" }}>{getServerUrl()}</code>
                    <button
                      className="cartoon-btn text-xs px-3 py-1"
                      style={{ background: "var(--accent-purple)", color: "#fff", fontSize: 11 }}
                      onClick={() => { setServerUrlInput(getServerUrl()); setServerModal(true); }}
                    >
                      {t("settings.server_edit")}
                    </button>
                  </div>
                )}
              </div>
              <div className="p-4 rounded-xl" style={{ background: "var(--bg-input)", border: "2px solid var(--border-card)" }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                    <Icons.Volume size={14} /> {t("settings.volume").toUpperCase()}
                  </p>
                  <span
                    className="cartoon-badge"
                    style={{ background: "var(--accent-purple)", color: "#fff", borderColor: "#000", fontSize: 12, padding: "2px 10px" }}
                  >
                    {memeVolume}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={memeVolume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setMemeVolume(v);
                    localStorage.setItem("memeVolume", String(v));
                  }}
                  className="w-full"
                />
                <div className="flex justify-between text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  <span>{t("settings.mute")}</span>
                  <span>{t("settings.max")}</span>
                </div>
              </div>
              {monitors.length > 1 && (
                <div className="p-4 rounded-xl" style={{ background: "var(--bg-input)", border: "2px solid var(--border-card)" }}>
                  <p className="text-xs font-bold mb-2" style={{ color: "var(--text-muted)" }}>
                    {t("settings.overlay_screen").toUpperCase()}
                  </p>
                  <div className="flex gap-2">
                    {monitors.map((m, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setSelectedMonitor(i);
                          localStorage.setItem("overlayMonitor", String(i));
                          const invoke = (window as any).__TAURI__?.core?.invoke;
                          if (invoke) {
                            invoke("set_overlay_monitor", { x: m.x, y: m.y, width: m.width, height: m.height }).catch(() => {});
                          }
                        }}
                        className="cartoon-btn px-3 py-2 text-xs font-bold flex-1"
                        style={{
                          background: selectedMonitor === i ? "var(--accent-cyan)" : "var(--bg-card)",
                          color: selectedMonitor === i ? "#000" : "var(--text-muted)",
                        }}
                      >
                        <div>{m.name}</div>
                        <div style={{ fontSize: 10 }}>{m.width}x{m.height}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div
                className="p-4 rounded-xl flex items-center justify-between"
                style={{ background: "var(--bg-input)", border: "2px solid var(--border-card)" }}
              >
                <div>
                  <p className="text-xs font-bold flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                    <Icons.Settings size={14} /> {t("settings.autostart").toUpperCase()}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {t("settings.autostart")}
                  </p>
                </div>
                <button
                  onClick={() => {
                    const newVal = !autostart;
                    const invoke = (window as any).__TAURI__?.core?.invoke;
                    if (invoke) {
                      invoke("set_autostart", { enabled: newVal }).then(() => setAutostart(newVal)).catch(() => {});
                    }
                  }}
                  className="relative rounded-full transition-colors"
                  style={{
                    width: 44, height: 24, flexShrink: 0,
                    background: autostart ? "var(--accent-green)" : "var(--bg-card)",
                    border: "2px solid #000",
                  }}
                >
                  <div
                    className="absolute top-0.5 rounded-full transition-all"
                    style={{
                      width: 16, height: 16,
                      background: "#fff",
                      border: "2px solid #000",
                      left: autostart ? 22 : 2,
                    }}
                  />
                </button>
              </div>
              <div
                className="p-4 rounded-xl flex items-center justify-between"
                style={{ background: "var(--bg-input)", border: "2px solid var(--border-card)" }}
              >
                <p className="text-xs font-bold" style={{ color: "var(--text-muted)" }}>
                  {t("settings.language").toUpperCase()}
                </p>
                <div className="flex gap-1">
                  {(["fr", "en"] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className="cartoon-btn px-3 py-1 text-xs font-bold"
                      style={lang === l
                        ? { background: "var(--accent-cyan)", color: "#000" }
                        : { background: "var(--bg-card)" }
                      }
                    >
                      {l.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => { logout(); navigate("/login"); }}
                className="cartoon-btn w-full py-3 flex items-center justify-center gap-2"
                style={{ background: "var(--accent-red)", color: "#fff" }}
              >
                <Icons.Trash size={18} /> {t("sidebar.logout")}
              </button>
            </div>
          )}
        </div>

        {/* Right Sidebar - Targets card */}
        <div className="hidden lg:flex flex-col flex-shrink-0" style={{ width: 260 }}>
          <div className="cartoon-card p-4 flex flex-col flex-1 overflow-hidden">
            <h2 className="font-cartoon text-base mb-1 flex items-center gap-2 flex-shrink-0" style={{ color: "var(--accent-cyan)" }}>
              <Icons.Users size={18} /> {t("sidebar.friends")}
            </h2>
            <p className="text-xs mb-3 flex-shrink-0" style={{ color: "var(--text-muted)" }}>
              {onlineCount} {t("friends.online").toLowerCase()}
            </p>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
              {/* Groups */}
              {groups.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                    {t("sidebar.groups")}
                  </h3>
                  <div className="space-y-1">
                    {groups.map((group) => {
                      const memberIds = group.members?.map((m: any) => m.userId).filter((id: string) => id !== user?.id) || [];
                      const allSelected = memberIds.length > 0 && memberIds.every((id: string) => selectedTargets.includes(id));
                      return (
                        <div
                          key={group.id}
                          onClick={() => handleSelectGroup(group.id)}
                          className={`friend-item ${allSelected ? "selected" : ""}`}
                        >
                          <div
                            className="w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0 font-cartoon font-bold text-xs"
                            style={{
                              background: allSelected ? "var(--accent-purple)" : "rgba(184,84,212,0.15)",
                              color: allSelected ? "#fff" : "var(--accent-purple)",
                              border: "2px solid #000",
                            }}
                          >
                            {group.name[0].toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold truncate">{group.name}</p>
                          </div>
                          <span
                            className="text-xs font-bold px-2 py-0.5 rounded-lg flex-shrink-0"
                            style={{
                              background: allSelected ? "var(--accent-purple)" : "var(--bg-input)",
                              color: allSelected ? "#fff" : "var(--text-muted)",
                              border: "2px solid var(--border-card)",
                              fontSize: 10,
                            }}
                          >
                            {allSelected ? t("general.all") : t("general.choose")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Friends */}
              <div>
                <h3 className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  {t("sidebar.friends")}
                </h3>
                <div className="space-y-1">
                  {friends.map((friend) => {
                    const isOnline = onlineFriendIds.includes(friend.id);
                    const isSelected = selectedTargets.includes(friend.id);
                    return (
                      <div
                        key={friend.id}
                        onClick={() => handleTargetToggle(friend.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, friendId: friend.id, friendName: friend.username });
                        }}
                        className={`friend-item ${isSelected ? "selected" : ""}`}
                      >
                        <div className="relative">
                          <div
                            className="cartoon-avatar"
                            style={{
                              background: getAvatarColor(friend.username),
                              width: 30,
                              height: 30,
                              fontSize: 12,
                              borderColor: isSelected ? "var(--accent-cyan)" : "#000",
                            }}
                          >
                            {friend.username[0].toUpperCase()}
                          </div>
                          <div
                            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 ${isOnline ? "online-pulse" : ""}`}
                            style={{
                              background: isOnline ? "var(--accent-green)" : "var(--text-muted)",
                              borderColor: "var(--bg-card)",
                            }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold truncate">{friend.username}</p>
                          <p className="text-xs" style={{ color: isOnline ? "var(--accent-green)" : "var(--text-muted)", fontSize: 10 }}>
                            {isOnline ? t("friends.online") : t("friends.offline")}
                          </p>
                        </div>
                        <div
                          className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                          style={{
                            border: `2px solid ${isSelected ? "var(--accent-cyan)" : "var(--border-card)"}`,
                            background: isSelected ? "var(--accent-cyan)" : "transparent",
                          }}
                        >
                          {isSelected && <Icons.Zap size={10} className="text-black" />}
                        </div>
                      </div>
                    );
                  })}
                  {friends.length === 0 && (
                    <p className="text-xs text-center py-3" style={{ color: "var(--text-muted)" }}>
                      {t("friends.no_friends")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainChat />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
