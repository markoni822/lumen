import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  backtest,
  DEFAULT_PARAMS,
  holdReturnPct,
  walkForward,
  warmupBars,
  type Candle,
} from "./engine.ts";

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

describe("walkForward", () => {
  const candles = makeCandles(1000);

  it("dzieli historię na kolejne okna bez luk i nachodzenia na siebie", () => {
    const wf = walkForward(candles, "ema", DEFAULT_PARAMS, 10_000);
    assert.ok(wf.enough);
    assert.ok(wf.folds.length >= 2);
    for (let i = 1; i < wf.folds.length; i++) {
      assert.equal(wf.folds[i].start, wf.folds[i - 1].end, "okna muszą lecieć po sobie bez luki");
    }
    const warmup = warmupBars(DEFAULT_PARAMS);
    assert.equal(wf.folds[0].start, warmup, "pierwsze okno zaczyna się po rozgrzewce wskaźników");
    assert.equal(wf.folds[wf.folds.length - 1].end, candles.length, "ostatnie okno kończy historię");
  });

  it("okna są w kolejności czasowej", () => {
    const wf = walkForward(candles, "ema", DEFAULT_PARAMS, 10_000);
    for (let i = 1; i < wf.folds.length; i++) {
      assert.ok(wf.folds[i].startTime > wf.folds[i - 1].startTime);
      assert.ok(wf.folds[i].endTime >= wf.folds[i].startTime);
    }
  });

  it("liczy wynik okna jako wycinek ciągłego przebiegu", () => {
    const wf = walkForward(candles, "ema", DEFAULT_PARAMS, 10_000);
    const warmup = warmupBars(DEFAULT_PARAMS);
    const run = backtest(candles, "ema", DEFAULT_PARAMS, 10_000, warmup, candles.length);
    for (const fold of wf.folds) {
      const before = fold.start - 1 >= warmup ? run.curve[fold.start - 1 - warmup] : null;
      const after = run.curve[fold.end - 1 - warmup];
      const equityBefore = before ? before.equity : 10_000;
      const holdBefore = before ? before.hold : 10_000;
      assert.ok(
        Math.abs(fold.returnPct - (after.equity / equityBefore - 1) * 100) < 1e-9,
        `strategia w oknie ${fold.index}`,
      );
      assert.ok(
        Math.abs(fold.holdPct - (after.hold / holdBefore - 1) * 100) < 1e-9,
        `trzymanie w oknie ${fold.index}`,
      );
    }
  });

  it("podaje w nagłówku wynik ciągłego przebiegu, bez sztucznych zamknięć na granicach okien", () => {
    const wf = walkForward(candles, "ema", DEFAULT_PARAMS, 10_000);
    const warmup = warmupBars(DEFAULT_PARAMS);
    const run = backtest(candles, "ema", DEFAULT_PARAMS, 10_000, warmup, candles.length);
    assert.equal(wf.oosReturnPct, run.returnPct);
    assert.equal(wf.oosHoldPct, run.holdPct);
    assert.equal(wf.oosTrades, run.trades.length);
    assert.equal(wf.oosMaxDrawdownPct, run.maxDrawdownPct);
  });

  it("liczy wygrane okna jako te, w których strategia pobiła trzymanie", () => {
    const wf = walkForward(candles, "ema", DEFAULT_PARAMS, 10_000);
    const manual = wf.folds.filter((fold) => fold.returnPct > fold.holdPct).length;
    assert.equal(wf.foldsWon, manual);
  });

  it("nie udaje wyniku, gdy historii jest za mało na dwa okna", () => {
    const short = makeCandles(90, 3);
    const wf = walkForward(short, "ema", DEFAULT_PARAMS, 10_000);
    assert.equal(wf.enough, false);
    assert.equal(wf.folds.length, 0);
  });

  it("nie zmienia wyniku pełnego backtestu", () => {
    const full = backtest(candles, "ema", DEFAULT_PARAMS, 10_000);
    assert.ok(full.enough);
    assert.ok(Math.abs(full.finalEquity - full.capital * (1 + full.returnPct / 100)) < 1e-6);
    // hold na całej próbce = to samo, co hold liczony ręcznie
    assert.ok(Math.abs(full.holdPct - holdReturnPct(candles, 0, candles.length, 10_000, DEFAULT_PARAMS)) < 1e-9);
  });
});
