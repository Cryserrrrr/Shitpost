import { useEffect, useRef, useState, useCallback } from "react";
import { Icons } from "./Icons";
import {
  HistoryEntry,
  getAllHistory,
  deleteHistoryEntries,
  purgeOldEntries,
} from "../services/historyDb";
import { saveToMemesFolder } from "../services/memesUtils";

interface HistoryTabProps {
  t: (key: any) => string;
  onStatus: (msg: string) => void;
  onSelectMeme: (dataUrl: string, mimeType: string, isVideo: boolean) => void;
}

function timeAgo(ts: number, t: (k: any) => string): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("history.just_now");
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}j`;
}

const AVATAR_COLORS = [
  "#ff6b9d", "#2de2e6", "#ffd700", "#ff8c42",
  "#53d769", "#b854d4", "#ff4757", "#00d2d3",
];
function getAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function HistoryTab({ t, onStatus, onSelectMeme }: HistoryTabProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");
  const [retentionDays, setRetentionDays] = useState(() => {
    const saved = localStorage.getItem("historyRetention");
    return saved ? Number(saved) : 7;
  });
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const loadEntries = useCallback(async () => {
    setLoading(true);
    // Purge old entries first (skip if retention is infinite)
    if (retentionDays > 0) await purgeOldEntries(retentionDays);
    const all = await getAllHistory();
    setEntries(all);
    setSelected(new Set());
    setLoading(false);
  }, [retentionDays]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleDelete = async (ids: string[]) => {
    await deleteHistoryEntries(ids);
    setEntries((prev) => prev.filter((e) => !ids.includes(e.id)));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    onStatus(t("history.deleted"));
  };

  const handleSaveToFolder = async (entry: HistoryEntry) => {
    const bytes = Uint8Array.from(atob(entry.mediaBase64), (c) => c.charCodeAt(0));
    const ext = entry.mimeType.split("/")[1]?.replace("jpeg", "jpg") || (entry.mediaType === "video" ? "mp4" : "png");
    const sender = entry.senderName.replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `${sender}_${entry.timestamp}.${ext}`;
    const saved = await saveToMemesFolder(bytes, filename);
    onStatus(saved ? t("memes.added") : t("history.already_saved"));
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === entries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.id)));
    }
  };

  const handleMouseEnter = (entry: HistoryEntry) => {
    if (entry.mediaType === "video") {
      const video = videoRefs.current.get(entry.id);
      if (video) { video.currentTime = 0; video.play().catch(() => {}); }
    }
  };

  const handleMouseLeave = (entry: HistoryEntry) => {
    if (entry.mediaType === "video") {
      const video = videoRefs.current.get(entry.id);
      if (video) { video.pause(); video.currentTime = 0; }
    }
  };

  const handleRetentionChange = (days: number) => {
    setRetentionDays(days);
    localStorage.setItem("historyRetention", String(days));
  };

  return (
    <div className="cartoon-card p-4 flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h2 className="font-cartoon text-base flex items-center gap-2" style={{ color: "var(--accent-purple)" }}>
          <Icons.Clock size={18} /> {t("history.title")}
          <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>
            ({entries.length})
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {/* Retention selector */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-xl" style={{ background: "var(--bg-input)", border: "2px solid var(--border-card)" }}>
            {[1, 3, 7, 14, 30, -1].map((d) => (
              <button
                key={d}
                onClick={() => handleRetentionChange(d)}
                className="px-2 py-0.5 rounded-lg text-xs font-bold transition-all"
                style={{
                  background: retentionDays === d ? "var(--accent-purple)" : "transparent",
                  color: retentionDays === d ? "#fff" : "var(--text-muted)",
                  fontSize: 11,
                }}
              >
                {d === -1 ? "∞" : `${d}j`}
              </button>
            ))}
          </div>

          {/* Direction filter */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-xl" style={{ background: "var(--bg-input)", border: "2px solid var(--border-card)" }}>
            {(["all", "sent", "received"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="px-2 py-0.5 rounded-lg text-xs font-bold transition-all"
                style={{
                  background: filter === f ? "var(--accent-cyan)" : "transparent",
                  color: filter === f ? "#000" : "var(--text-muted)",
                  fontSize: 11,
                }}
              >
                {t(`history.${f}`)}
              </button>
            ))}
          </div>

          {/* Select all */}
          {entries.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className="cartoon-btn px-3 py-1 text-xs"
              style={{
                background: selected.size === entries.length ? "var(--accent-cyan)" : "var(--bg-card)",
                color: selected.size === entries.length ? "#000" : "var(--text-muted)",
                fontSize: 11,
              }}
            >
              {selected.size === entries.length ? t("general.deselect_all") : t("general.select_all")}
            </button>
          )}

          {/* Delete selected */}
          {selected.size > 0 && (
            <button
              onClick={() => handleDelete(Array.from(selected))}
              className="cartoon-btn px-3 py-1 text-xs flex items-center gap-1"
              style={{ background: "var(--accent-red)", color: "#fff", fontSize: 11 }}
            >
              <Icons.Trash size={12} /> {t("history.delete")} ({selected.size})
            </button>
          )}

          {/* Refresh */}
          <button
            onClick={loadEntries}
            className="cartoon-btn px-3 py-1 text-xs"
            style={{ background: "var(--bg-card)", fontSize: 11 }}
            title={t("memes.refresh")}
          >
            <Icons.Refresh size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Content */}
      {(() => {
        const filtered = filter === "all" ? entries : entries.filter((e) => e.direction === filter);
        return loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Icons.Refresh size={32} className="animate-spin text-[var(--accent-purple)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Icons.Clock size={40} style={{ color: "var(--text-muted)" }} />
          <p className="text-sm font-bold" style={{ color: "var(--text-muted)" }}>
            {t("history.empty")}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("history.empty_desc")}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 p-1">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {filtered.map((entry) => {
              const isSelected = selected.has(entry.id);
              const dataUrl = `data:${entry.mimeType};base64,${entry.mediaBase64}`;
              const hasText = entry.textOverlay?.topText || entry.textOverlay?.bottomText;

              return (
                <div
                  key={entry.id}
                  className="meme-card group relative rounded-xl overflow-hidden"
                  style={{
                    background: "var(--bg-input)",
                    border: `2px solid ${isSelected ? "var(--accent-cyan)" : "var(--border-card)"}`,
                  }}
                >
                  {/* Checkbox */}
                  <div
                    className="absolute top-2 left-2 z-10 cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); toggleSelect(entry.id); }}
                  >
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center"
                      style={{
                        border: `2px solid ${isSelected ? "var(--accent-cyan)" : "rgba(255,255,255,0.4)"}`,
                        background: isSelected ? "var(--accent-cyan)" : "rgba(0,0,0,0.5)",
                      }}
                    >
                      {isSelected && <Icons.Zap size={10} className="text-black" />}
                    </div>
                  </div>

                  {/* Media preview */}
                  <div
                    className="relative cursor-pointer"
                    style={{ aspectRatio: "16/10" }}
                    onClick={() => onSelectMeme(dataUrl, entry.mimeType, entry.mediaType === "video")}
                    onMouseEnter={() => handleMouseEnter(entry)}
                    onMouseLeave={() => handleMouseLeave(entry)}
                  >
                    {entry.mediaType === "video" ? (
                      <video
                        ref={(el) => {
                          if (el) videoRefs.current.set(entry.id, el);
                          else videoRefs.current.delete(entry.id);
                        }}
                        src={dataUrl}
                        muted
                        loop
                        playsInline
                        preload="auto"
                        className="w-full h-full object-cover"
                        onLoadedData={(e) => { e.currentTarget.currentTime = 0.1; }}
                      />
                    ) : (
                      <img src={dataUrl} alt="" className="w-full h-full object-cover" />
                    )}

                    {/* Video badge */}
                    {entry.mediaType === "video" && (
                      <div
                        className="absolute top-2 right-2 px-1.5 py-0.5 rounded-lg flex items-center gap-1"
                        style={{ background: "rgba(0,0,0,0.7)", fontSize: 10 }}
                      >
                        <Icons.Media size={10} className="text-white" />
                        <span className="text-white font-bold">VID</span>
                      </div>
                    )}

                    {/* Text overlay preview */}
                    {hasText && (
                      <div
                        className="absolute inset-x-0 bottom-0 px-2 py-1"
                        style={{ background: "rgba(0,0,0,0.6)" }}
                      >
                        {entry.textOverlay?.topText && (
                          <p className="text-white font-bold text-center truncate" style={{ fontSize: 10, fontFamily: "Impact, sans-serif" }}>
                            {entry.textOverlay.topText.toUpperCase()}
                          </p>
                        )}
                        {entry.textOverlay?.bottomText && (
                          <p className="text-white font-bold text-center truncate" style={{ fontSize: 10, fontFamily: "Impact, sans-serif" }}>
                            {entry.textOverlay.bottomText.toUpperCase()}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Info bar */}
                  <div className="p-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 font-bold"
                        style={{
                          background: getAvatarColor(entry.senderName),
                          border: "2px solid #000",
                          fontSize: 9,
                          color: "#fff",
                        }}
                      >
                        {entry.senderName[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate" style={{ color: "var(--text-white)" }}>
                          {entry.senderName}
                        </p>
                        <div className="flex items-center gap-1">
                          <span
                            className="px-1 py-0 rounded font-bold"
                            style={{
                              fontSize: 9,
                              background: entry.direction === "sent" ? "rgba(45,226,230,0.15)" : "rgba(184,84,212,0.15)",
                              color: entry.direction === "sent" ? "var(--accent-cyan)" : "var(--accent-purple)",
                            }}
                          >
                            {entry.direction === "sent" ? "↑" : "↓"} {t(`history.${entry.direction}`)}
                          </span>
                          <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                            {timeAgo(entry.timestamp, t)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* Save to memes folder */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSaveToFolder(entry); }}
                        className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
                        title={t("history.save_to_folder")}
                      >
                        <Icons.Download size={14} style={{ color: "var(--accent-orange)" }} />
                      </button>
                      {/* Delete */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete([entry.id]); }}
                        className="p-1.5 rounded-lg transition-colors hover:bg-red-500/20"
                        title={t("history.delete")}
                      >
                        <Icons.Trash size={14} className="text-red-400" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
      })()}
    </div>
  );
}
