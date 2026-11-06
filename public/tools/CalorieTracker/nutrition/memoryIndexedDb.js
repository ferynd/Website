/** Minimal asynchronous IndexedDB fake: requests, commit events and named databases. */
export function memoryIndexedDb() {
    const databases = new Map();
    function request(fn) { const r = {}; queueMicrotask(() => { try {
        r.result = fn();
        r.onsuccess?.();
    }
    catch (e) {
        r.error = e;
        r.onerror?.();
    } }); return r; }
    return { databases, deleteDatabase: name => request(() => databases.delete(name)), open(name) { const r = {}; queueMicrotask(() => { const fresh = !databases.has(name); if (fresh)
            databases.set(name, new Map()); const stores = databases.get(name); r.result = { objectStoreNames: { contains: n => stores.has(n) }, createObjectStore: n => stores.set(n, new Map()), close() { }, transaction(n) { const tx = {}; tx.objectStore = () => { const s = stores.get(n); const act = fn => { const req = request(fn); queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.())); return req; }; return { get: k => act(() => structuredClone(s.get(k))), getAll: () => act(() => [...s.values()].map(v => structuredClone(v))), put: v => act(() => s.set(v.key, structuredClone(v))), delete: k => act(() => s.delete(k)) }; }; return tx; } }; if (fresh)
            r.onupgradeneeded?.(); r.onsuccess?.(); }); return r; } };
}
