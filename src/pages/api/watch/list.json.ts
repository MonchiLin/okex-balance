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

export const GET: APIRoute = async ({ locals }) => {
  try {
    const db = getDb(locals);

    const countRow = await db.prepare('SELECT COUNT(1) AS c FROM watched_traders').first();
    const watchedCount = toInt((countRow as any)?.c, 'watched_traders count');

    const watched = await db
      .prepare(
        `SELECT
          w.instId AS instId,
          w.createdAt AS watchedCreatedAt,
          w.updatedAt AS watchedUpdatedAt,
          i.nickName AS nickName,
          i.ccy AS ccy,
          i.leadDays AS leadDays,
          i.copyTraderNum AS copyTraderNum,
          i.maxCopyTraderNum AS maxCopyTraderNum,
          i.avatarUrl AS avatarUrl,
          i.traderInsts AS traderInsts,
          i.uTime AS infoUTime,
          m.timestamp AS metricsTimestamp,
          m.aum AS aum,
          m.investAmt AS investAmt,
          m.curCopyTraderPnl AS curCopyTraderPnl,
          m.winRatio AS winRatio,
          m.profitDays AS profitDays,
          m.lossDays AS lossDays,
          m.avgSubPosNotional AS avgSubPosNotional,
          m.leadPnl AS leadPnl,
          m.uTime AS metricsUTime
        FROM watched_traders w
        JOIN trader_info i ON i.instId = w.instId
        JOIN watched_trader_metrics m ON m.instId = w.instId
        WHERE m.timestamp = (
          SELECT timestamp
          FROM watched_trader_metrics
          WHERE instId = w.instId
          ORDER BY timestamp DESC
          LIMIT 1
        )
        ORDER BY w.createdAt DESC`
      )
      .all();

    const rows = Array.isArray(watched.results) ? watched.results : [];
    if (rows.length !== watchedCount) {
      throw new Error(`Expected ${watchedCount} watched trader rows, got ${rows.length}. Metrics/info missing?`);
    }

    const data = rows.map((r: any) => {
      const instId = String(r.instId);
      return {
        instId,
        watchedCreatedAt: toInt(r.watchedCreatedAt, `watchedCreatedAt for ${instId}`),
        watchedUpdatedAt: toInt(r.watchedUpdatedAt, `watchedUpdatedAt for ${instId}`),
        info: {
          nickName: String(r.nickName),
          ccy: String(r.ccy),
          leadDays: toInt(r.leadDays, `leadDays for ${instId}`),
          copyTraderNum: toInt(r.copyTraderNum, `copyTraderNum for ${instId}`),
          maxCopyTraderNum: toInt(r.maxCopyTraderNum, `maxCopyTraderNum for ${instId}`),
          avatarUrl: String(r.avatarUrl),
          traderInsts: parseJsonStringArray(r.traderInsts, `traderInsts for ${instId}`),
          uTime: toInt(r.infoUTime, `infoUTime for ${instId}`)
        },
        metrics: {
          timestamp: toInt(r.metricsTimestamp, `metricsTimestamp for ${instId}`),
          aum: toNumber(r.aum, `aum for ${instId}`),
          investAmt: toNumber(r.investAmt, `investAmt for ${instId}`),
          curCopyTraderPnl: toNumber(r.curCopyTraderPnl, `curCopyTraderPnl for ${instId}`),
          winRatio: toNumber(r.winRatio, `winRatio for ${instId}`),
          profitDays: toInt(r.profitDays, `profitDays for ${instId}`),
          lossDays: toInt(r.lossDays, `lossDays for ${instId}`),
          avgSubPosNotional: toNumber(r.avgSubPosNotional, `avgSubPosNotional for ${instId}`),
          leadPnl: r.leadPnl ? toNumber(r.leadPnl, `leadPnl for ${instId}`) : 0,
          uTime: toInt(r.metricsUTime, `metricsUTime for ${instId}`)
        }
      };
    });

    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

