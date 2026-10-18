// The current work kept on the phone (IndexedDB): the opened photo and the edit. If iOS closes
// the app in the background, or a full-size save runs out of memory and Safari reloads the
// tab, the next start offers to continue exactly where it stopped.
const DB = "kirson", STORE = "session", KEY = "current";

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode), s = t.objectStore(STORE), r = fn(s);
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function load() {
  try {
    return (await tx("readonly", (s) => s.get(KEY))) || null;
  } catch {
    return null;
  }
}

// merge fields into the saved session (photo blob, name, state, exporting flag)
let pending = Promise.resolve();
export function save(fields) {
  pending = pending.then(async () => {
    try {
      const cur = (await load()) || {};
      await tx("readwrite", (s) => s.put({ ...cur, ...fields, t: Date.now() }, KEY));
    } catch { /* storage unavailable (private mode): the app works without it */ }
  });
  return pending;
}

export function clear() {
  pending = pending.then(() => tx("readwrite", (s) => s.delete(KEY)).catch(() => {}));
  return pending;
}
