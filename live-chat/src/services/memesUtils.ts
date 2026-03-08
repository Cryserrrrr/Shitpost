import { readDir, readFile, writeFile, exists, mkdir } from "@tauri-apps/plugin-fs";

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"];
const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".avi", ".mkv"];
const ALL_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS];

export function isMediaFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ALL_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * Check if identical content already exists in the folder by comparing sizes then bytes.
 */
async function isDuplicate(folder: string, newBytes: Uint8Array): Promise<boolean> {
  try {
    const entries = await readDir(folder);
    const mediaEntries = entries.filter((e) => e.name && isMediaFile(e.name));

    for (const entry of mediaEntries) {
      const filePath = `${folder}\\${entry.name}`;
      try {
        const existingBytes = await readFile(filePath);
        if (existingBytes.byteLength !== newBytes.byteLength) continue;
        // Same size — compare content (check a few spots for speed)
        const existing = new Uint8Array(existingBytes);
        const len = newBytes.length;
        // Quick check: first, middle, last 64 bytes
        let match = true;
        const checkPoints = [0, Math.floor(len / 4), Math.floor(len / 2), Math.floor(len * 3 / 4), Math.max(0, len - 64)];
        for (const start of checkPoints) {
          const end = Math.min(start + 64, len);
          for (let i = start; i < end; i++) {
            if (existing[i] !== newBytes[i]) { match = false; break; }
          }
          if (!match) break;
        }
        if (match) return true;
      } catch {
        continue;
      }
    }
  } catch {
    // Folder doesn't exist or can't be read
  }
  return false;
}

/**
 * Save bytes to the memes folder if no duplicate exists.
 * Returns true if saved, false if duplicate or error.
 */
export async function saveToMemesFolder(
  bytes: Uint8Array,
  filename: string,
): Promise<boolean> {
  const folder = localStorage.getItem("memesFolder");
  if (!folder) return false;
  if (localStorage.getItem("memesAutoSave") !== "true") return false;

  try {
    const dirExists = await exists(folder);
    if (!dirExists) await mkdir(folder, { recursive: true });

    if (await isDuplicate(folder, bytes)) return false;

    await writeFile(`${folder}\\${filename}`, bytes);
    return true;
  } catch (err) {
    console.error("saveToMemesFolder failed:", err);
    return false;
  }
}

/**
 * Check if a file (by path) already exists as a duplicate in the memes folder.
 */
export async function isFileDuplicateInMemes(filePath: string): Promise<boolean> {
  const folder = localStorage.getItem("memesFolder");
  if (!folder) return false;

  try {
    const bytes = await readFile(filePath);
    return await isDuplicate(folder, new Uint8Array(bytes));
  } catch {
    return false;
  }
}
