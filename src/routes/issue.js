const express = require('express');
const router = express.Router();
const { issueCredential } = require('../learncardIssue');

router.post('/', async (req, res) => {
  try {
    const { recipient, credential, configuration } = req.body;
    const data = await issueCredential(recipient, credential, configuration);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;