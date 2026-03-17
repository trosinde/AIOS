import { describe, it, expect } from "vitest";
import { loadConfig, getAiosHome } from "./config.js";

describe("loadConfig", () => {
  it("gibt eine gültige Config zurück", () => {
    const config = loadConfig();
    expect(config).toBeDefined();
    expect(config.providers).toBeDefined();
    expect(config.defaults).toBeDefined();
    expect(config.defaults.provider).toBeTruthy();
    expect(config.paths).toBeDefined();
    expect(config.paths.patterns).toBeTruthy();
    expect(config.paths.personas).toBeTruthy();
  });

  it("hat mindestens einen Provider konfiguriert", () => {
    const config = loadConfig();
    const providers = Object.keys(config.providers);
    expect(providers.length).toBeGreaterThan(0);
  });

  it("Default Provider existiert in providers", () => {
    const config = loadConfig();
    expect(config.providers[config.defaults.provider]).toBeDefined();
  });

  it("Provider hat type und model", () => {
    const config = loadConfig();
    for (const [, provider] of Object.entries(config.providers)) {
      expect(provider.type).toBeTruthy();
      expect(provider.model).toBeTruthy();
    }
  });

  it("lädt lokale aios.yaml wenn vorhanden", () => {
    // Im Projekt-Root existiert aios.yaml
    const config = loadConfig();
    expect(config.paths.patterns).toContain("patterns");
  });
});

describe("getAiosHome", () => {
  it("gibt einen Pfad zurück", () => {
    const home = getAiosHome();
    expect(home).toBeTruthy();
    expect(home).toContain(".aios");
  });
});
