interface Env {
    DB: D1Database;
}

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

async function collectWatched(env: Env) {
    if (!env.DB) throw new Error('Missing D1 binding `DB`.');

    const watchedRes = await env.DB.prepare('SELECT instId FROM watched_traders').all();
    const watched = ensureArray(watchedRes.results, 'D1 watched_traders results').map((r: any) =>
        assertNonEmptyString(r?.instId, 'watched_traders.instId')
    );

    if (watched.length === 0) {
        return { message: 'No watched traders', watchedCount: 0 };
    }

    const now = Date.now();
    const bucketMs = 5 * 60 * 1000;
    const bucket = Math.floor(now / bucketMs) * bucketMs;

    const leadMap = await fetchLeadTraderMap(watched);

    const statsList = await mapLimit(watched, 2, async (instId) => {
        const stats = await fetchPublicStats(instId);
        return { instId, stats };
    });
    const statsMap = new Map(statsList.map((x) => [x.instId, x.stats]));

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

    const stmtTouchWatched = env.DB.prepare('UPDATE watched_traders SET updatedAt = ? WHERE instId = ?');

    const batch: D1PreparedStatement[] = [];
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
                stats.investAmt,
                stats.curCopyTraderPnl,
                stats.winRatio,
                stats.profitDays,
                stats.lossDays,
                stats.avgSubPosNotional,
                now
            )
        );

        batch.push(stmtTouchWatched.bind(now, instId));
    }

    const chunkSize = 90;
    for (let i = 0; i < batch.length; i += chunkSize) {
        await env.DB.batch(batch.slice(i, i + chunkSize));
    }

    return { message: 'Success', watchedCount: watched.length, timestamp: bucket };
}

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
                aum
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

async function fetchOkxJson(path: string, params: URLSearchParams): Promise<any> {
    const domain = 'https://www.okx.com';
    const url = `${domain}${path}?${params.toString()}`;

    console.log(`Fetching ${url}`);

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Accept-Language': 'zh-CN'
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
