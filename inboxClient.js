// src/inboxClient.js
import 'dotenv/config';

// Node 18+ has global fetch. If you're on Node 16, install & import 'node-fetch'.

const API_BASE = process.env.LEARNCARD_API_BASE?.replace(/\/$/, '') || 'https://network.learncard.com';
const API_KEY  = process.env.LEARNCARD_API_KEY;

if (!API_KEY) {
  console.warn('[WARN] LEARNCARD_API_KEY missing — /inbox/issue calls will fail.');
}

export async function inboxIssue({ recipient, credential, configuration = {}, consentRequest }) {
  const url = `${API_BASE}/api/inbox/issue`;

  const body = { recipient, credential };
  if (configuration && Object.keys(configuration).length) body.configuration = configuration;
  if (consentRequest) body.consentRequest = consentRequest;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || `Inbox issue failed (${res.status})`;
    throw new Error(msg);
  }
  return data; // { issuanceId, claimUrl?, ... }
}
