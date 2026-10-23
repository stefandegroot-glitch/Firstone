// IndexedDB-Speicher für Fotos. Alles bleibt lokal auf dem Gerät.

const DB_NAME = 'zeitraffer';
const DB_VERSION = 1;
const STORE = 'photos';

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      store.createIndex('date', 'date');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** photo: { date: 'YYYY-MM-DD', blob, thumb, width, height } */
export function addPhoto(photo) {
  return run('readwrite', (s) => s.add({ ...photo, createdAt: Date.now() }));
}

export async function getAllPhotos() {
  const all = await run('readonly', (s) => s.getAll());
  return all.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

export async function updatePhoto(id, patch) {
  const photo = await run('readonly', (s) => s.get(id));
  if (!photo) return;
  await run('readwrite', (s) => s.put({ ...photo, ...patch }));
}

export function deletePhoto(id) {
  return run('readwrite', (s) => s.delete(id));
}
