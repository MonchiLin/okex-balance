import type { APIRoute } from 'astro';
import { fetchLeadTradersTop } from '../../lib/okx';

export const prerender = false;

function getDb(locals: App.Locals): D1Database {
  const db = (locals.runtime?.env as any)?.DB;
  if (!db) throw new Error('Missing D1 binding `DB` (locals.runtime.env.DB).');
  return db as D1Database;
}

export const GET: APIRoute = async ({ locals }) => {
  try {
    const db = getDb(locals);
    const top = await fetchLeadTradersTop(50);

    const watchedRows = await db.prepare('SELECT instId FROM watched_traders').all();
    const watchedSet = new Set<string>();
    if (Array.isArray(watchedRows.results)) {
      for (const r of watchedRows.results) {
        if (r && typeof (r as any).instId === 'string') watchedSet.add((r as any).instId);
      }
    }

    const data = top.map((t) => ({
      ...t,
      watched: watchedSet.has(t.instId)
    }));

    return new Response(JSON.stringify({ top: data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

