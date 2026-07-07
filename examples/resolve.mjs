// Resolve a handle to a verified Monero address, checking the signature.
//   node examples/resolve.mjs xbtoshi
import { XmrBioClient } from '../dist/index.js';

const handle = process.argv[2] || 'xbtoshi';
const bio = new XmrBioClient(); // defaults to https://api.kyc.rip/v1/bio

// resolve() fetches the service signing key from /meta and verifies the
// ed25519 signature over the payload before returning. In production, pin the
// key: new XmrBioClient() … bio.resolve(handle, { trustedKey: '<pinned hex>' })
const id = await bio.resolve(handle);

console.log(`@${id.handle} → ${id.address}`);
console.log(`  name:     ${id.display_name}`);
console.log(`  verified: ${id.verified_at ?? '(agent / unverified)'}`);
console.log(`  proofs:   ${id.proofs.map((p) => `${p.type}:${p.identifier.slice(0, 12)}…`).join(', ') || '(none)'}`);
