const judgeSelect = document.getElementById('judge-select');
const scoringSelect = document.getElementById('scoring-select');
const categorySelect = document.getElementById('category-select');
const contestantsEl = document.getElementById('contestants');
const statusEl = document.getElementById('status');
const lockToggleBtn = document.getElementById('lock-toggle');
const doneToggleBtn = document.getElementById('done-toggle');
const doneIndicatorEl = document.getElementById('done-indicator');

let config = null;
let currentScoringId = null;
let currentJudgeId = null;
let currentCategory = null;
// usedScores[scoringId][category][judgeId] = Set of points used
let usedScores = {};
// selectedScores[scoringId][category][judgeId][contestantId] = points
let selectedScores = {};
// lockState[scoringId][category][judgeId] = boolean
let lockState = {};

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

  // Populate scorings
  scoringSelect.innerHTML = '';
  const scoringIds = Object.keys(config.scorings || {});
  scoringIds.forEach((id) => {
    const s = config.scorings[id];
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = s.label || id;
    scoringSelect.appendChild(opt);
  });
  currentScoringId = config.defaultScoring || scoringIds[0];
  scoringSelect.value = currentScoringId;

  // Populate categories for current scoring
  repopulateCategories();

  await refreshLockState();
  await refreshDoneState();
  renderContestants();
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

function updateDoneIndicator(isDone) {
  if (!doneIndicatorEl || !doneToggleBtn) return;
  if (isDone) {
    doneIndicatorEl.textContent = 'Je hebt deze beoordeling als afgewerkt gemarkeerd.';
    doneToggleBtn.textContent = 'Markering als afgewerkt verwijderen';
    doneToggleBtn.style.background = '#16a34a';
  } else {
    doneIndicatorEl.textContent = '';
    doneToggleBtn.textContent = 'Markeer beoordeling als afgewerkt';
    doneToggleBtn.style.background = '#6b7280';
  }
}

function repopulateCategories() {
  if (!config || !currentScoringId) return;
  const scoring = config.scorings[currentScoringId];
  if (!scoring) return;
  categorySelect.innerHTML = '';
  (scoring.categories || []).forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = labelForCategory(cat);
    categorySelect.appendChild(opt);
  });
  currentCategory = scoring.categories?.[0] || null;
}

function getUsedScoresSet(scoringId, category, judgeId) {
  if (!usedScores[scoringId]) usedScores[scoringId] = {};
  if (!usedScores[scoringId][category]) usedScores[scoringId][category] = {};
  if (!usedScores[scoringId][category][judgeId]) usedScores[scoringId][category][judgeId] = new Set();
  return usedScores[scoringId][category][judgeId];
}

function getSelectedScores(scoringId, category, judgeId) {
  if (!selectedScores[scoringId]) selectedScores[scoringId] = {};
  if (!selectedScores[scoringId][category]) selectedScores[scoringId][category] = {};
  if (!selectedScores[scoringId][category][judgeId]) selectedScores[scoringId][category][judgeId] = {};
  return selectedScores[scoringId][category][judgeId];
}

function isLocked(scoringId, category, judgeId) {
  return !!(lockState[scoringId] && lockState[scoringId][category] && lockState[scoringId][category][judgeId]);
}

async function refreshLockState() {
  if (!currentScoringId || !currentCategory || !currentJudgeId) return;
  try {
    const res = await fetch(`/api/lock?scoring=${encodeURIComponent(currentScoringId)}&category=${encodeURIComponent(currentCategory)}&judgeId=${encodeURIComponent(currentJudgeId)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!lockState[currentScoringId]) lockState[currentScoringId] = {};
    if (!lockState[currentScoringId][currentCategory]) lockState[currentScoringId][currentCategory] = {};
    lockState[currentScoringId][currentCategory][currentJudgeId] = !!data.locked;
    updateLockButton();
  } catch (err) {
    console.error('Failed to refresh lock state', err);
  }
}

async function refreshDoneState() {
  if (!currentScoringId || !currentJudgeId) return;
  try {
    const res = await fetch(`/api/done?scoring=${encodeURIComponent(currentScoringId)}&judgeId=${encodeURIComponent(currentJudgeId)}`);
    if (!res.ok) return;
    const data = await res.json();
    updateDoneIndicator(!!data.done);
  } catch (err) {
    console.error('Failed to refresh done state', err);
  }
}

async function toggleDone() {
  if (!currentScoringId || !currentJudgeId) return;
  const currentlyDoneText = doneIndicatorEl && doneIndicatorEl.textContent;
  const wantDone = !currentlyDoneText; // if there is text, assume marked done
  status('Saving...');
  try {
    const res = await fetch('/api/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scoring: currentScoringId, judgeId: currentJudgeId, done: wantDone }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      status(data.error || `Error ${res.status}`, true);
      return;
    }
    updateDoneIndicator(!!data.done);
    status(data.done ? 'Beoordeling gemarkeerd als afgewerkt.' : 'Beoordeling niet langer als afgewerkt gemarkeerd.');
  } catch (err) {
    console.error(err);
    status('Failed to update done state', true);
  }
}

function updateLockButton() {
  const locked = isLocked(currentScoringId, currentCategory, currentJudgeId);
  if (!lockToggleBtn) return;
  lockToggleBtn.textContent = locked
    ? 'Ontgrendel scores voor deze categorie'
    : 'Vergrendel scores voor deze categorie';
  lockToggleBtn.style.background = locked ? '#16a34a' : '#4b5563';
}

async function toggleLock() {
  if (!currentScoringId || !currentCategory || !currentJudgeId) return;
  const newLocked = !isLocked(currentScoringId, currentCategory, currentJudgeId);
  try {
    const res = await fetch('/api/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scoring: currentScoringId, category: currentCategory, judgeId: currentJudgeId, locked: newLocked }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      status(data.error || `Error ${res.status}`, true);
      return;
    }
    if (!lockState[currentScoringId]) lockState[currentScoringId] = {};
    if (!lockState[currentScoringId][currentCategory]) lockState[currentScoringId][currentCategory] = {};
    lockState[currentScoringId][currentCategory][currentJudgeId] = !!data.locked;
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
  if (!config || !currentScoringId) return;
  const scoring = config.scorings[currentScoringId];
  if (!scoring) return;

  const allowed = scoring.allowedScores;
  const used = getUsedScoresSet(currentScoringId, currentCategory, currentJudgeId);
  const selected = getSelectedScores(currentScoringId, currentCategory, currentJudgeId);
  const locked = isLocked(currentScoringId, currentCategory, currentJudgeId);

  (scoring.contestants || []).forEach((c) => {
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
  if (!config || !currentScoringId) return;

  status('Saving...');

  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scoring: currentScoringId,
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

    // Update used/selected scores for this judge/category within this scoring
    const used = getUsedScoresSet(currentScoringId, currentCategory, currentJudgeId);
    const selected = getSelectedScores(currentScoringId, currentCategory, currentJudgeId);

    const previous = selected[contestantId];
    if (typeof previous === 'number' && previous !== points) {
      // Free up the previously used score value for this judge/category
      used.delete(previous);
    }

    used.add(points);
    selected[contestantId] = points;
    status('Opgeslagen');
    renderContestants();
  } catch (err) {
    console.error(err);
    status('Netwerkfout bij opslaan van score', true);
  }
}

judgeSelect.addEventListener('change', async () => {
  currentJudgeId = Number(judgeSelect.value);
  status('');
  await refreshLockState();
  await refreshDoneState();
  renderContestants();
});

scoringSelect.addEventListener('change', async () => {
  currentScoringId = scoringSelect.value;
  status('');
  repopulateCategories();
  await refreshLockState();
  await refreshDoneState();
  renderContestants();
});

categorySelect.addEventListener('change', async () => {
  currentCategory = categorySelect.value;
  status('');
  await refreshLockState();
  renderContestants();
});

lockToggleBtn.addEventListener('click', () => {
  toggleLock();
});

doneToggleBtn.addEventListener('click', () => {
  toggleDone();
});

loadConfig().catch((err) => {
  console.error(err);
  status('Kon de app niet initialiseren', true);
});
