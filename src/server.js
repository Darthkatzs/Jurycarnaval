const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || process.env.CARNAVAL_JUDGE_PORT || 3100;

// Load config from JSON file
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const STATE_PATH = path.join(__dirname, '..', 'state.json');
let config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Load persisted scoring state if present (scores, locks, zeroed flags)
let persistedState = { scores: {}, locks: {}, zeroed: {} };
try {
  if (fs.existsSync(STATE_PATH)) {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    persistedState = JSON.parse(raw);
  }
} catch (err) {
  console.warn('Failed to read state.json, starting fresh:', err.message);
  persistedState = { scores: {}, locks: {}, zeroed: {} };
}

function saveState() {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(persistedState, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write state.json:', err.message);
  }
}

function getAllowedScores() {
  return Array.isArray(config.allowedScores) && config.allowedScores.length
    ? config.allowedScores.map(Number)
    : [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
}

// Convenience getters
function getCategories() {
  return config.categories || ['entertainment', 'kostumering', 'carnavalesk'];
}

function getJudges() {
  return config.judges || [];
}

function getContestants() {
  return config.contestants || [];
}

const CATEGORIES = getCategories();
const JUDGES = getJudges();
const CONTESTANTS = getContestants();

// Scores are stored as: scores[category][judgeId][contestantId] = points
const scores = {};
// Lock state: locks[category][judgeId] = true/false
const locks = {};
// Zero overrides: zeroed[category][contestantId] = true (disqualify for all judges in that category)
const zeroed = persistedState.zeroed || {};

for (const cat of CATEGORIES) {
  scores[cat] = persistedState.scores && persistedState.scores[cat] ? persistedState.scores[cat] : {};
  locks[cat] = persistedState.locks && persistedState.locks[cat] ? persistedState.locks[cat] : {};
  if (!zeroed[cat]) zeroed[cat] = {};
}

// Keep persistedState references pointing at live objects
persistedState.scores = scores;
persistedState.locks = locks;
persistedState.zeroed = zeroed;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple API to fetch configuration (judges, contestants, categories)
app.get('/api/config', (req, res) => {
  res.json({
    CATEGORIES,
    JUDGES,
    CONTESTANTS,
    allowedScores: getAllowedScores(),
  });
});

// Admin API to get raw config JSON
app.get('/admin/config', (req, res) => {
  res.json(config);
});

// Admin API to update config JSON
app.post('/admin/config', (req, res) => {
  const next = req.body;
  if (!next || !Array.isArray(next.judges) || !Array.isArray(next.contestants)) {
    return res.status(400).json({ error: 'Config must include judges[] and contestants[]' });
  }
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
    config = next;
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to write config.json', err);
    res.status(500).json({ error: 'Failed to write config.json' });
  }
});

// Get lock status for a judge/category
app.get('/api/lock', (req, res) => {
  const { category, judgeId } = req.query || {};
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const judge = JUDGES.find((j) => j.id === Number(judgeId));
  if (!judge) {
    return res.status(400).json({ error: 'Invalid judge' });
  }
  const locked = !!locks[category][judge.id];
  res.json({ locked });
});

// Admin: set or clear zero override for a group in a category (0 = disabled for all judges)
app.post('/admin/zero', (req, res) => {
  const { category, contestantId, zero } = req.body || {};
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const contestant = CONTESTANTS.find((c) => c.id === Number(contestantId));
  if (!contestant) {
    return res.status(400).json({ error: 'Invalid contestant' });
  }
  if (!zeroed[category]) zeroed[category] = {};
  if (zero) {
    zeroed[category][contestant.id] = true;
  } else {
    delete zeroed[category][contestant.id];
  }
  saveState();
  res.json({ ok: true, zeroed: !!zeroed[category][contestant.id] });
});

// Set lock status for a judge/category
app.post('/api/lock', (req, res) => {
  const { category, judgeId, locked } = req.body || {};
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const judge = JUDGES.find((j) => j.id === Number(judgeId));
  if (!judge) {
    return res.status(400).json({ error: 'Invalid judge' });
  }

  const wantLocked = !!locked;

  if (wantLocked) {
    // Only allow locking if this judge has scored all contestants in this category.
    const judgeScores = scores[category][judge.id] || {};
    const missing = CONTESTANTS.filter((c) => typeof judgeScores[c.id] !== 'number');
    if (missing.length > 0) {
      return res.status(400).json({
        error: `You must score all groups before locking. Missing: ${missing
          .map((c) => c.name)
          .join(', ')}`,
      });
    }
  }

  locks[category][judge.id] = wantLocked;
  saveState();
  return res.json({ ok: true, locked: locks[category][judge.id] });
});

// API to submit a score for one judge / category / contestant
app.post('/api/score', (req, res) => {
  const { category, judgeId, contestantId, points } = req.body || {};

  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const judge = JUDGES.find((j) => j.id === Number(judgeId));
  const contestant = CONTESTANTS.find((c) => c.id === Number(contestantId));
  const allowedScores = getAllowedScores();

  if (!judge || !contestant) {
    return res.status(400).json({ error: 'Invalid judge or contestant' });
  }
  if (!allowedScores.includes(Number(points))) {
    return res.status(400).json({ error: 'Invalid points' });
  }

  if (locks[category][judge.id]) {
    return res.status(400).json({ error: 'Scores are locked for this category for this judge.' });
  }

  if (zeroed[category] && zeroed[category][contestant.id]) {
    return res.status(400).json({ error: 'This group is set to 0 for this category and cannot be scored.' });
  }

  if (!scores[category][judge.id]) {
    scores[category][judge.id] = {};
  }

  // Enforce: each score value can only be used once per judge per category.
  const usedForJudge = scores[category][judge.id];
  for (const [cid, p] of Object.entries(usedForJudge)) {
    if (Number(p) === Number(points) && Number(cid) !== Number(contestant.id)) {
      return res.status(400).json({ error: `Judge ${judge.id} has already used score ${points} in ${category}.` });
    }
  }

  usedForJudge[contestant.id] = Number(points);
  saveState();

  return res.json({ ok: true });
});

// API to get totals by category + overall
app.get('/admin/totals', (req, res) => {
  const allowedScores = getAllowedScores();

  const categoryTotals = {};
  const overallTotals = {};

  for (const cat of CATEGORIES) {
    categoryTotals[cat] = {};
    for (const contestant of CONTESTANTS) {
      let sum = 0;
      // If zero override is set, this category contributes 0 for this contestant.
      const isZeroed = zeroed[cat] && zeroed[cat][contestant.id];
      if (!isZeroed) {
        // scores stored as scores[cat][judgeId][contestantId]
        for (const judge of JUDGES) {
          const map = scores[cat][judge.id] || {};
          if (typeof map[contestant.id] === 'number') {
            sum += map[contestant.id];
          }
        }
      }
      categoryTotals[cat][contestant.id] = sum;
      overallTotals[contestant.id] = (overallTotals[contestant.id] || 0) + sum;
    }
  }

  res.json({
    categories: CATEGORIES,
    contestants: CONTESTANTS,
    categoryTotals,
    overallTotals,
    allowedScores,
  });
});

// Basic judge UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin overview UI
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin config editor UI
app.get('/admin/config-ui', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'config.html'));
});

app.listen(PORT, () => {
  console.log(`Carnaval Judge listening on http://localhost:${PORT}`);
});
