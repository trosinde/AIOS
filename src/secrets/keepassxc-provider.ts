/**
 * KeePassXC Provider – Encrypted secret storage using .kdbx files.
 *
 * Uses `kdbxweb` (pure JS) for KeePass database read/write.
 * Fully compatible with KeePassXC desktop application.
 *
 * Context isolation via KeePass groups: AIOS/<context_id>/<key>
 * Global secrets stored under: AIOS/_global/<key>
 */

import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { SecretProvider, SecretRef } from "./secret-provider.js";

// Lazy import to avoid loading kdbxweb when not needed
let kdbxweb: typeof import("kdbxweb") | null = null;
let argon2Registered = false;

async function getKdbxweb() {
  if (!kdbxweb) {
    kdbxweb = await import("kdbxweb");
  }
  // Register argon2 implementation (required for KDBX4 format)
  if (!argon2Registered) {
    try {
      const argon2 = await import("argon2");
      kdbxweb.CryptoEngine.setArgon2Impl(
        (async (password: ArrayBuffer, salt: ArrayBuffer, memory: number, iterations: number, length: number, parallelism: number, type: number, version: number): Promise<ArrayBuffer> => {
          const argonType = type === 1 ? argon2.argon2i : type === 2 ? argon2.argon2id : argon2.argon2d;
          const result = await argon2.hash(Buffer.from(password), {
            salt: Buffer.from(salt),
            memoryCost: memory,
            timeCost: iterations,
            hashLength: length,
            parallelism,
            type: argonType,
            version,
            raw: true,
          });
          return new Uint8Array(result).buffer as ArrayBuffer;
        }) as Parameters<typeof kdbxweb.CryptoEngine.setArgon2Impl>[0]
      );
      argon2Registered = true;
    } catch {
      // argon2 not available – will fail on KDBX4 operations
    }
  }
  return kdbxweb;
}

export interface KeePassConfig {
  database: string;
  keyfile?: string;
  group?: string;  // default "AIOS"
}

export class KeePassXCProvider implements SecretProvider {
  readonly name = "keepassxc";
  private config: KeePassConfig;
  private db: InstanceType<typeof import("kdbxweb").Kdbx> | null = null;
  private masterPassword: string | null = null;
  private promptPassword: (() => Promise<string>) | null = null;

  constructor(config: KeePassConfig, promptPassword?: () => Promise<string>) {
    this.config = {
      ...config,
      group: config.group ?? "AIOS",
    };
    this.promptPassword = promptPassword ?? null;
  }

  async available(): Promise<boolean> {
    try {
      await getKdbxweb();
      return true;
    } catch {
      return false;
    }
  }

  async get(ref: SecretRef): Promise<string | undefined> {
    const db = await this.ensureOpen();
    const groupName = this.groupFor(ref.context_id);
    const entry = this.findEntry(db, groupName, ref.key);
    if (!entry) return undefined;

    const { ProtectedValue } = await getKdbxweb();
    const pw = entry.fields.get("Password");
    if (pw instanceof ProtectedValue) {
      return pw.getText();
    }
    return typeof pw === "string" ? pw : undefined;
  }

  async set(ref: SecretRef, value: string): Promise<void> {
    const kw = await getKdbxweb();
    const db = await this.ensureOpen();
    const groupName = this.groupFor(ref.context_id);
    const group = this.ensureGroup(db, groupName);

    // Check if entry exists
    let entry = this.findEntry(db, groupName, ref.key);
    if (!entry) {
      entry = db.createEntry(group);
      entry.fields.set("Title", ref.key);
    }

    entry.fields.set("Password", kw.ProtectedValue.fromString(value));
    entry.times.update();

    await this.save(db);
  }

  async delete(ref: SecretRef): Promise<void> {
    const db = await this.ensureOpen();
    const groupName = this.groupFor(ref.context_id);
    const entry = this.findEntry(db, groupName, ref.key);
    if (entry) {
      db.remove(entry);
      await this.save(db);
    }
  }

  async list(context_id?: string): Promise<string[]> {
    if (!existsSync(this.config.database)) return [];
    const db = await this.ensureOpen();
    const groupName = this.groupFor(context_id);
    const group = this.findGroup(db, groupName);
    if (!group) return [];

    const keys: string[] = [];
    for (const entry of group.entries) {
      const title = entry.fields.get("Title");
      if (typeof title === "string") {
        keys.push(title);
      }
    }
    return keys.sort();
  }

  // ─── Internal ──────────────────────────────────────────

  /** Set master password programmatically (for testing) */
  setMasterPassword(password: string): void {
    this.masterPassword = password;
  }

  private groupFor(context_id?: string): string {
    const prefix = this.config.group!;
    const scope = context_id && context_id !== "default" ? context_id : "_global";
    return `${prefix}/${scope}`;
  }

  private async ensureOpen(): Promise<InstanceType<typeof import("kdbxweb").Kdbx>> {
    if (this.db) return this.db;

    const kw = await getKdbxweb();

    if (!this.masterPassword) {
      if (this.promptPassword) {
        this.masterPassword = await this.promptPassword();
      } else {
        throw new Error("Master password required. Use setMasterPassword() or provide a promptPassword callback.");
      }
    }

    const credentials = new kw.Credentials(
      kw.ProtectedValue.fromString(this.masterPassword)
    );

    if (existsSync(this.config.database)) {
      const data = readFileSync(this.config.database);
      const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      this.db = await kw.Kdbx.load(arrayBuffer as ArrayBuffer, credentials);
    } else {
      // Create new database
      this.db = kw.Kdbx.create(credentials, "AIOS Secrets");
      await this.save(this.db);
    }

    return this.db;
  }

  private async save(db: InstanceType<typeof import("kdbxweb").Kdbx>): Promise<void> {
    mkdirSync(dirname(this.config.database), { recursive: true });
    const data = await db.save();
    writeFileSync(this.config.database, Buffer.from(data));
    chmodSync(this.config.database, 0o600);
  }

  private findGroup(
    db: InstanceType<typeof import("kdbxweb").Kdbx>,
    path: string
  ): InstanceType<typeof import("kdbxweb").KdbxGroup> | null {
    const parts = path.split("/");
    let current = db.getDefaultGroup();
    for (const part of parts) {
      const child = current.groups.find(
        (g: InstanceType<typeof import("kdbxweb").KdbxGroup>) => g.name === part
      );
      if (!child) return null;
      current = child;
    }
    return current;
  }

  private ensureGroup(
    db: InstanceType<typeof import("kdbxweb").Kdbx>,
    path: string
  ): InstanceType<typeof import("kdbxweb").KdbxGroup> {
    const parts = path.split("/");
    let current = db.getDefaultGroup();
    for (const part of parts) {
      let child = current.groups.find(
        (g: InstanceType<typeof import("kdbxweb").KdbxGroup>) => g.name === part
      );
      if (!child) {
        child = db.createGroup(current, part);
      }
      current = child;
    }
    return current;
  }

  private findEntry(
    db: InstanceType<typeof import("kdbxweb").Kdbx>,
    groupPath: string,
    key: string
  ): InstanceType<typeof import("kdbxweb").KdbxEntry> | null {
    const group = this.findGroup(db, groupPath);
    if (!group) return null;
    return (
      group.entries.find(
        (e: InstanceType<typeof import("kdbxweb").KdbxEntry>) => e.fields.get("Title") === key
      ) ?? null
    );
  }
}
