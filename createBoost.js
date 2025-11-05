import 'dotenv/config';
import { initLearnCard } from '@learncard/init';
import { getClaimableBoostsPlugin } from '@learncard/claimable-boosts-plugin';
import { getSimpleSigningPlugin } from '@learncard/simple-signing-plugin';

// --- If you're on Node < 18, uncomment the next 3 lines:
// if (typeof fetch === 'undefined') {
//   const { default: nodeFetch } = await import('node-fetch'); globalThis.fetch = nodeFetch;
// }

// ====== CONFIG / ENV ======
const DEMO_SEED =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64 hex chars
const SECURE_SEED = process.env.SECURE_SEED || DEMO_SEED;
if (!process.env.SECURE_SEED) {
  console.warn('⚠️  SECURE_SEED not set; using DEMO_SEED (for dev only).');
}

const profileId   = process.env.PROFILE_ID   || 'my-awesome-org-profile';
const profileName = process.env.PROFILE_NAME || 'My Awesome Org';

// Universal Inbox
const API_BASE = (process.env.LEARNCARD_API_BASE || 'https://network.learncard.com').replace(/\/$/, '');
const API_KEY  = process.env.LEARNCARD_API_KEY;
const TEST_RECIPIENT_EMAIL = process.env.TEST_RECIPIENT_EMAIL || 'student@example.com';

// ====== UNIVERSAL INBOX HELPERS ======
async function inboxIssue({ recipient, credential, configuration = {}, consentRequest }) {
  if (!API_KEY) throw new Error('Missing LEARNCARD_API_KEY in .env');
  const res = await fetch(`${API_BASE}/api/inbox/issue`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient, credential, configuration, ...(consentRequest ? { consentRequest } : {}) })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `Inbox issue failed (${res.status})`);
  return data; // { issuanceId, claimUrl? }
}

/** Build a minimal unsigned OpenBadge VC for “skill/achievement”. */
function buildOpenBadgeVC({ issuerDid, skillName, evidenceText }) {
  return {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.2.json"
    ],
    "type": ["VerifiableCredential", "OpenBadgeCredential"],
    "issuer": issuerDid || "did:key:placeholder",           // will be (re)signed at claim-time
    "issuanceDate": new Date().toISOString(),
    "name": skillName,
    "credentialSubject": {
      "id": "did:example:placeholder",                      // bound to recipient DID on claim
      "type": ["AchievementSubject"],
      "achievement": {
        "id": `urn:achievement:${encodeURIComponent(skillName)}`,
        "type": ["Achievement"],
        "name": skillName,
        "description": evidenceText || `Completed ${skillName}`,
        "criteria": { "narrative": evidenceText || `Completed ${skillName}` }
      }
    }
  };
}

/**
 * Fire-and-forget via Universal Inbox.
 * Pass the org DID explicitly so we don’t rely on an outer-scope variable.
 */
async function issueViaInbox({
  issuerDid,
  email,
  skillName,
  evidenceText = '',
  brand,              // { issuerName, issuerLogoUrl, credentialName, credentialType, recipientName }
  suppressDelivery,   // boolean
  webhookUrl,         // optional
  signingAuthority,   // { name, endpoint } optional
  consentRequest      // { scopes:[], description } optional (BETA)
}) {
  const delivery = {};
  if (brand || suppressDelivery) {
    delivery.suppress = !!suppressDelivery;
    if (brand) {
      delivery.template = {
        template: 'default',
        model: {
          issuer: {
            name: brand.issuerName || process.env.ORG_DISPLAY_NAME || 'LearnHaus',
            logoUrl: brand.issuerLogoUrl || process.env.ORG_LOGO_URL || undefined
          },
          credential: {
            name: brand.credentialName || skillName,
            type: brand.credentialType || 'badge'
          },
          ...(brand.recipientName ? { recipient: { name: brand.recipientName } } : {})
        }
      };
    }
  }

  const configuration = {};
  if (Object.keys(delivery).length) configuration.delivery = delivery;
  if (webhookUrl || process.env.WEBHOOK_PUBLIC_URL) {
    configuration.webhookUrl = webhookUrl || process.env.WEBHOOK_PUBLIC_URL;
  }
  if (signingAuthority) {
    configuration.signingAuthority = signingAuthority;
  } else if (process.env.SIGNING_AUTH_NAME && process.env.SIGNING_AUTH_ENDPOINT) {
    configuration.signingAuthority = {
      name: process.env.SIGNING_AUTH_NAME,
      endpoint: process.env.SIGNING_AUTH_ENDPOINT
    };
  }

  const credential = buildOpenBadgeVC({ issuerDid, skillName, evidenceText });
  const recipient  = { type: 'email', value: email };

  const resp = await inboxIssue({
    recipient,
    credential,
    configuration,
    consentRequest
  });

  return resp; // { issuanceId, claimUrl? }
}

// ====== MAIN QUICKSTART ======
async function quickstartBoost() {
  try {
    console.log('Initializing LearnCard…');
    const baseLC = await initLearnCard({
      seed: SECURE_SEED,
      network: true,
      allowRemoteContexts: true
    });

    const signingLC = await baseLC.addPlugin(
      await getSimpleSigningPlugin(baseLC, 'https://api.learncard.app/trpc')
    );
    const claimableLC = await signingLC.addPlugin(
      await getClaimableBoostsPlugin(signingLC)
    );
    console.log('✅ LearnCard initialized with plugins.');

    // Ensure profile exists (accept both “Profile already exists” and “Account already exists”)
    try {
      console.log(`Creating profile "${profileId}"…`);
      await claimableLC.invoke.createProfile({
        profileId,
        displayName: profileName,
        description: 'Issuing awesome credentials.'
      });
      console.log(`✅ Profile "${profileId}" created.`);
    } catch (error) {
      const msg = String(error?.message || '');
      if (/(profile .*already exists|account already exists)/i.test(msg)) {
        console.log(`ℹ️ Profile "${profileId}" already exists. Continuing.`);
      } else {
        throw new Error(`Failed to create profile: ${msg}`);
      }
    }

    // Create a Boost template + publish
    console.log('Creating boost template…');
    const boostTemplate = await claimableLC.invoke.newCredential({
      type: 'boost',
      boostName: 'Quickstart Achievement',
      boostImage: 'https://placehold.co/400x400?text=Quickstart',
      achievementType: 'Achievement',
      achievementName: 'Quickstart Achievement',
      achievementDescription: 'Completed the quickstart guide!',
      achievementNarrative: 'User successfully ran the quickstart script.',
      achievementImage: 'https://placehold.co/400x400?text=Quickstart'
    });
    console.log('✅ Boost template created.');

    console.log('Publishing boost to network…');
    const boostUri = await claimableLC.invoke.createBoost(
      boostTemplate,
      { name: boostTemplate.name, description: boostTemplate.achievementDescription }
    );
    console.log(`✅ Boost created: ${boostUri}`);

    console.log('Generating claim link…');
    const claimLink = await claimableLC.invoke.generateBoostClaimLink(boostUri);
    console.log('\n🎉 Success! Boost claim link:');
    console.log(claimLink);

    // === Also send a Fire-and-Forget email via Universal Inbox ===
    console.log('\nIssuing via Universal Inbox (email)…');
    const inboxResp = await issueViaInbox({
      issuerDid: baseLC.id,                 // pass the org DID explicitly
      email: TEST_RECIPIENT_EMAIL,          // set TEST_RECIPIENT_EMAIL in your .env
      skillName: 'Quickstart Achievement',
      evidenceText: 'Completed the quickstart guide at LearnHaus.',
      brand: {
        issuerName: process.env.ORG_DISPLAY_NAME || 'LearnHaus',
        issuerLogoUrl: process.env.ORG_LOGO_URL,
        credentialName: 'Quickstart Achievement',
        credentialType: 'badge',
        recipientName: 'Your Learner'      // optional
      },
      suppressDelivery: false,               // set true to get claimUrl back and no email sent
      // webhookUrl: process.env.WEBHOOK_PUBLIC_URL, // optional: receive CLAIMED events
      // signingAuthority: { name: 'my-signer', endpoint: 'https://my-vc-api.my-org.com/issue' }, // optional override
      // consentRequest: { scopes: ['credential:write:Badge'], description: 'Allow auto-delivery of future badges.' } // BETA
    });

    if (inboxResp.claimUrl) {
      console.log('📎 Inbox claim URL (delivery suppressed):', inboxResp.claimUrl);
    } else {
      console.log('✅ Inbox issuance created:', inboxResp.issuanceId, '(email will be sent by LearnCard)');
    }

    return { claimLink, inboxIssuanceId: inboxResp.issuanceId, inboxClaimUrl: inboxResp.claimUrl || null };
  } catch (err) {
    console.error('\n❌ Error during quickstart process:', err);
    process.exit(1);
  }
}

quickstartBoost();
