#!/usr/bin/env node
/**
 * xmr-bio CLI — resolve verified Monero identities from the terminal.
 *
 *   npx @kyc-rip/xmr-bio-sdk resolve xbtoshi
 *   npx @kyc-rip/xmr-bio-sdk address xbtoshi          # just the address (scriptable)
 *   npx @kyc-rip/xmr-bio-sdk openalias xbtoshi
 *   npx @kyc-rip/xmr-bio-sdk meta
 *   npx @kyc-rip/xmr-bio-sdk agent-register agent-mybot 4YourAddr [--key <hex>]
 *
 * Flags: --base <url> (default https://api.kyc.rip/v1/bio), --json, --key <hex>.
 */
import {
  XmrBioClient,
  generateAgentKey,
  registerAgent,
} from '../dist/index.js';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else positional.push(a);
  }
  return { positional, flags };
}

const USAGE = `xmr-bio — the address book for the Monero machine economy

Usage:
  xmr-bio resolve <handle>              resolve + verify a handle (full identity)
  xmr-bio address <handle>              print just the verified Monero address
  xmr-bio openalias <handle>            print the OpenAlias TXT record
  xmr-bio profile <handle>              raw public profile
  xmr-bio messages <handle>             the paid message board
  xmr-bio meta                          service descriptor + signing key
  xmr-bio agent-register <handle> <addr> [--key <hex>]
                                        register an agent (generates a key if none given)

Flags:
  --base <url>    API base (default https://api.kyc.rip/v1/bio)
  --json          machine-readable output
  --key <hex>     ed25519 private key hex (agent-register)
`;

function out(flags, human, obj) {
  if (flags.json) console.log(JSON.stringify(obj, null, 2));
  else console.log(human);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = positional;
  const bio = new XmrBioClient(flags.base ? { baseUrl: flags.base } : {});

  switch (cmd) {
    case 'resolve': {
      const id = await bio.resolve(need(rest[0], 'handle'));
      out(flags, `@${id.handle} → ${id.address}\n  name:     ${id.display_name}\n  verified: ${id.verified_at ?? '(agent/unverified)'}\n  proofs:   ${id.proofs.map((p) => `${p.type}:${p.identifier.slice(0, 12)}…`).join(', ') || '(none)'}`, id);
      break;
    }
    case 'address': {
      const addr = await bio.resolveAddress(need(rest[0], 'handle'));
      console.log(addr); // bare, always — scriptable
      break;
    }
    case 'openalias': {
      const oa = await bio.openalias(need(rest[0], 'handle'));
      out(flags, `${oa.fqdn}  ${oa.type}  ${oa.content}`, oa);
      break;
    }
    case 'profile': {
      const p = await bio.profile(need(rest[0], 'handle'));
      out(flags, `@${p.handle} — ${p.display_name}\n${p.address}`, p);
      break;
    }
    case 'messages': {
      const msgs = await bio.messages(need(rest[0], 'handle'));
      out(flags, msgs.map((m) => `${new Date(m.timestamp).toISOString()}  ${(m.amount / 1e12).toFixed(4)} XMR  ${m.sender}: ${m.content}`).join('\n') || '(no messages)', msgs);
      break;
    }
    case 'meta': {
      const m = await bio.meta();
      out(flags, `${m.service} v${m.version}\n  signing key: ${m.signing_key}\n  methods:     ${m.verification_methods.join(', ')}`, m);
      break;
    }
    case 'agent-register': {
      const handle = need(rest[0], 'agent handle');
      const address = need(rest[1], 'monero address');
      const privateKey = flags.key || generateAgentKey().privateKey;
      if (!flags.key) console.error(`# generated key (SAVE IT): ${privateKey}`);
      const r = await registerAgent({ handle, address, privateKey, baseUrl: flags.base });
      out(flags, `registered ${r.handle} → ${r.profile_url}`, { ...r, privateKey: flags.key ? undefined : privateKey });
      break;
    }
    case 'help': case undefined: console.log(USAGE); break;
    default: console.error(`unknown command: ${cmd}\n\n${USAGE}`); process.exit(1);
  }
}

function need(v, what) {
  if (!v) { console.error(`missing ${what}`); process.exit(1); }
  return v;
}

main().catch((e) => { console.error('error:', e.message); process.exit(1); });
