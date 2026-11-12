import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { candleCount, price, priceAxis, signedPct, verdict } from "./format.ts";
import type { RunStats, WalkForward } from "./engine.ts";

function stats(partial: Partial<RunStats>): RunStats {
  return {
    enough: true,
    finalEquity: 10_000,
    returnPct: 0,
    holdPct: 0,
    maxDrawdownPct: 0,
    winRate: null,
    profitFactor: null,
    trades: [{ entryTime: 1, exitTime: 2, entry: 1, exit: 1, pnl: 1, pnlPct: 0, reason: "signal" }],
    curve: [],
    exposurePct: 0,
    capital: 10_000,
    ...partial,
  };
}

function walk(partial: Partial<WalkForward>): WalkForward {
  const folds = partial.folds ?? [
    { index: 1, start: 0, end: 10, startTime: 1, endTime: 2, returnPct: 1, holdPct: 0, trades: 1, winRate: 100, maxDrawdownPct: 0, beatHold: true },
    { index: 2, start: 10, end: 20, startTime: 2, endTime: 3, returnPct: 1, holdPct: 0, trades: 1, winRate: 100, maxDrawdownPct: 0, beatHold: true },
  ];
  return {
    enough: true,
    folds,
    oosReturnPct: 2,
    oosHoldPct: 0,
    oosTrades: 2,
    oosWinRate: 100,
    oosProfitFactor: 2,
    oosMaxDrawdownPct: 1,
    foldsWon: folds.filter((f) => f.beatHold).length,
    worstFoldPct: 1,
    bestFoldPct: 1,
    ...partial,
  };
}

describe("verdict", () => {
  it("chwali strategię, gdy bije trzymanie poza próbką i wygrywa większość okien", () => {
    const out = verdict(stats({ returnPct: 10, holdPct: 5 }), walk({ oosReturnPct: 6, oosHoldPct: 1, foldsWon: 4 }));
    assert.equal(out.title, "Poza próbką bije trzymanie.");
    assert.match(out.body, /\+6,00%/);
    assert.match(out.body, /\+1,00%/);
  });

  it("ostrożni, gdy bije trzymanie, ale wygrywa mniej niż połowę okien", () => {
    const out = verdict(stats({ returnPct: 10, holdPct: 5 }), walk({ oosReturnPct: 6, oosHoldPct: 1, foldsWon: 1 }));
    assert.equal(out.title, "Ledwo bije trzymanie.");
  });

  it("mówi wprost, że cała próbka była ładna, a poza próbką nie", () => {
    const out = verdict(stats({ returnPct: 20, holdPct: 2 }), walk({ oosReturnPct: -3, oosHoldPct: 5, foldsWon: 0 }));
    assert.equal(out.title, "Cała próbka ładna, poza próbką nie.");
    assert.match(out.body, /−3,00%/);
    assert.match(out.body, /\+5,00%/);
  });

  it("zostawia informację o wolniejszej stracie, gdy bot traci, ale mniej niż trzymanie", () => {
    const out = verdict(stats({ returnPct: -5, holdPct: -20 }), walk({ oosReturnPct: -4, oosHoldPct: 3, foldsWon: 0 }));
    assert.equal(out.title, "Traci wolniej niż trzymanie. Nadal traci.");
  });

  it("mówi, że konfiguracja traci, gdy przegrywa wszędzie", () => {
    const out = verdict(stats({ returnPct: -5, holdPct: -2 }), walk({ oosReturnPct: -4, oosHoldPct: 3, foldsWon: 0 }));
    assert.equal(out.title, "Ta konfiguracja traci.");
  });

  it("obsługuje za mało świec i brak wejść", () => {
    assert.equal(verdict(stats({ enough: false }), walk({})).title, "Za mało świec.");
    assert.equal(verdict(stats({ trades: [] }), walk({})).title, "Bot ani razu nie wszedł.");
  });

  it("wraca do porównania na całej próbce, gdy walk-forward się nie da policzyć", () => {
    const out = verdict(stats({ returnPct: 10, holdPct: 5 }), walk({ enough: false, folds: [] }));
    assert.equal(out.title, "Na tej próbce biła samo trzymanie.");
    const out2 = verdict(stats({ returnPct: 10, holdPct: 20 }), walk({ enough: false, folds: [] }));
    assert.equal(out2.title, "Jest plus. Trzymanie monety było lepsze.");
  });
});

describe("priceAxis", () => {
  it("zrzuca grosze przy dużych kwotach, żeby etykieta osi się nie łamała", () => {
    assert.equal(priceAxis(88000), "88 000");
    assert.equal(priceAxis(10450), "10 450");
    assert.equal(priceAxis(72000), "72 000");
  });

  it("zachowuje grosze dla małych kwot", () => {
    assert.equal(priceAxis(1.06), "1,06");
    assert.equal(priceAxis(0.0678), "0,0678");
  });

  it("nie zwraca NaN", () => {
    assert.equal(priceAxis(Number.NaN), "");
  });
});

describe("price", () => {
  it("nie pokazuje sześciu zer dla zera", () => {
    assert.equal(price(0), "0,00");
    assert.equal(signedPct(0), "0,00%");
  });
});

describe("candleCount", () => {
  it("odmienia liczebnik świece", () => {
    assert.equal(candleCount(1), "1 świeca");
    assert.equal(candleCount(2), "2 świece");
    assert.equal(candleCount(5), "5 świec");
    assert.equal(candleCount(300), "300 świec");
    assert.equal(candleCount(1000), "1000 świec");
  });
});
