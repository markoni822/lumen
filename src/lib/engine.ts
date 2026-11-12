import { granMs, type Granularity, type StrategyId } from "./catalog.ts";

export type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type Params = {
  emaFast: number;
  emaSlow: number;
  rsiLen: number;
  rsiBuy: number;
  rsiSell: number;
  donEntry: number;
  donExit: number;
  bbLen: number;
  bbK: number;
  stopPct: number;
  feePct: number;
};

export const DEFAULT_PARAMS: Params = {
  emaFast: 20,
  emaSlow: 60,
  rsiLen: 14,
  rsiBuy: 30,
  rsiSell: 55,
  donEntry: 20,
  donExit: 10,
  bbLen: 20,
  bbK: 2,
  stopPct: 6,
  feePct: 0.1,
};

export type Cost = {
  feeRate: number;
  slippage: number;
  alloc: number;
  stopPct: number;
};

const SLIPPAGE = 0.0005;
const ALLOC = 0.98;

export function toCost(params: Params): Cost {
  return {
    feeRate: clamp(params.feePct, 0, 0.5) / 100,
    slippage: SLIPPAGE,
    alloc: ALLOC,
    stopPct: clamp(params.stopPct, 0, 30) / 100,
  };
}

export type Trade = {
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  pnl: number;
  pnlPct: number;
  reason: "signal" | "stop";
};

export type CurvePoint = { t: number; equity: number; hold: number };

export type RunStats = {
  enough: boolean;
  finalEquity: number;
  returnPct: number;
  holdPct: number;
  maxDrawdownPct: number;
  winRate: number | null;
  profitFactor: number | null;
  trades: Trade[];
  curve: CurvePoint[];
  exposurePct: number;
  capital: number;
};

type BookPos = {
  cash: number;
  qty: number;
  fill: number;
  basis: number;
  entryTime: number;
};

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  const p = Math.max(2, Math.round(period));
  if (values.length < p) return out;
  let sum = 0;
  for (let i = 0; i < p; i++) sum += values[i];
  let prev = sum / p;
  out[p - 1] = prev;
  const k = 2 / (p + 1);
  for (let i = p; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  const p = Math.max(2, Math.round(period));
  if (values.length <= p) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= p; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / p;
  let avgL = loss / p;
  const at = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[p] = at(avgG, avgL);
  for (let i = p + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgG = (avgG * (p - 1) + (d > 0 ? d : 0)) / p;
    avgL = (avgL * (p - 1) + (d < 0 ? -d : 0)) / p;
    out[i] = at(avgG, avgL);
  }
  return out;
}

function desiredSeries(candles: Candle[], strategy: StrategyId, params: Params): boolean[] {
  const closes = candles.map((c) => c.c);
  const want = new Array<boolean>(candles.length).fill(false);
  if (strategy === "ema") {
    const fast = ema(closes, params.emaFast);
    const slow = ema(closes, Math.max(params.emaSlow, params.emaFast + 2));
    for (let i = 0; i < candles.length; i++) {
      want[i] = Number.isFinite(fast[i]) && Number.isFinite(slow[i]) && fast[i] > slow[i];
    }
    return want;
  }
  if (strategy === "rsi") {
    const series = rsi(closes, params.rsiLen);
    const buy = clamp(params.rsiBuy, 5, 50);
    const sell = clamp(params.rsiSell, buy + 5, 90);
    let long = false;
    for (let i = 1; i < candles.length; i++) {
      const prev = series[i - 1];
      const cur = series[i];
      if (!Number.isFinite(prev) || !Number.isFinite(cur)) {
        want[i] = long;
        continue;
      }
      if (!long && prev < buy && cur >= buy) long = true;
      else if (long && prev < sell && cur >= sell) long = false;
      want[i] = long;
    }
    return want;
  }
  if (strategy === "donchian") {
    const entryN = Math.max(5, Math.round(params.donEntry));
    const exitN = Math.max(3, Math.round(params.donExit));
    let long = false;
    for (let i = 0; i < candles.length; i++) {
      if (i >= entryN) {
        let hh = Number.NEGATIVE_INFINITY;
        for (let k = i - entryN; k < i; k++) hh = Math.max(hh, candles[k].h);
        if (!long && candles[i].c > hh) long = true;
      }
      if (long && i >= exitN) {
        let ll = Number.POSITIVE_INFINITY;
        for (let k = i - exitN; k < i; k++) ll = Math.min(ll, candles[k].l);
        if (candles[i].c < ll) long = false;
      }
      want[i] = long;
    }
    return want;
  }
  const len = Math.max(8, Math.round(params.bbLen));
  const k = clamp(params.bbK, 0.8, 4);
  let long = false;
  for (let i = 0; i < candles.length; i++) {
    if (i >= len - 1) {
      let sum = 0;
      for (let j = i - len + 1; j <= i; j++) sum += closes[j];
      const mid = sum / len;
      let variance = 0;
      for (let j = i - len + 1; j <= i; j++) {
        const d = closes[j] - mid;
        variance += d * d;
      }
      const sd = Math.sqrt(variance / len);
      const lower = mid - k * sd;
      if (!long && closes[i] < lower) long = true;
      else if (long && closes[i] > mid) long = false;
    }
    want[i] = long;
  }
  return want;
}

function enter(cash: number, px: number, cost: Cost, time: number): BookPos | null {
  const fill = px * (1 + cost.slippage);
  if (!(fill > 0) || !(cash > 10)) return null;
  const notional = (cash * cost.alloc) / (1 + cost.feeRate);
  const fee = notional * cost.feeRate;
  if (notional < 5) return null;
  return {
    cash: cash - notional - fee,
    qty: notional / fill,
    fill,
    basis: notional + fee,
    entryTime: time,
  };
}

function leave(pos: BookPos, px: number, cost: Cost): { cash: number; fill: number; pnl: number } {
  const fill = px * (1 - cost.slippage);
  const notional = pos.qty * fill;
  const fee = notional * cost.feeRate;
  const proceeds = notional - fee;
  return { cash: pos.cash + proceeds, fill, pnl: proceeds - pos.basis };
}

function holdPosition(
  candles: Candle[],
  fromIndex: number,
  capital: number,
  cost: Cost,
): BookPos | null {
  const start = clamp(Math.floor(fromIndex), 0, candles.length - 1);
  const anchor = candles[Math.min(start + (start === 0 ? 1 : 0), candles.length - 1)];
  return enter(capital, anchor.o, cost, anchor.t);
}

/**
 * Trzymanie monety liczone na oknie [fromIndex, toIndex) — to samo okno, na
 * którym liczona jest strategia. Dzięki temu obie liczby są porównywalne.
 */
export function holdReturnPct(
  candles: Candle[],
  fromIndex: number,
  toIndex: number,
  capital: number,
  params: Params,
): number {
  const cost = toCost(params);
  const end = clamp(Math.floor(toIndex), 1, candles.length);
  const pos = holdPosition(candles, fromIndex, capital, cost);
  if (!pos) return 0;
  const lastPx = candles[end - 1].c;
  return (leave(pos, lastPx, cost).cash / capital - 1) * 100;
}

export function backtest(
  candles: Candle[],
  strategy: StrategyId,
  params: Params,
  capital: number,
  fromIndex = 0,
  toIndex = candles.length,
): RunStats {
  const empty: RunStats = {
    enough: false,
    finalEquity: capital,
    returnPct: 0,
    holdPct: 0,
    maxDrawdownPct: 0,
    winRate: null,
    profitFactor: null,
    trades: [],
    curve: [],
    exposurePct: 0,
    capital,
  };
  if (candles.length < 80 || !(capital > 0)) return empty;
  const cost = toCost(params);
  const desired = desiredSeries(candles, strategy, params);
  const end = clamp(Math.floor(toIndex), 2, candles.length);
  const start = clamp(Math.floor(fromIndex), 0, Math.max(0, end - 2));
  let pos: BookPos | null = null;
  let cooling = false;
  const trades: Trade[] = [];
  const curve: CurvePoint[] = [];
  let bars = 0;
  let inBars = 0;
  let peak = capital;
  let maxDd = 0;

  const holdPos = holdPosition(candles, start, capital, cost);

  let cash = capital;
  for (let i = start; i < end; i++) {
    if ((start > 0 && i >= start) || (start === 0 && i > 0)) {
      const wantRaw = desired[i - 1];
      if (cooling && !wantRaw) cooling = false;
      const want = wantRaw && !cooling;
      if (want && !pos) {
        const opened = enter(cash, candles[i].o, cost, candles[i].t);
        if (opened) {
          pos = opened;
          cash = opened.cash;
        }
      } else if (!want && pos) {
        const closed = leave(pos, candles[i].o, cost);
        trades.push(tradeOf(pos, closed.fill, closed.pnl, candles[i].t, "signal"));
        cash = closed.cash;
        pos = null;
      }
    }

    if (pos && cost.stopPct > 0) {
      const stop = pos.fill * (1 - cost.stopPct);
      if (candles[i].l <= stop) {
        const px = candles[i].o < stop ? candles[i].o : stop;
        const closed = leave(pos, px, cost);
        trades.push(tradeOf(pos, closed.fill, closed.pnl, candles[i].t, "stop"));
        cash = closed.cash;
        pos = null;
        cooling = true;
      }
    }

    const mark = cash + (pos ? pos.qty * candles[i].c : 0);
    const hold =
      holdPos == null
        ? capital
        : holdPos.cash + holdPos.qty * candles[i].c;
    curve.push({ t: candles[i].t, equity: mark, hold });
    bars += 1;
    if (pos) inBars += 1;
    peak = Math.max(peak, mark);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - mark) / peak);
  }

  const lastPx = candles[end - 1].c;
  const finalEquity = pos ? leave(pos, lastPx, cost).cash : cash;
  const holdFinal = holdPos ? leave(holdPos, lastPx, cost).cash : capital;
  const wins = trades.filter((t) => t.pnl > 0);
  const grossP = trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossL = trades.filter((t) => t.pnl < 0).reduce((s, t) => s + Math.abs(t.pnl), 0);

  return {
    enough: true,
    finalEquity,
    returnPct: (finalEquity / capital - 1) * 100,
    holdPct: (holdFinal / capital - 1) * 100,
    maxDrawdownPct: maxDd * 100,
    winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    profitFactor: trades.length === 0 ? null : grossL === 0 ? (grossP > 0 ? Infinity : 0) : grossP / grossL,
    trades,
    curve,
    exposurePct: bars ? (inBars / bars) * 100 : 0,
    capital,
  };
}

export type WalkForwardFold = {
  index: number;
  /** Indeksy świec w tablicy: okno to candles[start, end). */
  start: number;
  end: number;
  startTime: number;
  endTime: number;
  returnPct: number;
  holdPct: number;
  trades: number;
  beatHold: boolean;
};

export type WalkForward = {
  enough: boolean;
  folds: WalkForwardFold[];
  /** Wynik strategii składany ze wszystkich okien poza próbką. */
  oosReturnPct: number;
  /** Trzymanie monety na tych samych oknach — zawsze do porównania. */
  oosHoldPct: number;
  oosTrades: number;
  oosWinRate: number | null;
  oosProfitFactor: number | null;
  oosMaxDrawdownPct: number;
  foldsWon: number;
  worstFoldPct: number;
  bestFoldPct: number;
};

/** Ile świec potrzeba, zanim wskaźniki w ogóle wskazują kierunek. */
export function warmupBars(params: Params): number {
  return (
    Math.max(
      Math.round(params.emaFast),
      Math.round(params.emaSlow),
      Math.round(params.rsiLen),
      Math.round(params.donEntry),
      Math.round(params.bbLen),
    ) + 2
  );
}

/**
 * Walk-forward: ciągły przebieg strategii na danych po rozgrzewce wskaźników,
 * pocięty na kolejne okna. W każdym oknie strategia jest porównywana
 * z trzymaniem monety liczonym w TYM SAMYM oknie.
 *
 * Przebieg jest ciągły — pozycja nie jest zamykana na granicach okien, bo
 * żywy bot by jej nie zamykał. Okna to podział raportu, nie osobne testy.
 */
export function walkForward(
  candles: Candle[],
  strategy: StrategyId,
  params: Params,
  capital: number,
  foldsWanted = 5,
  minFoldCandles = 30,
): WalkForward {
  const empty: WalkForward = {
    enough: false,
    folds: [],
    oosReturnPct: 0,
    oosHoldPct: 0,
    oosTrades: 0,
    oosWinRate: null,
    oosProfitFactor: null,
    oosMaxDrawdownPct: 0,
    foldsWon: 0,
    worstFoldPct: 0,
    bestFoldPct: 0,
  };
  if (!(capital > 0)) return empty;

  const warmup = warmupBars(params);
  const start = warmup;
  const end = candles.length;
  const usable = end - start;
  const minFold = Math.max(10, Math.floor(minFoldCandles));
  const count = Math.min(Math.max(1, Math.floor(foldsWanted)), Math.floor(usable / minFold));
  if (count < 2 || usable < minFold * 2) return empty;

  const run = backtest(candles, strategy, params, capital, start, end);
  if (!run.enough || run.curve.length === 0) return empty;

  const size = Math.floor(usable / count);
  const folds: WalkForwardFold[] = [];
  let worst = Number.POSITIVE_INFINITY;
  let best = Number.NEGATIVE_INFINITY;
  let foldsWon = 0;

  for (let f = 0; f < count; f++) {
    const a = start + f * size;
    const b = f === count - 1 ? end : start + (f + 1) * size;
    const before = a - 1 >= start ? run.curve[a - 1 - start] : null;
    const after = run.curve[b - 1 - start];
    const equityBefore = before ? before.equity : capital;
    const holdBefore = before ? before.hold : capital;
    const returnPct = (after.equity / equityBefore - 1) * 100;
    const holdPct = (after.hold / holdBefore - 1) * 100;
    const from = candles[a].t;
    const to = candles[b - 1].t;
    const trades = run.trades.filter(
      (trade) => trade.exitTime >= from && trade.exitTime <= to,
    ).length;
    const beatHold = returnPct > holdPct;
    if (beatHold) foldsWon += 1;
    worst = Math.min(worst, returnPct);
    best = Math.max(best, returnPct);

    folds.push({
      index: f + 1,
      start: a,
      end: b,
      startTime: from,
      endTime: to,
      returnPct,
      holdPct,
      trades,
      beatHold,
    });
  }

  return {
    enough: true,
    folds,
    oosReturnPct: run.returnPct,
    oosHoldPct: run.holdPct,
    oosTrades: run.trades.length,
    oosWinRate: run.winRate,
    oosProfitFactor: run.profitFactor,
    oosMaxDrawdownPct: run.maxDrawdownPct,
    foldsWon,
    worstFoldPct: Number.isFinite(worst) ? worst : 0,
    bestFoldPct: Number.isFinite(best) ? best : 0,
  };
}

function tradeOf(
  pos: BookPos,
  exitPx: number,
  pnl: number,
  exitTime: number,
  reason: Trade["reason"],
): Trade {
  const pnlPct = pos.basis > 0 ? (pnl / pos.basis) * 100 : 0;
  return {
    entryTime: pos.entryTime,
    exitTime,
    entry: pos.fill,
    exit: exitPx,
    pnl,
    pnlPct,
    reason,
  };
}

export function desiredNow(candles: Candle[], strategy: StrategyId, params: Params): boolean {
  if (candles.length < 40) return false;
  const series = desiredSeries(candles, strategy, params);
  return series[series.length - 1] === true;
}

export type PaperEvent =
  | { t: number; kind: "start" }
  | { t: number; kind: "buy"; px: number; qty: number }
  | { t: number; kind: "sell"; px: number; pnl: number; why: "signal" | "stop" | "manual" };

export type PaperState = {
  active: boolean;
  symbol: string;
  granularity: Granularity;
  strategy: StrategyId;
  params: Params;
  cash: number;
  qty: number;
  avg: number;
  basis: number;
  seed: number;
  lastBar: number;
  cooling: boolean;
  events: PaperEvent[];
};

export function freshPaper(
  symbol: string,
  granularity: Granularity,
  strategy: StrategyId,
  params: Params,
  seed: number,
  now: number,
): PaperState {
  return {
    active: true,
    symbol,
    granularity,
    strategy,
    params: { ...params },
    cash: seed,
    qty: 0,
    avg: 0,
    basis: 0,
    seed,
    lastBar: -1,
    cooling: false,
    events: [{ t: now, kind: "start" }],
  };
}

function pushEvent(events: PaperEvent[], event: PaperEvent): PaperEvent[] {
  const next = events.concat(event);
  return next.length > 24 ? next.slice(next.length - 24) : next;
}

export function paperEquity(state: PaperState, price: number): number {
  if (!(price > 0)) return state.cash;
  if (state.qty <= 0) return state.cash;
  const cost = toCost(state.params);
  const fill = price * (1 - cost.slippage);
  const notional = state.qty * fill;
  return state.cash + notional - notional * cost.feeRate;
}

export function closedCandles(candles: Candle[], granularity: Granularity, now: number): Candle[] {
  const ms = granMs(granularity);
  const closed = candles.filter((c) => c.t + ms <= now);
  if (closed.length >= 40) return closed;
  return candles.length > 1 ? candles.slice(0, -1) : candles;
}

function buyPaper(state: PaperState, price: number, now: number): PaperState {
  const cost = toCost(state.params);
  const opened = enter(state.cash, price, cost, now);
  if (!opened) return state;
  return {
    ...state,
    cash: opened.cash,
    qty: opened.qty,
    avg: opened.fill,
    basis: opened.basis,
    events: pushEvent(state.events, { t: now, kind: "buy", px: opened.fill, qty: opened.qty }),
  };
}

function sellPaper(
  state: PaperState,
  price: number,
  now: number,
  why: "signal" | "stop" | "manual",
): PaperState {
  if (state.qty <= 0) return state;
  const cost = toCost(state.params);
  const pos: BookPos = {
    cash: state.cash,
    qty: state.qty,
    fill: state.avg,
    basis: state.basis,
    entryTime: now,
  };
  const closed = leave(pos, price, cost);
  return {
    ...state,
    cash: closed.cash,
    qty: 0,
    avg: 0,
    basis: 0,
    events: pushEvent(state.events, { t: now, kind: "sell", px: closed.fill, pnl: closed.pnl, why }),
  };
}

export function flattenPaper(state: PaperState, price: number, now: number): PaperState {
  const sold = sellPaper(state, price, now, "manual");
  return { ...sold, active: false, cooling: false };
}

export function syncPaper(state: PaperState, candles: Candle[], price: number, now: number): PaperState {
  if (!state.active || !(price > 0)) return state;
  const usable = closedCandles(candles, state.granularity, now);
  if (usable.length < 40) return state;
  const want = desiredNow(usable, state.strategy, state.params);
  const bar = usable[usable.length - 1].t;

  let next = state;
  if (next.qty > 0 && next.params.stopPct > 0 && price <= next.avg * (1 - next.params.stopPct / 100)) {
    next = sellPaper(next, price, now, "stop");
    next = { ...next, cooling: true, lastBar: bar };
  }

  let cooling = next.cooling;
  if (cooling && !want) cooling = false;
  const effective = want && !cooling;
  const aligned = (effective && next.qty > 0) || (!effective && next.qty === 0);
  if (next.lastBar === bar && aligned && cooling === next.cooling) {
    return next === state ? state : { ...next, cooling };
  }
  if (effective && next.qty === 0) next = buyPaper(next, price, now);
  else if (!effective && next.qty > 0) next = sellPaper(next, price, now, "signal");
  return { ...next, cooling, lastBar: bar };
}
