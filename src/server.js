require('dotenv').config();
const express = require('express');
const issueRouter = require('./routes/issue');

const app = express();
app.use(express.json());

app.use('/issue', issueRouter);

// Add a simple root route so GET / returns something instead of "Cannot GET /"
app.get('/', (req, res) => {
  res.send('LearnCard Skill API — GET /issue to POST issuance requests');
});

// optional: health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});