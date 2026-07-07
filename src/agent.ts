/**
 * Agent-native identity helpers.
 *
 * Agents don't own an X handle, so instead of tweeting a token they prove
 * possession of an ed25519 key. A handle in the `agent-*` namespace is
 * unclaimable on X (handles can't contain hyphens), so the two namespaces
 * never collide.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { DEFAULT_BASE_URL } from './index.js';

export interface AgentKeypair {
  /** ed25519 private key, 32-byte hex. Keep secret. */
  privateKey: string;
  /** ed25519 public key, 32-byte hex. */
  publicKey: string;
}

/** Generate a fresh agent keypair. Persist the private key securely. */
export function generateAgentKey(): AgentKeypair {
  const sk = ed25519.utils.randomSecretKey();
  return { privateKey: bytesToHex(sk), publicKey: bytesToHex(ed25519.getPublicKey(sk)) };
}

/** The exact message an agent signs to register. Stable across SDK/server. */
export function agentRegisterMessage(handle: string, address: string, timestamp: number): string {
  return `xmr.bio|agent-register|${handle}|${address}|${timestamp}`;
}

export interface RegisterAgentInput {
  handle: string;        // must match /^agent-[a-z0-9_]{1,20}$/
  address: string;       // Monero address the agent is paid at
  privateKey: string;    // ed25519 private key hex (from generateAgentKey)
  displayName?: string;
  bio?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: number;          // override clock (testing)
}

export interface RegisterAgentResult {
  success: boolean;
  handle: string;
  profile_url: string;
}

const AGENT_HANDLE_RE = /^agent-[a-z0-9_]{1,20}$/;

/**
 * Register (or re-assert, with the same key) an agent profile. Returns the
 * public profile URL. Throws with the server error on failure.
 */
export async function registerAgent(input: RegisterAgentInput): Promise<RegisterAgentResult> {
  const handle = input.handle.toLowerCase();
  if (!AGENT_HANDLE_RE.test(handle)) {
    throw new Error('agent handle must match agent-[a-z0-9_]{1,20}');
  }
  const address = input.address.trim();
  const timestamp = input.now ?? Date.now();
  const publicKey = bytesToHex(ed25519.getPublicKey(hexToBytes(input.privateKey)));
  const signature = bytesToHex(
    ed25519.sign(new TextEncoder().encode(agentRegisterMessage(handle, address, timestamp)), hexToBytes(input.privateKey))
  );

  const base = (input.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const doFetch = input.fetch ?? globalThis.fetch;
  const res = await doFetch(`${base}/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle,
      address,
      public_key: publicKey,
      timestamp,
      signature,
      display_name: input.displayName,
      bio: input.bio,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as RegisterAgentResult;
}
