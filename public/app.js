// Minimal frontend logic
const pixelGrid = document.getElementById('pixelGrid');
const colorPicker = document.getElementById('colorPicker');
const petNameInput = document.getElementById('petName');
const submitPetBtn = document.getElementById('submitPetBtn');
const connectLearnCardBtn = document.getElementById('connectLearnCardBtn');
const lcStatus = document.getElementById('lcStatus');
const badgeResultArea = document.getElementById('badgeResultArea');
const resultPetName = document.getElementById('resultPetName');
const resultPetDesignLink = document.getElementById('resultPetDesignLink');
const resultPetPreview = document.getElementById('resultPetPreview');

const gridSize = 10;
let currentDrawingColor = colorPicker.value;
let pixelData = Array(gridSize * gridSize).fill('#ffffff');

colorPicker.addEventListener('input', (e) => currentDrawingColor = e.target.value);

// build grid
for (let i = 0; i < gridSize * gridSize; i++) {
  const d = document.createElement('div');
  d.className = 'pixel';
  d.style.backgroundColor = pixelData[i];
  d.addEventListener('click', () => {
    d.style.backgroundColor = currentDrawingColor;
    pixelData[i] = currentDrawingColor;
  });
  pixelGrid.appendChild(d);
}

const connectBtn = document.getElementById('connectLearnCardBtn');
const issueBtn = document.getElementById('issueBadgeBtn');
const resultArea = document.getElementById('resultArea');
const resultMessage = document.getElementById('resultMessage');
const resultUri = document.getElementById('resultUri');

const LEARNED_DID_KEY = 'learnCardPlayerDid';

// Handle return from LearnCard consent redirect
window.addEventListener('DOMContentLoaded', () => {
  const qp = new URLSearchParams(window.location.search);
  const did = qp.get('learncard_did');
  const status = qp.get('status');
  if (status === 'connected' && did) {
    sessionStorage.setItem(LEARNED_DID_KEY, did);
    lcStatus.textContent = `LearnCard Connected: ${did.slice(0, 20)}...`;
    connectBtn.style.display = 'none';
    issueBtn.disabled = false;
    // clean URL (optional)
    window.history.replaceState({}, document.title, '/');
    return;
  }

  // If already connected in this session, enable issue button
  const stored = sessionStorage.getItem(LEARNED_DID_KEY);
  if (stored) {
    lcStatus.textContent = `LearnCard Connected: ${stored.slice(0, 20)}...`;
    connectBtn.style.display = 'none';
    issueBtn.disabled = false;
  }
});

// Connect flow: ask backend for consent URL and redirect
connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  lcStatus.textContent = 'Preparing connection...';
  try {
    const resp = await fetch('/api/get-consent-url');
    const text = await resp.text();
    if (!resp.ok) {
      console.error('/api/get-consent-url failed', resp.status, text);
      lcStatus.textContent = `Connection failed: ${resp.status}`;
      connectBtn.disabled = false;
      return;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error('Invalid JSON from /api/get-consent-url:', text);
      lcStatus.textContent = 'Invalid response from server (check console)';
      connectBtn.disabled = false;
      return;
    }
    if (!data?.consentUrl) {
      console.error('No consentUrl in response:', data);
      lcStatus.textContent = 'No consent URL returned (check server logs)';
      connectBtn.disabled = false;
      return;
    }
    console.log('Redirecting to LearnCard consent URL:', data.consentUrl);
    // use window.location to perform redirect
    window.location.href = data.consentUrl;
  } catch (err) {
    console.error('Fetch /api/get-consent-url error:', err);
    lcStatus.textContent = 'Connection failed (see console)';
    connectBtn.disabled = false;
  }
});

// submit pet -> backend
submitPetBtn.addEventListener('click', async () => {
  const petName = petNameInput.value.trim();
  const did = sessionStorage.getItem('learnCardPlayerDid');
  if (!petName) return alert('Please give your pet a name');
  if (!did) return alert('Connect LearnCard first');

  submitPetBtn.disabled = true;
  lcStatus.textContent = 'Issuing badge...';
  try {
    const resp = await fetch('/api/issue-pet-badge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: petName, petDesign: pixelData, playerLearnCardDid: did })
    });
    const j = await resp.json();
    if (!resp.ok) throw new Error(j.error || 'Issue failed');

    resultPetName.textContent = j.issuedPetName;
    // build image
    const canvas = document.createElement('canvas');
    canvas.width = gridSize * 10;
    canvas.height = gridSize * 10;
    const ctx = canvas.getContext('2d');
    for (let r=0;r<gridSize;r++){
      for (let c=0;c<gridSize;c++){
        ctx.fillStyle = pixelData[r*gridSize + c];
        ctx.fillRect(c*10, r*10, 10, 10);
      }
    }
    const uri = canvas.toDataURL();
    resultPetDesignLink.href = uri;
    resultPetPreview.innerHTML = `<img src="${uri}" style="image-rendering: pixelated; width:100%;height:100%;">`;
    badgeResultArea.style.display = 'block';
    lcStatus.textContent = 'Badge issued! Check your LearnCard app.';
  } catch (e) {
    console.error(e);
    lcStatus.textContent = 'Failed to issue badge.';
    alert(e.message || e);
  } finally {
    submitPetBtn.disabled = false;
  }
});

// Issue Badge: triggers same backend /api/issue-pet-badge flow
issueBtn.addEventListener('click', async () => {
  issueBtn.disabled = true;
  resultArea.style.display = 'none';
  resultMessage.textContent = '';
  lcStatus.textContent = 'Issuing badge...';

  const playerLearnCardDid = sessionStorage.getItem(LEARNED_DID_KEY);
  if (!playerLearnCardDid) {
    alert('LearnCard not connected. Please connect first.');
    issueBtn.disabled = false;
    return;
  }

  // Minimal payload expected by backend: playerName + petDesign + playerLearnCardDid
  const payload = {
    playerName: 'Issued Badge', // simple default name
    petDesign: Array(100).fill('#ffffff'), // placeholder design array so backend validation passes
    playerLearnCardDid
  };

  try {
    const r = await fetch('/api/issue-pet-badge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `Issue failed: ${r.statusText}`);

    lcStatus.textContent = 'Badge issued — check LearnCard app.';
    resultArea.style.display = 'block';
    resultMessage.textContent = `Issued: ${j.issuedPetName || payload.playerName}`;
    resultUri.textContent = j.credentialUri || '(no uri returned)';
    resultUri.href = j.credentialUri || '#';
  } catch (e) {
    lcStatus.textContent = 'Failed to issue badge.';
    resultArea.style.display = 'block';
    resultMessage.textContent = `Error: ${e.message || e}`;
    console.error(e);
  } finally {
    issueBtn.disabled = false;
  }
});