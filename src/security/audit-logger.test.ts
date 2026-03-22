import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { AuditLogger, DEFAULT_AUDIT_CONFIG } from "./audit-logger.js";
import type { TaintLabel } from "./taint-tracker.js";
import type { InputGuardResult, InjectionFlag } from "./input-guard.js";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

describe("AuditLogger", () => {
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    tmpDir = join("/tmp", `audit-test-${crypto.randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    logFile = join(tmpDir, "logs", "audit.jsonl");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Core log() behavior ──────────────────────────────────

  it("writes JSONL entry to file", () => {
    const logger = new AuditLogger({ logFile });
    logger.log({
      level: "info",
      event_type: "input_received",
      message: "test event",
    });

    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.level).toBe("info");
    expect(entry.event_type).toBe("input_received");
    expect(entry.message).toBe("test event");
    expect(entry.timestamp).toBeDefined();
  });

  it("appends multiple entries as separate lines", () => {
    const logger = new AuditLogger({ logFile });
    logger.log({ level: "info", event_type: "plan_created", message: "one" });
    logger.log({ level: "warn", event_type: "guard_triggered", message: "two" });

    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("does nothing when disabled", () => {
    const logger = new AuditLogger({ logFile, enabled: false });
    logger.log({ level: "info", event_type: "input_received", message: "should not appear" });

    expect(existsSync(logFile)).toBe(false);
  });

  it("respects logLevel filter", () => {
    const logger = new AuditLogger({ logFile, logLevel: "warn" });

    // debug and info should be filtered out
    logger.log({ level: "debug", event_type: "canary_ok", message: "debug" });
    logger.log({ level: "info", event_type: "input_received", message: "info" });

    // warn and error should pass
    logger.log({ level: "warn", event_type: "guard_triggered", message: "warn" });
    logger.log({ level: "error", event_type: "canary_missing", message: "error" });

    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).level).toBe("warn");
    expect(JSON.parse(lines[1]).level).toBe("error");
  });

  it("creates log directory recursively", () => {
    const deepPath = join(tmpDir, "a", "b", "c", "audit.jsonl");
    const logger = new AuditLogger({ logFile: deepPath });
    logger.log({ level: "info", event_type: "input_received", message: "deep" });

    expect(existsSync(deepPath)).toBe(true);
  });

  it("falls back to stderr on write failure", () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Use a path that will fail (directory as file)
    const badPath = join(tmpDir, "logs"); // logs is a directory after first logger use
    mkdirSync(badPath, { recursive: true });

    const logger = new AuditLogger({ logFile: badPath }); // path IS a directory
    logger.log({ level: "info", event_type: "input_received", message: "fallback" });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("[AUDIT]"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("fallback"));
    stderrSpy.mockRestore();
  });

  it("adds ISO timestamp automatically", () => {
    const logger = new AuditLogger({ logFile });
    logger.log({ level: "info", event_type: "input_received", message: "ts test" });

    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    // ISO 8601 format check
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });

  // ─── Convenience methods ────────────────────────────────────

  it("inputReceived logs with sha256 hash", () => {
    const logger = new AuditLogger({ logFile });
    logger.inputReceived("hello world", "trace-1", "ctx-1");

    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    expect(entry.event_type).toBe("input_received");
    expect(entry.trace_id).toBe("trace-1");
    expect(entry.context_id).toBe("ctx-1");
    expect(entry.input_hash).toBe(sha256("hello world"));
    expect(entry.message).toContain("11 chars");
  });

  it("guardTriggered logs warning with guard result", () => {
    const logger = new AuditLogger({ logFile });
    const result: InputGuardResult = {
      safe: false,
      score: 0.85,
      flags: ["pattern_match", "encoding_detected"] as InjectionFlag[],
      details: ["Suspicious pattern"],
      normalized: "suspicious input",
    };
    logger.guardTriggered(result, "trace-2");

    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    expect(entry.level).toBe("warn");
    expect(entry.event_type).toBe("guard_triggered");
    expect(entry.guard_result.safe).toBe(false);
    expect(entry.guard_result.score).toBe(0.85);
    expect(entry.guard_result.flags).toContain("pattern_match");
    expect(entry.message).toContain("0.85");
  });

  it("guardPassed logs at debug level", () => {
    const logger = new AuditLogger({ logFile, logLevel: "debug" });
    const result: InputGuardResult = {
      safe: true,
      score: 0.1,
      flags: [],
      details: [],
      normalized: "",
    };
    logger.guardPassed(result, "trace-3");

    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    expect(entry.level).toBe("debug");
    expect(entry.event_type).toBe("guard_passed");
  });

  it("planCreated logs plan hash", () => {
    const logger = new AuditLogger({ logFile });
    const plan = '{"type":"dag","steps":[]}';
    logger.planCreated(plan, "trace-4");

    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    expect(entry.event_type).toBe("plan_created");
    expect(entry.plan_hash).toBe(sha256(plan));
  });

  it("planFrozen logs truncated hash", () => {
    const logger = new AuditLogger({ logFile });
    logger.planFrozen("abcdef1234567890abcdef", "trace-5");

    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    expect(entry.event_type).toBe("plan_frozen");
    expect(entry.plan_hash).toBe("abcdef1234567890abcdef");
    expect(entry.message).toContain("abcdef1234567890...");
  });

  it("stepExecuted logs output hash and taint", () => {
    const logger = new AuditLogger({ logFile });
    const taint: TaintLabel = {
      integrity: "derived",
      confidentiality: "internal",
      source: "llm",
      transformations: ["summarize"],
    };
    logger.stepExecuted("step-1", "extract_requirements", "output text", taint, "trace-6");

    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    expect(entry.event_type).toBe("step_executed");
    expect(entry.step_id).toBe("step-1");
    expect(entry.pattern).toBe("extract_requirements");
    expect(entry.output_hash).toBe(sha256("output text"));
    expect(entry.taint_labels[0].integrity).toBe("derived");
  });

  it("stepExecuted works without taint", () => {
    const logger = new AuditLogger({ logFile });
    logger.stepExecuted("step-2", "analyze", "result");

    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    expect(entry.taint_labels).toBeUndefined();
  });

  it("canaryMissing logs at error level", () => {
    const logger = new AuditLogger({ logFile });
    logger.canaryMissing("bad_pattern", "trace-7");

    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    expect(entry.level).toBe("error");
    expect(entry.event_type).toBe("canary_missing");
    expect(entry.pattern).toBe("bad_pattern");
    expect(entry.message).toContain("CANARY MISSING");
  });

  it("canaryOk logs at debug level", () => {
    const logger = new AuditLogger({ logFile, logLevel: "debug" });
    logger.canaryOk("good_pattern", "trace-8");

    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    expect(entry.level).toBe("debug");
    expect(entry.event_type).toBe("canary_ok");
  });

  it("policyViolation logs with taint info", () => {
    const logger = new AuditLogger({ logFile });
    const taint: TaintLabel = {
      integrity: "untrusted",
      confidentiality: "public",
      source: "user",
      transformations: [],
    };
    logger.policyViolation("tool_execution", "untrusted input", taint, "trace-9");

    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    expect(entry.level).toBe("error");
    expect(entry.event_type).toBe("policy_violation");
    expect(entry.taint_labels[0].integrity).toBe("untrusted");
    expect(entry.message).toContain("tool_execution");
  });

  it("kbWrite logs content hash and taint integrity", () => {
    const logger = new AuditLogger({ logFile });
    const taint: TaintLabel = {
      integrity: "trusted",
      confidentiality: "internal",
      source: "system",
      transformations: [],
    };
    logger.kbWrite("knowledge content", taint, "trace-10");

    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    expect(entry.event_type).toBe("kb_write");
    expect(entry.output_hash).toBe(sha256("knowledge content"));
    expect(entry.message).toContain("integrity=trusted");
  });

  it("kbWriteBlocked logs with reason", () => {
    const logger = new AuditLogger({ logFile });
    logger.kbWriteBlocked("bad content", "untrusted source", "trace-11");

    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    expect(entry.level).toBe("warn");
    expect(entry.event_type).toBe("kb_write_blocked");
    expect(entry.message).toContain("untrusted source");
  });

  // ─── Default config ─────────────────────────────────────────

  it("uses default config values", () => {
    expect(DEFAULT_AUDIT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_AUDIT_CONFIG.logLevel).toBe("info");
    expect(DEFAULT_AUDIT_CONFIG.logFile).toBe("logs/security-audit.jsonl");
    expect(DEFAULT_AUDIT_CONFIG.complianceReports).toBe(true);
  });
});
