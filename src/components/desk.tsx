import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Play, Square, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GRANS, PAIRS, STRATEGIES, pairShort, type Granularity, type StrategyId, type SymbolId } from "@/lib/catalog";
import {
  DEFAULT_PARAMS,
  backtest,
  flattenPaper,
  freshPaper,
  paperEquity,
  syncPaper,
  walkForward,
  type CurvePoint,
  type PaperEvent,
  type PaperState,
  type Params,
} from "@/lib/engine";
import {
  candleCount,
  compact,
  money,
  plainPct,
  price,
  priceAxis,
  ratio,
  signedMoney,
  signedPct,
  stamp,
  strategyName,
  tone,
  verdict,
} from "@/lib/format";
import { getMarketBook, type MarketBook, type Tick } from "@/lib/market.functions";

const PAPER_KEY = "lumen-paper-v1";

const chartTip = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: 12,
  color: "var(--color-fg)",
};

function useMounted() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []);
  return on;
}

function decimate<T>(rows: T[], max = 180): T[] {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += step) out.push(rows[i]);
  const last = rows[rows.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function toneClass(n: number): string {
  const kind = tone(n);
  if (kind === "up") return "text-up";
  if (kind === "down") return "text-down";
  return "text-muted";
}

function eventLine(event: PaperEvent, symbol: string): string {
  if (event.kind === "start") return "Start sesji. Nic nie idzie na giełdę.";
  if (event.kind === "buy") return `Kupno ${pairShort(symbol)} po ${price(event.px)}`;
  const why = event.why === "stop" ? "stop" : event.why === "manual" ? "zamknięcie" : "sygnał";
  return `Sprzedaż po ${price(event.px)} · ${why} · ${signedMoney(event.pnl)}`;
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted">{props.label}</span>
        <span className="text-fg">
          {(Math.round(props.value * 100) / 100).toString().replace(".", ",")}
          {props.suffix}
        </span>
      </span>
      <input
        className="mt-1 h-11 w-full"
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function Desk({ initial }: { initial: MarketBook }) {
  const mounted = useMounted();
  const [symbol, setSymbol] = useState<SymbolId>(initial.symbol);
  const [granularity, setGranularity] = useState<Granularity>(initial.granularity);
  const [strategy, setStrategy] = useState<StrategyId>("ema");
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [capital, setCapital] = useState(10_000);
  const [paper, setPaper] = useState<PaperState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [ticks, setTicks] = useState<Tick[]>(initial.ticks);

  const query = useQuery({
    queryKey: ["bitget", symbol, granularity],
    queryFn: () => getMarketBook({ data: { symbol, granularity } }),
    initialData: symbol === initial.symbol && granularity === initial.granularity ? initial : undefined,
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const book =
    query.data && query.data.symbol === symbol && query.data.granularity === granularity ? query.data : undefined;

  useEffect(() => {
    if (query.data?.ticks?.length) setTicks(query.data.ticks);
  }, [query.data]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PAPER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PaperState;
        if (parsed && typeof parsed.symbol === "string" && parsed.params) {
          setPaper(parsed);
          if (parsed.active) {
            if (PAIRS.some((pair) => pair.symbol === parsed.symbol)) setSymbol(parsed.symbol as SymbolId);
            if (GRANS.some((gran) => gran.id === parsed.granularity)) setGranularity(parsed.granularity);
            setStrategy(parsed.strategy);
            setParams(parsed.params);
          }
        }
      }
    } catch {
      /* sesja z przeglądarki jest opcjonalna */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (paper) localStorage.setItem(PAPER_KEY, JSON.stringify(paper));
    else localStorage.removeItem(PAPER_KEY);
  }, [paper, hydrated]);

  useEffect(() => {
    if (!hydrated || !book) return;
    setPaper((prev) => {
      if (!prev?.active) return prev;
      if (prev.symbol !== book.symbol || prev.granularity !== book.granularity) return prev;
      const live = book.ticks.find((tick) => tick.symbol === prev.symbol)?.last ?? book.candles.at(-1)?.c;
      if (!live) return prev;
      return syncPaper(prev, book.candles, live, Date.now());
    });
  }, [book, hydrated]);

  const full = useMemo(
    () => (book ? backtest(book.candles, strategy, params, capital) : null),
    [book, strategy, params, capital],
  );
  const oos = useMemo(
    () => (book ? walkForward(book.candles, strategy, params, capital) : null),
    [book, strategy, params, capital],
  );
  const board = useMemo(
    () =>
      book
        ? STRATEGIES.map((item) => ({
            ...item,
            run: backtest(book.candles, item.id, params, capital),
            wf: walkForward(book.candles, item.id, params, capital),
          }))
        : [],
    [book, params, capital],
  );

  const tick = ticks.find((item) => item.symbol === symbol);
  const livePx = tick?.last ?? book?.candles.at(-1)?.c ?? 0;
  const locked = paper?.active === true;
  const words = full && oos ? verdict(full, oos) : null;
  const best = board.reduce<(typeof board)[number] | null>((champ, row) => {
    if (!row.wf.enough) return champ;
    if (!champ || row.wf.oosReturnPct > champ.wf.oosReturnPct) return row;
    return champ;
  }, null);

  function patch(partial: Partial<Params>) {
    setParams((prev) => {
      const next = { ...prev, ...partial };
      if (next.emaFast >= next.emaSlow) next.emaSlow = next.emaFast + 5;
      if (next.rsiSell <= next.rsiBuy) next.rsiSell = Math.min(90, next.rsiBuy + 5);
      return next;
    });
  }

  function startPaper() {
    if (!book || !(capital > 0)) return;
    const now = Date.now();
    const seeded = freshPaper(symbol, granularity, strategy, params, capital, now);
    const priceNow = book.ticks.find((item) => item.symbol === symbol)?.last ?? livePx;
    setPaper(priceNow ? syncPaper(seeded, book.candles, priceNow, now) : seeded);
  }

  function stopPaper() {
    setPaper((prev) => {
      if (!prev) return prev;
      const px =
        ticks.find((item) => item.symbol === prev.symbol)?.last ??
        (prev.qty > 0 ? prev.avg : 0);
      if (!(px > 0)) return { ...prev, active: false };
      return flattenPaper(prev, px, Date.now());
    });
  }

  const paperPx = paper ? (ticks.find((item) => item.symbol === paper.symbol)?.last ?? 0) : 0;
  const paperMark = paper ? paperEquity(paper, paperPx || paper.avg || paper.cash) : 0;
  const paperPnl = paper ? paperMark - paper.seed : 0;

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium tracking-widest text-brass">LUMEN</p>
            <h1 className="font-serif text-3xl text-fg sm:text-4xl">Laboratorium Bitget</h1>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted sm:text-right">
            Publiczne notowania spot. Bez klucza API, bez dźwigni, bez zleceń na Twoje środki.
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5">
        <section className="flex gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-brass" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-muted">
            Żaden bot nie „realnie zarabia” na zamówienie. Większość po opłatach przegrywa ze zwykłym trzymaniem
            monety, a część po prostu traci. Tu sprawdzisz to na świecach Bitget, zanim w ogóle pomyślisz o prawdziwych
            pieniądzach. To nie jest porada inwestycyjna.
          </p>
        </section>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {PAIRS.map((pair) => {
            const row = ticks.find((item) => item.symbol === pair.symbol);
            const on = pair.symbol === symbol;
            return (
              <button
                key={pair.symbol}
                type="button"
                disabled={locked}
                onClick={() => setSymbol(pair.symbol)}
                className={
                  "min-h-11 min-w-40 shrink-0 rounded-2xl border px-3 py-2 text-left " +
                  (on ? "border-brass bg-surface-2" : "border-line bg-surface")
                }
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{pair.short}</span>
                  <span className={row ? toneClass(row.change24h) : "text-muted"}>
                    {row ? signedPct(row.change24h * 100) : "—"}
                  </span>
                </span>
                <span className="mt-1 block text-sm text-muted">{row ? price(row.last) : pair.name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          {GRANS.map((gran) => (
            <button
              key={gran.id}
              type="button"
              disabled={locked}
              onClick={() => setGranularity(gran.id)}
              className={
                "min-h-11 rounded-full border px-4 text-sm " +
                (granularity === gran.id ? "border-brass bg-brass text-brass-ink" : "border-line bg-surface text-fg")
              }
            >
              {gran.label}
            </button>
          ))}
          <p className="self-center text-sm text-muted">
            {tick ? `Obrót 24h ${compact(tick.quoteVol)} USDT` : "Czekam na ticker"}
            {mounted && book ? ` · świece do ${stamp(book.fetchedAt)}` : ""}
          </p>
        </div>

        {query.isError && !book ? (
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-serif text-2xl">Bitget nie oddał notowań</h2>
            <p className="mt-2 text-sm text-muted">
              {query.error instanceof Error ? query.error.message : "Sprawdź połączenie i spróbuj jeszcze raz."}
            </p>
            <button
              type="button"
              className="mt-4 min-h-11 rounded-full bg-brass px-4 text-sm font-medium text-brass-ink"
              onClick={() => void query.refetch()}
            >
              Ponów
            </button>
          </section>
        ) : null}

        {words && full && oos ? (
          <section className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-sm text-muted">
              {strategyName(strategy)} · {pairShort(symbol)} · {candleCount(book?.candles.length ?? 0)} · opłata{" "}
              {String(params.feePct).replace(".", ",")}% + poślizg 0,05%
            </p>
            <h2 className="mt-2 max-w-3xl font-serif text-3xl leading-tight text-fg sm:text-4xl">{words.title}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{words.body}</p>
            <div className="mt-5">
              <p className="text-sm font-medium text-muted">Cała próbka</p>
              <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Strategia" value={signedPct(full.returnPct)} tone={full.returnPct} />
                <Stat label="Trzymanie monety" value={signedPct(full.holdPct)} tone={full.holdPct} />
                <Stat label="Transakcje" value={String(full.trades.length)} />
                <Stat label="Trafność" value={plainPct(full.winRate)} />
              </dl>
              <p className="mt-2 text-sm text-muted">
                Profit factor {ratio(full.profitFactor)} · czas w rynku {plainPct(full.exposurePct)} · max obsunięcie{" "}
                {plainPct(full.maxDrawdownPct)}
              </p>
            </div>
            <div className="mt-4">
              <p className="text-sm font-medium text-muted">
                Poza próbką — walk-forward{oos?.enough ? ` (${oos.folds.length} okien)` : ""}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Strategia" value={signedPct(oos.oosReturnPct)} tone={oos.oosReturnPct} />
                <Stat label="Trzymanie monety" value={signedPct(oos.oosHoldPct)} tone={oos.oosHoldPct} />
                <Stat
                  label="Wygrane okna"
                  value={oos.folds.length ? `${oos.foldsWon} z ${oos.folds.length}` : "—"}
                />
                <Stat label="Najgorsze okno" value={signedPct(oos.worstFoldPct)} tone={oos.worstFoldPct} />
              </dl>
              <p className="mt-2 text-sm text-muted">
                Transakcje {oos.oosTrades} · trafność {plainPct(oos.oosWinRate)} · profit factor{" "}
                {ratio(oos.oosProfitFactor)} · max obsunięcie {plainPct(oos.oosMaxDrawdownPct)}
              </p>
            </div>
            {book && book.candles.length < book.candleLimit ? (
              <p className="mt-4 text-sm text-muted">
                Bitget oddał tylko {candleCount(book.candles.length)} zamiast {candleCount(book.candleLimit)} — tyle
                historii ma w bazie dla tego interwału.
              </p>
            ) : null}
          </section>
        ) : (
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-serif text-3xl">Pobieram świece z Bitget…</h2>
            <p className="mt-2 text-sm text-muted">Historia idzie prosto z giełdy, nic nie jest dorysowane.</p>
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-5">
          <section className="flex flex-col gap-4 lg:col-span-3">
            <ChartCard title="Cena zamknięcia" hint={`${candleCount(book?.candles.length ?? 0)} z Bitget, bez zleceń`}>
              {book ? <PriceChart candles={book.candles.map((c) => ({ t: c.t, c: c.c }))} mounted={mounted} /> : <div className="h-64" />}
            </ChartCard>
            <ChartCard title="Kapitał strategii kontra trzymanie" hint="Ta sama opłata wejścia i wyjścia, ta sama próbka">
              {full?.enough ? <EquityChart curve={full.curve} mounted={mounted} /> : <div className="h-64" />}
            </ChartCard>
          </section>

          <section className="flex flex-col gap-4 lg:col-span-2">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="font-serif text-2xl">Strategia</h2>
              <div className="mt-3 grid gap-2">
                {STRATEGIES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={locked}
                    onClick={() => setStrategy(item.id)}
                    className={
                      "min-h-11 rounded-xl border px-3 py-2 text-left " +
                      (strategy === item.id ? "border-brass bg-surface-2" : "border-line")
                    }
                  >
                    <span className="block text-sm font-medium">{item.name}</span>
                    <span className="mt-0.5 block text-sm text-muted">{item.blurb}</span>
                  </button>
                ))}
              </div>
              <div className="mt-4 grid gap-1">
                {strategy === "ema" ? (
                  <>
                    <Slider label="Szybka EMA" value={params.emaFast} min={5} max={40} step={1} disabled={locked} onChange={(value) => patch({ emaFast: value })} />
                    <Slider label="Wolna EMA" value={params.emaSlow} min={15} max={120} step={1} disabled={locked} onChange={(value) => patch({ emaSlow: value })} />
                  </>
                ) : null}
                {strategy === "rsi" ? (
                  <>
                    <Slider label="Okres RSI" value={params.rsiLen} min={7} max={28} step={1} disabled={locked} onChange={(value) => patch({ rsiLen: value })} />
                    <Slider label="Wejście RSI" value={params.rsiBuy} min={15} max={45} step={1} disabled={locked} onChange={(value) => patch({ rsiBuy: value })} />
                    <Slider label="Wyjście RSI" value={params.rsiSell} min={40} max={80} step={1} disabled={locked} onChange={(value) => patch({ rsiSell: value })} />
                  </>
                ) : null}
                {strategy === "donchian" ? (
                  <>
                    <Slider label="Wybicie, świece" value={params.donEntry} min={10} max={55} step={1} disabled={locked} onChange={(value) => patch({ donEntry: value })} />
                    <Slider label="Wyjście, świece" value={params.donExit} min={5} max={40} step={1} disabled={locked} onChange={(value) => patch({ donExit: value })} />
                  </>
                ) : null}
                {strategy === "bollinger" ? (
                  <>
                    <Slider label="Okres wstęg" value={params.bbLen} min={10} max={40} step={1} disabled={locked} onChange={(value) => patch({ bbLen: value })} />
                    <Slider label="Szerokość" value={params.bbK} min={1} max={3} step={0.1} disabled={locked} onChange={(value) => patch({ bbK: Math.round(value * 10) / 10 })} />
                  </>
                ) : null}
                <Slider label="Stop od wejścia" value={params.stopPct} min={0} max={15} step={1} suffix="%" disabled={locked} onChange={(value) => patch({ stopPct: value })} />
                <Slider label="Opłata taker" value={params.feePct} min={0} max={0.2} step={0.01} suffix="%" disabled={locked} onChange={(value) => patch({ feePct: Math.round(value * 100) / 100 })} />
              </div>
              <label className="mt-3 block text-sm text-muted">
                Kapitał testu
                <input
                  className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-fg"
                  inputMode="numeric"
                  disabled={locked}
                  value={capital}
                  onChange={(event) => {
                    const next = Number(event.target.value.replace(/[^\d]/g, ""));
                    if (Number.isFinite(next)) setCapital(Math.min(1_000_000, next));
                  }}
                />
              </label>
              <button
                type="button"
                className="mt-3 min-h-11 text-sm text-muted underline-offset-4 hover:underline"
                disabled={locked}
                onClick={() => setParams(DEFAULT_PARAMS)}
              >
                Przywróć parametry podręcznikowe
              </button>
              {locked ? <p className="mt-2 text-sm text-muted">Papierowy bot działa — zatrzymaj go, żeby zmienić rynek albo parametry.</p> : null}
            </div>

            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-serif text-2xl">Bot na papierze</h2>
                {locked ? <span className="status-dot inline-block size-2 animate-pulse rounded-full bg-brass" /> : null}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Po zamknięciu świecy zajmuje albo zamyka pozycję po ostatniej cenie Bitget. Saldo jest wirtualne i
                zostaje w tej przeglądarce.
              </p>
              {paper ? (
                <dl className="mt-4 grid grid-cols-2 gap-3">
                  <Stat label="Wycena" value={money(paperMark)} tone={paperPnl} />
                  <Stat label="Wynik sesji" value={signedMoney(paperPnl)} tone={paperPnl} />
                  <div className="col-span-2 text-sm text-muted">
                    {paper.qty > 0
                      ? `Long ${pairShort(paper.symbol)} · średnia ${price(paper.avg)}`
                      : `Poza rynkiem · gotówka ${money(paper.cash)}`}
                    {" · "}
                    {strategyName(paper.strategy)}
                  </div>
                </dl>
              ) : (
                <p className="mt-4 text-sm text-muted">Jeszcze nie włączony.</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {locked ? (
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brass px-4 text-sm font-medium text-brass-ink"
                    onClick={stopPaper}
                  >
                    <Square className="size-4" aria-hidden="true" />
                    Zatrzymaj i zamknij
                  </button>
                ) : (
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brass px-4 text-sm font-medium text-brass-ink disabled:opacity-40"
                    disabled={!book}
                    onClick={startPaper}
                  >
                    <Play className="size-4" aria-hidden="true" />
                    Włącz na papierze
                  </button>
                )}
              </div>
              {paper && paper.events.length > 0 ? (
                <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-3">
                  {[...paper.events].reverse().slice(0, 6).map((event, index) => (
                    <li key={`${event.t}-${index}`} className="text-sm text-muted">
                      <span className="text-fg">{mounted ? stamp(event.t) : "…"}</span>
                      {" · "}
                      {eventLine(event, paper.symbol)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        </div>

        {oos && oos.enough ? (
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="font-serif text-2xl">Walk-forward — {oos.folds.length} okien poza próbką</h2>
            <p className="mt-1 text-sm text-muted">
              Historia podzielona na kolejne okna. W każdym strategia dostaje dane, których wcześniej nie widziała, i
              jest porównywana z trzymaniem monety w tym samym oknie. Zero okien to najgorszy wynik, jaki da się
              uczciwie pokazać.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="py-2 font-medium">Okno</th>
                    <th className="py-2 font-medium">Zakres</th>
                    <th className="py-2 font-medium">Strategia</th>
                    <th className="py-2 font-medium">Trzymanie</th>
                    <th className="py-2 font-medium">Transakcje</th>
                    <th className="py-2 font-medium">Werdykt</th>
                  </tr>
                </thead>
                <tbody>
                  {oos.folds.map((fold) => (
                    <tr key={fold.index} className="border-t border-line">
                      <td className="py-2">{fold.index}</td>
                      <td className="py-2 text-muted">
                        {mounted ? `${stamp(fold.startTime)} – ${stamp(fold.endTime)}` : "…"}
                      </td>
                      <td className={`py-2 ${toneClass(fold.returnPct)}`}>{signedPct(fold.returnPct)}</td>
                      <td className={`py-2 ${toneClass(fold.holdPct)}`}>{signedPct(fold.holdPct)}</td>
                      <td className="py-2 text-muted">{fold.trades}</td>
                      <td className="py-2 text-muted">{fold.beatHold ? "biła trzymanie" : "przegrała"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {board.length > 0 ? (
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="font-serif text-2xl">Cztery strategie, te same koszty</h2>
            <p className="mt-1 text-sm text-muted">
              Ranking liczony poza próbką
              {best ? `: ${best.name} (${signedPct(best.wf.oosReturnPct)})` : ""}. Wybór zwycięzcy po fakcie sam zawyża
              oczekiwania — dlatego liczymy go na oknach, których strategia wcześniej nie widziała.
            </p>
            <ul className="mt-3 divide-y divide-line">
              {board.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => setStrategy(row.id)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left"
                  >
                    <span>
                      <span className="block text-sm font-medium">{row.name}</span>
                      <span className="text-sm text-muted">
                        trzymanie poza próbką {signedPct(row.wf.oosHoldPct)}
                      </span>
                    </span>
                    <span className={toneClass(row.wf.oosReturnPct)}>{signedPct(row.wf.oosReturnPct)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-serif text-2xl">Zamknięte transakcje testu</h2>
          <p className="mt-1 text-sm text-muted">
            Sygnał ze zamknięcia, realizacja na otwarciu kolejnej świecy. Otwarta pozycja jest doliczona do wyniku po
            ostatniej cenie, z opłatą wyjścia.
          </p>
          {full && full.trades.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="py-2 font-medium">Wejście</th>
                    <th className="py-2 font-medium">Wyjście</th>
                    <th className="py-2 font-medium">Cena</th>
                    <th className="py-2 font-medium">Wynik</th>
                    <th className="py-2 font-medium">Powód</th>
                  </tr>
                </thead>
                <tbody>
                  {full.trades.slice(-8).reverse().map((trade) => (
                    <tr key={`${trade.entryTime}-${trade.exitTime}`} className="border-t border-line">
                      <td className="py-2">{mounted ? stamp(trade.entryTime) : "…"}</td>
                      <td className="py-2">{mounted ? stamp(trade.exitTime) : "…"}</td>
                      <td className="py-2">
                        {price(trade.entry)} → {price(trade.exit)}
                      </td>
                      <td className={`py-2 ${toneClass(trade.pnl)}`}>{signedMoney(trade.pnl)}</td>
                      <td className="py-2 text-muted">{trade.reason === "stop" ? "stop" : "sygnał"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">Brak zamkniętych transakcji dla tej konfiguracji.</p>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat(props: { label: string; value: string; tone?: number }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-3">
      <dt className="text-sm text-muted">{props.label}</dt>
      <dd className={`mt-1 text-lg font-medium ${props.tone == null ? "text-fg" : toneClass(props.tone)}`}>
        {props.value}
      </dd>
    </div>
  );
}

function ChartCard(props: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="font-serif text-2xl">{props.title}</h2>
      <p className="mt-1 text-sm text-muted">{props.hint}</p>
      <div className="mt-3">{props.children}</div>
    </section>
  );
}

function PriceChart({ candles, mounted }: { candles: { t: number; c: number }[]; mounted: boolean }) {
  if (!mounted) return <div className="h-64" />;
  const data = decimate(candles);
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={(value) => stamp(Number(value)).slice(0, 5)}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={36}
          />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={78}
            tickFormatter={(value) => priceAxis(Number(value))}
          />
          <Tooltip
            contentStyle={chartTip}
            labelFormatter={(label) => stamp(Number(label))}
            formatter={(value) => [price(Number(value)), "Cena"]}
          />
          <Area type="monotone" dataKey="c" stroke="var(--color-brass)" fill="var(--color-brass)" fillOpacity={0.15} strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function EquityChart({ curve, mounted }: { curve: CurvePoint[]; mounted: boolean }) {
  if (!mounted) return <div className="h-64" />;
  const data = decimate(curve);
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={(value) => stamp(Number(value)).slice(0, 5)}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={36}
          />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={78}
            tickFormatter={(value) => priceAxis(Number(value))}
          />
          <Tooltip
            contentStyle={chartTip}
            labelFormatter={(label) => stamp(Number(label))}
            formatter={(value, name) => [money(Number(value)), name === "hold" ? "Trzymaj" : "Strategia"]}
          />
          <Line type="monotone" dataKey="hold" stroke="var(--color-muted)" dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="equity" stroke="var(--color-brass)" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
