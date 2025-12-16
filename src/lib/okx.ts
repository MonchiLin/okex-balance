export type OkxLeadTraderRow = {
  instId: string; // uniqueCode
  nickName: string;
  ccy: string;
  leadDays: number;
  copyTraderNum: number;
  maxCopyTraderNum: number;
  avatarUrl: string; // portLink
  traderInsts: string[];
  aum: number;
};

export type OkxStatsRow = {
  ccy: string;
  winRatio: number;
  profitDays: number;
  lossDays: number;
  avgSubPosNotional: number;
  investAmt: number;
  curCopyTraderPnl: number;
};

export type OkxLeadTraderTopRow = OkxLeadTraderRow & { page: number; position: number };

export async function fetchLeadTradersTop(limit: number): Promise<OkxLeadTraderTopRow[]> {
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('Invalid limit');
  const pageSize = 20;
  const pages = Math.ceil(limit / pageSize);
  const out: OkxLeadTraderTopRow[] = [];

  for (let page = 1; page <= pages; page++) {
    const res = await fetchOkxJson(
      '/api/v5/copytrading/public-lead-traders',
      new URLSearchParams({
        instType: 'SWAP',
        sortType: 'overview',
        limit: String(pageSize),
        page: String(page)
      })
    );

    const data0 = res?.data?.[0];
    if (!data0) throw new Error('Unexpected OKX payload: missing data[0]');
    const ranks = data0?.ranks;
    if (!Array.isArray(ranks)) throw new Error('Unexpected OKX payload: missing data[0].ranks');

    for (let i = 0; i < ranks.length; i++) {
      const t = ranks[i];
      const instId = assertNonEmptyString(t?.uniqueCode, `ranks[${i}].uniqueCode`);
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

      out.push({
        instId,
        nickName,
        ccy,
        leadDays,
        copyTraderNum,
        maxCopyTraderNum,
        avatarUrl,
        traderInsts,
        aum,
        page,
        position: i + 1 + (page - 1) * pageSize
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export async function fetchLeadTraderByInstId(instId: string): Promise<OkxLeadTraderRow> {
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
      const code = assertNonEmptyString(t?.uniqueCode, `ranks[${i}].uniqueCode`);
      if (code !== instId) continue;

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

      return { instId, nickName, ccy, leadDays, copyTraderNum, maxCopyTraderNum, avatarUrl, traderInsts, aum };
    }
  }

  throw new Error(`OKX lead-traders: instId not found: ${instId}`);
}

export async function fetchPublicStats(instId: string): Promise<OkxStatsRow> {
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
  if (json.code !== '0') throw new Error(`OKX API Business Error: ${JSON.stringify(json)}`);
  return json;
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
