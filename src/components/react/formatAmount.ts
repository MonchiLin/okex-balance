export function formatAmount(value: number, ccy?: string): string {
    if (!Number.isFinite(value)) return '-';
    const abs = Math.abs(value);
    let formatted: string;
    if (abs >= 1e8) {
        formatted = `${(value / 1e8).toFixed(2)} 亿`;
    } else if (abs >= 1e4) {
        formatted = `${(value / 1e4).toFixed(2)} 万`;
    } else {
        formatted = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return ccy ? `${formatted} ${ccy}` : formatted;
}
