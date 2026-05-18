type FormatNumberOptions = {
  minDecimals?: number;     // default: 0
  maxDecimals?: number;     // default: 2
  fallback?: string;        // default: "—"
  symbol?: string;          // default: "$"
};

export function formatNumber(
  value: unknown,
  {
    minDecimals = 0,
    maxDecimals = 2,
    fallback = "—",
    symbol = "",
  }: FormatNumberOptions = {}
): string {
  if (value === null || value === undefined) return fallback;

  let num: number;

  try {
    if (typeof value === "number") num = value;
    else if (typeof value === "bigint") num = Number(value);
    else if (typeof value === "string") {
      const cleaned = value.replace(/[^0-9.-]/g, "");
      if (!cleaned || cleaned === "-" || cleaned === ".") return fallback;
      num = Number(cleaned);
    } else {
      num = Number(value as any);
    }
  } catch {
    return fallback;
  }

  if (!Number.isFinite(num)) return fallback;

  return `${symbol}${num.toLocaleString("en-US", {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  })}`;
}
