import { describe, it, expect, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import {
  XmrBioClient,
  verifyResolution,
  generateAgentKey,
  registerAgent,
  agentRegisterMessage,
  postPaidMessage,
  type SignedResolution,
} from '../src/index.js';

// ── helpers ──────────────────────────────────────────────────────────

const serviceSk = ed25519.utils.randomSecretKey();
const serviceKey = bytesToHex(ed25519.getPublicKey(serviceSk));

function signResolution(obj: object): SignedResolution {
  const payload = JSON.stringify(obj);
  return {
    payload,
    signature: bytesToHex(ed25519.sign(new TextEncoder().encode(payload), serviceSk)),
    public_key: serviceKey,
    alg: 'ed25519',
  };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

// ── verifyResolution ─────────────────────────────────────────────────

describe('verifyResolution', () => {
  const signed = signResolution({ v: 2, handle: 'alice', address: '4AAA' });

  it('accepts a genuine signature and returns the parsed payload', () => {
    const id = verifyResolution(signed, serviceKey);
    expect(id.handle).toBe('alice');
    expect(id.address).toBe('4AAA');
  });

  it('rejects a tampered payload', () => {
    const tampered = { ...signed, payload: signed.payload.replace('4AAA', '4EVIL') };
    expect(() => verifyResolution(tampered, serviceKey)).toThrow(/invalid/);
  });

  it('rejects an unexpected signing key', () => {
    const otherKey = bytesToHex(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
    expect(() => verifyResolution(signed, otherKey)).toThrow(/unexpected key/);
  });

  it('rejects an unsupported alg', () => {
    expect(() => verifyResolution({ ...signed, alg: 'rsa' as 'ed25519' }, serviceKey)).toThrow(/unsupported/);
  });
});

// ── XmrBioClient ─────────────────────────────────────────────────────

describe('XmrBioClient.resolve', () => {
  it('fetches the signing key from /meta and verifies the resolution', async () => {
    const signed = signResolution({ v: 2, handle: 'alice', address: '4AAA', proofs: [] });
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/meta')) return jsonResponse({ signing_key: serviceKey });
      if (u.includes('/resolve/alice')) return jsonResponse(signed);
      throw new Error(`unexpected url ${u}`);
    }) as unknown as typeof fetch;

    const bio = new XmrBioClient({ fetch: fetchImpl });
    const id = await bio.resolve('@Alice'); // handle is normalized
    expect(id.address).toBe('4AAA');
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).includes('/resolve/alice'))).toBe(true);
  });

  it('honors a pinned trustedKey without calling /meta', async () => {
    const signed = signResolution({ v: 2, handle: 'alice', address: '4AAA' });
    const fetchImpl = vi.fn(async () => jsonResponse(signed)) as unknown as typeof fetch;
    const bio = new XmrBioClient({ fetch: fetchImpl });
    const id = await bio.resolve('alice', { trustedKey: serviceKey });
    expect(id.address).toBe('4AAA');
    // only /resolve was called, never /meta
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.every((c) => !String(c[0]).endsWith('/meta'))).toBe(true);
  });

  it('throws with the server error on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'Handle not found' }, { status: 404 })) as unknown as typeof fetch;
    const bio = new XmrBioClient({ fetch: fetchImpl });
    await expect(bio.profile('ghost')).rejects.toThrow(/Handle not found/);
  });
});

// ── registerAgent ────────────────────────────────────────────────────

describe('registerAgent', () => {
  it('signs the canonical message and posts the expected body', async () => {
    const key = generateAgentKey();
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(init!.body as string) };
      return jsonResponse({ success: true, handle: 'agent-bot', profile_url: 'https://xmr.bio/agent-bot' });
    }) as unknown as typeof fetch;

    const res = await registerAgent({
      handle: 'agent-bot', address: '4ADDR', privateKey: key.privateKey, now: 1_700_000_000_000, fetch: fetchImpl,
    });
    expect(res.success).toBe(true);
    expect(captured!.url).toMatch(/\/agents\/register$/);
    expect(captured!.body.public_key).toBe(key.publicKey);

    // signature must verify against the canonical message
    const msg = agentRegisterMessage('agent-bot', '4ADDR', 1_700_000_000_000);
    const ok = ed25519.verify(
      hexToBytes(captured!.body.signature as string),
      new TextEncoder().encode(msg),
      hexToBytes(key.publicKey)
    );
    expect(ok).toBe(true);
  });

  it('rejects a non-agent namespace before hitting the network', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(registerAgent({ handle: 'alice', address: '4A', privateKey: bytesToHex(ed25519.utils.randomSecretKey()), fetch: fetchImpl }))
      .rejects.toThrow(/agent-/);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

// ── postPaidMessage ──────────────────────────────────────────────────

describe('postPaidMessage', () => {
  it('parses a 402 challenge from WWW-Authenticate', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'PAYMENT_REQUIRED' }), {
      status: 402,
      headers: { 'WWW-Authenticate': 'XMR402 address="4CREATOR", amount="1000000000", message="deadbeefcafe", timestamp="123"' },
    })) as unknown as typeof fetch;

    const r = await postPaidMessage({ handle: 'alice', content: 'gm', fetch: fetchImpl });
    expect(r.kind).toBe('402-challenge');
    if (r.kind === '402-challenge') {
      expect(r.address).toBe('4CREATOR');
      expect(r.amountPiconero).toBe(1_000_000_000);
      expect(r.nonce).toBe('deadbeefcafe');
    }
  });

  it('sends the XMR402 Authorization header when a proof is supplied', async () => {
    let authHeader: string | null = null;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      authHeader = new Headers(init!.headers).get('Authorization');
      return jsonResponse({ success: true, message: { id: 'm1', sender: 'bob', content: 'gm', amount: 1e9, tx_hash: 'TX:abc', timestamp: 1 } });
    }) as unknown as typeof fetch;

    const r = await postPaidMessage({ handle: 'alice', content: 'gm', proof: { txid: 'abc', proof: 'PROOF' }, fetch: fetchImpl });
    expect(authHeader).toBe('XMR402 txid="abc", proof="PROOF"');
    expect(r.kind).toBe('posted');
    if (r.kind === 'posted') expect(r.message.tx_hash).toBe('TX:abc');
  });
});
