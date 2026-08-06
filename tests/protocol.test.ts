import { describe, expect, it } from "vitest";
import {
  generateRoomId,
  historyToWire,
  isChessNetMessage,
  isValidRoomId,
  normalizeRoomId,
} from "../src/lib/multiplayer/protocol";

describe("multiplayer protocol helpers", () => {
  it("normalizes room ids to safe uppercase labels", () => {
    expect(normalizeRoomId("  templar hall  ")).toBe("TEMPLAR-HALL");
    expect(normalizeRoomId("a!b@c#")).toBe("ABC");
    expect(normalizeRoomId("x".repeat(40)).length).toBe(24);
  });

  it("validates room id length", () => {
    expect(isValidRoomId("AB")).toBe(false);
    expect(isValidRoomId("ABC")).toBe(true);
    expect(isValidRoomId("TEMPLAR")).toBe(true);
  });

  it("generates 6-char room codes from safe alphabet", () => {
    const id = generateRoomId();
    expect(id).toMatch(/^[A-Z0-9]{6}$/);
    expect(id).not.toMatch(/[IO01]/); // excluded ambiguous glyphs in alphabet
  });

  it("maps history to wire moves with ply counters", () => {
    const wire = historyToWire([
      {
        from: "e2",
        to: "e4",
        isTemplar: false,
      },
      {
        from: "e1",
        to: "f3",
        isTemplar: true,
      },
    ]);
    expect(wire).toEqual([
      { from: "e2", to: "e4", isTemplar: undefined, ply: 1, promotion: undefined },
      { from: "e1", to: "f3", isTemplar: true, ply: 2, promotion: undefined },
    ]);
  });

  it("type-guards chess net messages", () => {
    expect(isChessNetMessage({ t: "move", move: { from: "e2", to: "e4", ply: 1 } })).toBe(
      true,
    );
    expect(isChessNetMessage({ t: "hello", name: "A", role: "host" })).toBe(true);
    expect(isChessNetMessage({ t: "nope" })).toBe(false);
    expect(isChessNetMessage(null)).toBe(false);
  });
});
