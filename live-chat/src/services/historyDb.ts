export interface HistoryEntry {
  id: string;
  timestamp: number;
  senderName: string;
  direction: "sent" | "received";
  mediaType: "image" | "video" | "audio";
  mimeType: string;
  mediaBase64: string;
  textOverlay?: {
    topText: string;
    bottomText: string;
    fontSize?: number;
    position?: "on" | "around";
  };
}

/** Lightweight entry without the heavy media payload */
export type HistoryMeta = Omit<HistoryEntry, "mediaBase64">;

const DB_NAME = "shitpost-history";
const STORE_NAME = "entries";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get total number of entries in the store.
 */
export async function getHistoryCount(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get a page of history metadata (without mediaBase64) using a cursor.
 * Results are sorted by timestamp descending (newest first).
 */
export async function getHistoryPage(
  page: number,
  pageSize: number,
  directionFilter?: "sent" | "received"
): Promise<{ items: HistoryMeta[]; total: number }> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("timestamp");

    // Count total (respecting filter)
    let total = 0;
    const items: HistoryMeta[] = [];
    const skip = page * pageSize;
    let skipped = 0;
    let collected = 0;

    // Walk backwards (newest first) using 'prev' direction
    const cursorReq = index.openCursor(null, "prev");
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve({ items, total });
        return;
      }

      const entry = cursor.value as HistoryEntry;
      const matchesFilter = !directionFilter || entry.direction === directionFilter;

      if (matchesFilter) {
        total++;
        if (skipped < skip) {
          skipped++;
        } else if (collected < pageSize) {
          // Strip mediaBase64 to keep memory low
          const { mediaBase64: _, ...meta } = entry;
          items.push(meta);
          collected++;
        }
      }

      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

/**
 * Get media data for a single entry by ID.
 * Returns only the base64 string, or null if not found.
 */
export async function getHistoryMedia(id: string): Promise<string | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => {
      const entry = req.result as HistoryEntry | undefined;
      resolve(entry?.mediaBase64 ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

/** @deprecated Use getHistoryPage instead — this loads ALL entries into memory */
export async function getAllHistory(): Promise<HistoryEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).index("timestamp").getAll();
    req.onsuccess = () => resolve((req.result as HistoryEntry[]).reverse());
    req.onerror = () => reject(req.error);
  });
}

export async function deleteHistoryEntries(ids: string[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function purgeOldEntries(retentionDays: number): Promise<number> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("timestamp");
    const range = IDBKeyRange.upperBound(cutoff);
    const req = index.openCursor(range);
    let count = 0;
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        count++;
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
  });
}
