import { createFileRoute } from "@tanstack/react-router";
import { Desk } from "@/components/desk";
import { getMarketBook } from "@/lib/market.functions";

export const Route = createFileRoute("/")({
  loader: () => getMarketBook({ data: { symbol: "BTCUSDT", granularity: "1h" } }),
  component: Home,
});

function Home() {
  const initial = Route.useLoaderData();
  return <Desk initial={initial} />;
}
