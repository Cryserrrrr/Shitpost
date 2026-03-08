import { useEffect, useRef, useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readFile, remove, mkdir, exists } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import { saveToMemesFolder } from "../services/memesUtils";
import { Icons } from "./Icons";

interface MemeFile {
  name: string;
  path: string;
  isVideo: boolean;
  dataUrl: string;
}

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"];
const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".avi", ".mkv"];
const ALL_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS];

function isMediaFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ALL_EXTS.some((ext) => lower.endsWith(ext));
}

function isVideoFile(name: string): boolean {
  const lower = name.toLowerCase();
  return VIDEO_EXTS.some((ext) => lower.endsWith(ext));
}

function getMimeType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/mp4";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  return "application/octet-stream";
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface MemesTabProps {
  t: (key: any) => string;
  onStatus: (msg: string) => void;
  onSelectMeme: (dataUrl: string, mimeType: string, isVideo: boolean) => void;
}

export default function MemesTab({ t, onStatus, onSelectMeme }: MemesTabProps) {
  const [folderPath, setFolderPath] = useState<string | null>(() => localStorage.getItem("memesFolder"));
  const [memes, setMemes] = useState<MemeFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredMeme, setHoveredMeme] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoSave, setAutoSave] = useState(() => localStorage.getItem("memesAutoSave") === "true");
  const [searchQuery, setSearchQuery] = useState("");
  const videoPreviewRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const loadMemes = useCallback(async () => {
    if (!folderPath) return;
    setLoading(true);
    try {
      const dirExists = await exists(folderPath);
      if (!dirExists) {
        await mkdir(folderPath, { recursive: true });
      }
      const entries = await readDir(folderPath);
      const mediaEntries = entries.filter((e) => e.name && isMediaFile(e.name));

      const mediaFiles: MemeFile[] = await Promise.all(
        mediaEntries.map(async (e) => {
          const filePath = `${folderPath}\\${e.name}`;
          const bytes = await readFile(filePath);
          const base64 = uint8ToBase64(new Uint8Array(bytes));
          const mime = getMimeType(e.name!);
          return {
            name: e.name!,
            path: filePath,
            isVideo: isVideoFile(e.name!),
            dataUrl: `data:${mime};base64,${base64}`,
          };
        })
      );

      mediaFiles.sort((a, b) => a.name.localeCompare(b.name));
      setMemes(mediaFiles);
    } catch (err) {
      console.error("Failed to load memes:", err);
    }
    setLoading(false);
  }, [folderPath]);

  useEffect(() => {
    loadMemes();
  }, [loadMemes]);

  const handleSelectFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: t("memes.select_folder") });
    if (selected) {
      const path = selected as string;
      setFolderPath(path);
      localStorage.setItem("memesFolder", path);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!folderPath) return;

    const files = Array.from(e.dataTransfer.files).filter((f) => isMediaFile(f.name));
    let added = 0;
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const saved = await saveToMemesFolder(new Uint8Array(buffer), file.name);
      if (saved) added++;
    }
    if (added > 0) onStatus(t("memes.added"));
    loadMemes();
  };

  const handleDelete = async (meme: MemeFile) => {
    try {
      await remove(meme.path);
      onStatus(t("memes.deleted"));
      loadMemes();
    } catch (err) {
      console.error("Failed to delete meme:", err);
    }
  };

  const handleOpenFolder = async () => {
    if (!folderPath) return;
    try {
      await openPath(folderPath);
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  };

  const handleMouseEnter = (meme: MemeFile) => {
    setHoveredMeme(meme.path);
    if (meme.isVideo) {
      const video = videoPreviewRefs.current.get(meme.path);
      if (video) {
        video.currentTime = 0;
        video.play().catch(() => {});
      }
    }
  };

  const handleMouseLeave = (meme: MemeFile) => {
    setHoveredMeme(null);
    if (meme.isVideo) {
      const video = videoPreviewRefs.current.get(meme.path);
      if (video) {
        video.pause();
        video.currentTime = 0;
      }
    }
  };

  // No folder selected
  if (!folderPath) {
    return (
      <div className="cartoon-card p-6 flex-1 flex flex-col items-center justify-center gap-4">
        <div className="rounded-2xl p-6" style={{ background: "var(--bg-input)" }}>
          <Icons.Folder size={48} className="text-[var(--accent-orange)]" />
        </div>
        <h2 className="font-cartoon text-lg" style={{ color: "var(--accent-orange)" }}>
          {t("memes.no_folder")}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("memes.no_folder_desc")}
        </p>
        <button
          onClick={handleSelectFolder}
          className="cartoon-btn px-6 py-3 flex items-center gap-2"
          style={{ background: "var(--accent-orange)", color: "#000" }}
        >
          <Icons.Folder size={18} /> {t("memes.select_folder")}
        </button>
      </div>
    );
  }

  return (
    <div
      className="cartoon-card p-4 flex-1 flex flex-col overflow-hidden min-h-0 relative"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h2 className="font-cartoon text-base flex items-center gap-2" style={{ color: "var(--accent-orange)" }}>
          <Icons.Gallery size={18} /> {t("memes.title")}
        </h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("memes.search")}
              className="cartoon-input text-xs"
              style={{ width: 160, padding: "4px 12px 4px 28px" }}
            />
            <Icons.Search size={12} style={{ color: "var(--text-muted)", position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
          </div>
          <button
            onClick={handleSelectFolder}
            className="cartoon-btn px-3 py-1 text-xs"
            style={{ background: "var(--accent-purple)", color: "#fff", fontSize: 11 }}
          >
            {t("memes.change_folder")}
          </button>
          <button
            onClick={handleOpenFolder}
            className="cartoon-btn px-3 py-1 text-xs"
            style={{ background: "var(--bg-card)", fontSize: 11 }}
            title={t("memes.open_folder")}
          >
            <Icons.Folder size={14} />
          </button>
          <button
            onClick={() => {
              const next = !autoSave;
              setAutoSave(next);
              localStorage.setItem("memesAutoSave", String(next));
            }}
            className="cartoon-btn px-3 py-1 text-xs flex items-center gap-1"
            style={{
              background: autoSave ? "var(--accent-green)" : "var(--bg-card)",
              color: autoSave ? "#000" : "var(--text-muted)",
              fontSize: 11,
            }}
            title={t("memes.auto_save_desc")}
          >
            <Icons.Zap size={12} /> {t("memes.auto_save")}
          </button>
          <button
            onClick={loadMemes}
            className="cartoon-btn px-3 py-1 text-xs"
            style={{ background: "var(--bg-card)", fontSize: 11 }}
            title={t("memes.refresh")}
          >
            <Icons.Refresh size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Drag overlay */}
      {isDragging && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl"
          style={{ background: "rgba(255,140,66,0.15)", border: "3px dashed var(--accent-orange)" }}
        >
          <div className="text-center">
            <Icons.Upload size={48} className="mx-auto mb-2 text-[var(--accent-orange)]" />
            <p className="font-cartoon text-lg" style={{ color: "var(--accent-orange)" }}>
              {t("memes.drop_here")}
            </p>
          </div>
        </div>
      )}

      {/* Grid */}
      {(() => {
        const filtered = searchQuery
          ? memes.filter((m) => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
          : memes;
        return loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Icons.Refresh size={32} className="animate-spin text-[var(--accent-orange)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Icons.Image size={40} style={{ color: "var(--text-muted)" }} />
          <p className="text-sm font-bold" style={{ color: "var(--text-muted)" }}>
            {t("memes.empty")}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("memes.empty_desc")}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 p-1">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
            {filtered.map((meme) => (
              <div
                key={meme.path}
                className="meme-card group relative rounded-xl overflow-hidden cursor-pointer"
                style={{
                  background: "var(--bg-input)",
                  border: "2px solid var(--border-card)",
                  aspectRatio: "1",
                }}
                onClick={() => onSelectMeme(meme.dataUrl, getMimeType(meme.name), meme.isVideo)}
                onMouseEnter={() => handleMouseEnter(meme)}
                onMouseLeave={() => handleMouseLeave(meme)}
              >
                {meme.isVideo ? (
                  <video
                    ref={(el) => {
                      if (el) videoPreviewRefs.current.set(meme.path, el);
                      else videoPreviewRefs.current.delete(meme.path);
                    }}
                    src={meme.dataUrl}
                    muted
                    loop
                    playsInline
                    preload="auto"
                    className="w-full h-full object-cover"
                    onLoadedData={(e) => {
                      e.currentTarget.currentTime = 0.1;
                    }}
                  />
                ) : (
                  <img
                    src={meme.dataUrl}
                    alt={meme.name}
                    className="w-full h-full object-cover"
                  />
                )}

                {/* Video badge */}
                {meme.isVideo && (
                  <div
                    className="absolute top-2 left-2 px-1.5 py-0.5 rounded-lg flex items-center gap-1"
                    style={{ background: "rgba(0,0,0,0.7)", fontSize: 10 }}
                  >
                    <Icons.Media size={10} className="text-white" />
                    <span className="text-white font-bold">VID</span>
                  </div>
                )}

                {/* Hover overlay with name + delete */}
                <div
                  className="absolute inset-x-0 bottom-0 p-2 transition-opacity duration-200"
                  style={{
                    background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
                    opacity: hoveredMeme === meme.path ? 1 : 0,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-white truncate flex-1 mr-2">
                      {meme.name}
                    </p>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(meme); }}
                      className="p-1 rounded-lg hover:bg-red-500/30 transition-colors"
                      title={t("memes.delete")}
                    >
                      <Icons.Trash size={14} className="text-red-400" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
      })()}
    </div>
  );
}
