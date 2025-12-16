import type { APIRoute } from 'astro';
import { requireAuth, UnauthorizedError, DEFAULT_AUTH_SECRET } from '../../../lib/auth';
import { fetchLeadTraderByInstId, fetchPublicStats } from '../../../lib/okx';

export const prerender = false;

function getRequiredEnvString(locals: App.Locals, name: string): string {
  const value = (locals.runtime?.env as any)?.[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing env var \`${name}\``);
  return value;
}

function getDb(locals: App.Locals): D1Database {
  const db = (locals.runtime?.env as any)?.DB;
  if (!db) throw new Error('Missing D1 binding `DB` (locals.runtime.env.DB).');
  return db as D1Database;
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    await requireAuth(request, DEFAULT_AUTH_SECRET);

    const body = await request.json().catch(() => null);
    const instId = body && typeof body === 'object' ? (body as any).instId : null;
    if (typeof instId !== 'string' || instId.length === 0) throw new Error('Missing `instId`');

    const db = getDb(locals);

    const existing = await db.prepare('SELECT instId FROM watched_traders WHERE instId = ?').bind(instId).first();
    const now = Date.now();

    if (existing) {
      await db.prepare('DELETE FROM watched_traders WHERE instId = ?').bind(instId).run();
      return new Response(JSON.stringify({ instId, watched: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const lead = await fetchLeadTraderByInstId(instId);
    const stats = await fetchPublicStats(instId);

    const bucketMs = 5 * 60 * 1000;
    const bucket = Math.floor(now / bucketMs) * bucketMs;

    const stmtInfo = db.prepare(
      `INSERT INTO trader_info (instId, nickName, ccy, leadDays, copyTraderNum, maxCopyTraderNum, avatarUrl, traderInsts, uTime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instId) DO UPDATE SET
        nickName=excluded.nickName,
        ccy=excluded.ccy,
        leadDays=excluded.leadDays,
        copyTraderNum=excluded.copyTraderNum,
        maxCopyTraderNum=excluded.maxCopyTraderNum,
        avatarUrl=excluded.avatarUrl,
        traderInsts=excluded.traderInsts,
        uTime=excluded.uTime`
    );

    const stmtWatch = db.prepare(
      `INSERT INTO watched_traders (instId, createdAt, updatedAt)
        VALUES (?, ?, ?)
        ON CONFLICT(instId) DO UPDATE SET updatedAt=excluded.updatedAt`
    );

    const stmtMetrics = db.prepare(
      `INSERT INTO watched_trader_metrics
        (instId, timestamp, ccy, aum, investAmt, curCopyTraderPnl, winRatio, profitDays, lossDays, avgSubPosNotional, uTime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instId, timestamp) DO UPDATE SET
        ccy=excluded.ccy,
        aum=excluded.aum,
        investAmt=excluded.investAmt,
        curCopyTraderPnl=excluded.curCopyTraderPnl,
        winRatio=excluded.winRatio,
        profitDays=excluded.profitDays,
        lossDays=excluded.lossDays,
        avgSubPosNotional=excluded.avgSubPosNotional,
        uTime=excluded.uTime`
    );

    await db.batch([
      stmtInfo.bind(
        lead.instId,
        lead.nickName,
        lead.ccy,
        lead.leadDays,
        lead.copyTraderNum,
        lead.maxCopyTraderNum,
        lead.avatarUrl,
        JSON.stringify(lead.traderInsts),
        now
      ),
      stmtWatch.bind(instId, now, now),
      stmtMetrics.bind(
        instId,
        bucket,
        stats.ccy,
        lead.aum,
        stats.investAmt,
        stats.curCopyTraderPnl,
        stats.winRatio,
        stats.profitDays,
        stats.lossDays,
        stats.avgSubPosNotional,
        now
      )
    ]);

    return new Response(JSON.stringify({ instId, watched: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return new Response(JSON.stringify({ error: e.message }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
