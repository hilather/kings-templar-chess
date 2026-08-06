import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Game } from "./Game";
import { OnlineGame } from "./OnlineGame";
import { Button } from "@/components/ui/button";
import { isValidRoomId } from "@/lib/multiplayer/protocol";

export function AppRoot() {
  const [mode, setMode] = useState<"ai" | "online">(() => {
    if (typeof window === "undefined") return "ai";
    const room = new URLSearchParams(window.location.search).get("room");
    return room && isValidRoomId(room) ? "online" : "ai";
  });

  // Deep-link: always open online when ?room= is present
  useEffect(() => {
    if (typeof window === "undefined") return;
    const room = new URLSearchParams(window.location.search).get("room");
    if (room && isValidRoomId(room)) setMode("online");
  }, []);

  if (mode === "online") {
    return (
      <OnlineGame
        onBack={() => {
          setMode("ai");
          if (typeof window !== "undefined") {
            const u = new URL(window.location.href);
            u.searchParams.delete("room");
            window.history.replaceState({}, "", u.pathname + u.search);
          }
        }}
      />
    );
  }

  return (
    <div className="relative min-h-full">
      <Game />
      {/* Fixed entry point so we do not need to edit Game.tsx menu markup */}
      <div className="fixed bottom-4 right-4 z-30 sm:bottom-6 sm:right-6">
        <Button
          size="lg"
          className="shadow-lg"
          onClick={() => setMode("online")}
        >
          <Users className="h-4 w-4" />
          Play online
        </Button>
      </div>
    </div>
  );
}
