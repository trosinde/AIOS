import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { scanProject } from "./scanner.js";

describe("scanner", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aios-scan-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns defaults for empty directory", () => {
    const result = scanProject(testDir);
    expect(result.language).toBe("unknown");
    expect(result.projectName).toBeNull();
    expect(result.hasTests).toBe(false);
    expect(result.hasCi).toBe(false);
    expect(result.existingAios).toBe(false);
    expect(result.existingClaudeMd).toBe(false);
    expect(result.sourceFileCount).toBe(0);
  });

  describe("TypeScript project", () => {
    beforeEach(() => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({
        name: "my-ts-project",
        description: "A TypeScript project",
        type: "module",
        dependencies: { express: "^4.0.0" },
        devDependencies: { typescript: "^5.0.0", vitest: "^2.0.0" },
      }));
      writeFileSync(join(testDir, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", strict: true },
      }));
      mkdirSync(join(testDir, "src"), { recursive: true });
      writeFileSync(join(testDir, "src", "index.ts"), "export const x = 1;");
      writeFileSync(join(testDir, "src", "app.ts"), "export const app = {};");
    });

    it("detects TypeScript + ESM + vitest + express", () => {
      const result = scanProject(testDir);
      expect(result.projectName).toBe("my-ts-project");
      expect(result.description).toBe("A TypeScript project");
      expect(result.language).toBe("typescript");
      expect(result.moduleSystem).toBe("esm");
      expect(result.hasTests).toBe(true);
      expect(result.testFramework).toBe("vitest");
      expect(result.detectedFrameworks).toContain("express");
      expect(result.sourceFileCount).toBe(2);
    });
  });

  describe("JavaScript project with jest", () => {
    beforeEach(() => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({
        name: "js-project",
        dependencies: { react: "^18.0.0" },
        devDependencies: { jest: "^29.0.0" },
      }));
      mkdirSync(join(testDir, "src"), { recursive: true });
      writeFileSync(join(testDir, "src", "App.jsx"), "export default () => null;");
    });

    it("detects JavaScript + commonjs + jest + react", () => {
      const result = scanProject(testDir);
      expect(result.language).toBe("javascript");
      expect(result.moduleSystem).toBe("commonjs");
      expect(result.hasTests).toBe(true);
      expect(result.testFramework).toBe("jest");
      expect(result.detectedFrameworks).toContain("react");
    });
  });

  describe("Python project", () => {
    beforeEach(() => {
      writeFileSync(join(testDir, "pyproject.toml"), [
        '[project]',
        'name = "my-python-lib"',
        '',
        '[tool.pytest.ini_options]',
        'testpaths = ["tests"]',
      ].join("\n"));
      mkdirSync(join(testDir, "tests"), { recursive: true });
      mkdirSync(join(testDir, "src"), { recursive: true });
      writeFileSync(join(testDir, "src", "main.py"), "print('hello')");
    });

    it("detects Python + pytest", () => {
      const result = scanProject(testDir);
      expect(result.language).toBe("python");
      expect(result.hasTests).toBe(true);
      expect(result.testFramework).toBe("pytest");
      expect(result.projectName).toBe("my-python-lib");
    });
  });

  describe("Rust project", () => {
    beforeEach(() => {
      writeFileSync(join(testDir, "Cargo.toml"), [
        '[package]',
        'name = "my-rust-project"',
        'version = "0.1.0"',
      ].join("\n"));
      mkdirSync(join(testDir, "src"), { recursive: true });
      writeFileSync(join(testDir, "src", "main.rs"), 'fn main() {}');
    });

    it("detects Rust + cargo test", () => {
      const result = scanProject(testDir);
      expect(result.language).toBe("rust");
      expect(result.hasTests).toBe(true);
      expect(result.testFramework).toBe("cargo test");
      expect(result.projectName).toBe("my-rust-project");
    });
  });

  describe("Go project", () => {
    beforeEach(() => {
      writeFileSync(join(testDir, "go.mod"), "module github.com/user/mygoapp\n\ngo 1.21\n");
      writeFileSync(join(testDir, "main.go"), "package main\nfunc main() {}");
      writeFileSync(join(testDir, "main_test.go"), "package main\nfunc TestMain() {}");
    });

    it("detects Go + go test", () => {
      const result = scanProject(testDir);
      expect(result.language).toBe("go");
      expect(result.hasTests).toBe(true);
      expect(result.testFramework).toBe("go test");
      expect(result.projectName).toBe("mygoapp");
    });
  });

  describe("CI/CD detection", () => {
    it("detects GitHub Actions", () => {
      mkdirSync(join(testDir, ".github", "workflows"), { recursive: true });
      writeFileSync(join(testDir, ".github", "workflows", "ci.yml"), "name: CI");
      const result = scanProject(testDir);
      expect(result.hasCi).toBe(true);
      expect(result.ciTool).toBe("github-actions");
    });

    it("detects GitLab CI", () => {
      writeFileSync(join(testDir, ".gitlab-ci.yml"), "stages: [build]");
      const result = scanProject(testDir);
      expect(result.hasCi).toBe(true);
      expect(result.ciTool).toBe("gitlab-ci");
    });

    it("detects Jenkins", () => {
      writeFileSync(join(testDir, "Jenkinsfile"), "pipeline {}");
      const result = scanProject(testDir);
      expect(result.hasCi).toBe(true);
      expect(result.ciTool).toBe("jenkins");
    });
  });

  describe("existing .aios and CLAUDE.md", () => {
    it("detects existing .aios/", () => {
      mkdirSync(join(testDir, ".aios"));
      const result = scanProject(testDir);
      expect(result.existingAios).toBe(true);
    });

    it("detects existing CLAUDE.md", () => {
      writeFileSync(join(testDir, "CLAUDE.md"), "# Project");
      const result = scanProject(testDir);
      expect(result.existingClaudeMd).toBe(true);
    });
  });

  describe("compliance hints", () => {
    it("detects OWASP in README", () => {
      writeFileSync(join(testDir, "README.md"), "This project follows OWASP guidelines.");
      const result = scanProject(testDir);
      expect(result.complianceHints).toContain("OWASP");
    });

    it("detects IEC 62443 in docs", () => {
      mkdirSync(join(testDir, "docs"), { recursive: true });
      writeFileSync(join(testDir, "docs", "security.md"), "Conforming to IEC 62443 SL2");
      const result = scanProject(testDir);
      expect(result.complianceHints).toContain("IEC 62443");
    });
  });

  describe("git remote", () => {
    it("extracts git remote URL", () => {
      mkdirSync(join(testDir, ".git"), { recursive: true });
      writeFileSync(join(testDir, ".git", "config"), [
        "[remote \"origin\"]",
        "\turl = https://github.com/user/repo.git",
        "\tfetch = +refs/heads/*:refs/remotes/origin/*",
      ].join("\n"));
      const result = scanProject(testDir);
      expect(result.gitRemote).toBe("https://github.com/user/repo.git");
    });
  });

  describe("mixed language", () => {
    it("detects mixed when both TS and Python present", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({
        name: "mixed", devDependencies: { typescript: "^5.0.0" },
      }));
      writeFileSync(join(testDir, "pyproject.toml"), '[project]\nname = "mixed"');
      const result = scanProject(testDir);
      expect(result.language).toBe("mixed");
    });
  });

  describe("ignores node_modules", () => {
    it("does not count files in node_modules", () => {
      mkdirSync(join(testDir, "node_modules", "some-pkg"), { recursive: true });
      writeFileSync(join(testDir, "node_modules", "some-pkg", "index.js"), "module.exports = 1;");
      mkdirSync(join(testDir, "src"), { recursive: true });
      writeFileSync(join(testDir, "src", "app.ts"), "export const x = 1;");
      const result = scanProject(testDir);
      expect(result.sourceFileCount).toBe(1);
    });
  });
});
