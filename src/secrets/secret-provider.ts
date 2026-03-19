/**
 * SecretProvider – Kernel-stable interface for secret storage backends.
 *
 * Follows the "mechanism, not policy" principle: the interface is kernel-level,
 * concrete backends (env, keepassxc, etc.) are user-space.
 */

// ─── Types ────────────────────────────────────────────────

export interface SecretRef {
  key: string;
  context_id?: string;  // undefined = global scope
}

export interface SecretProvider {
  readonly name: string;
  get(ref: SecretRef): Promise<string | undefined>;
  set(ref: SecretRef, value: string): Promise<void>;
  delete(ref: SecretRef): Promise<void>;
  list(context_id?: string): Promise<string[]>;
  available(): Promise<boolean>;
}

export interface SecretStoreConfig {
  backend: "env" | "keepassxc";
  keepassxc?: {
    database: string;       // path to .kdbx file
    keyfile?: string;       // optional key file path
    group?: string;         // KeePass group prefix, default "AIOS"
  };
}
