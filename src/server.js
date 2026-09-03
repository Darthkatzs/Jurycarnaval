const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const XLSX = require('xlsx');
const { createStorage, readJsonFile } = require('./storage');

const app = express();
const PORT = process.env.PORT || process.env.CARNAVAL_JUDGE_PORT || 3100;
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const STATE_PATH = path.join(__dirname, '..', 'state.json');
const DEFAULT_STATE = { scores: {}, locks: {}, zeroed: {}, done: {}, headPassword: 'password', judgePasswords: {} };
const storage = createStorage({ configPath: CONFIG_PATH, statePath: STATE_PATH });

let config = null;
let persistedState = null;
let scores = {};
let locks = {};
let zeroed = {};
let done = {};
let judgePasswords = {};
let JUDGES = [];
let SCORING_IDS = [];

function normaliseConfig(inputConfig) {
  const nextConfig = inputConfig || {};

  // Ensure config uses multi-scoring structure; if not, migrate in-memory.
  if (!nextConfig.scorings) {
    const legacyCategories = nextConfig.categories || ['entertainment', 'kostumering', 'carnavalesk'];
    const legacyContestants = nextConfig.contestants || [];
    const legacyAllowed = Array.isArray(nextConfig.allowedScores) && nextConfig.allowedScores.length
      ? nextConfig.allowedScores.map(Number)
      : [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

    nextConfig.scorings = {
      groups: {
        id: 'groups',
        label: 'Groups',
        contestants: legacyContestants,
        categories: legacyCategories,
        allowedScores: legacyAllowed,
      },
      floats: {
        id: 'floats',
        label: 'Floats',
        contestants: [],
        categories: legacyCategories,
        allowedScores: legacyAllowed,
      },
    };
    nextConfig.defaultScoring = nextConfig.defaultScoring || 'groups';
  }

  return nextConfig;
}

function stateLooksLegacy(state, scoringIds) {
  const scoreKeys = Object.keys((state && state.scores) || {});
  if (scoreKeys.length === 0) return false;
  return !scoreKeys.some((key) => scoringIds.includes(key));
}

function normaliseState(inputState, currentConfig) {
  const nextState = Object.assign({}, DEFAULT_STATE, inputState || {});
  const scoringIds = Object.keys((currentConfig && currentConfig.scorings) || {});

  // Migrate legacy (no scoring dimension) state into default scoring if needed.
  if (stateLooksLegacy(nextState, scoringIds)) {
    const defaultScoringKey = currentConfig.defaultScoring || scoringIds[0] || 'groups';
    nextState.scores = { [defaultScoringKey]: nextState.scores || {} };
    nextState.locks = { [defaultScoringKey]: nextState.locks || {} };
    nextState.zeroed = { [defaultScoringKey]: nextState.zeroed || {} };
    nextState.done = nextState.done || {};
  }

  nextState.scores = nextState.scores || {};
  nextState.locks = nextState.locks || {};
  nextState.zeroed = nextState.zeroed || {};
  nextState.done = nextState.done || {};
  nextState.judgePasswords = nextState.judgePasswords || {};
  nextState.headPassword = typeof nextState.headPassword === 'string' && nextState.headPassword.length
    ? nextState.headPassword
    : 'password';

  return nextState;
}

function getJudges() {
  return config.judges || [];
}

function getScoringIds() {
  return Object.keys(config.scorings || {});
}

function getScoringConfig(scoringId) {
  const scorings = config.scorings || {};
  const effectiveId = scoringId && scorings[scoringId] ? scoringId : (config.defaultScoring || Object.keys(scorings)[0]);
  const cfg = scorings[effectiveId];
  if (!cfg) {
    throw new Error(`Unknown scoring: ${scoringId}`);
  }
  return { id: effectiveId, ...cfg };
}

function bindRuntimeState() {
  JUDGES = getJudges();
  SCORING_IDS = getScoringIds();

  // Scores are stored as: scores[scoringId][category][judgeId][contestantId] = points
  scores = persistedState.scores || {};
  // Lock state: locks[scoringId][category][judgeId] = true/false
  locks = persistedState.locks || {};
  // Zero overrides: zeroed[scoringId][category][contestantId] = true (disqualify for all judges in that category)
  zeroed = persistedState.zeroed || {};
  // Done flags: done[scoringId][judgeId] = true/false (judge finished entire scoring)
  done = persistedState.done || {};
  // Judge passwords: judgePasswords[judgeId] = string (not exposed via APIs)
  judgePasswords = persistedState.judgePasswords || {};

  // Ensure all structures exist for known scorings.
  for (const scoringId of SCORING_IDS) {
    const scoringCfg = getScoringConfig(scoringId);
    if (!scores[scoringId]) scores[scoringId] = {};
    if (!locks[scoringId]) locks[scoringId] = {};
    if (!zeroed[scoringId]) zeroed[scoringId] = {};
    if (!done[scoringId]) done[scoringId] = {};

    for (const cat of scoringCfg.categories || []) {
      if (!scores[scoringId][cat]) scores[scoringId][cat] = {};
      if (!locks[scoringId][cat]) locks[scoringId][cat] = {};
      if (!zeroed[scoringId][cat]) zeroed[scoringId][cat] = {};
    }
  }

  // Ensure judgePasswords has a default of "password" for each judge.
  for (const judge of JUDGES) {
    if (!judgePasswords[judge.id]) {
      judgePasswords[judge.id] = 'password';
    }
  }

  // Keep persistedState references pointing at live objects.
  persistedState.scores = scores;
  persistedState.locks = locks;
  persistedState.zeroed = zeroed;
  persistedState.done = done;
  persistedState.judgePasswords = judgePasswords;
}

async function initializeRuntime() {
  const fileConfig = readJsonFile(CONFIG_PATH, { judges: [], scorings: {}, defaultScoring: undefined });
  const fileState = readJsonFile(STATE_PATH, DEFAULT_STATE);
  const loaded = await storage.load({ config: fileConfig, state: fileState });

  config = normaliseConfig(loaded.config);
  persistedState = normaliseState(loaded.state, config);
  bindRuntimeState();

  // Persist seed/migration data to Postgres. In local file mode, avoid rewriting
  // checked-in config.json or creating state.json until there is an actual change.
  if (storage.type === 'postgres') {
    await Promise.all([storage.saveConfig(config), storage.saveState(persistedState)]);
  }
  console.log(`Persistence backend: ${storage.type}`);
}

async function saveState(res) {
  try {
    await storage.saveState(persistedState);
    return true;
  } catch (err) {
    console.error(`Failed to write state to ${storage.type}:`, err.message);
    if (res && !res.headersSent) {
      res.status(500).json({ error: 'Failed to persist state' });
    }
    return false;
  }
}

async function saveConfig(nextConfig, res) {
  try {
    await storage.saveConfig(nextConfig);
    return true;
  } catch (err) {
    console.error(`Failed to write config to ${storage.type}:`, err.message);
    if (res && !res.headersSent) {
      res.status(500).json({ error: 'Failed to persist config' });
    }
    return false;
  }
}

function getHeadPassword() {
  return typeof persistedState.headPassword === 'string' && persistedState.headPassword.length
    ? persistedState.headPassword
    : 'password';
}

function checkHeadPassword(req, res) {
  const provided =
    (req.headers['x-head-password'] && String(req.headers['x-head-password'])) ||
    (req.query && req.query.password ? String(req.query.password) : '');
  if (provided !== getHeadPassword()) {
    res.status(401).json({ error: 'Invalid head judge password' });
    return false;
  }
  return true;
}

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple API to fetch configuration (judges, scorings, categories, contestants)
app.get('/api/config', (req, res) => {
  const scoringsPayload = {};
  for (const scoringId of SCORING_IDS) {
    const s = getScoringConfig(scoringId);
    scoringsPayload[scoringId] = {
      id: s.id,
      label: s.label || s.id,
      categories: s.categories || [],
      contestants: s.contestants || [],
      allowedScores: (s.allowedScores || [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]).map(Number),
    };
  }

  res.json({
    JUDGES,
    scorings: scoringsPayload,
    defaultScoring: config.defaultScoring || SCORING_IDS[0],
  });
});

// Admin API to get raw config JSON (does not expose judge passwords)
app.get('/admin/config', (req, res) => {
  res.json(config);
});

// Judge login: verify judgeId + password (does not return password)
app.post('/api/judge-login', (req, res) => {
  const { judgeId, password } = req.body || {};
  const judge = JUDGES.find((j) => j.id === Number(judgeId));
  if (!judge) {
    return res.status(400).json({ error: 'Ongeldig jurylid' });
  }
  const stored = judgePasswords[judge.id] || 'password';
  if (String(password || '') !== String(stored)) {
    return res.status(401).json({ error: 'Verkeerd wachtwoord' });
  }
  res.json({ ok: true, judgeId: judge.id, judgeName: judge.name });
});

// Judge password change
app.post('/api/judge-password', async (req, res) => {
  const { judgeId, oldPassword, newPassword } = req.body || {};
  const judge = JUDGES.find((j) => j.id === Number(judgeId));
  if (!judge) {
    return res.status(400).json({ error: 'Ongeldig jurylid' });
  }
  const stored = judgePasswords[judge.id] || 'password';
  if (String(oldPassword || '') !== String(stored)) {
    return res.status(401).json({ error: 'Huidig wachtwoord klopt niet' });
  }
  if (!newPassword || String(newPassword).length < 4) {
    return res.status(400).json({ error: 'Nieuw wachtwoord moet minstens 4 tekens lang zijn' });
  }
  judgePasswords[judge.id] = String(newPassword);
  if (!(await saveState(res))) return;
  res.json({ ok: true });
});

// Admin API to update config JSON
app.post('/admin/config', async (req, res) => {
  const next = req.body;
  if (!next || !Array.isArray(next.judges)) {
    return res.status(400).json({ error: 'Config must include judges[]' });
  }
  if (!next.scorings || typeof next.scorings !== 'object') {
    return res.status(400).json({ error: 'Config must include scorings{} with groups/floats, etc.' });
  }

  try {
    config = normaliseConfig(next);
    persistedState = normaliseState(persistedState, config);
    bindRuntimeState();
    if (!(await saveConfig(config, res))) return;
    if (!(await saveState(res))) return;
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to write config.json', err);
    res.status(500).json({ error: 'Failed to write config.json' });
  }
});

// Get "done" status for a judge within a scoring (has marked scoring complete)
app.get('/api/done', (req, res) => {
  const { scoring, judgeId } = req.query || {};
  let scoringCfg;
  try {
    scoringCfg = getScoringConfig(scoring);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const judge = JUDGES.find((j) => j.id === Number(judgeId));
  if (!judge) {
    return res.status(400).json({ error: 'Invalid judge' });
  }
  const isDone = !!(done[scoringCfg.id] && done[scoringCfg.id][judge.id]);
  res.json({ done: isDone });
});

// Set "done" status for a judge within a scoring
app.post('/api/done', async (req, res) => {
  const { scoring, judgeId, done: wantDone } = req.body || {};
  let scoringCfg;
  try {
    scoringCfg = getScoringConfig(scoring);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const judge = JUDGES.find((j) => j.id === Number(judgeId));
  if (!judge) {
    return res.status(400).json({ error: 'Invalid judge' });
  }

  const flag = !!wantDone;
  if (flag) {
    // Only allow marking done if all categories are complete for this judge
    const categories = scoringCfg.categories || [];
    const contestants = scoringCfg.contestants || [];
    const incomplete = categories.filter((cat) => {
      const judgeScores = scores[scoringCfg.id]
        && scores[scoringCfg.id][cat]
        && scores[scoringCfg.id][cat][judge.id];
      if (!contestants.length) return true;
      return !contestants.every((c) => judgeScores && typeof judgeScores[c.id] === 'number');
    });
    if (incomplete.length > 0) {
      return res.status(400).json({
        error: `Cannot mark done: missing scores in categories: ${incomplete.join(', ')}`,
      });
    }
  }

  if (!done[scoringCfg.id]) done[scoringCfg.id] = {};
  done[scoringCfg.id][judge.id] = flag;
  if (!(await saveState(res))) return;
  res.json({ ok: true, done: flag });
});

// Get lock status for a judge/category within a scoring
app.get('/api/lock', (req, res) => {
  const { scoring, category, judgeId } = req.query || {};
  let scoringCfg;
  try {
    scoringCfg = getScoringConfig(scoring);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!scoringCfg.categories.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const judge = JUDGES.find((j) => j.id === Number(judgeId));
  if (!judge) {
    return res.status(400).json({ error: 'Invalid judge' });
  }
  const locked = !!(locks[scoringCfg.id] && locks[scoringCfg.id][category] && locks[scoringCfg.id][category][judge.id]);
  res.json({ locked });
});

// Admin: set or clear zero override for a contestant in a scoring/category (0 = disabled for all judges)
app.post('/admin/zero', async (req, res) => {
  const { scoring, category, contestantId, zero } = req.body || {};
  let scoringCfg;
  try {
    scoringCfg = getScoringConfig(scoring);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!scoringCfg.categories.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const contestant = (scoringCfg.contestants || []).find((c) => c.id === Number(contestantId));
  if (!contestant) {
    return res.status(400).json({ error: 'Invalid contestant' });
  }
  if (!zeroed[scoringCfg.id]) zeroed[scoringCfg.id] = {};
  if (!zeroed[scoringCfg.id][category]) zeroed[scoringCfg.id][category] = {};

  if (zero) {
    zeroed[scoringCfg.id][category][contestant.id] = true;
  } else {
    delete zeroed[scoringCfg.id][category][contestant.id];
  }
  if (!(await saveState(res))) return;
  res.json({ ok: true, zeroed: !!zeroed[scoringCfg.id][category][contestant.id] });
});

// Set lock status for a judge/category within a scoring
app.post('/api/lock', async (req, res) => {
  const { scoring, category, judgeId, locked } = req.body || {};
  let scoringCfg;
  try {
    scoringCfg = getScoringConfig(scoring);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!scoringCfg.categories.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const judge = JUDGES.find((j) => j.id === Number(judgeId));
  if (!judge) {
    return res.status(400).json({ error: 'Invalid judge' });
  }

  const wantLocked = !!locked;

  if (wantLocked) {
    // Only allow locking if this judge has scored all contestants in this category.
    const judgeScores = (scores[scoringCfg.id] && scores[scoringCfg.id][category] && scores[scoringCfg.id][category][judge.id]) || {};
    const missing = (scoringCfg.contestants || []).filter((c) => typeof judgeScores[c.id] !== 'number');
    if (missing.length > 0) {
      return res.status(400).json({
        error: `You must score all groups before locking. Missing: ${missing
          .map((c) => c.name)
          .join(', ')}`,
      });
    }
  }

  if (!locks[scoringCfg.id]) locks[scoringCfg.id] = {};
  if (!locks[scoringCfg.id][category]) locks[scoringCfg.id][category] = {};

  locks[scoringCfg.id][category][judge.id] = wantLocked;
  if (!(await saveState(res))) return;
  return res.json({ ok: true, locked: locks[scoringCfg.id][category][judge.id] });
});

// API to get existing scores for a judge/category within a scoring
app.get('/api/judge-scores', (req, res) => {
  const { scoring, category, judgeId } = req.query || {};
  let scoringCfg;
  try {
    scoringCfg = getScoringConfig(scoring);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!scoringCfg.categories.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const judge = JUDGES.find((j) => j.id === Number(judgeId));
  if (!judge) {
    return res.status(400).json({ error: 'Invalid judge' });
  }

  const byJudge = scores[scoringCfg.id]
    && scores[scoringCfg.id][category]
    && scores[scoringCfg.id][category][judge.id];

  const result = {};
  if (byJudge) {
    Object.entries(byJudge).forEach(([cid, points]) => {
      if (typeof points === 'number') {
        result[cid] = points;
      }
    });
  }

  res.json({ scoring: scoringCfg.id, category, judgeId: judge.id, scores: result });
});

// API to submit a score for one judge / category / contestant within a scoring
app.post('/api/score', async (req, res) => {
  const { scoring, category, judgeId, contestantId, points } = req.body || {};

  let scoringCfg;
  try {
    scoringCfg = getScoringConfig(scoring);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!scoringCfg.categories.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const judge = JUDGES.find((j) => j.id === Number(judgeId));
  const contestant = (scoringCfg.contestants || []).find((c) => c.id === Number(contestantId));
  const allowedScores = (scoringCfg.allowedScores || [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]).map(Number);

  if (!judge || !contestant) {
    return res.status(400).json({ error: 'Invalid judge or contestant' });
  }
  if (!allowedScores.includes(Number(points))) {
    return res.status(400).json({ error: 'Invalid points' });
  }

  if (locks[scoringCfg.id] && locks[scoringCfg.id][category] && locks[scoringCfg.id][category][judge.id]) {
    return res.status(400).json({ error: 'Scores are locked for this category for this judge.' });
  }

  if (zeroed[scoringCfg.id] && zeroed[scoringCfg.id][category] && zeroed[scoringCfg.id][category][contestant.id]) {
    return res.status(400).json({ error: 'This group is set to 0 for this category and cannot be scored.' });
  }

  if (!scores[scoringCfg.id]) scores[scoringCfg.id] = {};
  if (!scores[scoringCfg.id][category]) scores[scoringCfg.id][category] = {};
  if (!scores[scoringCfg.id][category][judge.id]) {
    scores[scoringCfg.id][category][judge.id] = {};
  }

  // Enforce: each score value can only be used once per judge per category.
  const usedForJudge = scores[scoringCfg.id][category][judge.id];
  for (const [cid, p] of Object.entries(usedForJudge)) {
    if (Number(p) === Number(points) && Number(cid) !== Number(contestant.id)) {
      return res.status(400).json({ error: `Judge ${judge.id} has already used score ${points} in ${category}.` });
    }
  }

  usedForJudge[contestant.id] = Number(points);
  if (!(await saveState(res))) return;

  return res.json({ ok: true });
});

// API to get totals by category + overall for a scoring (head judge, password protected)
app.get('/head/totals', (req, res) => {
  if (!checkHeadPassword(req, res)) return;
  const { scoring } = req.query || {};
  let scoringCfg;
  try {
    scoringCfg = getScoringConfig(scoring);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const categoryTotals = {};
  const overallTotals = {};

  for (const cat of scoringCfg.categories || []) {
    categoryTotals[cat] = {};
    for (const contestant of scoringCfg.contestants || []) {
      let sum = 0;
      // If zero override is set, this category contributes 0 for this contestant.
      const isZeroed = zeroed[scoringCfg.id]
        && zeroed[scoringCfg.id][cat]
        && zeroed[scoringCfg.id][cat][contestant.id];
      if (!isZeroed) {
        // scores stored as scores[scoringId][cat][judgeId][contestantId]
        for (const judge of JUDGES) {
          const map = scores[scoringCfg.id]
            && scores[scoringCfg.id][cat]
            && scores[scoringCfg.id][cat][judge.id];
          if (map && typeof map[contestant.id] === 'number') {
            sum += map[contestant.id];
          }
        }
      }
      categoryTotals[cat][contestant.id] = sum;
      overallTotals[contestant.id] = (overallTotals[contestant.id] || 0) + sum;
    }
  }

  res.json({
    scoring: scoringCfg.id,
    scoringLabel: scoringCfg.label || scoringCfg.id,
    categories: scoringCfg.categories || [],
    contestants: scoringCfg.contestants || [],
    categoryTotals,
    overallTotals,
  });
});

// Admin status: per-judge, per-category completion/lock matrix for a scoring (no password)
app.get('/admin/status', (req, res) => {
  const { scoring } = req.query || {};
  let scoringCfg;
  try {
    scoringCfg = getScoringConfig(scoring);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const categories = scoringCfg.categories || [];
  const contestants = scoringCfg.contestants || [];

  const status = JUDGES.map((judge) => {
    const perCategory = {};
    categories.forEach((cat) => {
      const judgeScores = scores[scoringCfg.id]
        && scores[scoringCfg.id][cat]
        && scores[scoringCfg.id][cat][judge.id];
      const allScored = contestants.length === 0
        ? false
        : contestants.every((c) => judgeScores && typeof judgeScores[c.id] === 'number');
      const locked = !!(
        locks[scoringCfg.id]
        && locks[scoringCfg.id][cat]
        && locks[scoringCfg.id][cat][judge.id]
      );
      perCategory[cat] = { complete: allScored, locked };
    });
    const isDone = !!(done[scoringCfg.id] && done[scoringCfg.id][judge.id]);
    return { judgeId: judge.id, judgeName: judge.name, done: isDone, categories: perCategory };
  });

  res.json({
    scoring: scoringCfg.id,
    scoringLabel: scoringCfg.label || scoringCfg.id,
    categories,
    judges: status,
  });
});

// Head judge export: Excel with totals and raw scores for a scoring (password protected)
app.get('/head/export.xlsx', (req, res) => {
  if (!checkHeadPassword(req, res)) return;

  const { scoring } = req.query || {};
  let scoringCfg;
  try {
    scoringCfg = getScoringConfig(scoring);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const scoringId = scoringCfg.id;
  const contestants = scoringCfg.contestants || [];
  const categories = scoringCfg.categories || [];

  // Build totals sheet data
  const totalsRows = [];
  for (const contestant of contestants) {
    const row = { Contestant: contestant.name };
    let overall = 0;
    for (const cat of categories) {
      let sum = 0;
      const isZeroed = zeroed[scoringId]
        && zeroed[scoringId][cat]
        && zeroed[scoringId][cat][contestant.id];
      if (!isZeroed) {
        for (const judge of JUDGES) {
          const map = scores[scoringId]
            && scores[scoringId][cat]
            && scores[scoringId][cat][judge.id];
          if (map && typeof map[contestant.id] === 'number') {
            sum += map[contestant.id];
          }
        }
      }
      row[cat] = sum;
      overall += sum;
    }
    row.Overall = overall;
    totalsRows.push(row);
  }

  // Build raw scores sheet data
  const rawRows = [];
  contestants.forEach((contestant) => {
    const row = { Contestant: contestant.name };
    categories.forEach((cat) => {
      JUDGES.forEach((judge) => {
        const key = `${cat} – Judge ${judge.id}`;
        const map = scores[scoringId]
          && scores[scoringId][cat]
          && scores[scoringId][cat][judge.id];
        const val = map && typeof map[contestant.id] === 'number'
          ? map[contestant.id]
          : '';
        row[key] = val;
      });
    });
    rawRows.push(row);
  });

  const wb = XLSX.utils.book_new();
  const totalsSheet = XLSX.utils.json_to_sheet(totalsRows);
  const rawSheet = XLSX.utils.json_to_sheet(rawRows);
  XLSX.utils.book_append_sheet(wb, totalsSheet, `${scoringCfg.label || scoringId} Totals`);
  XLSX.utils.book_append_sheet(wb, rawSheet, `${scoringCfg.label || scoringId} Raw`);

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `jurycarnaval-${scoringId}-${new Date().toISOString().slice(0,10)}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

// Basic judge UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Judge password change UI
app.get('/judge-password.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'judge-password.html'));
});

// Admin overview UI
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin config editor UI
app.get('/admin/config-ui', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'config.html'));
});

// Head judge UI
app.get('/head', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'head.html'));
});

initializeRuntime()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Carnaval Judge listening on http://localhost:${PORT}`);
    });
  })
  .catch(async (err) => {
    console.error('Failed to start Carnaval Judge:', err);
    await storage.close().catch(() => {});
    process.exit(1);
  });
