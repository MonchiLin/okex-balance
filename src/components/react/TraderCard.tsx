import React from 'react';
import { EyeOff } from 'lucide-react';
import { formatAmount } from './formatAmount';

export type WatchedTrader = {
    instId: string;
    watchedCreatedAt: number;
    watchedUpdatedAt: number;
    info: {
        nickName: string;
        ccy: string;
        leadDays: number;
        copyTraderNum: number;
        maxCopyTraderNum: number;
        avatarUrl: string;
        traderInsts: string[];
        uTime: number;
    };
    metrics: {
        timestamp: number;
        aum: number;
        investAmt: number;
        curCopyTraderPnl: number;
        winRatio: number;
        profitDays: number;
        lossDays: number;
        avgSubPosNotional: number;
        uTime: number;
    };
};

interface TraderCardProps {
    trader: WatchedTrader;
    canToggle?: boolean;
    onToggle?: (instId: string) => void;
    onOpen?: (instId: string, name: string, isWatched: boolean) => void;
}

export const TraderCard: React.FC<TraderCardProps> = ({ trader, canToggle = false, onToggle, onOpen }) => {
    const { info, metrics } = trader;
    // Align with OKX official definition: "Trader Assets" = investAmt (own funds)
    const traderAsset = metrics.investAmt;

    const requiredNumbers: Array<[unknown, string]> = [
        [info.leadDays, 'leadDays'],
        [info.copyTraderNum, 'copyTraderNum'],
        [info.maxCopyTraderNum, 'maxCopyTraderNum'],
        [metrics.aum, 'aum'],
        [metrics.investAmt, 'investAmt'],
        [metrics.curCopyTraderPnl, 'curCopyTraderPnl'],
        [metrics.winRatio, 'winRatio'],
        [metrics.profitDays, 'profitDays'],
        [metrics.lossDays, 'lossDays'],
        [metrics.avgSubPosNotional, 'avgSubPosNotional']
    ];

    for (const [value, name] of requiredNumbers) {
        const n = Number(value);
        if (!Number.isFinite(n)) throw new Error(`Invalid ${name} for trader ${trader.instId}`);
    }
    if (!Array.isArray(info.traderInsts)) throw new Error(`Invalid traderInsts for trader ${trader.instId}`);

    const ccy = info.ccy;
    const updatedAt = new Date(metrics.timestamp).toLocaleString();
    const instPreview = info.traderInsts.slice(0, 6);
    const instMore = info.traderInsts.length - instPreview.length;

    return (
        <div
            className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-blue-500 transition-colors shadow-lg cursor-pointer"
            onClick={() => onOpen?.(trader.instId, info.nickName, true)}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                    <img
                        src={info.avatarUrl}
                        alt={info.nickName}
                        className="h-10 w-10 rounded-full border border-gray-700 object-cover flex-shrink-0"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                    />
                    <div className="min-w-0">
                        <h3 className="text-lg font-bold text-white truncate" title={info.nickName}>
                            {info.nickName}
                        </h3>
                        <div className="text-xs text-gray-400 truncate" title={trader.instId}>
                            ID: {trader.instId}
                        </div>
                        <div className="text-[11px] text-gray-500 mt-1">
                            Updated: {updatedAt}
                        </div>
                    </div>
                </div>

                {canToggle && onToggle && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggle(trader.instId);
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600"
                        title="取消观察"
                    >
                        <EyeOff size={14} />
                        取消
                    </button>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                    <p className="text-xs text-gray-400 mb-1">币种</p>
                    <div className="text-sm font-semibold text-blue-300">{ccy}</div>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">带单天数</p>
                    <div className="text-sm font-semibold text-blue-300">{info.leadDays}</div>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">跟单人数</p>
                    <div className="text-sm font-semibold text-blue-300">
                        {info.copyTraderNum}/{info.maxCopyTraderNum}
                    </div>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">胜率</p>
                    <div className="text-sm font-semibold text-blue-300">{(metrics.winRatio * 100).toFixed(2)}%</div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                    <p className="text-xs text-gray-400 mb-1">交易员带单资产</p>
                    <div className="text-sm font-semibold text-purple-300">
                        {formatAmount(traderAsset, ccy)}
                    </div>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">带单规模</p>
                    <div className="text-sm font-semibold text-purple-300">
                        {formatAmount(metrics.aum, ccy)}
                    </div>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">当前跟单用户收益</p>
                    <div className="text-sm font-semibold text-green-300">
                        {formatAmount(metrics.curCopyTraderPnl, ccy)}
                    </div>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">平均仓位价值</p>
                    <div className="text-sm font-semibold text-purple-300">
                        {formatAmount(metrics.avgSubPosNotional, ccy)}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                    <p className="text-xs text-gray-400 mb-1">盈利天数</p>
                    <div className="text-sm font-semibold text-green-300">{metrics.profitDays}</div>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">亏损天数</p>
                    <div className="text-sm font-semibold text-red-300">{metrics.lossDays}</div>
                </div>
            </div>

            <div className="mt-4">
                <p className="text-xs text-gray-400 mb-2">带单品种</p>
                <div className="flex flex-wrap gap-1">
                    {instPreview.map((x) => (
                        <span key={x} className="text-[11px] rounded bg-gray-700 px-2 py-0.5 text-gray-200">
                            {x}
                        </span>
                    ))}
                    {instMore > 0 && (
                        <span className="text-[11px] rounded bg-gray-700 px-2 py-0.5 text-gray-200">+{instMore}</span>
                    )}
                </div>
            </div>
        </div>
    );
};
