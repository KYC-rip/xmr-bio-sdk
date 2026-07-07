/**
 * XMR402 helpers for posting a paid message to a creator's board.
 *
 * The SDK handles the HTTP handshake and challenge parsing. It does NOT move
 * money — generating the Monero transaction and the tx proof is the wallet's
 * job (e.g. @kyc-rip/ripley-guard-ts, the Ripley gateway, or monero-wallet-rpc
 * `get_tx_proof`). The typical flow:
 *
 *   1. postPaidMessage() with no proof → returns a Xmr402Challenge (HTTP 402).
 *   2. Your wallet sends `amountPiconero` to `challenge.address` and produces a
 *      tx proof over the message `challenge.nonce` (check_tx_proof / get_tx_proof).
 *   3. postPaidMessage() again with { txid, proof } → message is posted.
 *
 * The nonce is bound to the request body + your IP + a rolling time window, so
 * pay and submit within a few minutes and don't change the body between steps.
 */

import { DEFAULT_BASE_URL } from './index.js';

export interface Xmr402Challenge {
  kind: '402-challenge';
  address: string;         // pay THIS (the creator's address)
  amountPiconero: number;
  nonce: string;           // sign this as the tx-proof message
  timestamp: number;
}

export interface PaidMessagePosted {
  kind: 'posted';
  message: {
    id: string; sender: string; content: string;
    amount: number; tx_hash: string; timestamp: number;
  };
}

export interface PostPaidMessageInput {
  handle: string;
  content: string;
  sender?: string;
  proof?: { txid: string; proof: string };  // omit for the first (challenge) call
  baseUrl?: string;
  fetch?: typeof fetch;
}

function parseChallenge(headerValue: string, ts: number): Xmr402Challenge | null {
  // XMR402 address="..", amount="..", message="..", timestamp=".."
  const get = (k: string) => headerValue.match(new RegExp(`${k}="([^"]*)"`))?.[1];
  const address = get('address');
  const amount = get('amount');
  const nonce = get('message');
  if (!address || !amount || !nonce) return null;
  return { kind: '402-challenge', address, amountPiconero: Number(amount), nonce, timestamp: ts };
}

/**
 * Post a paid message via the XMR402 direct-to-creator path. Returns a
 * `402-challenge` when payment is required, or `posted` once the proof clears.
 */
export async function postPaidMessage(input: PostPaidMessageInput): Promise<Xmr402Challenge | PaidMessagePosted> {
  const base = (input.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const doFetch = input.fetch ?? globalThis.fetch;
  const handle = input.handle.toLowerCase().replace(/^@/, '');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (input.proof) headers['Authorization'] = `XMR402 txid="${input.proof.txid}", proof="${input.proof.proof}"`;

  // Body must be byte-identical between the challenge and proof calls — the
  // nonce is bound to its hash.
  const body = JSON.stringify({ content: input.content, sender: input.sender });
  const res = await doFetch(`${base}/message402/${handle}`, { method: 'POST', headers, body });

  if (res.status === 402) {
    const challenge = parseChallenge(res.headers.get('WWW-Authenticate') || '', Date.now());
    if (!challenge) throw new Error('malformed 402 challenge');
    return challenge;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return { kind: 'posted', message: (data as { message: PaidMessagePosted['message'] }).message };
}
