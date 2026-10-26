// Versleutelt API-keys met een niet-exporteerbare AES-GCM-sleutel die in IndexedDB van deze browser staat.
// De sleutel verlaat de browser niet. Dit beschermt tegen het meelezen van localStorage/exports,
// maar niet tegen malware die al op je apparaat draait.

const DB_NAME = "llmhub";
const STORE = "kv";
const MASTER = "master-key";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let keyPromise: Promise<CryptoKey> | null = null;

function getMasterKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const db = await openDb();
      const existing = await idbRequest<CryptoKey | undefined>(db, "readonly", (s) => s.get(MASTER));
      if (existing) return existing;
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      await idbRequest(db, "readwrite", (s) => s.put(key, MASTER));
      return key;
    })();
  }
  return keyPromise;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): ArrayBuffer {
  const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return bytes.buffer as ArrayBuffer;
}

export async function encryptSecret(plain: string): Promise<string> {
  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `${toB64(iv)}.${toB64(new Uint8Array(ct))}`;
}

export async function decryptSecret(blob: string): Promise<string> {
  const [ivB, ctB] = blob.split(".");
  const key = await getMasterKey();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivB) }, key, fromB64(ctB));
  return new TextDecoder().decode(pt);
}
