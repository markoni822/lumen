import { createServerFn } from "@tanstack/react-start";
import { GRANS, PAIRS, type Granularity, type SymbolId } from "@/lib/catalog";
import type { Candle } from "@/lib/engine";

export type Tick = {
  symbol: SymbolId;
  last: number;
  change24h: number;
  high: number;
  low: number;
  quoteVol: number;
};

export type MarketBook = {
  symbol: SymbolId;
  granularity: Granularity;
  candles: Candle[];
  ticks: Tick[];
  fetchedAt: number;
  /** Ile świec prosiliśmy Bitget o — Bitget dla doby oddaje tylko 300. */
  candleLimit: number;
};

const SYMBOL_SET = new Set<string>(PAIRS.map((p) => p.symbol));
const GRAN_SET = new Set<string>(GRANS.map((g) => g.id));

/** Bitget oddaje maksymalnie 1000 świec na interwał (dla doby — tylko 300). */
const CANDLE_LIMIT = 1000;

const cache = new Map<string, { at: number; book: MarketBook }>();

function asSymbol(value: unknown): SymbolId {
  if (typeof value === "string" && SYMBOL_SET.has(value)) return value as SymbolId;
  throw new Error("Nieobsługiwana para.");
}

function asGran(value: unknown): Granularity {
  if (typeof value === "string" && GRAN_SET.has(value)) return value as Granularity;
  throw new Error("Nieobsługiwany interwał.");
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

async function bitget(path: string): Promise<unknown> {
  const response = await fetch(`https://api.bitget.com${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Bitget odpowiedział ${response.status}.`);
  const body = (await response.json()) as { code?: string; msg?: string; data?: unknown };
  if (body.code !== "00000" || body.data == null) {
    throw new Error(body.msg || "Bitget nie zwrócił notowań.");
  }
  return body.data;
}

function parseCandles(data: unknown): Candle[] {
  if (!Array.isArray(data)) return [];
  const candles: Candle[] = [];
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const t = num(row[0]);
    const o = num(row[1]);
    const h = num(row[2]);
    const l = num(row[3]);
    const c = num(row[4]);
    const v = num(row[5]);
    if (t == null || o == null || h == null || l == null || c == null || v == null) continue;
    if (c <= 0 || h < l) continue;
    candles.push({ t, o, h, l, c, v });
  }
  candles.sort((a, b) => a.t - b.t);
  const unique: Candle[] = [];
  for (const candle of candles) {
    if (unique.length && unique[unique.length - 1].t === candle.t) unique[unique.length - 1] = candle;
    else unique.push(candle);
  }
  return unique;
}

function parseTick(symbol: SymbolId, data: unknown): Tick | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const ticker = row as Record<string, unknown>;
  const last = num(ticker.lastPr);
  const change = num(ticker.change24h);
  const high = num(ticker.high24h);
  const low = num(ticker.low24h);
  const quoteVol = num(ticker.usdtVolume) ?? num(ticker.quoteVolume);
  if (last == null || change == null || high == null || low == null || quoteVol == null) return null;
  return { symbol, last, change24h: change, high, low, quoteVol };
}

export const getMarketBook = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { symbol?: unknown; granularity?: unknown }) : {};
    return { symbol: asSymbol(raw.symbol), granularity: asGran(raw.granularity) };
  })
  .handler(async ({ data }): Promise<MarketBook> => {
    const key = `${data.symbol}:${data.granularity}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 8000) return hit.book;

    const candlePath = `/api/v2/spot/market/candles?symbol=${data.symbol}&granularity=${data.granularity}&limit=${CANDLE_LIMIT}`;
    const [candleData, tickRows] = await Promise.all([
      bitget(candlePath),
      Promise.all(
        PAIRS.map(async (pair) => {
          try {
            const row = await bitget(`/api/v2/spot/market/tickers?symbol=${pair.symbol}`);
            return parseTick(pair.symbol, row);
          } catch {
            return null;
          }
        }),
      ),
    ]);

    const candles = parseCandles(candleData);
    if (candles.length < 80) throw new Error("Bitget zwrócił za mało świec do testu.");
    const ticks = tickRows.filter((tick): tick is Tick => tick != null);
    if (!ticks.some((tick) => tick.symbol === data.symbol)) {
      const last = candles[candles.length - 1];
      ticks.push({
        symbol: data.symbol,
        last: last.c,
        change24h: 0,
        high: last.h,
        low: last.l,
        quoteVol: 0,
      });
    }

    const book: MarketBook = {
      symbol: data.symbol,
      granularity: data.granularity,
      candles,
      ticks,
      fetchedAt: Date.now(),
      candleLimit: CANDLE_LIMIT,
    };
    cache.set(key, { at: Date.now(), book });
    return book;
  });
