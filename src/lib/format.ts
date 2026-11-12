import { STRATEGIES, type StrategyId } from "./catalog.ts";
import type { RunStats, WalkForward } from "./engine.ts";

export function price(n: number): string {
  if (n === 0) return "0,00";
  const digits = n >= 100 ? 2 : n >= 1 ? 2 : n >= 0.01 ? 4 : 6;
  const [whole, frac] = n.toFixed(digits).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac ? `${grouped},${frac}` : grouped;
}

/**
 * Etykieta osi wykresu. Bez groszy — przy pełnych cenach („88 000,00") etykieta
 * łamała się na dwie linie i oś stawała się nieczytelna.
 */
export function priceAxis(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) >= 100) {
    const whole = Math.round(n).toString();
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  return price(n);
}

/** „1 świeca / 2 świece / 5 świec" */
export function candleCount(n: number): string {
  if (n === 1) return "1 świeca";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} świece`;
  return `${n} świec`;
}

export function signedPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2).replace(".", ",")}%`;
}

export function signedMoney(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${price(Math.abs(n))} USDT`;
}

export function money(n: number): string {
  return `${price(n)} USDT`;
}

export function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} mld`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} mln`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} tys.`;
  return price(n);
}

export function ratio(n: number | null): string {
  if (n == null) return "—";
  if (!Number.isFinite(n)) return "∞";
  return n.toFixed(2).replace(".", ",");
}

export function plainPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1).replace(".", ",")}%`;
}

const timeFmt = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function stamp(t: number): string {
  return timeFmt.format(t);
}

export function tone(n: number): "up" | "down" | "muted" {
  if (n > 0.0000001) return "up";
  if (n < -0.0000001) return "down";
  return "muted";
}

export function strategyName(id: StrategyId): string {
  return STRATEGIES.find((item) => item.id === id)?.name ?? id;
}

/**
 * Werdykt dla strategii.
 *
 * Rozstrzyga walk-forward: kilka kolejnych okien, każde liczone jako dane,
 * których strategia wcześniej nie widziała. W każdym oknie strategia jest
 * porównywana z trzymaniem monety w TYM SAMYM oknie — inaczej porównanie
 * zestawia dwa różne okresy i zawyża przewagę.
 */
export function verdict(full: RunStats, wf: WalkForward): { title: string; body: string } {
  if (!full.enough) {
    return {
      title: "Za mało świec.",
      body: "Bitget nie oddał dość historii, żeby uczciwie policzyć opłaty i obsunięcie.",
    };
  }
  if (full.trades.length === 0) {
    return {
      title: "Bot ani razu nie wszedł.",
      body: "To nie jest zarabianie. Przy tych parametrach strategia cały czas stoi w USDT.",
    };
  }

  const beatHold = full.returnPct > full.holdPct;

  if (!wf.enough) {
    // Za mało historii na walk-forward — zostaje samo porównanie na całej próbce.
    if (full.returnPct < 0) {
      return beatHold
        ? {
            title: "Traci wolniej niż trzymanie. Nadal traci.",
            body: "Na tej próbce bot oddał mniej niż kupno monety, ale kapitał i tak jest mniejszy. Mniejsza strata nie jest zarabianiem.",
          }
        : {
            title: "Ta konfiguracja traci.",
            body: "Po opłacie takera i poślizgu kapitał jest mniejszy. Tak kończy większość prostych botów.",
          };
    }
    return beatHold
      ? {
          title: "Na tej próbce biła samo trzymanie.",
          body: "To jedno okno notowań Bitget, bez dźwigni i bez prawdziwych zleceń. Nie jest dowodem, że zarobi jutro.",
        }
      : {
          title: "Jest plus. Trzymanie monety było lepsze.",
          body: "Aktywny handel oddał różnicę w opłatach albo w słabszych wejściach. Bot, który nie bije „kup i trzymaj”, nie ma po co pracować.",
        };
  }

  const n = wf.folds.length;
  const freshBeat = wf.oosReturnPct > wf.oosHoldPct;
  const line = `Na ${n} oknach poza próbką strategia zarobiła ${signedPct(wf.oosReturnPct)}, a trzymanie monety ${signedPct(wf.oosHoldPct)}. Wygrane okna: ${wf.foldsWon} z ${n}.`;

  if (freshBeat && wf.foldsWon * 2 > n) {
    return {
      title: "Poza próbką bije trzymanie.",
      body: `${line} To najmocniejszy dowód, jaki da się policzyć na jednej próbce.`,
    };
  }
  if (freshBeat) {
    return {
      title: "Ledwo bije trzymanie.",
      body: `${line} Wygranych okien jest za mało, żeby ufać strategii.`,
    };
  }
  if (full.returnPct > 0) {
    return {
      title: "Cała próbka ładna, poza próbką nie.",
      body: `${line} Cała próbka wyglądała lepiej, ale to z przeszłości — tak wygląda strategia dopasowana do danych.`,
    };
  }
  if (beatHold) {
    return {
      title: "Traci wolniej niż trzymanie. Nadal traci.",
      body: `${line} Na tej próbce bot oddał mniej niż kupno monety, ale kapitał i tak jest mniejszy. Mniejsza strata nie jest zarabianiem.`,
    };
  }
  return {
    title: "Ta konfiguracja traci.",
    body: `${line} Po opłacie takera i poślizgu kapitał jest mniejszy. Tak kończy większość prostych botów.`,
  };
}
