const axios = require('axios');

const API_BASE = 'https://network.learncard.com/api';
const API_KEY = process.env.LEARNCARD_API_KEY; // set in .env

async function issueCredential(recipient, credential, configuration = {}) {
  if (!API_KEY) throw new Error('Missing LEARNCARD_API_KEY env var');

  const body = { recipient, credential, configuration };

  const resp = await axios.post(`${API_BASE}/inbox/issue`, body, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  return resp.data;
}

module.exports = { issueCredential };