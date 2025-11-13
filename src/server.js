import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// Config from .env
const SECURE_SEED_RAW = process.env.SECURE_SEED || '';
function sanitizeHexSeed(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/^0x/i, '').replace(/["']/g, '');
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
  return null;
}
const ISSUER_SEED = sanitizeHexSeed(SECURE_SEED_RAW);
if (!ISSUER_SEED) {
  console.error('FATAL: SECURE_SEED is missing or invalid (must be 64 hex chars). Fix .env and restart.');
  process.exit(1);
}

const PIXELPET_PROFILE_ID = process.env.PIXELPET_PROFILE_ID || process.env.PROFILE_ID || 'pixelpet-designer-game';
const PIXELPET_DISPLAY_NAME = process.env.PIXELPET_DISPLAY_NAME || process.env.PROFILE_NAME || 'Pixel Pet Designer Official';
const GAMEFLOW_REDIRECT_URL = process.env.GAMEFLOW_REDIRECT_URL || 'http://localhost:3000/learncard-callback';
const LEARNCARD_CONSENT_BASE = process.env.LEARNCARD_CONSENT_BASE || 'https://learncard.app/consent-flow';

let gameLearnCardInstance = null;
let gameFlowContractUriCache = null;

async function initializeLearnCardIssuer() {
  if (gameLearnCardInstance) return gameLearnCardInstance;
  console.log('Initializing LearnCard issuer (dynamic import)...');

  // dynamic import to avoid ESM/CommonJS mismatch at top-level
  const { initLearnCard } = await import('@learncard/init');
  const { getSimpleSigningPlugin } = await import('@learncard/simple-signing-plugin');
  const { getClaimableBoostsPlugin } = await import('@learncard/claimable-boosts-plugin');

  const baseLC = await initLearnCard({
    seed: ISSUER_SEED,
    network: true,
    allowRemoteContexts: true
  });

  // attach plugins used by this project
  const signingLC = await baseLC.addPlugin(
    await getSimpleSigningPlugin(baseLC, 'https://api.learncard.app/trpc')
  );
  const claimableLC = await signingLC.addPlugin(
    await getClaimableBoostsPlugin(signingLC)
  );

  gameLearnCardInstance = claimableLC; // use plugin-enhanced instance for invoke methods
  console.log('LearnCard initialized. Issuer DID:', baseLC.id?.did?.() || baseLC.id || '(unknown)');

  // Ensure profile (service/profile used by the issuer)
  try {
    await gameLearnCardInstance.invoke.createProfile({
      profileId: PIXELPET_PROFILE_ID,
      displayName: PIXELPET_DISPLAY_NAME,
      description: 'Pixel Pet Designer service profile'
    });
    console.log(`Created profile: ${PIXELPET_PROFILE_ID}`);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/(profile .*already exists|account already exists)/i.test(msg)) {
      console.log(`Profile "${PIXELPET_PROFILE_ID}" already exists. OK.`);
    } else {
      console.warn('Could not create profile:', msg);
    }
  }

  return gameLearnCardInstance;
}

async function getOrCreateGameFlowContract() {
  if (gameFlowContractUriCache) return gameFlowContractUriCache;
  if (!gameLearnCardInstance) await initializeLearnCardIssuer();

  const contract = {
    name: "Pixel Pet Designer - Badge Connection",
    subtitle: "Connect to save your pixel pet designs as verifiable badges!",
    description: "Allows Pixel Pet Designer to issue you a unique badge for each pet you create. Guardian consent is required for younger designers.",
    needsGuardianConsent: true,
    redirectUrl: GAMEFLOW_REDIRECT_URL,
    reasonForAccessing: "Pixel Pet Designer needs permission to issue you a digital badge for your created pet. This badge will include your pet's name and its design.",
    contract: {
      read: {},
      write: {
        credentials: {
          categories: { "Achievement": { required: true } }
        }
      }
    }
  };

  try {
    const uri = await gameLearnCardInstance.invoke.createContract(contract);
    console.log('GameFlow contract created:', uri);
    gameFlowContractUriCache = uri;
    return uri;
  } catch (err) {
    // If createContract fails because it exists, try to surface message
    console.error('createContract error:', err?.message || err);
    throw err;
  }
}

// --- Endpoints ---

app.get('/api/get-consent-url', async (req, res) => {
  try {
    const contractUri = await getOrCreateGameFlowContract();
    // Build LearnCard consent URL (frontend will redirect there)
    const consentUrl = `${LEARNCARD_CONSENT_BASE}?uri=${encodeURIComponent(contractUri)}&returnTo=${encodeURIComponent(GAMEFLOW_REDIRECT_URL)}`;
    res.json({ consentUrl });
  } catch (err) {
    console.error('/api/get-consent-url error:', err?.message || err);
    res.status(500).json({ error: 'Could not create consent URL.' });
  }
});

// LearnCard will redirect here after consent flow
app.get('/learncard-callback', async (req, res) => {
  const userDid = req.query.did;
  const delegateVpJwt = req.query.vp;
  console.log('LearnCard callback, did=', userDid, 'vp=', delegateVpJwt ? '(present)' : 'N/A');

  if (!userDid) {
    return res.redirect('/?learncard_error=did_missing');
  }

  // In production, tie this DID to the user's session/account using stored state.
  // For demo, redirect to frontend index with did in query params.
  const frontendRedirect = `/index.html?learncard_did=${encodeURIComponent(userDid)}&status=connected`;
  res.redirect(frontendRedirect);
});

// --- New: Issue a simple test credential (SkillBadge) ---
app.post('/api/issue-credential', async (req, res) => {
  try {
    if (!gameLearnCardInstance) await initializeLearnCardIssuer();

    // Accept recipient DID in body
    const recipientDid = req.body.recipientDid || req.body.playerLearnCardDid;
    if (!recipientDid) return res.status(400).json({ error: 'Missing recipientDid in request body' });

    const issuerDid = gameLearnCardInstance.id?.did?.() || gameLearnCardInstance.id;
    if (!issuerDid) return res.status(500).json({ error: 'Issuer DID not available' });

    // Build a minimal, valid VC (SkillBadge example)
    const vc = {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      id: `urn:uuid:${crypto.randomUUID()}`,
      type: ["VerifiableCredential", "SkillBadge"],
      issuer: issuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: recipientDid,
        name: "Demo Skill Badge",
        description: "A simple test badge issued from the demo service"
      }
    };

    // Try to sign the VC using common SDK entry points
    const issueFn = gameLearnCardInstance.invoke?.issueCredential ?? gameLearnCardInstance.issueCredential;
    if (typeof issueFn === 'function') {
      const signed = await issueFn(vc);
      // Return the signed credential (could be JWT string or object)
      return res.json({ success: true, credential: signed });
    }

    // Fallback: sign via invoke.signVerifiableCredential or invoke.signCredential
    const signFn = gameLearnCardInstance.invoke?.signVerifiableCredential ?? gameLearnCardInstance.invoke?.signCredential;
    if (typeof signFn === 'function') {
      const signedVc = await signFn(vc);
      return res.json({ success: true, credential: signedVc });
    }

    return res.status(500).json({ error: 'No signing method available on LearnCard instance' });
  } catch (err) {
    console.error('/api/issue-credential error:', err?.stack || err);
    return res.status(500).json({ error: err?.message || String(err), stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack });
  }
});

// Health/root
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
(async () => {
  try {
    // initialize on startup
    await initializeLearnCardIssuer();
    await getOrCreateGameFlowContract();
  } catch (e) {
    console.warn('Startup initialization incomplete:', e?.message || e);
  }
  app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
})();