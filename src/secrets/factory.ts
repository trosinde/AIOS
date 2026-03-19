/**
 * Factory for creating a SecretResolver based on configuration.
 *
 * Determines which backends to use and creates them in priority order.
 */

import { join } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import type { AiosConfig } from "../types.js";
import type { SecretStoreConfig, SecretProvider } from "./secret-provider.js";
import { EnvSecretProvider } from "./env-provider.js";
import { KeePassXCProvider } from "./keepassxc-provider.js";
import { SecretResolver } from "./resolver.js";

const AIOS_HOME = join(homedir(), ".aios");

/**
 * Prompt the user for a password via TTY (hidden input).
 */
function promptMasterPassword(): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stderr.write("KeePass Master-Passwort: ");

    if (process.stdin.isTTY) {
      let input = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf-8");

      const onData = (chunk: string) => {
        if (chunk === "\n" || chunk === "\r") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stderr.write("\n");
          resolve(input);
        } else if (chunk === "\u0003") {
          process.stdin.setRawMode(false);
          reject(new Error("Abgebrochen"));
        } else if (chunk === "\u007f" || chunk === "\b") {
          input = input.slice(0, -1);
        } else {
          input += chunk;
        }
      };
      process.stdin.on("data", onData);
    } else {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      rl.question("", (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Create a SecretResolver from AIOS config and optional context-level secret config.
 */
export async function createSecretResolver(
  config: AiosConfig,
  contextSecrets?: SecretStoreConfig
): Promise<SecretResolver> {
  const secretConfig = contextSecrets ?? config.secrets;
  const providers: SecretProvider[] = [];

  if (secretConfig?.backend === "keepassxc" && secretConfig.keepassxc) {
    const dbPath = secretConfig.keepassxc.database.replace("~", homedir());
    const kp = new KeePassXCProvider(
      {
        database: dbPath,
        keyfile: secretConfig.keepassxc.keyfile,
        group: secretConfig.keepassxc.group ?? "AIOS",
      },
      promptMasterPassword
    );
    providers.push(kp);
  }

  // Env is always the fallback
  providers.push(new EnvSecretProvider());

  return new SecretResolver(providers);
}

/**
 * Default database path for KeePass secrets.
 */
export function defaultKeePassPath(): string {
  return join(AIOS_HOME, "secrets.kdbx");
}
