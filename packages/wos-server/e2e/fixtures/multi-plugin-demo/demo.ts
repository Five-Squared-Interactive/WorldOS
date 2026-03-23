/**
 * Multi-Plugin Demo: Identity + World Manager + Messaging
 *
 * Demonstrates three WorldOS plugins working together in-memory:
 * 1. Identity plugin handles user registration and JWT token validation
 * 2. World Manager plugin manages the world, entity templates, and entities
 * 3. Messaging plugin uses identity for auth, provides channels and DMs
 *
 * Flow:
 *   Start plugins → Register users → Get world info → Create templates
 *   → Instantiate entities → Query entities → Update entity
 *   → Create channel → Send messages → Fetch history
 *   → Send DM → Fetch DM history → Get world info → Health checks
 *
 * Run: npx tsx --import ./sdk-shim.mjs demo.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Shared MQTT Bus ──────────────────────────────────────────────

type Handler = (msg: { topic: string; payload: any }) => void;

class MockMqttBus {
  private handlers = new Map<string, Handler[]>();
  private label: string;

  constructor(label: string) {
    this.label = label;
  }

  subscribeWithHandler(topic: string, handler: Handler) {
    if (!this.handlers.has(topic)) this.handlers.set(topic, []);
    this.handlers.get(topic)!.push(handler);
  }

  publishRaw(topic: string, payload: any) {
    // Normalize: identity passes objects, messaging passes JSON strings
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const handlers = this.handlers.get(topic) || [];
    for (const h of handlers) {
      h({ topic, payload: parsed });
    }
  }

  /** Bridge N buses: a publish on any one delivers to all */
  static bridgeAll(...buses: MockMqttBus[]) {
    const originals = buses.map(b => b.publishRaw.bind(b));
    for (let i = 0; i < buses.length; i++) {
      buses[i].publishRaw = (topic: string, payload: any) => {
        for (const orig of originals) {
          orig(topic, payload);
        }
      };
    }
  }
}

// ── Identity Response Adapter ────────────────────────────────────
//
// The identity plugin publishes token validation responses as:
//   { correlationId, valid, payload: { userId, role, sessionId } }
//
// The messaging plugin expects:
//   { correlationId, valid, userId, role, token }
//
// This adapter rewrites identity responses so messaging can consume them.

function installIdentityAdapter(bus: MockMqttBus, requestBus: MockMqttBus) {
  const pendingTokens = new Map<string, string>();

  const origPublish = requestBus.publishRaw.bind(requestBus);
  const wrappedPublish = function (topic: string, payload: any) {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (topic === 'wos/identity/token/validate') {
      pendingTokens.set(parsed.correlationId, parsed.token);
    }
    origPublish(topic, payload);
  };
  requestBus.publishRaw = wrappedPublish;

  bus.subscribeWithHandler('wos/identity/token/validate/response', (msg) => {
    const p = msg.payload;
    if (p.payload && p.valid) {
      p.userId = p.payload.userId;
      p.role = p.payload.role;
      p.token = pendingTokens.get(p.correlationId) || '';
      pendingTokens.delete(p.correlationId);
      delete p.payload;
    }
  });
}

// ── Logging Helpers ──────────────────────────────────────────────

let stepNum = 0;
function log(msg: string) {
  stepNum++;
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`  STEP ${stepNum}: ${msg}`);
  console.log(`[${'='.repeat(60)}]`);
}

function logResult(label: string, data: any) {
  console.log(`  ${label}:`, JSON.stringify(data, null, 4).split('\n').join('\n  '));
}

// ── Helper: publish and wait for response ────────────────────────

function publishAndCollect(
  bus: MockMqttBus,
  responseTopic: string,
  requestTopic: string,
  payload: any,
): Promise<any[]> {
  const collected: any[] = [];
  bus.subscribeWithHandler(responseTopic, (msg) => {
    collected.push(msg.payload);
  });
  bus.publishRaw(requestTopic, payload);
  return new Promise(r => setTimeout(() => r(collected), 150));
}

// ── Main Demo ────────────────────────────────────────────────────

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-demo-'));
  console.log(`\n  WorldOS Multi-Plugin Demo`);
  console.log(`  Working directory: ${tmpDir}\n`);

  // ── Create shared MQTT buses ──
  const identityBus = new MockMqttBus('identity');
  const worldBus = new MockMqttBus('world-manager');
  const messagingBus = new MockMqttBus('messaging');
  MockMqttBus.bridgeAll(identityBus, worldBus, messagingBus);

  // Install adapter to translate identity responses for messaging
  installIdentityAdapter(messagingBus, messagingBus);

  const makeLogger = (name: string) => ({
    info: (...args: any[]) => console.log(`  [${name}]`, ...args),
    warn: (...args: any[]) => console.log(`  [${name}] WARN:`, ...args),
    error: (...args: any[]) => console.log(`  [${name}] ERROR:`, ...args),
  });

  // ── 1. Start Identity Plugin ──
  log('Starting Identity Plugin...');

  const { IdentityPlugin } = await import('../../../../wos-plugin-identity/src/index.js');
  const identityPlugin = new IdentityPlugin();

  await identityPlugin.onStart({
    serverDir: tmpDir,
    config: {
      allow_registration: true,
      jwt_secret: 'demo-secret-key-for-testing-only',
      access_token_ttl: 3600,
      refresh_token_ttl: 86400,
    },
    logger: makeLogger('identity'),
    mqtt: identityBus,
    manifest: { name: 'identity' },
  } as any);

  // ── 2. Start World Manager Plugin ──
  log('Starting World Manager Plugin...');

  const { WorldManagerPlugin } = await import('../../../../wos-plugin-world-manager/src/index.js');
  const worldPlugin = new WorldManagerPlugin();

  await worldPlugin.onStart({
    serverDir: tmpDir,
    config: {
      world_name: 'Demo World',
      world_type: 'space',
      world_owner: 'system',
    },
    logger: makeLogger('world-mgr'),
    mqtt: worldBus,
    manifest: { name: 'world-manager' },
  } as any);

  // ── 3. Start Messaging Plugin ──
  log('Starting Messaging Plugin...');

  const { MessagingPlugin } = await import('../../../../wos-plugin-messaging/src/index.js');
  const messagingPlugin = new MessagingPlugin();

  await messagingPlugin.onStart({
    serverDir: tmpDir,
    config: { retentionLimit: 100, maxContentLength: 4000 },
    logger: makeLogger('messaging'),
    mqtt: messagingBus,
    manifest: { name: 'messaging' },
  } as any);

  // ── 4. Register Users ──
  log('Registering users "alice" and "bob"...');

  let results = await publishAndCollect(
    messagingBus,
    'wos/identity/auth/register/response',
    'wos/identity/auth/register',
    { correlationId: 'reg-1', username: 'alice', email: 'alice@example.com', password: 'password123', displayName: 'Alice' },
  );
  const regAlice = results.find(p => p.correlationId === 'reg-1');
  const aliceToken = regAlice?.accessToken;
  const aliceId = regAlice?.user?.id;
  if (!aliceToken) { console.error('Alice registration failed!', regAlice); process.exit(1); }
  logResult('Alice', { userId: aliceId, username: 'alice', hasToken: true });

  results = await publishAndCollect(
    messagingBus,
    'wos/identity/auth/register/response',
    'wos/identity/auth/register',
    { correlationId: 'reg-2', username: 'bob', email: 'bob@example.com', password: 'password456', displayName: 'Bob' },
  );
  const regBob = results.find(p => p.correlationId === 'reg-2');
  const bobToken = regBob?.accessToken;
  const bobId = regBob?.user?.id;
  logResult('Bob', { userId: bobId, username: 'bob', hasToken: true });

  // ── 5. Get World Info ──
  log('Getting world info...');

  results = await publishAndCollect(
    worldBus,
    'wos/world-manager/world/get/response',
    'wos/world-manager/world/get',
    { correlationId: 'wg-1' },
  );
  const worldInfo = results.find(p => p.correlationId === 'wg-1');
  logResult('World', {
    id: worldInfo?.id,
    name: worldInfo?.name,
    type: worldInfo?.type,
    owner: worldInfo?.owner,
  });

  const worldId = worldInfo?.id;

  // ── 6. Create Entity Templates ──
  log('Creating entity templates (campfire + signpost)...');

  results = await publishAndCollect(
    worldBus,
    'wos/world-manager/template/create/response',
    'wos/world-manager/template/create',
    {
      correlationId: 'tmpl-1',
      name: 'Campfire',
      type: 'prop',
      properties: { model: 'campfire.glb', emitsLight: true, warmthRadius: 5.0 },
      defaultPosition: { x: 0, y: 0, z: 0 },
      defaultScale: { x: 1, y: 1, z: 1 },
    },
  );
  const campfireTemplate = results.find(p => p.correlationId === 'tmpl-1');
  logResult('Campfire template', { id: campfireTemplate?.id, name: campfireTemplate?.name });

  results = await publishAndCollect(
    worldBus,
    'wos/world-manager/template/create/response',
    'wos/world-manager/template/create',
    {
      correlationId: 'tmpl-2',
      name: 'Signpost',
      type: 'prop',
      properties: { model: 'signpost.glb', text: 'Welcome!', readable: true },
      defaultPosition: { x: 0, y: 0, z: 0 },
      defaultScale: { x: 0.8, y: 0.8, z: 0.8 },
    },
  );
  const signpostTemplate = results.find(p => p.correlationId === 'tmpl-2');
  logResult('Signpost template', { id: signpostTemplate?.id, name: signpostTemplate?.name });

  // ── 7. Instantiate Entities from Templates ──
  log('Placing entities in the world...');

  results = await publishAndCollect(
    worldBus,
    'wos/world-manager/template/instantiate/response',
    'wos/world-manager/template/instantiate',
    {
      correlationId: 'inst-1',
      templateId: campfireTemplate?.id,
      position: { x: 10.5, y: 0, z: -3.2 },
      owner: aliceId,
    },
  );
  const campfireEntity = results.find(p => p.correlationId === 'inst-1');
  logResult('Campfire placed', {
    entityId: campfireEntity?.id,
    type: campfireEntity?.type,
    position: campfireEntity?.position,
    owner: campfireEntity?.owner,
  });

  results = await publishAndCollect(
    worldBus,
    'wos/world-manager/template/instantiate/response',
    'wos/world-manager/template/instantiate',
    {
      correlationId: 'inst-2',
      templateId: signpostTemplate?.id,
      position: { x: 0, y: 0, z: 5.0 },
      properties: { text: 'Welcome to Demo World!' },
      owner: aliceId,
    },
  );
  const signpostEntity = results.find(p => p.correlationId === 'inst-2');
  logResult('Signpost placed', {
    entityId: signpostEntity?.id,
    type: signpostEntity?.type,
    position: signpostEntity?.position,
    properties: signpostEntity?.properties,
  });

  // ── 8. Query All Entities ──
  log('Querying all entities in the world...');

  results = await publishAndCollect(
    worldBus,
    'wos/world-manager/entity/query/response',
    'wos/world-manager/entity/query',
    { correlationId: 'eq-1' },
  );
  const entityQuery = results.find(p => p.correlationId === 'eq-1');
  console.log(`  Total entities: ${entityQuery?.total}`);
  for (const e of (entityQuery?.entities ?? [])) {
    console.log(`    [${e.type}] ${e.id.slice(0, 8)}... at (${e.position.x}, ${e.position.y}, ${e.position.z})`);
  }

  // ── 9. Update Entity (move the campfire) ──
  log('Moving the campfire to a new position...');

  results = await publishAndCollect(
    worldBus,
    'wos/world-manager/entity/update/response',
    'wos/world-manager/entity/update',
    {
      correlationId: 'eu-1',
      id: campfireEntity?.id,
      position: { x: 15.0, y: 0.5, z: -1.0 },
      properties: { model: 'campfire.glb', emitsLight: true, warmthRadius: 8.0 },
    },
  );
  const updatedEntity = results.find(p => p.correlationId === 'eu-1');
  logResult('Campfire moved', {
    position: updatedEntity?.position,
    warmthRadius: updatedEntity?.properties?.warmthRadius,
  });

  // ── 10. Create a Chat Channel for this World ──
  log('Alice creates channel "general" for the world...');

  results = await publishAndCollect(
    messagingBus,
    'wos/messaging/channel/create/response',
    'wos/messaging/channel/create',
    JSON.stringify({
      correlationId: 'ch-1',
      token: aliceToken,
      worldId: worldId,
      name: 'general',
      description: 'General discussion for Demo World',
    }),
  );
  const channelResult = results.find(p => p.correlationId === 'ch-1');
  logResult('Channel created', { channelId: channelResult?.channelId, name: channelResult?.name });

  const channelId = channelResult?.channelId;
  if (!channelId) { console.error('Channel creation failed!', channelResult); process.exit(1); }

  // ── 11. Send Messages about the World ──
  log('Alice and Bob chat about the world...');

  const sendMsg = async (corrId: string, token: string, content: string) => {
    const r = await publishAndCollect(
      messagingBus,
      'wos/messaging/message/send/response',
      'wos/messaging/message/send',
      JSON.stringify({ correlationId: corrId, token, conversationId: channelId, content }),
    );
    return r.find(p => p.correlationId === corrId);
  };

  await sendMsg('msg-1', aliceToken, 'Welcome to Demo World! I just placed a campfire and a signpost.');
  await sendMsg('msg-2', bobToken, 'Nice! Where is the campfire?');
  await sendMsg('msg-3', aliceToken, 'I moved it to (15, 0.5, -1). Come warm up!');

  console.log('  3 messages sent to #general');

  // ── 12. Fetch Message History ──
  log('Fetching message history for #general...');

  results = await publishAndCollect(
    messagingBus,
    'wos/messaging/message/history/response',
    'wos/messaging/message/history',
    JSON.stringify({ correlationId: 'hist-1', token: aliceToken, conversationId: channelId }),
  );
  const histResult = results.find(p => p.correlationId === 'hist-1');
  if (histResult?.messages) {
    console.log(`  Messages in history: ${histResult.total}`);
    for (const m of histResult.messages) {
      console.log(`    [${m.createdAt}] ${m.senderId.slice(0, 8)}...: ${m.content}`);
    }
  }

  // ── 13. Send a DM ──
  log('Alice sends Bob a DM...');

  results = await publishAndCollect(
    messagingBus,
    'wos/messaging/dm/send/response',
    'wos/messaging/dm/send',
    JSON.stringify({ correlationId: 'dm-1', token: aliceToken, recipientId: bobId, content: 'Hey Bob, check out the signpost near spawn!' }),
  );
  const dmResult = results.find(p => p.correlationId === 'dm-1');
  logResult('DM sent', { messageId: dmResult?.messageId, conversationId: dmResult?.conversationId });

  // Bob replies
  await publishAndCollect(
    messagingBus,
    'wos/messaging/dm/send/response',
    'wos/messaging/dm/send',
    JSON.stringify({ correlationId: 'dm-2', token: bobToken, recipientId: aliceId, content: 'On my way! Love the "Welcome to Demo World!" text.' }),
  );

  // ── 14. Fetch DM History ──
  log('Fetching DM conversation...');

  results = await publishAndCollect(
    messagingBus,
    'wos/messaging/message/history/response',
    'wos/messaging/message/history',
    JSON.stringify({ correlationId: 'dm-hist-1', token: aliceToken, conversationId: dmResult?.conversationId }),
  );
  const dmHistResult = results.find(p => p.correlationId === 'dm-hist-1');
  if (dmHistResult?.messages) {
    console.log(`  DM messages: ${dmHistResult.total}`);
    for (const m of dmHistResult.messages) {
      console.log(`    [${m.senderId.slice(0, 8)}...]: ${m.content}`);
    }
  }

  // ── 15. Final World State ──
  log('Final world state...');

  results = await publishAndCollect(
    worldBus,
    'wos/world-manager/world/get/response',
    'wos/world-manager/world/get',
    { correlationId: 'wg-final' },
  );
  const finalWorld = results.find(p => p.correlationId === 'wg-final');

  results = await publishAndCollect(
    worldBus,
    'wos/world-manager/entity/query/response',
    'wos/world-manager/entity/query',
    { correlationId: 'eq-final' },
  );
  const finalEntities = results.find(p => p.correlationId === 'eq-final');

  results = await publishAndCollect(
    worldBus,
    'wos/world-manager/template/list/response',
    'wos/world-manager/template/list',
    { correlationId: 'tl-final' },
  );
  const finalTemplates = results.find(p => p.correlationId === 'tl-final');

  logResult('World', { name: finalWorld?.name, type: finalWorld?.type });
  console.log(`  Templates: ${finalTemplates?.total ?? 0}`);
  console.log(`  Entities: ${finalEntities?.total}`);

  // ── 16. Health Checks ──
  log('Health checks across all plugins...');

  const identityHealth = await identityPlugin.onHealthCheck();
  const worldHealth = await worldPlugin.onHealthCheck();
  const messagingHealth = await messagingPlugin.onHealthCheck();

  logResult('Identity', identityHealth);
  logResult('World Manager', worldHealth);
  logResult('Messaging', messagingHealth);

  // ── Cleanup ──
  console.log(`\n[${'='.repeat(60)}]`);
  console.log('  CLEANUP: Stopping plugins...');
  console.log(`[${'='.repeat(60)}]`);

  await messagingPlugin.onStop();
  await worldPlugin.onStop();
  await identityPlugin.onStop();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\n  Demo complete!\n');
}

main().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
