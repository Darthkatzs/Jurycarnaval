const judgeSelect = document.getElementById('judge-select');
const categorySelect = document.getElementById('category-select');
const contestantsEl = document.getElementById('contestants');
const statusEl = document.getElementById('status');
const lockToggleBtn = document.getElementById('lock-toggle');

let config = null;
let currentJudgeId = null;
let currentCategory = null;
let usedScores = {}; // usedScores[category][judgeId] = Set of points used
let selectedScores = {}; // selectedScores[category][judgeId][contestantId] = points
let lockState = {}; // lockState[category][judgeId] = boolean

async function loadConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) {
    status('Failed to load config', true);
    return;
  }
  config = await res.json();

  // Populate judges
  judgeSelect.innerHTML = '';
  config.JUDGES.forEach((j) => {
    const opt = document.createElement('option');
    opt.value = j.id;
    opt.textContent = j.name;
    judgeSelect.appendChild(opt);
  });
  currentJudgeId = config.JUDGES[0]?.id;

  // Populate categories
  categorySelect.innerHTML = '';
  config.CATEGORIES.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = labelForCategory(cat);
    categorySelect.appendChild(opt);
  });
  currentCategory = config.CATEGORIES[0];

  refreshLockState().then(renderContestants).catch((err) => {
    console.error(err);
    renderContestants();
  });
}

function labelForCategory(cat) {
  if (cat === 'entertainment') return 'Entertainment & Enthousiasme';
  if (cat === 'kostumering') return 'Kostumering';
  if (cat === 'carnavalesk') return 'Carnavalesk';
  return cat;
}

function status(msg, isError = false) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', !!isError);
}

function getUsedScoresSet(category, judgeId) {
  if (!usedScores[category]) usedScores[category] = {};
  if (!usedScores[category][judgeId]) usedScores[category][judgeId] = new Set();
  return usedScores[category][judgeId];
}

function getSelectedScores(category, judgeId) {
  if (!selectedScores[category]) selectedScores[category] = {};
  if (!selectedScores[category][judgeId]) selectedScores[category][judgeId] = {};
  return selectedScores[category][judgeId];
}

function isLocked(category, judgeId) {
  return !!(lockState[category] && lockState[category][judgeId]);
}

async function refreshLockState() {
  if (!currentCategory || !currentJudgeId) return;
  try {
    const res = await fetch(`/api/lock?category=${encodeURIComponent(currentCategory)}&judgeId=${encodeURIComponent(currentJudgeId)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!lockState[currentCategory]) lockState[currentCategory] = {};
    lockState[currentCategory][currentJudgeId] = !!data.locked;
    updateLockButton();
  } catch (err) {
    console.error('Failed to refresh lock state', err);
  }
}

function updateLockButton() {
  const locked = isLocked(currentCategory, currentJudgeId);
  if (!lockToggleBtn) return;
  lockToggleBtn.textContent = locked ? 'Unlock scores for this category' : 'Lock scores for this category';
  lockToggleBtn.style.background = locked ? '#16a34a' : '#4b5563';
}

async function toggleLock() {
  if (!currentCategory || !currentJudgeId) return;
  const newLocked = !isLocked(currentCategory, currentJudgeId);
  try {
    const res = await fetch('/api/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: currentCategory, judgeId: currentJudgeId, locked: newLocked }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      status(data.error || `Error ${res.status}`, true);
      return;
    }
    if (!lockState[currentCategory]) lockState[currentCategory] = {};
    lockState[currentCategory][currentJudgeId] = !!data.locked;
    updateLockButton();
    status(data.locked ? 'Scores locked for this category.' : 'Scores unlocked for this category.');
    renderContestants();
  } catch (err) {
    console.error(err);
    status('Failed to update lock state', true);
  }
}

function renderContestants() {
  contestantsEl.innerHTML = '';
  if (!config) return;

  const allowed = config.allowedScores;
  const used = getUsedScoresSet(currentCategory, currentJudgeId);
  const selected = getSelectedScores(currentCategory, currentJudgeId);
  const locked = isLocked(currentCategory, currentJudgeId);

  config.CONTESTANTS.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'contestant';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = c.name;
    row.appendChild(nameSpan);

    const scoresDiv = document.createElement('div');
    scoresDiv.className = 'scores';

    // TODO: once zero overrides are surfaced to the client, we can grey-out rows here.

    allowed.forEach((points) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'score-btn';
      btn.textContent = points;

      if (used.has(points)) {
        btn.classList.add('used');
      }
      if (selected[c.id] === points) {
        btn.classList.remove('used');
        btn.classList.add('selected');
      }
      if (locked) {
        btn.disabled = true;
      }

      btn.addEventListener('click', () => {
        if (locked) return;
        submitScore(c.id, points);
      });

      scoresDiv.appendChild(btn);
    });

    row.appendChild(scoresDiv);
    contestantsEl.appendChild(row);
  });
}

async function submitScore(contestantId, points) {
  if (!config) return;

  status('Saving...');

  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: currentCategory,
        judgeId: currentJudgeId,
        contestantId,
        points,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      status(data.error || `Error ${res.status}`, true);
      return;
    }

    // Mark score as used for this judge/category
    const used = getUsedScoresSet(currentCategory, currentJudgeId);
    used.add(points);
    const selected = getSelectedScores(currentCategory, currentJudgeId);
    selected[contestantId] = points;
    status('Saved');
    renderContestants();
  } catch (err) {
    console.error(err);
    status('Network error saving score', true);
  }
}

judgeSelect.addEventListener('change', () => {
  currentJudgeId = Number(judgeSelect.value);
  status('');
  refreshLockState().then(renderContestants);
});

categorySelect.addEventListener('change', () => {
  currentCategory = categorySelect.value;
  status('');
  refreshLockState().then(renderContestants);
});

lockToggleBtn.addEventListener('click', () => {
  toggleLock();
});

loadConfig().catch((err) => {
  console.error(err);
  status('Failed to init app', true);
});
