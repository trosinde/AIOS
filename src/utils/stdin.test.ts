import { describe, it, expect, vi } from "vitest";

describe("readStdin", () => {
  it("gibt leeren String zurück wenn stdin TTY ist", async () => {
    // Mock stdin.isTTY = true
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    const { readStdin } = await import("./stdin.js");
    const result = await readStdin();
    expect(result).toBe("");

    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
  });
});
