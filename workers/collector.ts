interface Env {
    DB: D1Database;
    PUSHPLUS_TOKEN?: string;
}

// Config constants
const ALERT_THRESHOLD_PCT = 0.05; // 5%
// const ALERT_THRESHOLD_PCT = 0.05; // 5%

export default {
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
        console.log('Cron triggered');
        await collectWatched(env);
    },

    // HTTP Handler (manual run)
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        if (request.method !== 'GET') {
            return new Response('Method Not Allowed', { status: 405 });
        }

        try {
            const result = await collectWatched(env);
            return new Response(JSON.stringify(result, null, 2), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e) {
            console.error(e);
            const message = e instanceof Error ? e.message : String(e);
            return new Response(JSON.stringify({ error: message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
};

type OkxLeadTraderRow = {
    instId: string; // uniqueCode
    nickName: string;
    ccy: string;
    leadDays: number;
    copyTraderNum: number;
    maxCopyTraderNum: number;
    avatarUrl: string;
    traderInsts: string[];
    aum: number;
    pnl: number;
};

type OkxStatsRow = {
    ccy: string;
    winRatio: number;
    profitDays: number;
    lossDays: number;
    avgSubPosNotional: number;
    investAmt: number;
    curCopyTraderPnl: number;
};

// Combined stats type including traderAsset from priapi
type OkxStatsWithAsset = OkxStatsRow & { traderAsset: number };

async function collectWatched(env: Env) {
    if (!env.DB) throw new Error('Missing D1 binding `DB`.');

    const watchedRes = await env.DB.prepare('SELECT instId FROM watched_traders').all();
    const watched = ensureArray(watchedRes.results, 'D1 watched_traders results').map((r: any) =>
        assertNonEmptyString(r?.instId, 'watched_traders.instId')
    );

    if (watched.length === 0) {
        // console.log('No watched traders');
        return { message: 'No watched traders', watchedCount: 0 };
    }

    const now = Date.now();
    const bucketMs = 5 * 60 * 1000;
    const bucket = Math.floor(now / bucketMs) * bucketMs;

    // Parallel Fetch: Lead Map + Stats List + History Snapshots
    const [leadMap, statsList, history5m, history1h, history24h] = await Promise.all([
        fetchLeadTraderMap(watched),
        mapLimit(watched, 2, async (instId) => {
            const [stats, traderAsset] = await Promise.all([
                fetchPublicStats(instId),
                fetchTradeData(instId)
            ]);
            return { instId, stats: { ...stats, traderAsset } };
        }),
        fetchSnapshot(env, watched, bucket - bucketMs),      // 5 min ago
        fetchSnapshot(env, watched, bucket - 12 * bucketMs), // 1 hour ago
        fetchSnapshot(env, watched, bucket - 24 * 12 * bucketMs) // 24 hours ago
    ]);

    const statsMap = new Map<string, OkxStatsWithAsset>(statsList.map((x) => [x.instId, x.stats]));

    // --- Change Detection Logic ---
    const traderAlerts = new Map<string, string[]>();

    for (const instId of watched) {
        const lead = leadMap.get(instId);
        const stats = statsMap.get(instId);
        if (!lead || !stats) continue;

        // Use traderAsset (accurate value from priapi) for display and calculations
        // lead.aum is "Scale AUM" (copier funds), stats.traderAsset is "Trader Assets"
        const currentTotalAum = lead.aum + stats.traderAsset;
        const currentUsers = lead.copyTraderNum; // (unused but kept for ref)

        if (!traderAlerts.has(instId)) {
            traderAlerts.set(instId, []);
        }
        const msgs = traderAlerts.get(instId)!;

        // Check 5 min change
        checkChange(msgs, '5分钟', currentTotalAum, lead.aum, history5m.get(instId));
        // Check 1 hour change
        checkChange(msgs, '1小时', currentTotalAum, lead.aum, history1h.get(instId));
        // Check 24 hour change
        checkChange(msgs, '24小时', currentTotalAum, lead.aum, history24h.get(instId));
    }

    // Filter out empty traders
    const activeAlerts: string[] = [];
    for (const [instId, msgs] of traderAlerts) {
        if (msgs.length > 0) {
            const lead = leadMap.get(instId);
            activeAlerts.push(`👤 <b>${lead?.nickName ?? instId}</b>:<br/>${msgs.join('<br/>')}`);
        }
    }

    if (activeAlerts.length > 0) {
        const timeStr = new Date(now + 8 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19); // Simple China Time
        const title = `🚨 资金异动报警 ${timeStr}`;
        const content = activeAlerts.join('<br/><br/>');

        console.log('--- ALERTS TRIGGERED ---');
        console.log(content);

        if (env.PUSHPLUS_TOKEN) {
            await sendPushPlus(env.PUSHPLUS_TOKEN, title, content);
        } else {
            console.log('Skipping PushPlus notification: PUSHPLUS_TOKEN not set');
        }
    }
    // ------------------------------

    const stmtInfo = env.DB.prepare(
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

    const stmtMetrics = env.DB.prepare(
        `INSERT INTO watched_trader_metrics
            (instId, timestamp, ccy, aum, investAmt, curCopyTraderPnl, winRatio, profitDays, lossDays, avgSubPosNotional, leadPnl, uTime)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(instId, timestamp) DO UPDATE SET
            ccy=excluded.ccy,
            aum=excluded.aum,
            investAmt=excluded.investAmt,
            curCopyTraderPnl=excluded.curCopyTraderPnl,
            winRatio=excluded.winRatio,
            profitDays=excluded.profitDays,
            lossDays=excluded.lossDays,
            avgSubPosNotional=excluded.avgSubPosNotional,
            leadPnl=excluded.leadPnl,
            uTime=excluded.uTime`
    );

    const stmtTouchWatched = env.DB.prepare('UPDATE watched_traders SET updatedAt = ? WHERE instId = ?');

    const batch = [];
    for (const instId of watched) {
        const lead = leadMap.get(instId);
        if (!lead) throw new Error(`Watched trader not found in OKX lead-traders list: ${instId}`);
        const stats = statsMap.get(instId);
        if (!stats) throw new Error(`Missing OKX public-stats result: ${instId}`);

        batch.push(
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
            )
        );

        batch.push(
            stmtMetrics.bind(
                instId,
                bucket,
                stats.ccy,
                lead.aum,
                stats.traderAsset, // Use traderAsset (accurate value) instead of raw investAmt
                stats.curCopyTraderPnl,
                stats.winRatio,
                stats.profitDays,
                stats.lossDays,
                stats.avgSubPosNotional,
                0, // leadPnl is now obsolete, use 0 as placeholder
                now
            )
        );

        batch.push(stmtTouchWatched.bind(now, instId));
    }

    const chunkSize = 90;
    for (let i = 0; i < batch.length; i += chunkSize) {
        await env.DB.batch(batch.slice(i, i + chunkSize));
    }

    return { message: 'Success', watchedCount: watched.length, timestamp: bucket, alertsCount: activeAlerts.length };
}

// --- Helper Functions for Detection ---

type Snapshot = { aum: number; investAmt: number; pnl: number; copyTraderNum: number };

async function fetchSnapshot(env: Env, instIds: string[], timestamp: number): Promise<Map<string, Snapshot>> {
    if (instIds.length === 0) return new Map();
    // we only have metrics, so we construct snapshot with available data
    const placeholders = instIds.map(() => '?').join(',');
    const stmt = env.DB.prepare(
        `SELECT instId, aum, investAmt, leadPnl FROM watched_trader_metrics WHERE timestamp = ? AND instId IN (${placeholders})`
    ).bind(timestamp, ...instIds);

    const res = await stmt.all();
    const map = new Map<string, Snapshot>();
    if (res.results) {
        for (const r of res.results as any[]) {
            map.set(r.instId, { aum: r.aum, investAmt: r.investAmt, pnl: r.leadPnl || 0, copyTraderNum: 0 });
        }
    }
    return map;
}

function checkChange(
    msgs: string[],
    label: string,
    currentTotalAum: number, // Total (Trader + Copy)
    currentScaleAum: number, // Scale (Copy Only)
    old: Snapshot | undefined
) {
    if (!old) {
        // console.log(`[${label}] No history`);
        return;
    }

    // 1. Total AUM Check (Scale + Invest + PnL)
    const oldTotalAum = old.aum + old.investAmt + (old.pnl || 0);
    const deltaTotal = currentTotalAum - oldTotalAum;

    if (oldTotalAum > 0) {
        const pct = deltaTotal / oldTotalAum;
        if (Math.abs(pct) >= ALERT_THRESHOLD_PCT) {
            const dir = pct > 0 ? "📈 暴涨" : "📉 暴跌";
            msgs.push(`[${label}] 总资产: ${formatMoney(oldTotalAum)} -> ${formatMoney(currentTotalAum)} (${dir} ${(pct * 100).toFixed(1)}%)`);
        }
    }

    // 2. Scale AUM Check
    const oldScaleAum = old.aum;
    const deltaScale = currentScaleAum - oldScaleAum;

    if (oldScaleAum > 0) {
        const pct = deltaScale / oldScaleAum;
        if (Math.abs(pct) >= ALERT_THRESHOLD_PCT) {
            const dir = pct > 0 ? "📈 暴涨" : "📉 暴跌";
            msgs.push(`[${label}] 带单规模: ${formatMoney(oldScaleAum)} -> ${formatMoney(currentScaleAum)} (${dir} ${(pct * 100).toFixed(1)}%)`);
        }
    }
}

function formatMoney(val: number) {
    return val.toFixed(0);
}

// --------------------------------------

async function fetchLeadTraderMap(instIds: string[]): Promise<Map<string, OkxLeadTraderRow>> {
    const wanted = new Set(instIds);
    const found = new Map<string, OkxLeadTraderRow>();

    let totalPage = 1;
    for (let page = 1; page <= totalPage; page++) {
        const res = await fetchOkxJson(
            '/api/v5/copytrading/public-lead-traders',
            new URLSearchParams({
                instType: 'SWAP',
                sortType: 'overview',
                limit: '20',
                page: String(page)
            })
        );

        const data0 = res?.data?.[0];
        if (!data0) throw new Error('Unexpected OKX payload: missing data[0]');

        totalPage = parseOkxInt(data0?.totalPage, 'public-lead-traders.totalPage');

        const ranks = data0?.ranks;
        if (!Array.isArray(ranks)) throw new Error('Unexpected OKX payload: missing data[0].ranks');

        for (let i = 0; i < ranks.length; i++) {
            const t = ranks[i];
            const instId = assertNonEmptyString(t?.uniqueCode, `ranks[${i}].uniqueCode`);
            if (!wanted.has(instId) || found.has(instId)) continue;

            const nickName = assertNonEmptyString(t?.nickName, `ranks[${i}].nickName`);
            const ccy = assertNonEmptyString(t?.ccy, `ranks[${i}].ccy`);
            const leadDays = parseOkxInt(t?.leadDays, `ranks[${i}].leadDays`);
            const copyTraderNum = parseOkxInt(t?.copyTraderNum, `ranks[${i}].copyTraderNum`);
            const maxCopyTraderNum = parseOkxInt(t?.maxCopyTraderNum, `ranks[${i}].maxCopyTraderNum`);
            const avatarUrl = assertNonEmptyString(t?.portLink, `ranks[${i}].portLink`);
            const aum = parseOkxNumber(t?.aum, `ranks[${i}].aum`);
            const pnl = parseOkxNumber(t?.pnl, `ranks[${i}].pnl`);
            if (pnl !== 0) console.log(`[LeadMap] ${instId} (${nickName}) pnl=${pnl}`);

            const traderInsts = t?.traderInsts;
            if (!Array.isArray(traderInsts) || traderInsts.some((x: any) => typeof x !== 'string' || x.length === 0)) {
                throw new Error(`Invalid ranks[${i}].traderInsts`);
            }

            found.set(instId, {
                instId,
                nickName,
                ccy,
                leadDays,
                copyTraderNum,
                maxCopyTraderNum,
                avatarUrl,
                traderInsts,
                aum,
                pnl
            });
        }

        if (found.size === wanted.size) break;
    }

    const missing = instIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
        throw new Error(`Watched trader(s) not found in OKX lead-traders list: ${missing.join(', ')}`);
    }

    return found;
}

async function fetchPublicStats(instId: string): Promise<OkxStatsRow> {
    const res = await fetchOkxJson(
        '/api/v5/copytrading/public-stats',
        new URLSearchParams({ instType: 'SWAP', uniqueCode: instId, lastDays: '4' })
    );
    const row = res?.data?.[0];
    if (!row) throw new Error(`Missing OKX public-stats data for ${instId}`);

    return {
        ccy: assertNonEmptyString(row?.ccy, `public-stats.ccy for ${instId}`),
        winRatio: parseOkxNumber(row?.winRatio, `public-stats.winRatio for ${instId}`),
        profitDays: parseOkxInt(row?.profitDays, `public-stats.profitDays for ${instId}`),
        lossDays: parseOkxInt(row?.lossDays, `public-stats.lossDays for ${instId}`),
        avgSubPosNotional: parseOkxNumber(row?.avgSubPosNotional, `public-stats.avgSubPosNotional for ${instId}`),
        investAmt: parseOkxNumber(row?.investAmt, `public-stats.investAmt for ${instId}`),
        curCopyTraderPnl: parseOkxNumber(row?.curCopyTraderPnl, `public-stats.curCopyTraderPnl for ${instId}`)
    };
}

/**
 * Fetch accurate "Trader Assets" from priapi endpoint.
 * This endpoint returns the exact value shown on the OKX website.
 * URL: /priapi/v5/ecotrade/public/trader/trade-data
 */
async function fetchTradeData(instId: string): Promise<number> {
    const url = `https://www.okx.com/priapi/v5/ecotrade/public/trader/trade-data?latestNum=0&bizType=SWAP&uniqueName=${instId}`;

    console.log(`Fetching trade-data: ${url}`);

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Accept-Language': 'zh-CN',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`OKX trade-data API Error: ${response.status} - ${text}`);
    }

    const json: any = await response.json();
    if (json.code !== '0' && json.code !== 0) {
        throw new Error(`OKX trade-data API Business Error: ${JSON.stringify(json)}`);
    }

    // Find the "asset" item in nonPeriodicPart
    const nonPeriodic = json?.data?.[0]?.nonPeriodicPart;
    if (!Array.isArray(nonPeriodic)) {
        throw new Error(`Missing trade-data.nonPeriodicPart for ${instId}`);
    }

    const assetItem = nonPeriodic.find((item: any) => item.functionId === 'asset');
    if (!assetItem) {
        throw new Error(`Missing "asset" field in trade-data for ${instId}`);
    }

    const traderAsset = parseOkxNumber(assetItem.value, `trade-data.asset for ${instId}`);
    console.log(`[TradeData] ${instId} traderAsset=${traderAsset}`);

    return traderAsset;
}

async function fetchOkxJson(path: string, params: URLSearchParams): Promise<any> {
    const domain = 'https://www.okx.com';
    const url = `${domain}${path}?${params.toString()}`;

    console.log(`Fetching ${url}`);

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Accept-Language': 'zh-CN',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`OKX API Error: ${response.status} ${response.statusText} - Body: ${text}`);
    }

    const json: any = await response.json();
    if (json.code !== '0') {
        throw new Error(`OKX API Business Error: ${JSON.stringify(json)}`);
    }

    return json;
}

function ensureArray(value: unknown, name: string): any[] {
    if (!Array.isArray(value)) throw new Error(`Unexpected ${name}: expected array`);
    return value;
}

function assertNonEmptyString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing ${name}`);
    return value;
}

function parseOkxNumber(value: unknown, name: string): number {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(n)) throw new Error(`Invalid ${name}: ${String(value)}`);
    return n;
}

function parseOkxInt(value: unknown, name: string): number {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
    if (!Number.isFinite(n)) throw new Error(`Invalid ${name}: ${String(value)}`);
    return n;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    if (!Number.isFinite(limit) || limit <= 0) throw new Error('Invalid concurrency limit');
    const results: R[] = new Array(items.length);
    let idx = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
        (async () => {
            while (true) {
                const current = idx++;
                if (current >= items.length) break;
                results[current] = await fn(items[current], current);
            }
        })()
    );

    await Promise.all(workers);
    return results;
}

// PushPlus Notification
async function sendPushPlus(token: string, title: string, content: string): Promise<void> {
    const url = 'https://www.pushplus.plus/send';
    const body = {
        token,
        title,
        content,
        template: 'html',
        channel: 'wechat'
    };

    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const json: any = await resp.json();
        if (json?.code !== 200) {
            console.error('PushPlus Error:', json);
        } else {
            console.log('PushPlus Success:', json);
        }
    } catch (e) {
        console.error('PushPlus Fetch Failed:', e);
    }
}
