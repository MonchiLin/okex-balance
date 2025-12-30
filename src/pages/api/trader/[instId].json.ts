import type { APIRoute } from 'astro';

export const prerender = false;

// Time interval configuration: defines bucket size and data retention for each interval
const INTERVAL_CONFIG: Record<string, { bucketMs: number; limitDays: number }> = {
  '5m': { bucketMs: 5 * 60 * 1000, limitDays: 1 },       // 5min buckets, 1 day (~288 points)
  '15m': { bucketMs: 15 * 60 * 1000, limitDays: 7 },      // 15min buckets, 7 days (~672 points)
  '30m': { bucketMs: 30 * 60 * 1000, limitDays: 7 },      // 30min buckets, 7 days (~336 points)
  '1h': { bucketMs: 60 * 60 * 1000, limitDays: 7 },      // 1h buckets, 7 days (~168 points)
  '2h': { bucketMs: 2 * 60 * 60 * 1000, limitDays: 14 }, // 2h buckets, 14 days (~168 points)
  '4h': { bucketMs: 4 * 60 * 60 * 1000, limitDays: 28 }, // 4h buckets, 28 days (~168 points)
  '8h': { bucketMs: 8 * 60 * 60 * 1000, limitDays: 56 }, // 8h buckets, 56 days (~168 points)
  '1d': { bucketMs: 24 * 60 * 60 * 1000, limitDays: 90 }, // 1d buckets, 90 days (~90 points)
  '1w': { bucketMs: 7 * 24 * 60 * 60 * 1000, limitDays: 365 } // 1w buckets, 365 days (~52 points)
};

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

    // Parse interval parameter (default: 5m)
    const url = new URL(request.url);
    const intervalParam = url.searchParams.get('interval') || '5m';
    const config = INTERVAL_CONFIG[intervalParam];

    if (!config) {
      throw new Error(`Invalid interval: ${intervalParam}. Valid values: ${Object.keys(INTERVAL_CONFIG).join(', ')}`);
    }

    const { bucketMs, limitDays } = config;
    const cutoffTimestamp = Date.now() - limitDays * 24 * 60 * 60 * 1000;

    // Fetch trader info
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

    // Fetch metrics with time-bucket aggregation
    // This query groups data into time buckets and selects the last record in each bucket
    const metricsRes = await db
      .prepare(
        `SELECT 
           m1.timestamp,
           m1.ccy,
           m1.aum,
           m1.investAmt,
           m1.curCopyTraderPnl,
           m1.winRatio,
           m1.profitDays,
           m1.lossDays,
           m1.avgSubPosNotional,
           m1.leadPnl,
           m1.uTime
         FROM watched_trader_metrics m1
         INNER JOIN (
           SELECT 
             ((timestamp / ?) * ?) as bucket,
             MAX(timestamp) as max_ts
           FROM watched_trader_metrics
           WHERE instId = ? AND timestamp >= ?
           GROUP BY bucket
         ) m2 ON m1.timestamp = m2.max_ts AND m1.instId = ?
         ORDER BY m1.timestamp DESC
         LIMIT 1000`
      )
      .bind(bucketMs, bucketMs, instId, cutoffTimestamp, instId)
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
        leadPnl: r.leadPnl ? toNumber(r.leadPnl, 'leadPnl') : 0,
        uTime: toInt(r.uTime, 'uTime')
      }))
      .reverse();

    return new Response(JSON.stringify({ instId, watched, info, series }, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Cache for 90 seconds, allow serving stale for 30s while revalidating
        // Data updates every 5 minutes, so 90s cache is safe
        'Cache-Control': 'public, max-age=90, stale-while-revalidate=30'
      }
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
