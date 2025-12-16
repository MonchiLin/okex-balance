export const AUTH_COOKIE_NAME = 'okx_admin';
export const DEFAULT_AUTH_SECRET = 'hardcoded-auth-secret-change-if-needed';
export const DEFAULT_ADMIN_PASSWORD = 'admin';

export type AuthPayload = {
  iat: number; // seconds
  exp: number; // seconds
};

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    if (k === name) return rest.join('=');
  }
  return null;
}

export function buildAuthSetCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 7, secure = true): string {
  const securePart = secure ? '; Secure' : '';
  return `${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly${securePart}; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export async function signAuthToken(payload: AuthPayload, secret: string): Promise<string> {
  const data = base64UrlEncodeUtf8(JSON.stringify(payload));
  const sig = await hmacBase64Url(data, secret);
  return `${data}.${sig}`;
}

export async function verifyAuthToken(token: string, secret: string): Promise<AuthPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  if (!data || !sig) return null;

  const expected = await hmacBase64Url(data, secret);
  if (!timingSafeEqual(expected, sig)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlDecodeUtf8(data));
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) return null;
  const exp = (payload as any).exp;
  const iat = (payload as any).iat;
  if (typeof exp !== 'number' || typeof iat !== 'number') return null;

  if (Date.now() >= exp * 1000) return null;
  return payload as AuthPayload;
}

export class UnauthorizedError extends Error {
  name = 'UnauthorizedError';
}

export async function requireAuth(request: Request, secret: string): Promise<AuthPayload> {
  const token = getCookie(request, AUTH_COOKIE_NAME);
  if (!token) throw new UnauthorizedError('Missing auth cookie');

  const payload = await verifyAuthToken(token, secret);
  if (!payload) throw new UnauthorizedError('Invalid auth token');
  return payload;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeUtf8(text: string): string {
  return base64UrlEncode(new TextEncoder().encode(text));
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeUtf8(str: string): string {
  return new TextDecoder().decode(base64UrlDecode(str));
}

async function hmacBase64Url(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign'
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return base64UrlEncode(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
