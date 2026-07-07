/**
 * @kyc-rip/xmr-bio-sdk
 *
 * Client for the xmr.bio identity layer — "the address book of the Monero
 * machine economy". Resolve a handle to a verified Monero address, check the
 * ed25519 signature on the resolution, register an autonomous agent, or read
 * the OpenAlias record. Zero runtime deps except @noble/curves.
 *
 * Works in Node 18+, Bun, Deno, browsers, and Cloudflare Workers (uses global
 * `fetch` and WebCrypto).
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/curves/utils.js';

export const DEFAULT_BASE_URL = 'https://api.kyc.rip/v1/bio';

export interface BioMeta {
  service: string;
  version: number;
  signing_key: string;      // ed25519 public key hex used to sign /resolve responses
  signing_alg: 'ed25519';
  endpoints: Record<string, string>;
  verification_methods: string[];
  payments: { protocol: string; min_piconero: number };
}

export interface PublicProfile {
  handle: string;
  address: string;
  display_name: string;
  avatar: string;
  bio: string;
  verified_at?: string;
}

export interface IdentityProof {
  type: 'nostr' | 'agent-key' | string;
  identifier: string;
  verified_at: string;
}

/** The verified contents of a /resolve response (signature already checked). */
export interface ResolvedIdentity {
  v: number;
  service: string;
  handle: string;
  address: string;
  display_name: string;
  verified_at: string | null;
  proofs: IdentityProof[];
  resolved_at: string;
}

export interface SignedResolution {
  payload: string;       // JSON string — sign/verify over its exact UTF-8 bytes
  signature: string;     // ed25519 hex
  public_key: string;    // signer hex
  alg: 'ed25519';
}

export interface Message {
  id: string;
  sender: string;
  content: string;
  amount: number;        // piconero
  tx_hash: string;       // proof id (ANONPAY:… | TX:…)
  timestamp: number;
}

export interface XmrBioError extends Error {
  status?: number;
}

function mkError(message: string, status?: number): XmrBioError {
  const e = new Error(message) as XmrBioError;
  e.status = status;
  return e;
}

/**
 * Verify a signed resolution WITHOUT trusting the response's own `public_key`
 * field. Always pass the key you obtained out-of-band (from meta(), pinned in
 * your config, or a DNS record) as `trustedKey` — otherwise a MITM could swap
 * both the payload and the key.
 */
export function verifyResolution(res: SignedResolution, trustedKey: string): ResolvedIdentity {
  if (res.alg !== 'ed25519') throw mkError(`unsupported alg: ${res.alg}`);
  if (trustedKey && res.public_key !== trustedKey) {
    throw mkError('resolution signed by an unexpected key');
  }
  const ok = ed25519.verify(
    hexToBytes(res.signature),
    new TextEncoder().encode(res.payload),
    hexToBytes(res.public_key)
  );
  if (!ok) throw mkError('resolution signature invalid');
  return JSON.parse(res.payload) as ResolvedIdentity;
}

export interface XmrBioClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class XmrBioClient {
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private cachedSigningKey?: string;

  constructor(opts: XmrBioClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) throw mkError('no fetch implementation available');
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw mkError((data as { error?: string }).error || `HTTP ${res.status}`, res.status);
    return data as T;
  }

  meta(): Promise<BioMeta> {
    return this.get<BioMeta>('/meta');
  }

  profile(handle: string): Promise<PublicProfile> {
    return this.get<PublicProfile>(`/profile/${clean(handle)}`);
  }

  messages(handle: string): Promise<Message[]> {
    return this.get<Message[]>(`/messages/${clean(handle)}`);
  }

  openalias(handle: string): Promise<{ fqdn: string; type: 'TXT'; content: string }> {
    return this.get(`/openalias/${clean(handle)}`);
  }

  /** Raw signed resolution — you verify it yourself with verifyResolution(). */
  resolveSigned(handle: string): Promise<SignedResolution> {
    return this.get<SignedResolution>(`/resolve/${clean(handle)}`);
  }

  /** The current service signing key (cached), fetched from /meta. */
  async signingKey(): Promise<string> {
    if (!this.cachedSigningKey) this.cachedSigningKey = (await this.meta()).signing_key;
    return this.cachedSigningKey;
  }

  /**
   * Resolve a handle to a verified identity, checking the ed25519 signature.
   * Pass `trustedKey` if you pin the signing key out-of-band (recommended);
   * otherwise the key is taken from /meta over the same channel.
   */
  async resolve(handle: string, opts: { trustedKey?: string } = {}): Promise<ResolvedIdentity> {
    const trustedKey = opts.trustedKey ?? (await this.signingKey());
    const signed = await this.resolveSigned(handle);
    return verifyResolution(signed, trustedKey);
  }

  /** Convenience: verified Monero address for a handle, or throws. */
  async resolveAddress(handle: string, opts: { trustedKey?: string } = {}): Promise<string> {
    return (await this.resolve(handle, opts)).address;
  }
}

function clean(handle: string): string {
  return handle.toLowerCase().replace(/^@/, '');
}

export * from './agent.js';
export * from './pay.js';
