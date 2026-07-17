import { app, safeStorage } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger";

/**
 * Per-install ed25519 device key. The private key never leaves this machine;
 * the public key is registered with a server at enrollment and is the device
 * identity there. Encrypted at rest via the OS (DPAPI / keychain / libsecret)
 * when available.
 */

const KEY_FILE = "device-key.bin";
const KEY_FILE_PLAIN = "device-key.pem";

/** SPKI DER prefix for ed25519 — strip it to get the raw 32-byte public key. */
const SPKI_ED25519_PREFIX_LEN = 12;

let cached: { privateKey: crypto.KeyObject; publicKeyB64: string } | null = null;

function keyDir(): string {
  return app.getPath("userData");
}

function derivePublicB64(privateKey: crypto.KeyObject): string {
  const spki = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  return Buffer.from(spki.subarray(SPKI_ED25519_PREFIX_LEN)).toString("base64");
}

function loadExisting(): crypto.KeyObject | null {
  const enc = path.join(keyDir(), KEY_FILE);
  const plain = path.join(keyDir(), KEY_FILE_PLAIN);
  try {
    if (fs.existsSync(enc) && safeStorage.isEncryptionAvailable()) {
      const pem = safeStorage.decryptString(fs.readFileSync(enc));
      return crypto.createPrivateKey(pem);
    }
    if (fs.existsSync(plain)) {
      return crypto.createPrivateKey(fs.readFileSync(plain, "utf8"));
    }
  } catch (err) {
    logger.warn(`[DEVICE_KEY] Could not load existing key, generating new: ${String(err)}`);
  }
  return null;
}

function persist(privateKey: crypto.KeyObject): void {
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  fs.mkdirSync(keyDir(), { recursive: true });
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(path.join(keyDir(), KEY_FILE), safeStorage.encryptString(pem));
  } else {
    // No OS keystore (e.g. bare Linux without a keyring) — best effort on disk.
    logger.warn("[DEVICE_KEY] OS encryption unavailable; storing key with file permissions only");
    fs.writeFileSync(path.join(keyDir(), KEY_FILE_PLAIN), pem, { mode: 0o600 });
  }
}

export function getDeviceKey(): { privateKey: crypto.KeyObject; publicKeyB64: string } {
  if (cached) return cached;
  let privateKey = loadExisting();
  if (!privateKey) {
    privateKey = crypto.generateKeyPairSync("ed25519").privateKey;
    persist(privateKey);
    logger.info("[DEVICE_KEY] Generated new device keypair");
  }
  cached = { privateKey, publicKeyB64: derivePublicB64(privateKey) };
  return cached;
}

/** Signs a login challenge nonce; returns base64 of the 64-byte ed25519 signature. */
export function signChallenge(nonce: string): string {
  const { privateKey } = getDeviceKey();
  return crypto.sign(null, Buffer.from(nonce, "utf8"), privateKey).toString("base64");
}

/**
 * `X-Download-Auth` value: `ts.nonce.signature`. Proves the private key was
 * used to start this stream; the server checks freshness and replay.
 */
export function makeDownloadAuthHeader(): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const { privateKey } = getDeviceKey();
  const sig = crypto.sign(null, Buffer.from(`${ts}.${nonce}`, "utf8"), privateKey).toString("base64");
  return `${ts}.${nonce}.${sig}`;
}
