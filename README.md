# @kyc-rip/xmr-bio-sdk

> The address book for the Monero machine economy.

Resolve an `@handle` to a **verified Monero address**, check the ed25519
signature on the resolution, and register an autonomous agent — in a few lines.
Zero runtime deps except
[`@noble/curves`](https://github.com/paulmillr/noble-curves). Runs in Node 18+,
Bun, Deno, browsers, and Cloudflare Workers.

```bash
npm install @kyc-rip/xmr-bio-sdk
```

## Resolve a handle → verified address

```ts
import { XmrBioClient } from '@kyc-rip/xmr-bio-sdk';

const bio = new XmrBioClient();                 // → https://api.kyc.rip/v1/bio
const id = await bio.resolve('xbtoshi');        // fetches + verifies the signature

id.address;        // "89fM69NVioz94JQrJFLGPDa8..."
id.display_name;   // "CyberSatoshi 𓆙 - @XBToshi"
id.verified_at;    // ISO timestamp of X-ownership proof
id.proofs;         // [{ type: 'nostr', identifier: 'npub1…' }, …]
```

`resolve()` fetches the service signing key from `/meta` and verifies the
ed25519 signature over the payload **before** returning. For stronger
guarantees, pin the key out-of-band:

```ts
const id = await bio.resolve('xbtoshi', { trustedKey: '<pinned signing key hex>' });
// or just the address:
const addr = await bio.resolveAddress('xbtoshi');
```

### Verify a resolution yourself

If you fetch `/resolve/{handle}` directly, verify it with the standalone helper.
Always pass a `trustedKey` you obtained out-of-band — never trust the response's
own `public_key` blindly.

```ts
import { verifyResolution } from '@kyc-rip/xmr-bio-sdk';
const identity = verifyResolution(signedResolution, trustedKeyHex); // throws if invalid
```

## Register an autonomous agent

Agents don't own an X account — they prove possession of an ed25519 key. The
`agent-*` namespace can never collide with an X handle (X forbids hyphens).

```ts
import { generateAgentKey, registerAgent } from '@kyc-rip/xmr-bio-sdk';

const key = generateAgentKey();                 // persist key.privateKey securely!
await registerAgent({
  handle: 'agent-mybot',
  address: '4YourMoneroAddress...',
  privateKey: key.privateKey,
  displayName: 'My Bot',
});
// → now resolvable at https://xmr.bio/agent-mybot and via bio.resolve('agent-mybot')
```

## OpenAlias

```ts
const oa = await bio.openalias('xbtoshi');
// { fqdn: 'xbtoshi.xmr.bio', type: 'TXT', content: 'oa1:xmr recipient_address=…;' }
```

## CLI

The package ships an `xmr-bio` binary — resolve identities from the terminal or
a shell script (no install needed via `npx`):

```bash
npx @kyc-rip/xmr-bio-sdk resolve xbtoshi
npx @kyc-rip/xmr-bio-sdk address xbtoshi           # bare address — pipe it into a wallet
npx @kyc-rip/xmr-bio-sdk openalias xbtoshi
npx @kyc-rip/xmr-bio-sdk meta
npx @kyc-rip/xmr-bio-sdk agent-register agent-mybot 4YourAddr   # prints a fresh key

# scriptable: pay whoever @alice is, verified end-to-end
xmr-wallet transfer "$(npx -y @kyc-rip/xmr-bio-sdk address alice)" 0.1
```

Flags: `--base <url>`, `--json`, `--key <hex>`.

## API

| Method | Returns |
| --- | --- |
| `new XmrBioClient({ baseUrl?, fetch? })` | client |
| `bio.resolve(handle, { trustedKey? })` | `ResolvedIdentity` (signature verified) |
| `bio.resolveAddress(handle)` | verified address string |
| `bio.resolveSigned(handle)` | raw `{ payload, signature, public_key }` |
| `bio.profile(handle)` | `PublicProfile` |
| `bio.openalias(handle)` | OpenAlias TXT record |
| `bio.meta()` / `bio.signingKey()` | service descriptor / signing key |
| `verifyResolution(signed, trustedKey)` | `ResolvedIdentity` or throws |
| `generateAgentKey()` | `{ privateKey, publicKey }` |
| `registerAgent(input)` | `{ success, handle, profile_url }` |

Runnable examples in [`examples/`](./examples).

## License

MIT · Part of the [kyc.rip](https://kyc.rip) ecosystem.
