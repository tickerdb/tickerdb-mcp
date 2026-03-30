/**
 * OAuth crypto utilities using Web Crypto API (Cloudflare Workers compatible).
 */
/** SHA-256 hash a string, returned as hex. */
export async function sha256(input) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
/** Generate a cryptographically secure random token as hex. */
export function generateToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
/**
 * Verify a PKCE S256 code challenge.
 * code_challenge = BASE64URL(SHA256(code_verifier))
 */
export async function verifyPkceS256(codeVerifier, codeChallenge) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const base64url = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return base64url === codeChallenge;
}
// ── AES-GCM encryption for storing raw API keys ─────────────────────────────
async function importAesKey(keyBase64) {
    const rawKey = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
/**
 * Encrypt a string with AES-256-GCM.
 * Returns "base64(iv):base64(ciphertext)".
 */
export async function aesEncrypt(plaintext, keyBase64) {
    const key = await importAesKey(keyBase64);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(plaintext);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    const ivB64 = btoa(String.fromCharCode(...iv));
    const ctB64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
    return `${ivB64}:${ctB64}`;
}
/**
 * Decrypt an AES-256-GCM encrypted string.
 * Expects "base64(iv):base64(ciphertext)".
 */
export async function aesDecrypt(ciphertext, keyBase64) {
    const [ivB64, ctB64] = ciphertext.split(':');
    const key = await importAesKey(keyBase64);
    const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(decrypted);
}
