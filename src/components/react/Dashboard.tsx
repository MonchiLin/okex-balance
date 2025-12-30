import React, { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { Loader2, Settings } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { TraderCard, type WatchedTrader } from './TraderCard';
import { BasicTraderCard, type LeadTrader } from './BasicTraderCard';
import { formatAmount } from './formatAmount';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
        const message = data && typeof data === 'object' && 'error' in (data as any) ? (data as any).error : `HTTP ${res.status}`;
        throw new Error(String(message));
    }
    return data as T;
}

// Cache entry type
type CacheEntry = {
    data: {
        instId: string;
        watched: boolean;
        info: { nickName: string; ccy: string };
        series: { timestamp: number; aum: number; investAmt: number }[];
    };
    timestamp: number; // Cache creation time
};

// Cache TTL: 2 minutes (less than the 5-minute data collection interval)
const CACHE_TTL_MS = 2 * 60 * 1000;

export const Dashboard: React.FC = () => {
    const [watched, setWatched] = useState<WatchedTrader[] | null>(null);
    const [top, setTop] = useState<LeadTrader[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Cache: Map<instId:interval, CacheEntry>
    const cacheRef = React.useRef<Map<string, CacheEntry>>(new Map());

    const [password, setPassword] = useState('');
    const [authed, setAuthed] = useState(false);
    const [instId, setInstId] = useState('');
    const [showPanel, setShowPanel] = useState(false);

    const [modalOpen, setModalOpen] = useState(false);
    const [selectedTrader, setSelectedTrader] = useState<{ instId: string; name: string; watched: boolean } | null>(null);
    const [detail, setDetail] = useState<{
        instId: string;
        watched: boolean;
        info: { nickName: string; ccy: string };
        series: { timestamp: number; aum: number; investAmt: number; leadPnl?: number }[];
    } | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [interval, setInterval] = useState<string>('5m'); // Default 5m

    const load = async () => {
        const [watchedData, topData] = await Promise.all([
            fetchJson<WatchedTrader[]>('/api/watch/list.json'),
            fetchJson<{ top: (LeadTrader & { watched: boolean })[] }>('/api/traders.json')
        ]);
        if (!Array.isArray(watchedData)) throw new Error('Invalid watch list');
        if (!topData || !Array.isArray(topData.top)) throw new Error('Invalid top list');
        setWatched(watchedData);
        setTop(topData.top);
    };

    useEffect(() => {
        load()
            .then(() => setLoading(false))
            .catch((err) => {
                console.error(err);
                setError(err instanceof Error ? err.message : 'Failed to load');
                setLoading(false);
            });

        // check auth cookie so用户不必每次输入
        (async () => {
            try {
                const res = await fetch('/api/auth/status.json');
                if (res.ok) setAuthed(true);
            } catch {
                // ignore
            }
        })();
    }, []);

    const verifyPassword = async () => {
        setBusy(true);
        try {
            await fetchJson('/api/auth/verify.json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            setAuthed(true);
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : 'Verify failed');
        } finally {
            setBusy(false);
        }
    };

    const toggleWatch = async (id: string): Promise<boolean> => {
        setBusy(true);
        try {
            await fetchJson('/api/watch/toggle.json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instId: id })
            });
            await load();
            return true;
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : 'Toggle failed');
            return false;
        } finally {
            setBusy(false);
        }
    };

    const addWatch = async (id?: string) => {
        const target = (id ?? instId).trim();
        if (!authed) {
            setError('Not authenticated: please verify password first');
            return;
        }
        if (target.length === 0) {
            setError('instId is required');
            return;
        }
        const ok = await toggleWatch(target);
        if (ok) setInstId('');
    };

    const refreshNow = async () => {
        if (!authed) {
            setError('Not authenticated: please verify password first');
            return;
        }
        setRefreshing(true);
        try {
            await fetchJson('/api/refresh.json', { method: 'POST' });
            await load();
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : '刷新失败');
        } finally {
            setRefreshing(false);
        }
    };

    const loadTraderDetail = async (id: string, intervalParam: string) => {
        const cacheKey = `${id}:${intervalParam}`;
        const now = Date.now();

        // Check cache first
        const cached = cacheRef.current.get(cacheKey);
        if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
            // Cache hit and still valid
            console.log(`[Cache] Hit for ${cacheKey}, age: ${Math.round((now - cached.timestamp) / 1000)}s`);
            setDetail(cached.data);
            setDetailLoading(false);
            return;
        }

        setDetailLoading(true);
        setDetailError(null);
        try {
            const data = await fetchJson<{
                instId: string;
                watched: boolean;
                info: { nickName: string; ccy: string };
                series: { timestamp: number; aum: number; investAmt: number }[];
            }>(`/api/trader/${encodeURIComponent(id)}.json?interval=${intervalParam}`);

            // Store in cache
            cacheRef.current.set(cacheKey, {
                data,
                timestamp: now
            });

            // Clean up old cache entries (keep cache size manageable)
            if (cacheRef.current.size > 20) {
                const entries = Array.from(cacheRef.current.entries());
                entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
                // Remove oldest 5 entries
                for (let i = 0; i < 5; i++) {
                    cacheRef.current.delete(entries[i][0]);
                }
            }

            setDetail(data);
        } catch (err) {
            console.error(err);
            const msg = err instanceof Error ? err.message : '加载明细失败';
            setDetailError(msg.includes('not found') || msg.includes('No metrics') ? '暂无数据，需要先观察才会落库' : msg);
        } finally {
            setDetailLoading(false);
        }
    };

    const openTrader = async (id: string, name: string, isWatched: boolean) => {
        setSelectedTrader({ instId: id, name, watched: isWatched });
        setModalOpen(true);
        setDetail(null);
        await loadTraderDetail(id, interval);
    };

    // Reload data when interval changes
    React.useEffect(() => {
        if (selectedTrader && modalOpen) {
            loadTraderDetail(selectedTrader.instId, interval);
        }
    }, [interval]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <Loader2 className="animate-spin text-blue-500" size={48} />
            </div>
        );
    }

    if (error) {
        throw new Error(error);
    }

    if (!watched) {
        throw new Error('Missing watched state');
    }

    const watchedMap = new Map(watched.map((w) => [w.instId, w]));
    const unwatchedTop = top.filter((t) => !watchedMap.has(t.instId));

    return (
        <div className="container mx-auto px-4 py-8 relative">
            <button
                type="button"
                onClick={() => setShowPanel((v) => !v)}
                className="fixed top-4 left-4 inline-flex items-center gap-2 rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white hover:border-blue-500 shadow-lg z-10"
            >
                <Settings size={16} />
                设置
            </button>

            {showPanel && (
                <div className="fixed top-16 left-4 w-80 bg-gray-900 border border-gray-700 rounded-lg p-4 shadow-xl z-20">
                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">管理密码</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
                                placeholder="输入 ADMIN_PASSWORD"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={verifyPassword}
                            disabled={busy || password.length === 0}
                            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                            {authed ? '已验证' : '验证密码'}
                        </button>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">观察交易员（instId = uniqueCode）</label>
                            <div className="flex gap-2">
                                <input
                                    value={instId}
                                    onChange={(e) => setInstId(e.target.value)}
                                    className="flex-1 rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
                                    placeholder="例如：F2BCA22ABBB69F57"
                                />
                                <button
                                    type="button"
                                    onClick={() => addWatch()}
                                    disabled={busy || !authed || instId.trim().length === 0}
                                    className="rounded-md bg-purple-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                                >
                                    观察
                                </button>
                            </div>
                        </div>
                        <div className="text-[11px] text-gray-500">数据每 5 分钟由 Cron 更新；新增观察立即写入一次。</div>
                        <button
                            type="button"
                            onClick={refreshNow}
                            disabled={refreshing || busy || !authed}
                            className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                            {refreshing ? '刷新中…' : '手动刷新数据（拉取 OKX → D1）'}
                        </button>
                    </div>
                </div>
            )}

            <h1 className="text-3xl font-bold text-white mb-6 text-center bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
                OKX 合约带单（SWAP）观察
            </h1>

            <div className="mb-8">
                <h2 className="text-lg font-semibold text-white mb-3">已观察（优先展示）</h2>
                {watched.length === 0 ? (
                    <div className="text-sm text-gray-400">暂无观察交易员。</div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {watched.map((trader) => (
                            <TraderCard
                                key={trader.instId}
                                trader={trader}
                                canToggle={authed}
                                onToggle={toggleWatch}
                                onOpen={openTrader}
                            />
                        ))}
                    </div>
                )}
            </div>

            <div>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold text-white">前 50 交易员（未观察）</h2>
                    <span className="text-xs text-gray-500">已观察的不会重复显示</span>
                </div>
                {unwatchedTop.length === 0 ? (
                    <div className="text-sm text-gray-400">没有更多未观察的交易员。</div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {unwatchedTop.map((trader) => (
                            <BasicTraderCard
                                key={trader.instId}
                                trader={trader}
                                onWatch={(id) => addWatch(id)}
                                disabled={busy || !authed}
                                onOpen={openTrader}
                            />
                        ))}
                    </div>
                )}
            </div>

            <Dialog.Root open={modalOpen} onOpenChange={(v) => {
                setModalOpen(v);
                if (!v) {
                    setSelectedTrader(null);
                    setDetail(null);
                    setDetailError(null);
                    setDetailLoading(false);
                    setInterval('5m');
                }
            }}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" />
                    <Dialog.Content className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-4xl max-h-[90vh] overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <Dialog.Title className="text-xl font-semibold text-white">
                                    {selectedTrader?.name ?? '交易员详情'}
                                </Dialog.Title>
                                <Dialog.Description className="text-sm text-gray-400">
                                    {selectedTrader?.instId}
                                </Dialog.Description>
                            </div>
                            <Dialog.Close asChild>
                                <button
                                    type="button"
                                    className="rounded-md bg-gray-800 px-3 py-1 text-sm text-gray-200 hover:bg-gray-700"
                                >
                                    关闭
                                </button>
                            </Dialog.Close>
                        </div>

                        {detailLoading ? (
                            <div className="flex items-center justify-center h-60 text-gray-300 gap-2">
                                <Loader2 className="animate-spin" size={20} />
                                加载中...
                            </div>
                        ) : detailError ? (
                            <div className="text-red-400 text-sm">{detailError}</div>
                        ) : detail ? (
                            <Tabs.Root defaultValue="total" className="flex flex-col h-full">
                                <div className="flex items-center justify-between border-b border-gray-700 mb-4 pb-2">
                                    <Tabs.List className="inline-flex space-x-2">
                                        <Tabs.Trigger
                                            value="total"
                                            className="px-3 py-2 text-sm text-gray-300 data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
                                        >
                                            交易员带单资产
                                        </Tabs.Trigger>
                                        <Tabs.Trigger
                                            value="scale"
                                            className="px-3 py-2 text-sm text-gray-300 data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
                                        >
                                            带单规模
                                        </Tabs.Trigger>
                                    </Tabs.List>

                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-400">周期:</span>
                                        <select
                                            value={interval}
                                            onChange={(e) => setInterval(e.target.value)}
                                            className="bg-gray-800 text-xs text-white border border-gray-600 rounded px-2 py-1 outline-none focus:border-blue-500"
                                        >
                                            <option value="5m">原始 (5m)</option>
                                            <option value="15m">15 分钟</option>
                                            <option value="30m">30 分钟</option>
                                            <option value="1h">1 小时</option>
                                            <option value="2h">2 小时</option>
                                            <option value="4h">4 小时</option>
                                            <option value="8h">8 小时</option>
                                            <option value="1d">1 天</option>
                                            <option value="1w">1 周</option>
                                        </select>
                                    </div>
                                </div>

                                <Tabs.Content value="total" className="flex-1">
                                    <div className="h-80">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart
                                                data={detail.series.map((s) => ({
                                                    ...s,
                                                    // "Trader Assets" = investAmt + leadPnl
                                                    investAmt: s.investAmt + (s.leadPnl || 0),
                                                    timeLabel: new Date(s.timestamp).toLocaleString()
                                                }))}
                                            >
                                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                                <XAxis dataKey="timeLabel" tick={{ fill: '#9CA3AF', fontSize: 11 }} hide />
                                                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                                                <Tooltip
                                                    contentStyle={{ background: '#111827', border: '1px solid #374151', color: '#E5E7EB' }}
                                                    labelFormatter={(label) => label}
                                                    formatter={(value: number | undefined) => [formatAmount(value ?? 0, detail.info.ccy), '交易员带单资产']}
                                                />
                                                <Line type="monotone" dataKey="investAmt" stroke="#60A5FA" dot={false} strokeWidth={2} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </Tabs.Content>

                                <Tabs.Content value="scale" className="flex-1">
                                    <div className="h-80">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart
                                                data={detail.series.map((s) => ({
                                                    ...s,
                                                    timeLabel: new Date(s.timestamp).toLocaleString()
                                                }))}
                                            >
                                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                                <XAxis dataKey="timeLabel" tick={{ fill: '#9CA3AF', fontSize: 11 }} hide />
                                                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                                                <Tooltip
                                                    contentStyle={{ background: '#111827', border: '1px solid #374151', color: '#E5E7EB' }}
                                                    labelFormatter={(label) => label}
                                                    formatter={(value: number | undefined) => [formatAmount(value ?? 0, detail.info.ccy), '带单规模']}
                                                />
                                                <Line type="monotone" dataKey="aum" stroke="#A78BFA" dot={false} strokeWidth={2} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </Tabs.Content>
                            </Tabs.Root>
                        ) : (
                            <div className="text-sm text-gray-400">请选择交易员查看详情</div>
                        )}
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </div >
    );
};

// Downsampling is now handled by the API, so this function is removed

