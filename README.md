# LUMEN — Laboratorium Bitget

Backtester strategii tradingowych na publicznych świecach spot z Bitget. Nie obiecuje zysku — ma go raczej udowodnić, że go nie ma.

Aplikacja pobiera prawdziwe świece z `api.bitget.com`, liczy strategię **po kosztach** (opłata taker + poślizg) i porównuje ją z kupnem i trzymaniem monety. Bez klucza API, bez dźwigni, bez składania zleceń na cudze pieniądze.

Większość botów po opłatach przegrywa ze zwykłym trzymaniem monety, a część po prostu traci. Tu sprawdzisz to, zanim w ogóle pomyślisz o prawdziwych pieniądzach.

## Co potrafi

- **4 strategie** — przecięcie EMA, RSI z powrotem, kanał Donchiana, wstęgi Bollingera. Parametry każdej przesuwasz suwakiem.
- **Walk-forward** — historia dzielona na kolejne okna; w każdym strategia dostaje dane, których wcześniej nie widziała, i jest porównywana z trzymaniem monety **w tym samym oknie**. Nagłówek mówi wprost, ile okna wygrała.
- **Bot na papierze** — żywa symulacja na bieżących notowaniach. Saldo zostaje w Twojej przeglądarce.
- **Realne koszty** — każde wejście i wyjście płaci opłatę takera i poślizg; pozycja otwarta jest doliczana po ostatniej cenie, razem z opłatą wyjścia.
- **8 par** (BTC, ETH, SOL, XRP, BNB, DOGE, ADA, AVAX) × 4 interwały (15 min, 1 godz., 4 godz., 1 dzień).

## Ważna uwaga

To **nie jest porada inwestycentwa** i nie jest to symulator rachunku maklerskiego. Nie uwzględnia głębokości rynku ani realnych zleceń — liczy na publicznych świecach. Jedyne, co ta aplikacja robi uczciwie, to pokazuje, że aktywny handel po opłatach ma dużo trudniej niż się wydaje.

## Uruchomienie

```bash
npm install
npm run dev        # http://127.0.0.1:8080
```

```bash
npm test           # 279 testów
npm run typecheck
npm run build      # build produkcyjny (.vercel/output)
npm run preview:restart   # podgląd builda na :8081
```

## Wdrożenie

Build jest aplikacją serwerową (TanStack Start + Nitro, preset `vercel`):

```bash
npm run build
npx vercel deploy --prod   # albo przez import repo na Vercel
```

`vercel.json` ustawia `installCommand` na `npm install --omit=dev`, więc build przechodzi bez zależności deweloperskich.

Auth i baza są **wyłączone** — aplikacja trzyma stan wyłącznie w `localStorage` przeglądarki.

## Architektura

| Plik | Rola |
| --- | --- |
| `src/lib/engine.ts` | Silnik: backtest, strategie, koszty, bot na papierze, walk-forward |
| `src/lib/market.functions.ts` | Pobieranie świec i tickerów z Bitget (server fn, cache 8 s) |
| `src/lib/format.ts` | Formatowanie liczb i werdykt (ostateczna ocena strategii) |
| `src/lib/catalog.ts` | Pary i interwały |
| `src/components/desk.tsx` | Cały interfejs |
| `assets-binary.json` | Pliki binarne (PNG) w base64 — odtwarzane przez `scripts/decode-binary-assets.mjs` |

## Zasada, której nie wolno złamać

**Strategia i trzymanie monety muszą być liczone w tym samym oknie.** Jeśli „ostatnie 30%" porównasz z trzymaniem liczonym na całej próbce, zestawisz dwa różne okresy obok siebie i zawyżysz przewagę bota — czasem w obie strony. Dlatego walk-forward liczy obie strony z tego samego przebiegu.

Testy w `src/lib/engine.test.ts`, `src/lib/engine.walkforward.test.ts` i `src/lib/format.test.ts` pilnują tego warunku.

## Uwagi techniczne

- Bitget oddaje maksymalnie 1000 świec na interwał, ale dla doby tylko **300** — aplikacja mówi o tym wprost w interfejsie.
- `change24h` w tickerach Bitget to ułamek dziesiętny (`"0.00453"` = 0,453 %), nie procent.
- Moduły objęte testami jednostkowymi importują się względnie z rozszerzeniem `.ts` — alias `@/lib/...` nie rozwiązuje się w czystym Node pod `node --experimental-strip-types`.

## Źródło

Projekt powstał w Grok Code (xAI) jako aplikacja demonstracyjna. Kod jest otwarty.
