export const PAIRS = [
  { symbol: "BTCUSDT", name: "Bitcoin", short: "BTC" },
  { symbol: "ETHUSDT", name: "Ethereum", short: "ETH" },
  { symbol: "SOLUSDT", name: "Solana", short: "SOL" },
  { symbol: "XRPUSDT", name: "XRP", short: "XRP" },
  { symbol: "BNBUSDT", name: "BNB", short: "BNB" },
  { symbol: "DOGEUSDT", name: "Dogecoin", short: "DOGE" },
  { symbol: "ADAUSDT", name: "Cardano", short: "ADA" },
  { symbol: "AVAXUSDT", name: "Avalanche", short: "AVAX" },
] as const;

export type SymbolId = (typeof PAIRS)[number]["symbol"];

export const GRANS = [
  { id: "15min", label: "15 min", ms: 15 * 60 * 1000 },
  { id: "1h", label: "1 godz.", ms: 60 * 60 * 1000 },
  { id: "4h", label: "4 godz.", ms: 4 * 60 * 60 * 1000 },
  { id: "1day", label: "1 dzień", ms: 24 * 60 * 60 * 1000 },
] as const;

export type Granularity = (typeof GRANS)[number]["id"];

export function granMs(id: Granularity): number {
  return GRANS.find((g) => g.id === id)?.ms ?? 60 * 60 * 1000;
}

export function pairShort(symbol: string): string {
  return PAIRS.find((p) => p.symbol === symbol)?.short ?? symbol.replace("USDT", "");
}

export const STRATEGIES = [
  {
    id: "ema",
    name: "Przecięcie EMA",
    blurb: "Jest w monecie, gdy szybka średnia idzie nad wolną.",
  },
  {
    id: "rsi",
    name: "RSI, powrót",
    blurb: "Kupuje wyprzedanie, sprzedaje gdy wskaźnik odreaguje.",
  },
  {
    id: "donchian",
    name: "Kanał Donchiana",
    blurb: "Wchodzi na wybiciu górą, wychodzi po zejściu dołem.",
  },
  {
    id: "bollinger",
    name: "Wstęgi Bollingera",
    blurb: "Kupuje pod dolną wstęgą, sprzedaje przy średniej.",
  },
] as const;

export type StrategyId = (typeof STRATEGIES)[number]["id"];
