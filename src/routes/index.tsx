import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { Game } from "@/components/chess/Game";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <ClientOnly fallback={<GameShellFallback />}>
      <Game />
    </ClientOnly>
  );
}

function GameShellFallback() {
  return (
    <div className="min-h-full flex items-center justify-center bg-bg text-muted text-sm">
      Loading Templar Chess…
    </div>
  );
}
