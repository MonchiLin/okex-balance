import type { APIRoute } from 'astro';
import { buildAuthSetCookie, signAuthToken, DEFAULT_AUTH_SECRET, DEFAULT_ADMIN_PASSWORD } from '../../../lib/auth';

export const prerender = false;

function getRequiredEnvString(locals: App.Locals, name: string): string {
  const value = (locals.runtime?.env as any)?.[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing env var \`${name}\``);
  return value;
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json().catch(() => null);
    const password = body && typeof body === 'object' ? (body as any).password : null;
    if (typeof password !== 'string' || password.length === 0) throw new Error('Missing `password`');

    const adminPassword = (locals.runtime?.env as any)?.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;
    const authSecret = DEFAULT_AUTH_SECRET;

    if (password !== adminPassword) {
      return new Response(JSON.stringify({ error: 'Invalid password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const maxAge = 60 * 60 * 24 * 7;
    const token = await signAuthToken({ iat: nowSec, exp: nowSec + maxAge }, authSecret);

    const secure = new URL(request.url).protocol === 'https:';

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': buildAuthSetCookie(token, maxAge, secure)
      }
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
