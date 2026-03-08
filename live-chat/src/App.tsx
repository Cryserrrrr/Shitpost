import { useEffect, useRef, useState, useCallback } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import fixWebmDuration from "fix-webm-duration";
import { useAuth } from "./contexts/AuthContext";
import { useLang } from "./contexts/LangContext";
import api, { getServerUrl, setServerUrl, refreshAuthToken } from "./services/api";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import { Icons } from "./components/Icons";
import Titlebar from "./components/Titlebar";
import MemesTab from "./components/MemesTab";
import HistoryTab from "./components/HistoryTab";
import Updater from "./components/Updater";


const TIMEOUT_LIMITS = { min: 1000, maxImage: 10000, maxVideo: 30000, step: 500 } as const;
const SEGMENT_COLORS = ["var(--accent-cyan)", "var(--accent-pink)", "var(--accent-green)", "var(--accent-yellow)", "var(--accent-purple)", "var(--accent-orange)"];
const segColor = (i: number) => SEGMENT_COLORS[i % SEGMENT_COLORS.length];
const totalSegDuration = (segs: { start: number; end: number }[]) => segs.reduce((s, g) => s + (g.end - g.start), 0);
const MAX_FILE_SIZE = { image: 100 * 1024 * 1024, video: 500 * 1024 * 1024, audio: 50 * 1024 * 1024 } as const;
const MAX_DROP_FILES = 50;

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
  type: "image" | "video" | "audio";
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
  const [myInviteCode, setMyInviteCode] = useState<string>("");
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
  const [segments, setSegments] = useState<{ start: number; end: number }[]>([]);
  const [activeSegment, setActiveSegment] = useState(0);
  const [loopCount, setLoopCount] = useState(1);
  const segmentPlayRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [previewMuted, setPreviewMuted] = useState(true);
  const [videoMuteOriginal, setVideoMuteOriginal] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioTrimStart, setAudioTrimStart] = useState(0);
  const [audioTrimEnd, setAudioTrimEnd] = useState(0);
  const [audioOverlayMuted, setAudioOverlayMuted] = useState(false);
  const audioOverlayRef = useRef<HTMLAudioElement>(null);
  const [globalDragging, setGlobalDragging] = useState(false);
  const [dropProgress, setDropProgress] = useState<{ current: number; total: number } | null>(null);
  const [groupInvites, setGroupInvites] = useState<any[]>([]);
  const [serverModal, setServerModal] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState("");
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [dndEnabled, setDndEnabled] = useState(false);
  const [selfDefault, setSelfDefault] = useState(() => localStorage.getItem("selfDefault") === "true");
  const [dndFriendIds, setDndFriendIds] = useState<string[]>([]);
  const [userContextMenu, setUserContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [inviteLinkInput, setInviteLinkInput] = useState("");
  const [inviteLinkModal, setInviteLinkModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; friendId: string; friendName: string } | null>(null);

  // Initialize DND from user status
  useEffect(() => {
    if (user?.status === "dnd") setDndEnabled(true);
  }, [user?.status]);

  const fetchData = useCallback(async () => {
    try {
      const [friendsRes, groupsRes, pendingRes, groupInvitesRes, inviteCodeRes] = await Promise.all([
        api.get("/friends"),
        api.get("/groups"),
        api.get("/friends/pending"),
        api.get("/groups/invites/pending"),
        api.get("/friends/invite-code"),
      ]);
      setFriends(friendsRes.data);
      setGroups(groupsRes.data);
      setPendingRequests(pendingRes.data);
      setGroupInvites(groupInvitesRes.data);
      setMyInviteCode(inviteCodeRes.data.inviteCode);
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
        if (data.status === "online" || data.status === "dnd") {
          return prev.includes(data.userId) ? prev : [...prev, data.userId];
        }
        return prev.filter((id) => id !== data.userId);
      });
      setDndFriendIds((prev) => {
        if (data.status === "dnd") {
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

    newSocket.on("status:dnd_updated", (enabled: boolean) => {
      setDndEnabled(enabled);
    });

    newSocket.on("media:sent", (data: { results: Array<{ targetId: string; delivered: boolean; dnd?: boolean }> }) => {
      const dndCount = data.results?.filter((r) => r.dnd).length ?? 0;
      const offlineCount = data.results?.filter((r) => !r.delivered && !r.dnd).length ?? 0;
      const allDelivered = dndCount === 0 && offlineCount === 0;
      if (allDelivered) {
        setSendStatus(t("media.sent"));
      } else {
        const parts: string[] = [];
        if (offlineCount > 0) parts.push(`${offlineCount} offline`);
        if (dndCount > 0) parts.push(`${dndCount} ${t("settings.dnd").toLowerCase()}`);
        setSendStatus(`${t("media.sent")} (${parts.join(", ")})`);
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

          const lineHeight = fontSize * 1.15;
          if (text.topText) {
            const lines = text.topText.toUpperCase().split("\n");
            lines.forEach((line, i) => {
              const y = fontSize + 10 + i * lineHeight;
              ctx.strokeText(line, canvas.width / 2, y);
              ctx.fillText(line, canvas.width / 2, y);
            });
          }
          if (text.bottomText) {
            const lines = text.bottomText.toUpperCase().split("\n");
            lines.forEach((line, i) => {
              const y = canvas.height - 20 - (lines.length - 1 - i) * lineHeight;
              ctx.strokeText(line, canvas.width / 2, y);
              ctx.fillText(line, canvas.width / 2, y);
            });
          }

          resolve(canvas.toDataURL("image/png", 1.0));
        };
        img.src = media.data;
      });
    },
    [textSize]
  );

  const isGif = mediaData?.mimeType === "image/gif";

  useEffect(() => {
    if (!mediaData) { setPreviewUrl(null); return; }
    if (mediaData.type === "image" && textPosition === "on" && !isGif) {
      createPreview(mediaData, textData).then(setPreviewUrl);
    } else {
      setPreviewUrl(mediaData.data);
    }
  }, [mediaData, textData, textPosition, textSize, createPreview, isGif]);

  // Sync preview video volume with settings
  useEffect(() => {
    if (previewVideoRef.current) previewVideoRef.current.volume = memeVolume / 100;
  }, [memeVolume]);

  // Clamp duration when switching media type
  useEffect(() => {
    const max = mediaData?.type === "video" ? TIMEOUT_LIMITS.maxVideo : TIMEOUT_LIMITS.maxImage;
    setTimeoutMs((prev) => Math.min(prev, max));
  }, [mediaData?.type]);

  // Clamp audio overlay trim when video segments/loop change
  useEffect(() => {
    if (!audioData || !audioDuration) return;
    const maxClip = mediaData?.type === "video" ? totalSegDuration(segments) * loopCount : timeoutMs / 1000;
    if (maxClip > 0) {
      setAudioTrimEnd((prev) => Math.min(prev, maxClip, audioDuration));
      setAudioTrimStart((prev) => Math.min(prev, Math.min(maxClip, audioDuration) - 0.5));
    }
  }, [segments, loopCount, mediaData?.type, timeoutMs, audioData, audioDuration]);

  const loadMediaFile = useCallback((file: File, dataUrl: string) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const VIDEO_FORCE_EXTS = ["webm", "mp4", "mov", "avi", "mkv"];
    const isVideo = file.type.startsWith("video/") || VIDEO_FORCE_EXTS.includes(ext);
    const isAudio = !isVideo && file.type.startsWith("audio/");
    const type = isVideo ? "video" : isAudio ? "audio" : "image";
    setMediaData({ type, data: dataUrl, mimeType: file.type });
    setAudioData(null);
    setPreviewMuted(!isAudio);
    setLoopCount(1);
    setVideoMuteOriginal(false);
    if (isVideo || isAudio) {
      const el = document.createElement(isVideo ? "video" : "audio");
      el.src = dataUrl;
      el.onloadedmetadata = () => {
        const dur = el.duration;
        setVideoDuration(dur);
        const maxTrim = Math.min(dur, TIMEOUT_LIMITS.maxVideo / 1000);
        setSegments([{ start: 0, end: maxTrim }]);
        setActiveSegment(0);
        setTimeoutMs(Math.round(maxTrim * 1000));
      };
    } else {
      setVideoDuration(0);
      setSegments([]);
      setActiveSegment(0);
    }
  }, []);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const maxSize = file.type.startsWith("video/") ? MAX_FILE_SIZE.video : file.type.startsWith("audio/") ? MAX_FILE_SIZE.audio : MAX_FILE_SIZE.image;
      if (file.size > maxSize) {
        setSendStatus(t("media.file_too_large").replace("{max}", String(Math.round(maxSize / 1024 / 1024))));
        setTimeout(() => setSendStatus(null), 3000);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = (re) => loadMediaFile(file, re.target?.result as string);
      reader.readAsDataURL(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [loadMediaFile, t],
  );

  const handleAudioUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE_SIZE.audio) {
        setSendStatus(
          t("media.file_too_large").replace("{max}", String(Math.round(MAX_FILE_SIZE.audio / 1024 / 1024))),
        );
        setTimeout(() => setSendStatus(null), 3000);
        if (audioInputRef.current) audioInputRef.current.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = async (re) => {
        const result = re.target?.result as string;
        const base64 = result.split(",")[1];
        setAudioData({ data: base64, mimeType: file.type, name: file.name });
        setAudioOverlayMuted(previewMuted);
        // Decode to get duration
        try {
          const buf = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
          const ctx = new AudioContext();
          const decoded = await ctx.decodeAudioData(buf);
          const dur = decoded.duration;
          ctx.close();
          setAudioDuration(dur);
          setAudioTrimStart(0);
          const maxClip = mediaData?.type === "video" ? totalSegDuration(segments) * loopCount : timeoutMs / 1000;
          setAudioTrimEnd(Math.min(dur, maxClip));
        } catch { /* fallback: no trim */ }
      };
      reader.readAsDataURL(file);
      if (audioInputRef.current) audioInputRef.current.value = "";
    },
    [t, timeoutMs, mediaData?.type, segments, loopCount, previewMuted],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const dropExt = file.name.split(".").pop()?.toLowerCase() || "";
      const DROP_VID_EXTS = ["webm", "mp4", "mov", "avi", "mkv"];
      const isDropVideo = file.type.startsWith("video/") || DROP_VID_EXTS.includes(dropExt);
      const isDropAudio = !isDropVideo && file.type.startsWith("audio/");
      if (file.type.startsWith("image/") || isDropVideo || isDropAudio) {
        const maxSize = isDropVideo ? MAX_FILE_SIZE.video : isDropAudio ? MAX_FILE_SIZE.audio : MAX_FILE_SIZE.image;
        if (file.size > maxSize) {
          setSendStatus(
            t("media.file_too_large").replace("{max}", String(Math.round(maxSize / 1024 / 1024))),
          );
          setTimeout(() => setSendStatus(null), 3000);
          return;
        }
        const reader = new FileReader();
        reader.onload = (re) => loadMediaFile(file, re.target?.result as string);
        reader.readAsDataURL(file);
      }
    },
    [loadMediaFile, t]
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
          let paths = event.payload.paths.filter(isMedia);
          if (paths.length === 0) return;

          // Limit number of files to prevent crashes
          if (paths.length > MAX_DROP_FILES) {
            setSendStatus(t("media.too_many_files").replace("{max}", String(MAX_DROP_FILES)));
            setTimeout(() => setSendStatus(null), 3000);
            paths = paths.slice(0, MAX_DROP_FILES);
          }

          const memesFolder = localStorage.getItem("memesFolder");
          const { readFile, stat } = await import("@tauri-apps/plugin-fs");
          const { saveToMemesFolder, isFileDuplicateInMemes } = await import("./services/memesUtils");

          // Filter out files that are too large
          const validPaths: string[] = [];
          let skippedLarge = 0;
          for (const p of paths) {
            try {
              const info = await stat(p);
              const maxSize = isVideo(p) ? MAX_FILE_SIZE.video : MAX_FILE_SIZE.image;
              if (info.size > maxSize) {
                skippedLarge++;
              } else {
                validPaths.push(p);
              }
            } catch {
              skippedLarge++;
            }
          }
          if (skippedLarge > 0) {
            setSendStatus(
              t("media.file_too_large").replace("{max}", "500"),
            );
            setTimeout(() => setSendStatus(null), 3000);
          }
          paths = validPaths;
          if (paths.length === 0) return;

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
              // Encode to base64 in chunks to avoid OOM from string concatenation
              const CHUNK = 0x8000;
              const parts: string[] = [];
              for (let i = 0; i < u8.length; i += CHUNK) {
                parts.push(String.fromCharCode(...u8.subarray(i, i + CHUNK)));
              }
              const base64 = btoa(parts.join(""));
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
                  const maxTrim = Math.min(dur, TIMEOUT_LIMITS.maxVideo / 1000);
                  setSegments([{ start: 0, end: maxTrim }]);
                  setActiveSegment(0);
                  setTimeoutMs(Math.round(maxTrim * 1000));
                };
              } else {
                setVideoDuration(0);
                setSegments([]);
                setActiveSegment(0);
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

  const compressVideo = useCallback(async (dataUrl: string, segs: { start: number; end: number }[], muteOriginal = false): Promise<string> => {
    const MAX_WIDTH = 1280;
    const MAX_HEIGHT = 720;

    const blobFromDataUrl = (url: string): Blob => {
      const [header, b64] = url.split(",");
      const mime = header.match(/:(.*?);/)?.[1] || "video/mp4";
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    };

    const sourceBlob = blobFromDataUrl(dataUrl);
    const objectUrl = URL.createObjectURL(sourceBlob);
    const totalDur = totalSegDuration(segs);

    return new Promise((resolve, reject) => {
      const cleanup = () => URL.revokeObjectURL(objectUrl);

      const video = document.createElement("video");
      video.playsInline = true;
      video.muted = true;
      video.volume = 1;
      video.src = objectUrl;

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
        let audioCtx: AudioContext | null = null;
        if (!muteOriginal) {
          try {
            audioCtx = new AudioContext();
            const source = audioCtx.createMediaElementSource(video);
            const dest = audioCtx.createMediaStreamDestination();
            source.connect(dest);
            dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
            // createMediaElementSource takes over audio routing, safe to unmute
            video.muted = false;
          } catch (e) {
            console.warn("[COMPRESS] No audio track captured:", e);
          }
        }

        const bitrate = totalDur > 20 ? 1_000_000 : 2_000_000;
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm";
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });

        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

        recorder.onstop = () => {
          cleanup();
          audioCtx?.close().catch(() => {});
          const rawBlob = new Blob(chunks, { type: "video/webm" });
          chunks.length = 0;
          // Fix WebM duration metadata (MediaRecorder doesn't write it)
          fixWebmDuration(rawBlob, totalDur * 1000).then((fixedBlob) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("Failed to read compressed video"));
            reader.readAsDataURL(fixedBlob);
          });
        };

        recorder.onerror = () => { cleanup(); audioCtx?.close().catch(() => {}); reject(new Error("MediaRecorder error")); };

        let segIdx = 0;
        let elapsed = 0;
        let lastProgress = 0;

        const playSegment = () => {
          if (segIdx >= segs.length) {
            video.pause();
            setTimeout(() => recorder.stop(), 100);
            return;
          }
          const seg = segs[segIdx];
          video.currentTime = seg.start;
          video.onseeked = () => {
            video.onseeked = null;
            video.play().then(() => {
              const drawFrame = () => {
                if (video.paused || video.ended || video.currentTime >= seg.end) {
                  ctx.drawImage(video, 0, 0, w, h);
                  video.pause();
                  elapsed += seg.end - seg.start;
                  segIdx++;
                  playSegment();
                  return;
                }
                ctx.drawImage(video, 0, 0, w, h);
                const progress = Math.round(((elapsed + video.currentTime - seg.start) / totalDur) * 100);
                if (progress !== lastProgress) { lastProgress = progress; setCompressProgress(Math.min(progress, 100)); }
                requestAnimationFrame(drawFrame);
              };
              drawFrame();
            }).catch((err) => { cleanup(); reject(err); });
          };
        };

        recorder.start(1000);
        playSegment();
      };

      video.onerror = () => { cleanup(); reject(new Error("Video load error")); };
    });
  }, []);

  const trimAudio = useCallback(async (dataUrl: string, segs: { start: number; end: number }[]): Promise<string> => {
    const response = await fetch(dataUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioCtx = new AudioContext();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const sampleRate = decoded.sampleRate;
    const numChannels = decoded.numberOfChannels;

    // Render each segment and concatenate
    const renderedBuffers: AudioBuffer[] = [];
    for (const seg of segs) {
      const length = Math.floor((seg.end - seg.start) * sampleRate);
      if (length <= 0) continue;
      const offCtx = new OfflineAudioContext(numChannels, length, sampleRate);
      const src = offCtx.createBufferSource();
      src.buffer = decoded;
      src.connect(offCtx.destination);
      src.start(0, seg.start, seg.end - seg.start);
      renderedBuffers.push(await offCtx.startRendering());
    }
    audioCtx.close();

    const totalSamples = renderedBuffers.reduce((s, b) => s + b.length, 0);
    const bitsPerSample = 16;
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = totalSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (off: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (const rendered of renderedBuffers) {
      for (let i = 0; i < rendered.length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
          const sample = Math.max(-1, Math.min(1, rendered.getChannelData(ch)[i]));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
          offset += 2;
        }
      }
    }

    const blob = new Blob([buffer], { type: "audio/wav" });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read trimmed audio"));
      reader.readAsDataURL(blob);
    });
  }, []);

  const handleSend = useCallback(async () => {
    if (!socketRef.current?.connected || selectedTargets.length === 0 || !mediaData) return;

    const hasText = textData.topText || textData.bottomText;
    let mediaBuffer: string;
    let mimeType = mediaData.mimeType;

    if (mediaData.type === "video") {
      // Compress video before sending — repeat segments for loop
      const loopedSegments: { start: number; end: number }[] = [];
      for (let l = 0; l < loopCount; l++) loopedSegments.push(...segments);
      setCompressing(true);
      setCompressProgress(0);
      try {
        const compressed = await compressVideo(mediaData.data, loopedSegments, videoMuteOriginal);
        mediaBuffer = compressed.split(",")[1];
        mimeType = "video/webm";
      } catch (err) {
        console.error("Video compression failed:", err);
        setSendStatus(t("media.compress_error"));
        setCompressing(false);
        return;
      }
      setCompressing(false);
    } else if (mediaData.type === "audio") {
      // Trim audio before sending — repeat segments for loop
      const loopedAudioSegs: { start: number; end: number }[] = [];
      for (let l = 0; l < loopCount; l++) loopedAudioSegs.push(...segments);
      if (loopedAudioSegs.length > 0) {
        setCompressing(true);
        try {
          const trimmed = await trimAudio(mediaData.data, loopedAudioSegs);
          mediaBuffer = trimmed.split(",")[1];
          mimeType = "audio/wav";
        } catch (err) {
          console.error("Audio trim failed:", err);
          // Fallback: send raw audio without trimming
          mediaBuffer = mediaData.data.split(",")[1];
        }
        setCompressing(false);
      } else {
        mediaBuffer = mediaData.data.split(",")[1];
      }
    } else {
      mediaBuffer = mediaData.data.split(",")[1];
    }

    // Trim audio overlay if present (for images or videos)
    let trimmedAudioOverlay: string | undefined;
    if ((mediaData.type === "image" || mediaData.type === "video") && audioData) {
      try {
        const audioDataUrl = `data:${audioData.mimeType};base64,${audioData.data}`;
        const trimmed = await trimAudio(audioDataUrl, [{ start: audioTrimStart, end: audioTrimEnd }]);
        trimmedAudioOverlay = trimmed.split(",")[1];
      } catch (err) {
        console.error("Audio overlay trim failed:", err);
        trimmedAudioOverlay = audioData.data;
      }
    }

    const finalTargets = selfDefault && user && !selectedTargets.includes(user.id)
      ? [...selectedTargets, user.id]
      : selectedTargets;

    socketRef.current.emit("broadcast_media", {
      targetIds: finalTargets,
      mediaType: mediaData.type,
      mediaBuffer,
      mimeType,
      duration: (mediaData.type === "video" || mediaData.type === "audio") ? Math.round(totalSegDuration(segments) * loopCount * 1000) : timeoutMs,
      textOverlay: hasText ? { ...textData, fontSize: textSize, position: textPosition } : undefined,
      audioBuffer: trimmedAudioOverlay,
      audioMimeType: trimmedAudioOverlay ? "audio/wav" : undefined,
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
  }, [selectedTargets, mediaData, textData, timeoutMs, audioData, audioTrimStart, audioTrimEnd, createPreview, compressVideo, trimAudio, segments, loopCount, videoMuteOriginal]);

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

    // Friend link: shitpost://friend/CODE or raw CODE (hex 8 chars)
    const friendMatch = trimmed.match(/^shitpost:\/\/friend\/(.+)$/) || trimmed.match(/^([A-Fa-f0-9]{8})$/);
    if (friendMatch) {
      const code = friendMatch[1].toUpperCase();
      // Resolve invite code to username before showing confirm
      api.get(`/friends/resolve/${code}`).then((res) => {
        const { username } = res.data;
        if (username === user?.username) return;
        setConfirmAction({
          message: `${t("friends.confirm_add")}\n${username}`,
          onConfirm: async () => {
            try {
              await api.post("/friends/add-direct", { code });
              fetchData();
              setSendStatus(t("friends.request_sent"));
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
        <div
          className="flex items-center gap-1.5 cursor-pointer rounded-lg px-1.5 py-1 hover:opacity-80"
          onContextMenu={(e) => {
            e.preventDefault();
            setUserContextMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <div className="relative">
            <div
              className="cartoon-avatar"
              style={{ background: getAvatarColor(user?.username || ""), width: 24, height: 24, fontSize: 10 }}
            >
              {user?.username?.[0]?.toUpperCase()}
            </div>
            {dndEnabled && (
              <div
                className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                style={{ background: "var(--accent-red)", borderColor: "var(--bg-sidebar)" }}
              />
            )}
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

      {/* User context menu (titlebar) */}
      {userContextMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setUserContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setUserContextMenu(null); }}
        >
          <div
            className="absolute cartoon-card py-1"
            style={{
              left: userContextMenu.x,
              top: userContextMenu.y,
              minWidth: 180,
              boxShadow: "var(--shadow-cartoon)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                const newVal = !dndEnabled;
                socketRef.current?.emit("status:set_dnd", newVal);
                setDndEnabled(newVal);
                setUserContextMenu(null);
              }}
              className="w-full text-left px-4 py-2 text-xs hover:opacity-80 flex items-center gap-2"
              style={{ color: "var(--text-white)" }}
            >
              <Icons.Moon size={12} /> {dndEnabled ? t("settings.dnd_disable") : t("settings.dnd")}
            </button>
            <div style={{ height: 1, background: "var(--border-card)", margin: "2px 8px" }} />
            <button
              onClick={() => {
                setUserContextMenu(null);
                setConfirmAction({
                  message: t("settings.logout_confirm"),
                  onConfirm: () => { logout(); navigate("/login"); setConfirmAction(null); },
                });
              }}
              className="w-full text-left px-4 py-2 text-xs hover:opacity-80 flex items-center gap-2"
              style={{ color: "var(--accent-red)" }}
            >
              <Icons.Trash size={12} /> {t("sidebar.logout")}
            </button>
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
              placeholder="A1B2C3D4 or shitpost://group/..."
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
                      <>
                        <img src={previewUrl} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
                        {audioData && (
                          <>
                            <audio
                              ref={audioOverlayRef}
                              src={`data:${audioData.mimeType};base64,${audioData.data}`}
                              autoPlay
                              loop
                              style={{ display: "none" }}
                              onLoadedMetadata={(e) => {
                                const el = e.currentTarget;
                                el.currentTime = audioTrimStart;
                                el.volume = audioOverlayMuted ? 0 : memeVolume / 100;
                              }}
                              onTimeUpdate={(e) => {
                                const el = e.currentTarget;
                                if (el.currentTime >= audioTrimEnd || el.currentTime < audioTrimStart - 0.5) {
                                  el.currentTime = audioTrimStart;
                                }
                              }}
                            />
                            <button
                              onClick={() => {
                                setAudioOverlayMuted((m) => {
                                  const next = !m;
                                  if (audioOverlayRef.current) audioOverlayRef.current.volume = next ? 0 : memeVolume / 100;
                                  return next;
                                });
                              }}
                              className="absolute top-2 left-2 w-7 h-7 rounded-full flex items-center justify-center"
                              style={{ background: "rgba(0,0,0,0.7)", border: "2px solid rgba(255,255,255,0.3)", zIndex: 2, cursor: "pointer" }}
                            >
                              {audioOverlayMuted ? <Icons.Muted size={14} className="text-white" /> : <Icons.Volume size={14} className="text-white" />}
                            </button>
                          </>
                        )}
                      </>
                    ) : mediaData?.type === "audio" ? (
                      <div className="flex flex-col items-center justify-center gap-3" style={{ position: "absolute", inset: 0 }}>
                        <div
                          className="w-20 h-20 rounded-full flex items-center justify-center"
                          style={{ background: "var(--accent-purple)", border: "3px solid #000", boxShadow: "var(--shadow-cartoon)" }}
                        >
                          <Icons.Music size={36} className="text-white" />
                        </div>
                        <p className="text-xs font-bold" style={{ color: "var(--text-muted)" }}>
                          {videoDuration > 0 ? `${videoDuration.toFixed(1)}s` : ""}
                        </p>
                        <audio
                          ref={(el) => {
                            (previewVideoRef as React.MutableRefObject<HTMLAudioElement | HTMLVideoElement | null>).current = el;
                            if (el) {
                              el.volume = previewMuted ? 0 : memeVolume / 100;
                            }
                          }}
                          src={previewUrl}
                          autoPlay
                          onLoadedMetadata={() => {
                            if (previewVideoRef.current && segments.length > 0) {
                              segmentPlayRef.current = 0;
                              previewVideoRef.current.currentTime = segments[0].start;
                            }
                          }}
                          onTimeUpdate={() => {
                            const v = previewVideoRef.current;
                            if (!v || segments.length === 0) return;
                            setPlayheadTime(v.currentTime);
                            const idx = segmentPlayRef.current;
                            const seg = segments[idx];
                            if (seg && v.currentTime >= seg.end) {
                              const next = (idx + 1) % segments.length;
                              segmentPlayRef.current = next;
                              v.currentTime = segments[next].start;
                              v.play();
                            }
                          }}
                          style={{ display: "none" }}
                        />
                      </div>
                    ) : (
                      <video
                        ref={(el) => {
                          (previewVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
                          if (el) el.volume = memeVolume / 100;
                        }}
                        src={previewUrl}
                        autoPlay
                        muted={previewMuted || videoMuteOriginal}
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
                        onLoadedMetadata={() => {
                          if (previewVideoRef.current && segments.length > 0) {
                            segmentPlayRef.current = 0;
                            previewVideoRef.current.currentTime = segments[0].start;
                          }
                        }}
                        onTimeUpdate={() => {
                          const v = previewVideoRef.current;
                          if (!v || segments.length === 0) return;
                          const idx = segmentPlayRef.current;
                          const seg = segments[idx];
                          if (seg && v.currentTime >= seg.end) {
                            const next = (idx + 1) % segments.length;
                            segmentPlayRef.current = next;
                            v.currentTime = segments[next].start;
                            v.play();
                          }
                        }}
                      />
                    )}
                    {/* Text overlay preview — "on" mode (absolute on video/gif) */}
                    {(mediaData?.type === "video" || isGif) && textPosition === "on" && (textData.topText || textData.bottomText) && (
                      <>
                        {textData.topText && (
                          <div style={{
                            position: "absolute", top: 8, left: 0, right: 0, textAlign: "center", zIndex: 1,
                            fontSize: textSize * 0.45, fontWeight: 900, fontFamily: "'Impact', 'Charcoal', sans-serif",
                            color: "#fff", letterSpacing: 1, whiteSpace: "pre-line",
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
                            color: "#fff", letterSpacing: 1, whiteSpace: "pre-line",
                            textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000",
                            pointerEvents: "none",
                          }}>
                            {textData.bottomText.toUpperCase()}
                          </div>
                        )}
                      </>
                    )}
                    {/* Text overlay preview — "around" mode (outside video) */}
                    {(mediaData?.type === "video" || mediaData?.type === "image") && textPosition === "around" && (textData.topText || textData.bottomText) && (
                      <>
                        {textData.topText && (
                          <div style={{
                            position: "absolute", top: 4, left: 0, right: 0, textAlign: "center", zIndex: 1,
                            fontSize: textSize * 0.35, fontWeight: 900, fontFamily: "'Impact', 'Charcoal', sans-serif",
                            color: "#fff", letterSpacing: 1, whiteSpace: "pre-line",
                            textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000",
                            pointerEvents: "none", background: "rgba(0,0,0,0.5)", padding: "4px 8px", borderRadius: 8,
                          }}>
                            {textData.topText.toUpperCase()}
                          </div>
                        )}
                        {textData.bottomText && (
                          <div style={{
                            position: "absolute", bottom: 4, left: 0, right: 0, textAlign: "center", zIndex: 1,
                            fontSize: textSize * 0.35, fontWeight: 900, fontFamily: "'Impact', 'Charcoal', sans-serif",
                            color: "#fff", letterSpacing: 1, whiteSpace: "pre-line",
                            textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000",
                            pointerEvents: "none", background: "rgba(0,0,0,0.5)", padding: "4px 8px", borderRadius: 8,
                          }}>
                            {textData.bottomText.toUpperCase()}
                          </div>
                        )}
                      </>
                    )}
                    {/* Audio overlay for video */}
                    {mediaData?.type === "video" && audioData && (
                      <audio
                        ref={audioOverlayRef}
                        src={`data:${audioData.mimeType};base64,${audioData.data}`}
                        autoPlay
                        loop
                        style={{ display: "none" }}
                        onLoadedMetadata={(e) => {
                          const el = e.currentTarget;
                          el.currentTime = audioTrimStart;
                          el.volume = audioOverlayMuted ? 0 : memeVolume / 100;
                        }}
                        onTimeUpdate={(e) => {
                          const el = e.currentTarget;
                          if (el.currentTime >= audioTrimEnd || el.currentTime < audioTrimStart - 0.5) {
                            el.currentTime = audioTrimStart;
                          }
                        }}
                      />
                    )}
                    {/* Single mute button — controls original audio OR audio overlay */}
                    {(mediaData?.type === "video" || mediaData?.type === "audio") && (
                      <button
                        onClick={() => {
                          if (mediaData?.type === "video" && videoMuteOriginal && audioData) {
                            // Control audio overlay
                            setAudioOverlayMuted((m) => {
                              const next = !m;
                              if (audioOverlayRef.current) audioOverlayRef.current.volume = next ? 0 : memeVolume / 100;
                              return next;
                            });
                          } else {
                            // Control original audio
                            setPreviewMuted((m) => {
                              const next = !m;
                              const el = previewVideoRef.current;
                              if (el) {
                                if (mediaData?.type === "audio") {
                                  el.volume = next ? 0 : memeVolume / 100;
                                } else {
                                  (el as HTMLVideoElement).muted = next;
                                }
                              }
                              return next;
                            });
                          }
                        }}
                        className="absolute top-2 left-2 w-7 h-7 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(0,0,0,0.7)", border: "2px solid rgba(255,255,255,0.3)", zIndex: 2, pointerEvents: "auto", cursor: "pointer" }}
                      >
                        {(mediaData?.type === "video" && videoMuteOriginal && audioData ? audioOverlayMuted : previewMuted)
                          ? <Icons.Muted size={14} className="text-white" />
                          : <Icons.Volume size={14} className="text-white" />}
                      </button>
                    )}
                    <button
                      onClick={() => { setMediaData(null); setAudioData(null); setTextData({ topText: "", bottomText: "" }); setPreviewMuted(true); setAudioOverlayMuted(false); setVideoMuteOriginal(false); }}
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
                    <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept="image/*,video/*,audio/*" />
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
                  <textarea
                    value={textData.topText}
                    onChange={(e) => setTextData((p) => ({ ...p, topText: e.target.value }))}
                    className="cartoon-input w-full text-xs py-1.5"
                    placeholder="IMPACT TEXT..."
                    rows={2}
                    style={{ resize: "none" }}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold mb-1 block" style={{ color: "var(--text-muted)" }}>{t("media.bottom_text").toUpperCase()}</label>
                  <textarea
                    value={textData.bottomText}
                    onChange={(e) => setTextData((p) => ({ ...p, bottomText: e.target.value }))}
                    className="cartoon-input w-full text-xs py-1.5"
                    placeholder="BOTTOM TEXT..."
                    rows={2}
                    style={{ resize: "none" }}
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
                {(mediaData?.type === "image" || mediaData?.type === "video") && (
                  <div>
                    {/* Mute original video audio */}
                    {mediaData?.type === "video" && (
                      <button
                        onClick={() => {
                          const next = !videoMuteOriginal;
                          setVideoMuteOriginal(next);
                          if (previewVideoRef.current) (previewVideoRef.current as HTMLVideoElement).muted = next;
                          if (next) {
                            // Muting original → carry over mute state to audio overlay
                            setAudioOverlayMuted(previewMuted);
                            if (audioOverlayRef.current) audioOverlayRef.current.volume = previewMuted ? 0 : memeVolume / 100;
                          } else {
                            // Re-enable original audio → remove custom audio, restore video mute state
                            if (previewVideoRef.current) (previewVideoRef.current as HTMLVideoElement).muted = previewMuted;
                            setAudioData(null); setAudioDuration(0); setAudioTrimStart(0); setAudioTrimEnd(0); setAudioOverlayMuted(false);
                          }
                        }}
                        className="cartoon-btn w-full px-3 py-1.5 text-xs flex items-center justify-center gap-1.5 mb-1"
                        style={{
                          background: videoMuteOriginal ? "var(--accent-red)" : "var(--bg-input)",
                          color: videoMuteOriginal ? "#fff" : "var(--text-muted)",
                        }}
                      >
                        {videoMuteOriginal ? <Icons.Muted size={13} /> : <Icons.Volume size={13} />}
                        {videoMuteOriginal ? t("media.muted_original") : t("media.mute_original")}
                      </button>
                    )}
                    <input ref={audioInputRef} type="file" className="hidden" onChange={handleAudioUpload} accept="audio/*" />
                    {/* Show add audio button: always for images, only when original muted for videos */}
                    {(mediaData?.type === "image" || videoMuteOriginal) && (
                      <button
                        onClick={() => audioInputRef.current?.click()}
                        className="cartoon-btn w-full px-3 py-1.5 text-xs flex items-center justify-center gap-1.5"
                        style={{ background: "var(--accent-purple)", color: "#fff" }}
                      >
                        <Icons.Music size={13} />
                        {audioData ? audioData.name : t("media.choose_audio")}
                      </button>
                    )}
                    {audioData && (
                      <>
                        <button
                          onClick={() => { setAudioData(null); setAudioDuration(0); setAudioTrimStart(0); setAudioTrimEnd(0); setAudioOverlayMuted(false); }}
                          className="cartoon-btn w-full px-3 py-1 text-xs mt-1"
                          style={{ background: "var(--bg-input)", color: "var(--accent-red)" }}
                        >
                          {t("media.remove_audio")}
                        </button>

                        {/* Audio overlay trim */}
                        {audioDuration > 0 && (
                          <div className="mt-1.5">
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs font-bold flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                                <Icons.Music size={11} /> DECOUPE AUDIO
                              </label>
                              <span
                                className="cartoon-badge text-xs"
                                style={{ background: "var(--accent-purple)", color: "#fff", borderColor: "#000", padding: "1px 8px" }}
                              >
                                {audioTrimStart.toFixed(1)}s → {audioTrimEnd.toFixed(1)}s ({(audioTrimEnd - audioTrimStart).toFixed(1)}s)
                              </span>
                            </div>
                            {/* Barre principale — drag uniquement */}
                            <div
                              className="relative rounded-t-lg"
                              style={{ height: 28, background: "var(--bg-input)", border: "2px solid var(--border-card)", borderBottom: "none", cursor: "grab", userSelect: "none" }}
                              onMouseDown={(e) => {
                                const track = e.currentTarget;
                                const rect = track.getBoundingClientRect();
                                const pxToTime = (px: number) => Math.max(0, Math.min(audioDuration, (px / rect.width) * audioDuration));
                                const clickTime = pxToTime(e.clientX - rect.left);
                                const clipLen = audioTrimEnd - audioTrimStart;
                                const moveOffset = clickTime - audioTrimStart;

                                const onMove = (ev: MouseEvent) => {
                                  const t = pxToTime(ev.clientX - rect.left);
                                  let ns = t - moveOffset;
                                  ns = Math.max(0, Math.min(ns, audioDuration - clipLen));
                                  setAudioTrimStart(ns);
                                  setAudioTrimEnd(ns + clipLen);
                                };
                                const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                                window.addEventListener("mousemove", onMove);
                                window.addEventListener("mouseup", onUp);
                                onMove(e.nativeEvent);
                              }}
                            >
                              {/* Inactive left */}
                              <div className="absolute top-0 bottom-0 left-0 rounded-l-md" style={{ width: `${(audioTrimStart / audioDuration) * 100}%`, background: "rgba(0,0,0,0.35)" }} />
                              {/* Active zone */}
                              <div className="absolute top-0 bottom-0" style={{ left: `${(audioTrimStart / audioDuration) * 100}%`, width: `${((audioTrimEnd - audioTrimStart) / audioDuration) * 100}%`, background: "var(--accent-purple)", opacity: 0.35 }} />
                              {/* Inactive right */}
                              <div className="absolute top-0 bottom-0 right-0 rounded-r-md" style={{ width: `${((audioDuration - audioTrimEnd) / audioDuration) * 100}%`, background: "rgba(0,0,0,0.35)" }} />
                              {/* Start handle */}
                              <div className="absolute top-0 bottom-0 flex items-center justify-center" style={{ left: `${(audioTrimStart / audioDuration) * 100}%`, transform: "translateX(-50%)", width: 14, zIndex: 4, pointerEvents: "none" }}>
                                <div style={{ width: 4, height: 16, borderRadius: 2, background: "var(--accent-purple)", border: "1px solid #000" }} />
                              </div>
                              {/* End handle */}
                              <div className="absolute top-0 bottom-0 flex items-center justify-center" style={{ left: `${(audioTrimEnd / audioDuration) * 100}%`, transform: "translateX(-50%)", width: 14, zIndex: 4, pointerEvents: "none" }}>
                                <div style={{ width: 4, height: 16, borderRadius: 2, background: "var(--accent-purple)", border: "1px solid #000" }} />
                              </div>
                            </div>
                            {/* Barre du bas — resize */}
                            <div
                              className="relative rounded-b-lg"
                              style={{ height: 16, cursor: "ew-resize", userSelect: "none", background: "var(--bg-input)", borderLeft: "2px solid var(--border-card)", borderRight: "2px solid var(--border-card)", borderBottom: "2px solid var(--border-card)", marginTop: -2 }}
                              onMouseDown={(e) => {
                                const track = e.currentTarget;
                                const rect = track.getBoundingClientRect();
                                const pxToTime = (px: number) => Math.max(0, Math.min(audioDuration, (px / rect.width) * audioDuration));
                                const clickTime = pxToTime(e.clientX - rect.left);
                                const mid = (audioTrimStart + audioTrimEnd) / 2;
                                const side: "left" | "right" = clickTime < mid ? "left" : "right";

                                const maxClip = mediaData?.type === "video" ? totalSegDuration(segments) * loopCount : timeoutMs / 1000;
                                const onMove = (ev: MouseEvent) => {
                                  const t = pxToTime(ev.clientX - rect.left);
                                  if (side === "left") {
                                    const v = Math.max(Math.max(0, audioTrimEnd - maxClip), Math.min(t, audioTrimEnd - 0.5));
                                    setAudioTrimStart(v);
                                  } else {
                                    const v = Math.min(Math.min(audioDuration, audioTrimStart + maxClip), Math.max(t, audioTrimStart + 0.5));
                                    setAudioTrimEnd(v);
                                  }
                                };
                                const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                                window.addEventListener("mousemove", onMove);
                                window.addEventListener("mouseup", onUp);
                                onMove(e.nativeEvent);
                              }}
                            >
                              {/* Mirrored range indicator */}
                              <div className="absolute top-0 bottom-0" style={{ left: `${(audioTrimStart / audioDuration) * 100}%`, width: `${((audioTrimEnd - audioTrimStart) / audioDuration) * 100}%`, background: "var(--accent-purple)", opacity: 0.15 }} />
                              <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: 8, color: "var(--text-muted)", fontWeight: 700, pointerEvents: "none" }}>
                                {audioTrimStart.toFixed(1)}s → {audioTrimEnd.toFixed(1)}s
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Multi-segment Trim Editor */}
                {(mediaData?.type === "video" || mediaData?.type === "audio") && videoDuration > 0 && segments.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                        <Icons.Clock size={13} /> DECOUPE
                      </label>
                      <div className="flex items-center gap-1.5">
                        {/* Loop control — only for short videos */}
                        {mediaData?.type === "video" && totalSegDuration(segments) < TIMEOUT_LIMITS.maxVideo / 1000 && (() => {
                          const segDur = totalSegDuration(segments);
                          const maxLoops = Math.max(1, Math.floor((TIMEOUT_LIMITS.maxVideo / 1000) / segDur));
                          return maxLoops > 1 ? (
                            <div className="relative flex items-center">
                              <select
                                value={loopCount}
                                onChange={(e) => setLoopCount(Number(e.target.value))}
                                className="font-bold cursor-pointer appearance-none"
                                style={{
                                  fontSize: 11,
                                  padding: "3px 22px 3px 8px",
                                  background: "var(--accent-cyan)",
                                  color: "#000",
                                  border: "2px solid #000",
                                  borderRadius: 10,
                                  outline: "none",
                                  boxShadow: "var(--shadow-cartoon-sm)",
                                  WebkitAppearance: "none",
                                  MozAppearance: "none",
                                }}
                              >
                                {Array.from({ length: maxLoops }, (_, i) => i + 1).map((n) => (
                                  <option key={n} value={n} style={{ background: "var(--bg-card)", color: "var(--text-white)" }}>{n}×</option>
                                ))}
                              </select>
                              <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", right: 6, pointerEvents: "none" }}>
                                <path d="M6 9l6 6 6-6" />
                              </svg>
                            </div>
                          ) : null;
                        })()}
                        <span
                          className="cartoon-badge text-xs"
                          style={{ background: segColor(activeSegment), color: "#000", borderColor: "#000", padding: "1px 8px" }}
                        >
                          {(totalSegDuration(segments) * loopCount).toFixed(1)}s total
                        </span>
                      </div>
                    </div>

                    {/* Segment badges */}
                    <div className="flex flex-wrap items-center gap-1 mb-1.5">
                      {segments.map((seg, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg cursor-pointer transition-all"
                          style={{
                            background: i === activeSegment ? segColor(i) : "var(--bg-input)",
                            color: i === activeSegment ? "#000" : "var(--text-muted)",
                            border: `2px solid ${i === activeSegment ? segColor(i) : "var(--border-card)"}`,
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                          onClick={() => {
                            setActiveSegment(i);
                            if (previewVideoRef.current) previewVideoRef.current.currentTime = seg.start;
                          }}
                        >
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: segColor(i) }} />
                          {seg.start.toFixed(1)}s→{seg.end.toFixed(1)}s
                          {segments.length > 1 && (
                            <span
                              className="ml-0.5 hover:text-red-400 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                const next = segments.filter((_, j) => j !== i);
                                setSegments(next);
                                setActiveSegment(Math.min(activeSegment, next.length - 1));
                                const td = totalSegDuration(next);
                                setTimeoutMs(Math.min(Math.round(td * 1000), TIMEOUT_LIMITS.maxVideo));
                              }}
                            >
                              ×
                            </span>
                          )}
                        </div>
                      ))}
                      {segments.length < 6 && totalSegDuration(segments) < TIMEOUT_LIMITS.maxVideo / 1000 && (
                        <button
                          className="flex items-center justify-center rounded-lg transition-all hover:scale-110"
                          style={{
                            width: 22, height: 22,
                            background: "var(--bg-input)",
                            border: "2px solid var(--border-card)",
                            color: "var(--text-muted)",
                            fontSize: 14,
                            fontWeight: 700,
                          }}
                          onClick={() => {
                            const maxTotal = TIMEOUT_LIMITS.maxVideo / 1000;
                            const remaining = maxTotal - totalSegDuration(segments);
                            if (remaining < 0.5) return;
                            // Find first gap between sorted segments
                            const sorted = [...segments].sort((a, b) => a.start - b.start);
                            let gapStart = 0;
                            let gapLen = 0;
                            for (const sg of sorted) {
                              if (sg.start - gapStart >= 0.5) { gapLen = sg.start - gapStart; break; }
                              gapStart = Math.max(gapStart, sg.end);
                            }
                            if (gapLen === 0) gapLen = videoDuration - gapStart;
                            if (gapLen < 0.5) return;
                            const segLen = Math.min(remaining, 2, gapLen);
                            const newSeg = { start: gapStart, end: gapStart + segLen };
                            const next = [...segments, newSeg];
                            setSegments(next);
                            setActiveSegment(next.length - 1);
                            const td = totalSegDuration(next);
                            setTimeoutMs(Math.min(Math.round(td * 1000), TIMEOUT_LIMITS.maxVideo));
                          }}
                        >
                          +
                        </button>
                      )}
                    </div>

                    {/* Timeline track */}
                    <div
                      className="relative rounded-t-lg"
                      style={{ height: 32, background: "var(--bg-input)", border: "2px solid var(--border-card)", borderBottom: "none", userSelect: "none" }}
                      onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const mouseX = e.clientX - rect.left;
                        const seg = segments[activeSegment];
                        if (!seg) { e.currentTarget.style.cursor = "default"; return; }
                        const startPx = (seg.start / videoDuration) * rect.width;
                        const endPx = (seg.end / videoDuration) * rect.width;
                        const HZ = 12;
                        if (Math.abs(mouseX - startPx) <= HZ || Math.abs(mouseX - endPx) <= HZ) {
                          e.currentTarget.style.cursor = "ew-resize";
                        } else if (mouseX > startPx + HZ && mouseX < endPx - HZ) {
                          e.currentTarget.style.cursor = "grab";
                        } else {
                          e.currentTarget.style.cursor = "default";
                        }
                      }}
                      onMouseDown={(e) => {
                        const track = e.currentTarget;
                        const rect = track.getBoundingClientRect();
                        const pxToTime = (px: number) => Math.max(0, Math.min(videoDuration, (px / rect.width) * videoDuration));
                        const clickTime = pxToTime(e.clientX - rect.left);
                        const mouseX = e.clientX - rect.left;
                        const seg = segments[activeSegment];
                        if (!seg) return;

                        const startPx = (seg.start / videoDuration) * rect.width;
                        const endPx = (seg.end / videoDuration) * rect.width;
                        const playheadPx = (playheadTime / videoDuration) * rect.width;
                        const HANDLE_ZONE = 12;

                        let mode: "start" | "end" | "move" | "playhead";
                        const nearStart = Math.abs(mouseX - startPx) <= HANDLE_ZONE;
                        const nearEnd = Math.abs(mouseX - endPx) <= HANDLE_ZONE;
                        const insideSegment = mouseX > startPx + HANDLE_ZONE && mouseX < endPx - HANDLE_ZONE;
                        // Playhead handle has priority when outside segment
                        if (!nearStart && !nearEnd && !insideSegment && Math.abs(mouseX - playheadPx) <= 8) {
                          mode = "playhead";
                        } else if (nearStart && nearEnd) {
                          // Both handles overlap (tiny segment) — use closest
                          mode = Math.abs(mouseX - startPx) <= Math.abs(mouseX - endPx) ? "start" : "end";
                        } else if (nearStart) {
                          mode = "start";
                        } else if (nearEnd) {
                          mode = "end";
                        } else if (insideSegment) {
                          mode = "move";
                        } else {
                          // Click on another segment?
                          for (let i = 0; i < segments.length; i++) {
                            const s = segments[i];
                            const sLeft = (s.start / videoDuration) * rect.width;
                            const sRight = (s.end / videoDuration) * rect.width;
                            if (mouseX >= sLeft && mouseX <= sRight) {
                              setActiveSegment(i);
                              if (previewVideoRef.current) previewVideoRef.current.currentTime = s.start;
                              return;
                            }
                          }
                          // Click on empty space = seek playhead
                          mode = "playhead";
                        }

                        const segIdx = activeSegment;
                        const clipLen = seg.end - seg.start;
                        const moveOffset = clickTime - seg.start;

                        const onMove = (ev: MouseEvent) => {
                          const t = pxToTime(ev.clientX - rect.left);
                          if (mode === "playhead") {
                            setPlayheadTime(t);
                            if (previewVideoRef.current) previewVideoRef.current.currentTime = t;
                            return;
                          }
                          setSegments((prev) => {
                            const updated = [...prev];
                            const s = { ...updated[segIdx] };
                            const maxTotal = TIMEOUT_LIMITS.maxVideo / 1000;
                            const othersDur = totalSegDuration(prev) - (prev[segIdx].end - prev[segIdx].start);
                            const maxThisSeg = maxTotal - othersDur;
                            // Compute bounds from neighbors to prevent overlap
                            const sorted = updated.map((sg, i) => ({ ...sg, i })).sort((a, b) => a.start - b.start);
                            const sortedIdx = sorted.findIndex((x) => x.i === segIdx);
                            const prevSeg = sortedIdx > 0 ? sorted[sortedIdx - 1] : null;
                            const nextSeg = sortedIdx < sorted.length - 1 ? sorted[sortedIdx + 1] : null;
                            const lowerBound = prevSeg ? prevSeg.end : 0;
                            const upperBound = nextSeg ? nextSeg.start : videoDuration;
                            if (mode === "start") {
                              let v = Math.max(lowerBound, Math.min(t, s.end - 0.5));
                              if (s.end - v > maxThisSeg) v = s.end - maxThisSeg;
                              s.start = v;
                            } else if (mode === "end") {
                              let v = Math.min(upperBound, Math.max(t, s.start + 0.5));
                              if (v - s.start > maxThisSeg) v = s.start + maxThisSeg;
                              s.end = v;
                            } else {
                              // Find the right gap for the dragged position
                              const desiredStart = t - moveOffset;
                              const others = sorted.filter((x) => x.i !== segIdx);
                              // Build list of available gaps
                              const gaps: { start: number; end: number }[] = [];
                              let gapStart = 0;
                              for (const o of others) {
                                if (o.start > gapStart) gaps.push({ start: gapStart, end: o.start });
                                gapStart = Math.max(gapStart, o.end);
                              }
                              if (gapStart < videoDuration) gaps.push({ start: gapStart, end: videoDuration });
                              // Find the gap where desiredStart falls, or the closest one that fits
                              let bestGap = gaps.find((g) => g.end - g.start >= clipLen && desiredStart >= g.start - clipLen && desiredStart <= g.end);
                              if (!bestGap) bestGap = gaps.filter((g) => g.end - g.start >= clipLen).sort((a, b) => Math.abs((a.start + a.end) / 2 - desiredStart) - Math.abs((b.start + b.end) / 2 - desiredStart))[0];
                              if (bestGap) {
                                let ns = Math.max(bestGap.start, Math.min(desiredStart, bestGap.end - clipLen));
                                s.start = ns;
                                s.end = ns + clipLen;
                              }
                            }
                            updated[segIdx] = s;
                            const td = totalSegDuration(updated);
                            setTimeoutMs(Math.min(Math.round(td * 1000), TIMEOUT_LIMITS.maxVideo));
                            return updated;
                          });
                          if (previewVideoRef.current) {
                            previewVideoRef.current.currentTime = mode === "end" ? Math.max(pxToTime(ev.clientX - rect.left) - 0.3, segments[segIdx]?.start ?? 0) : pxToTime(ev.clientX - rect.left);
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
                      {/* Inactive background */}
                      <div className="absolute inset-0 rounded-md" style={{ background: "rgba(0,0,0,0.35)" }} />

                      {/* Segment zones */}
                      {segments.map((seg, i) => (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0"
                          style={{
                            left: `${(seg.start / videoDuration) * 100}%`,
                            width: `${((seg.end - seg.start) / videoDuration) * 100}%`,
                            background: segColor(i),
                            opacity: i === activeSegment ? 0.4 : 0.2,
                            pointerEvents: "none",
                            zIndex: 1,
                          }}
                        />
                      ))}

                      {/* Handles for active segment */}
                      {(() => {
                        const seg = segments[activeSegment];
                        if (!seg) return null;
                        return (
                          <>
                            <div
                              className="absolute top-0 bottom-0 flex items-center justify-center"
                              style={{
                                left: `${(seg.start / videoDuration) * 100}%`,
                                transform: "translateX(-50%)",
                                width: 14,
                                zIndex: 4,
                                pointerEvents: "none",
                              }}
                            >
                              <div style={{ width: 4, height: 18, borderRadius: 2, background: segColor(activeSegment), border: "1px solid #000" }} />
                            </div>
                            <div
                              className="absolute top-0 bottom-0 flex items-center justify-center"
                              style={{
                                left: `${(seg.end / videoDuration) * 100}%`,
                                transform: "translateX(-50%)",
                                width: 14,
                                zIndex: 4,
                                pointerEvents: "none",
                              }}
                            >
                              <div style={{ width: 4, height: 18, borderRadius: 2, background: segColor(activeSegment), border: "1px solid #000", pointerEvents: "none" }} />
                            </div>
                          </>
                        );
                      })()}

                      {/* Playhead indicator */}
                      <div
                        className="absolute"
                        style={{
                          left: `${(playheadTime / videoDuration) * 100}%`,
                          transform: "translateX(-50%)",
                          top: 0,
                          bottom: 0,
                          width: 2,
                          background: "#fff",
                          opacity: 0.9,
                          zIndex: 6,
                          pointerEvents: "none",
                        }}
                      />
                    </div>

                    {/* Playhead drag zone below */}
                    <div
                      className="relative rounded-b-lg"
                      style={{ height: 16, cursor: "col-resize", userSelect: "none", background: "var(--bg-input)", borderLeft: "2px solid var(--border-card)", borderRight: "2px solid var(--border-card)", borderBottom: "2px solid var(--border-card)", marginTop: -2 }}
                      onMouseDown={(e) => {
                        const track = e.currentTarget;
                        const rect = track.getBoundingClientRect();
                        const pxToTime = (px: number) => Math.max(0, Math.min(videoDuration, (px / rect.width) * videoDuration));
                        const seek = (ev: MouseEvent) => {
                          const t = pxToTime(ev.clientX - rect.left);
                          setPlayheadTime(t);
                          if (previewVideoRef.current) previewVideoRef.current.currentTime = t;
                        };
                        seek(e.nativeEvent);
                        const onUp = () => { window.removeEventListener("mousemove", seek); window.removeEventListener("mouseup", onUp); };
                        window.addEventListener("mousemove", seek);
                        window.addEventListener("mouseup", onUp);
                      }}
                    >
                      {/* Playhead position line */}
                      <div
                        className="absolute top-0 bottom-0"
                        style={{
                          left: `${(playheadTime / videoDuration) * 100}%`,
                          transform: "translateX(-50%)",
                          width: 2,
                          background: "#fff",
                          opacity: 0.7,
                        }}
                      />
                      {/* Time label */}
                      <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 700, pointerEvents: "none" }}
                      >
                        {playheadTime.toFixed(1)}s / {videoDuration.toFixed(1)}s
                      </div>
                    </div>
                  </div>
                )}

                {/* Duration (images only) */}
                {mediaData?.type === "image" && (
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
              onSelectMeme={(dataUrl, mimeType, mediaType) => {
                setMediaData({ type: mediaType, data: dataUrl, mimeType });
                setAudioData(null);
                setTextData({ topText: "", bottomText: "" });
                setPreviewMuted(mediaType !== "audio");
                if (mediaType === "video" || mediaType === "audio") {
                  const el = document.createElement(mediaType === "video" ? "video" : "audio");
                  el.src = dataUrl;
                  el.onloadedmetadata = () => {
                    const dur = el.duration;
                    setVideoDuration(dur);
                    const maxTrim = Math.min(dur, TIMEOUT_LIMITS.maxVideo / 1000);
                    setSegments([{ start: 0, end: maxTrim }]);
                    setActiveSegment(0);
                    setTimeoutMs(Math.round(maxTrim * 1000));
                  };
                } else {
                  setVideoDuration(0);
                  setSegments([]);
                  setActiveSegment(0);
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
              onSelectMeme={(dataUrl, mimeType, mediaType) => {
                setMediaData({ type: mediaType, data: dataUrl, mimeType });
                setAudioData(null);
                setTextData({ topText: "", bottomText: "" });
                setPreviewMuted(mediaType !== "audio");
                if (mediaType === "video" || mediaType === "audio") {
                  const el = document.createElement(mediaType === "video" ? "video" : "audio");
                  el.src = dataUrl;
                  el.onloadedmetadata = () => {
                    const dur = el.duration;
                    setVideoDuration(dur);
                    const maxTrim = Math.min(dur, TIMEOUT_LIMITS.maxVideo / 1000);
                    setSegments([{ start: 0, end: maxTrim }]);
                    setActiveSegment(0);
                    setTimeoutMs(Math.round(maxTrim * 1000));
                  };
                } else {
                  setVideoDuration(0);
                  setSegments([]);
                  setActiveSegment(0);
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
                      navigator.clipboard.writeText(myInviteCode);
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
              <div
                className="p-4 rounded-xl flex items-center justify-between"
                style={{ background: "var(--bg-input)", border: `2px solid ${dndEnabled ? "var(--accent-red)" : "var(--border-card)"}` }}
              >
                <div>
                  <p className="text-xs font-bold flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                    <Icons.Moon size={14} /> {t("settings.dnd").toUpperCase()}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {t("settings.dnd_desc")}
                  </p>
                </div>
                <button
                  onClick={() => {
                    const newVal = !dndEnabled;
                    socketRef.current?.emit("status:set_dnd", newVal);
                    setDndEnabled(newVal);
                  }}
                  className="relative rounded-full transition-colors"
                  style={{
                    width: 44, height: 24, flexShrink: 0,
                    background: dndEnabled ? "var(--accent-red)" : "var(--bg-card)",
                    border: "2px solid #000",
                  }}
                >
                  <div
                    className="absolute top-0.5 rounded-full transition-all"
                    style={{
                      width: 16, height: 16,
                      background: "#fff",
                      border: "2px solid #000",
                      left: dndEnabled ? 22 : 2,
                    }}
                  />
                </button>
              </div>
              <div
                className="p-4 rounded-xl flex items-center justify-between"
                style={{ background: "var(--bg-input)", border: `2px solid ${selfDefault ? "var(--accent-orange)" : "var(--border-card)"}` }}
              >
                <div>
                  <p className="text-xs font-bold flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                    <Icons.Zap size={14} /> {t("settings.self_default").toUpperCase()}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {t("settings.self_default_desc")}
                  </p>
                </div>
                <button
                  onClick={() => {
                    const newVal = !selfDefault;
                    setSelfDefault(newVal);
                    localStorage.setItem("selfDefault", String(newVal));
                  }}
                  className="relative rounded-full transition-colors"
                  style={{
                    width: 44, height: 24, flexShrink: 0,
                    background: selfDefault ? "var(--accent-orange)" : "var(--bg-card)",
                    border: "2px solid #000",
                  }}
                >
                  <div
                    className="absolute top-0.5 rounded-full transition-all"
                    style={{
                      width: 16, height: 16,
                      background: "#fff",
                      border: "2px solid #000",
                      left: selfDefault ? 22 : 2,
                    }}
                  />
                </button>
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
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {onlineCount} {t("friends.online").toLowerCase()}
              </p>
              {user && (
                <button
                  onClick={() => { if (!selfDefault) handleTargetToggle(user.id); }}
                  className="text-xs font-bold px-2 py-0.5 rounded-lg transition-colors"
                  style={{
                    background: (selfDefault || selectedTargets.includes(user.id)) ? "var(--accent-orange)" : "var(--bg-input)",
                    color: (selfDefault || selectedTargets.includes(user.id)) ? "#000" : "var(--text-muted)",
                    border: "2px solid var(--border-card)",
                    fontSize: 10,
                    opacity: selfDefault ? 0.7 : 1,
                    cursor: selfDefault ? "default" : "pointer",
                  }}
                >
                  {t("friends.self")}
                </button>
              )}
            </div>

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
                    const isDnd = dndFriendIds.includes(friend.id);
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
                            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 ${isOnline && !isDnd ? "online-pulse" : ""}`}
                            style={{
                              background: isDnd ? "var(--accent-red)" : isOnline ? "var(--accent-green)" : "var(--text-muted)",
                              borderColor: "var(--bg-card)",
                            }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold truncate">{friend.username}</p>
                          <p className="text-xs" style={{ color: isDnd ? "var(--accent-red)" : isOnline ? "var(--accent-green)" : "var(--text-muted)", fontSize: 10 }}>
                            {isDnd ? t("friends.dnd") : isOnline ? t("friends.online") : t("friends.offline")}
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
    <>
      <Updater />
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
    </>
  );
}

export default App;
