import React from 'react';
import { formatAmount } from './formatAmount';

export type LeadTrader = {
    instId: string;
    nickName: string;
    ccy: string;
    leadDays: number;
    copyTraderNum: number;
    maxCopyTraderNum: number;
    avatarUrl: string;
    traderInsts: string[];
    aum: number;
    position?: number;
};

interface Props {
    trader: LeadTrader;
    onWatch?: (instId: string) => void;
    disabled?: boolean;
    onOpen?: (instId: string, name: string, isWatched: boolean) => void;
    isWatched?: boolean;
}

export const BasicTraderCard: React.FC<Props> = ({ trader, onWatch, disabled, onOpen, isWatched = false }) => {
    const instPreview = trader.traderInsts.slice(0, 6);
    const instMore = trader.traderInsts.length - instPreview.length;

    return (
        <div
            className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-blue-500 transition-colors shadow-lg cursor-pointer"
            onClick={() => onOpen?.(trader.instId, trader.nickName, isWatched)}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                    <img
                        src={trader.avatarUrl}
                        alt={trader.nickName}
                        className="h-10 w-10 rounded-full border border-gray-700 object-cover flex-shrink-0"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                    />
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-white truncate" title={trader.nickName}>
                                {trader.nickName}
                            </h3>
                            {typeof trader.position === 'number' && (
                                <span className="text-[11px] text-gray-400">#{trader.position}</span>
                            )}
                        </div>
                        <div className="text-xs text-gray-400 truncate" title={trader.instId}>
                            ID: {trader.instId}
                        </div>
                    </div>
                </div>

                {onWatch && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onWatch(trader.instId);
                        }}
                        disabled={disabled}
                        className="inline-flex items-center gap-1 rounded-md bg-purple-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    >
                        观察
                    </button>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                    <p className="text-xs text-gray-400 mb-1">币种</p>
                    <div className="text-sm font-semibold text-blue-300">{trader.ccy}</div>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">带单天数</p>
                    <div className="text-sm font-semibold text-blue-300">{trader.leadDays}</div>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">跟单人数</p>
                    <div className="text-sm font-semibold text-blue-300">
                        {trader.copyTraderNum}/{trader.maxCopyTraderNum}
                    </div>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">带单规模</p>
                    <div className="text-sm font-semibold text-purple-300">
                        {formatAmount(trader.aum, trader.ccy)}
                    </div>
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
