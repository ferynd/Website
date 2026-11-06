/** Canonical JSON rejects values that cannot be hashed consistently. */
export function canonicalJson(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string')
        return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value))
        return JSON.stringify(value);
    if (Array.isArray(value))
        return '[' + value.map(canonicalJson).join(',') + ']';
    if (value && Object.getPrototypeOf(value) === Object.prototype)
        return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
    throw new TypeError('Content must be finite JSON');
}
export async function sha256Hex(text) {
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export async function contentHashOf(obj) { return 'sha256:' + await sha256Hex(canonicalJson(obj)); }
