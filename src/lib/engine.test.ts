import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { backtest, DEFAULT_PARAMS, toCost, type Candle } from "./engine.ts";

/** Deterministyczny random walk — ten sam seed = te same świece. */
function makeCandles(n: number, seed = 7, drift = 0.0002): Candle[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: Candle[] = [];
  let px = 100;
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = Math.max(1, o * (1 + drift + (rnd() - 0.5) * 0.02));
    const h = Math.max(o, c) * (1 + rnd() * 0.005);
    const l = Math.min(o, c) * (1 - rnd() * 0.005);
    out.push({ t: t0 + i * 3_600_000, o, h, l, c, v: 100 });
    px = c;
  }
  return out;
}

/** Trzymanie monety liczone ręcznie: wejście po otwarciu `idx`, wyjście po ostatniej zamkniętej. */
function manualHold(candles: Candle[], idx: number, capital = 10_000): number {
  const cost = toCost(DEFAULT_PARAMS);
  const fill = candles[idx].o * (1 + cost.slippage);
  const notional = (capital * cost.alloc) / (1 + cost.feeRate);
  const fee = notional * cost.feeRate;
  const qty = notional / fill;
  const cash = capital - notional - fee;
  const lastPx = candles[candles.length - 1].c * (1 - cost.slippage);
  const exitNotional = qty * lastPx;
  return ((cash + exitNotional - exitNotional * cost.feeRate) / capital - 1) * 100;
}

describe("backtest — benchmark trzymania monety", () => {
  const candles = makeCandles(1000);
  const start = Math.floor(candles.length * 0.7);

  it("liczy trzymanie na tej samej próbce co strategia", () => {
    const full = backtest(candles, "ema", DEFAULT_PARAMS, 10_000);
    assert.ok(Math.abs(full.holdPct - manualHold(candles, 1)) < 1e-9);
  });

  it("liczy trzymanie w oknie OOS na oknie OOS, nie na całej próbce", () => {
    // To jest sedno poprawki: „Ostatnie 30%" musi porównywać się z trzymaniem
    // liczonym na tych samych ostatnich 30%, inaczej porównanie jest bez sensu.
    const oos = backtest(candles, "ema", DEFAULT_PARAMS, 10_000, start);
    assert.ok(
      Math.abs(oos.holdPct - manualHold(candles, start)) < 1e-9,
      `oos.holdPct=${oos.holdPct} vs manual=${manualHold(candles, start)}`,
    );
  });

  it("trzymanie w oknie OOS różni się od trzymania na całej próbce", () => {
    const full = backtest(candles, "ema", DEFAULT_PARAMS, 10_000);
    const oos = backtest(candles, "ema", DEFAULT_PARAMS, 10_000, start);
    assert.ok(
      Math.abs(oos.holdPct - full.holdPct) > 0.5,
      "gdyby obie wartości były równe, porównanie w UI znowu zestawiałoby dwa różne okna",
    );
  });

  it("nie zmienia wyniku strategii", () => {
    const full = backtest(candles, "ema", DEFAULT_PARAMS, 10_000);
    assert.ok(full.enough);
    assert.ok(full.trades.length > 0);
    assert.ok(Math.abs(full.finalEquity - full.capital * (1 + full.returnPct / 100)) < 1e-6);
  });
});
