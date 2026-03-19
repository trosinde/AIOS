/**
 * AIOS Secret Management – Secure credential storage with pluggable backends.
 *
 * Backends:
 *   - EnvSecretProvider: .env files (fallback, always available)
 *   - KeePassXCProvider: Encrypted .kdbx files (KeePassXC-compatible)
 */

export type { SecretProvider, SecretRef, SecretStoreConfig } from "./secret-provider.js";
export { EnvSecretProvider } from "./env-provider.js";
export { KeePassXCProvider, type KeePassConfig } from "./keepassxc-provider.js";
export { SecretResolver } from "./resolver.js";
