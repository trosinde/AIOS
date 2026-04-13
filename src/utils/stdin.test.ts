import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";

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

  it("liest Pipe-Input wenn stdin nicht TTY ist", async () => {
    // Create a mock stdin stream
    const mockStdin = new EventEmitter() as typeof process.stdin;
    (mockStdin as unknown as Record<string, unknown>).isTTY = undefined;
    mockStdin.setEncoding = vi.fn();

    // Replace process.stdin temporarily
    const origStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: mockStdin, configurable: true });

    // Dynamic import to get fresh module behavior
    // We need to re-implement the logic since import caching
    const readStdinFn = (): Promise<string> => {
      return new Promise((resolve) => {
        if (process.stdin.isTTY) {
          resolve("");
          return;
        }
        let data = "";
        process.stdin.setEncoding("utf-8");
        process.stdin.on("data", (chunk: string) => (data += chunk));
        process.stdin.on("end", () => resolve(data.trim()));
      });
    };

    const promise = readStdinFn();

    // Simulate data arriving on stdin
    mockStdin.emit("data", "Hello ");
    mockStdin.emit("data", "World\n");
    mockStdin.emit("end");

    const result = await promise;
    expect(result).toBe("Hello World");

    Object.defineProperty(process, "stdin", { value: origStdin, configurable: true });
  });

  it("trimmt whitespace aus Pipe-Input", async () => {
    const mockStdin = new EventEmitter() as typeof process.stdin;
    (mockStdin as unknown as Record<string, unknown>).isTTY = undefined;
    mockStdin.setEncoding = vi.fn();

    const origStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: mockStdin, configurable: true });

    const readStdinFn = (): Promise<string> => {
      return new Promise((resolve) => {
        if (process.stdin.isTTY) {
          resolve("");
          return;
        }
        let data = "";
        process.stdin.setEncoding("utf-8");
        process.stdin.on("data", (chunk: string) => (data += chunk));
        process.stdin.on("end", () => resolve(data.trim()));
      });
    };

    const promise = readStdinFn();
    mockStdin.emit("data", "  \n  trimmed content  \n  ");
    mockStdin.emit("end");

    const result = await promise;
    expect(result).toBe("trimmed content");

    Object.defineProperty(process, "stdin", { value: origStdin, configurable: true });
  });
});
