import { useEffect, useRef, useState, useCallback, memo } from "react";
import { Icons } from "./Icons";
import {
  HistoryMeta,
  getHistoryPage,
  getHistoryMedia,
  deleteHistoryEntries,
  purgeOldEntries,
} from "../services/historyDb";
import { saveToMemesFolder } from "../services/memesUtils";

interface HistoryTabProps {
  t: (key: any) => string;
  onStatus: (msg: string) => void;
  onSelectMeme: (dataUrl: string, mimeType: string, mediaType: "image" | "video" | "audio") => void;
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

const PAGE_SIZE = 40;

/** A single history card that lazy-loads its media via IntersectionObserver */
const HistoryCard = memo(function HistoryCard({
  entry,
  isSelected,
  onToggleSelect,
  onDelete,
  onSave,
  onSelect,
  t,
}: {
  entry: HistoryMeta;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onSave: (entry: HistoryMeta) => void;
  onSelect: (entry: HistoryMeta) => void;
  t: (k: any) => string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  // Lazy load media when card becomes visible
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load media data once visible
  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;

    getHistoryMedia(entry.id).then((base64) => {
      if (cancelled || !base64) return;
      // Convert base64 to Blob URL (much lighter than data URL in DOM)
      try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: entry.mimeType });
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setThumbUrl(url);
      } catch {
        // Fallback to data URL if blob creation fails
        setThumbUrl(`data:${entry.mimeType};base64,${base64}`);
      }
    });

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [isVisible, entry.id, entry.mimeType]);

  const handleMouseEnter = () => {
    if (entry.mediaType === "video" && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  };

  const handleMouseLeave = () => {
    if (entry.mediaType === "video" && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  const hasText = entry.textOverlay?.topText || entry.textOverlay?.bottomText;

  return (
    <div
      ref={cardRef}
      className="meme-card group relative rounded-xl overflow-hidden"
      style={{
        background: "var(--bg-input)",
        border: `2px solid ${isSelected ? "var(--accent-cyan)" : "var(--border-card)"}`,
      }}
    >
      {/* Checkbox */}
      <div
        className="absolute top-2 left-2 z-10 cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onToggleSelect(entry.id); }}
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
        onClick={() => onSelect(entry)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {thumbUrl ? (
          entry.mediaType === "video" ? (
            <video
              ref={videoRef}
              src={thumbUrl}
              muted
              loop
              playsInline
              preload="metadata"
              className="w-full h-full object-cover"
              onLoadedData={(e) => { e.currentTarget.currentTime = 0.1; }}
            />
          ) : (
            <img src={thumbUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: "var(--bg-dark)" }}>
            <Icons.Refresh size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
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

        {/* Audio badge */}
        {entry.mediaType === "audio" && (
          <div
            className="absolute top-2 right-2 px-1.5 py-0.5 rounded-lg flex items-center gap-1"
            style={{ background: "rgba(0,0,0,0.7)", fontSize: 10 }}
          >
            <Icons.Volume size={10} className="text-white" />
            <span className="text-white font-bold">AUD</span>
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
          <button
            onClick={(e) => { e.stopPropagation(); onSave(entry); }}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
            title={t("history.save_to_folder")}
          >
            <Icons.Download size={14} style={{ color: "var(--accent-orange)" }} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete([entry.id]); }}
            className="p-1.5 rounded-lg transition-colors hover:bg-red-500/20"
            title={t("history.delete")}
          >
            <Icons.Trash size={14} className="text-red-400" />
          </button>
        </div>
      </div>
    </div>
  );
});

export default function HistoryTab({ t, onStatus, onSelectMeme }: HistoryTabProps) {
  const [entries, setEntries] = useState<HistoryMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");
  const [retentionDays, setRetentionDays] = useState(() => {
    const saved = localStorage.getItem("historyRetention");
    return saved ? Number(saved) : 7;
  });
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const directionFilter = filter === "all" ? undefined : filter;

  const loadPage = useCallback(async (pageNum: number, append = false) => {
    if (pageNum === 0) setLoading(true);
    else setLoadingMore(true);

    try {
      if (pageNum === 0 && retentionDays > 0) {
        await purgeOldEntries(retentionDays);
      }
      const { items, total } = await getHistoryPage(pageNum, PAGE_SIZE, directionFilter);
      setTotalCount(total);
      setEntries((prev) => append ? [...prev, ...items] : items);
      setPage(pageNum);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [retentionDays, directionFilter]);

  // Reset when filter or retention changes
  useEffect(() => {
    setSelected(new Set());
    loadPage(0);
  }, [loadPage]);

  const hasMore = (page + 1) * PAGE_SIZE < totalCount;

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      loadPage(page + 1, true);
    }
  };

  // Infinite scroll: load more when reaching bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
        handleLoadMore();
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  });

  const handleDelete = async (ids: string[]) => {
    await deleteHistoryEntries(ids);
    setEntries((prev) => prev.filter((e) => !ids.includes(e.id)));
    setTotalCount((prev) => prev - ids.length);
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    onStatus(t("history.deleted"));
  };

  const handleSaveToFolder = async (entry: HistoryMeta) => {
    const base64 = await getHistoryMedia(entry.id);
    if (!base64) return;
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const ext = entry.mimeType.split("/")[1]?.replace("jpeg", "jpg") || (entry.mediaType === "video" ? "mp4" : "png");
    const sender = entry.senderName.replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `${sender}_${entry.timestamp}.${ext}`;
    const saved = await saveToMemesFolder(bytes, filename, true);
    onStatus(saved ? t("memes.added") : t("history.already_saved"));
  };

  const handleSelectMeme = async (entry: HistoryMeta) => {
    const base64 = await getHistoryMedia(entry.id);
    if (!base64) return;
    const dataUrl = `data:${entry.mimeType};base64,${base64}`;
    onSelectMeme(dataUrl, entry.mimeType, entry.mediaType);
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
            ({totalCount})
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
            onClick={() => loadPage(0)}
            className="cartoon-btn px-3 py-1 text-xs"
            style={{ background: "var(--bg-card)", fontSize: 11 }}
            title={t("memes.refresh")}
          >
            <Icons.Refresh size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Icons.Refresh size={32} className="animate-spin text-[var(--accent-purple)]" />
        </div>
      ) : entries.length === 0 ? (
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
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 p-1">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {entries.map((entry) => (
              <HistoryCard
                key={entry.id}
                entry={entry}
                isSelected={selected.has(entry.id)}
                onToggleSelect={toggleSelect}
                onDelete={handleDelete}
                onSave={handleSaveToFolder}
                onSelect={handleSelectMeme}
                t={t}
              />
            ))}
          </div>
          {/* Load more indicator */}
          {hasMore && (
            <div className="flex justify-center py-4">
              {loadingMore ? (
                <Icons.Refresh size={20} className="animate-spin" style={{ color: "var(--accent-purple)" }} />
              ) : (
                <button
                  onClick={handleLoadMore}
                  className="cartoon-btn px-4 py-2 text-xs"
                  style={{ background: "var(--bg-card)", color: "var(--text-muted)" }}
                >
                  {t("history.load_more") || "Load more..."}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
