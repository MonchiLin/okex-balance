import type { APIRoute } from 'astro';

export const prerender = false;

function getDb(locals: App.Locals): D1Database {
  const db = (locals.runtime?.env as any)?.DB;
  if (!db) throw new Error('Missing D1 binding `DB` (locals.runtime.env.DB).');
  return db as D1Database;
}

function parseJsonStringArray(value: unknown, name: string): string[] {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing ${name}`);
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== 'string')) throw new Error(`Invalid ${name}: expected JSON string array`);
  return parsed;
}

function toNumber(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}: ${String(value)}`);
  return n;
}

function toInt(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}: ${String(value)}`);
  return n;
}

export const GET: APIRoute = async ({ locals, params, request }) => {
  try {
    const db = getDb(locals);

    const instId = params.instId;
    if (!instId) throw new Error('Missing instId param');

    const infoRow = await db
      .prepare(
        `SELECT instId, nickName, ccy, leadDays, copyTraderNum, maxCopyTraderNum, avatarUrl, traderInsts, uTime
         FROM trader_info
         WHERE instId = ?`
      )
      .bind(instId)
      .first();

    if (!infoRow) throw new Error(`Trader not found in DB: ${instId}`);

    const watchedRow = await db.prepare('SELECT instId FROM watched_traders WHERE instId = ?').bind(instId).first();
    const watched = Boolean(watchedRow);

    const metricsRes = await db
      .prepare(
        `SELECT timestamp, ccy, aum, investAmt, curCopyTraderPnl, winRatio, profitDays, lossDays, avgSubPosNotional, uTime
         FROM watched_trader_metrics
         WHERE instId = ?
         ORDER BY timestamp DESC
         LIMIT 288`
      )
      .bind(instId)
      .all();

    const metricsRows = Array.isArray(metricsRes.results) ? metricsRes.results : [];
    if (metricsRows.length === 0) throw new Error(`No metrics found for trader: ${instId}`);

    const info = {
      instId: String((infoRow as any).instId),
      nickName: String((infoRow as any).nickName),
      ccy: String((infoRow as any).ccy),
      leadDays: toInt((infoRow as any).leadDays, 'leadDays'),
      copyTraderNum: toInt((infoRow as any).copyTraderNum, 'copyTraderNum'),
      maxCopyTraderNum: toInt((infoRow as any).maxCopyTraderNum, 'maxCopyTraderNum'),
      avatarUrl: String((infoRow as any).avatarUrl),
      traderInsts: parseJsonStringArray((infoRow as any).traderInsts, 'traderInsts'),
      uTime: toInt((infoRow as any).uTime, 'uTime')
    };

    const series = metricsRows
      .map((r: any) => ({
        timestamp: toInt(r.timestamp, 'timestamp'),
        ccy: String(r.ccy),
        aum: toNumber(r.aum, 'aum'),
        investAmt: toNumber(r.investAmt, 'investAmt'),
        curCopyTraderPnl: toNumber(r.curCopyTraderPnl, 'curCopyTraderPnl'),
        winRatio: toNumber(r.winRatio, 'winRatio'),
        profitDays: toInt(r.profitDays, 'profitDays'),
        lossDays: toInt(r.lossDays, 'lossDays'),
        avgSubPosNotional: toNumber(r.avgSubPosNotional, 'avgSubPosNotional'),
        uTime: toInt(r.uTime, 'uTime')
      }))
      .reverse();

    return new Response(JSON.stringify({ instId, watched, info, series }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
