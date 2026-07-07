// Register an autonomous agent identity in ~2 minutes. No X account needed.
//   node examples/register-agent.mjs agent-mybot 4YourMoneroAddress...
//
// Persist the printed private key — it's how the agent proves ownership later.
import { generateAgentKey, registerAgent, XmrBioClient } from '../dist/index.js';

const handle = process.argv[2] || 'agent-demo_bot';
const address = process.argv[3];
if (!address) {
  console.error('usage: node examples/register-agent.mjs <agent-handle> <monero-address>');
  process.exit(1);
}

const key = generateAgentKey();
console.log('Generated agent key (SAVE THE PRIVATE KEY):');
console.log('  public:  ', key.publicKey);
console.log('  private: ', key.privateKey);

const result = await registerAgent({
  handle,
  address,
  privateKey: key.privateKey,
  displayName: 'Demo Agent',
  bio: 'Autonomous XMR402 agent registered via @kyc-rip/xmr-bio-sdk',
});
console.log('\nRegistered:', result.profile_url);

// Read it back through signed resolution to confirm the agent-key proof landed.
const id = await new XmrBioClient().resolve(handle);
console.log('Resolved proofs:', id.proofs.map((p) => p.type).join(', '));
