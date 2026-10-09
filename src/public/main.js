const judgeSelect = document.getElementById('judge-select');
const judgePasswordInput = document.getElementById('judge-password');
const judgeLoginBtn = document.getElementById('judge-login-btn');
const loginStatusEl = document.getElementById('login-status');
const judgeContent = document.getElementById('judge-content');
const judgeInfoEl = document.getElementById('judge-info');

const scoringSelect = document.getElementById('scoring-select');
const categorySelect = document.getElementById('category-select');
const contestantsEl = document.getElementById('contestants');
const statusEl = document.getElementById('status');
const lockToggleBtn = document.getElementById('lock-toggle');
const doneToggleBtn = document.getElementById('done-toggle');
const doneIndicatorEl = document.getElementById('done-indicator');
const viewCompactBtn = document.getElementById('view-compact');
const viewButtonsBtn = document.getElementById('view-buttons');
const scoreSheetBackdrop = document.getElementById('score-sheet-backdrop');
const scoreSheetTitle = document.getElementById('score-sheet-title');
const scoreSheetSubtitle = document.getElementById('score-sheet-subtitle');
const scoreSheetGrid = document.getElementById('score-sheet-grid');
const scoreSheetCloseBtn = document.getElementById('score-sheet-close');

let config = null;
let currentScoringId = null;
let currentJudgeId = null;
let currentJudgeName = null;
let currentCategory = null;
// usedScores[scoringId][category][judgeId] = Set of points used
let usedScores = {};
// selectedScores[scoringId][category][judgeId][contestantId] = points
let selectedScores = {};
// lockState[scoringId][category][judgeId] = boolean
let lockState = {};
let scoreViewMode = localStorage.getItem('scoreViewMode') || 'auto';
let activePickerContestantId = null;

async function loadConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) {
    status('Kon de configuratie niet laden', true);
    return;
  }
  config = await res.json();

  // Populate judges for login
  judgeSelect.innerHTML = '';
  config.JUDGES.forEach((j) => {
    const opt = document.createElement('option');
    opt.value = j.id;
    opt.textContent = j.name;
    judgeSelect.appendChild(opt);
  });

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
}

function labelForCategory(cat) {
  if (cat === 'entertainment') return 'Entertainment & Enthousiasme';
  if (cat === 'kostumering') return 'Kostumering';
  if (cat === 'carnavalesk') return 'Carnavalesk';
  return cat;
}

function allowedScoresForCategory(scoring, category) {
  if (scoring && scoring.categoryAllowedScores && Array.isArray(scoring.categoryAllowedScores[category])) {
    return scoring.categoryAllowedScores[category];
  }
  return (scoring && scoring.allowedScores) || [];
}

function isZeroedForCategory(scoring, category, contestantId) {
  const scoringZeroed = scoring && scoring.zeroed && scoring.zeroed[category];
  const configZeroed = config && config.zeroed && config.zeroed[currentScoringId] && config.zeroed[currentScoringId][category];
  return !!((scoringZeroed && scoringZeroed[contestantId])
    || (configZeroed && configZeroed[contestantId]));
}

function status(msg, isError = false) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', !!isError);
}

function setLoginStatus(msg, isError = false) {
  loginStatusEl.textContent = msg || '';
  loginStatusEl.classList.toggle('error', !!isError);
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

function prefersCompactScores() {
  if (scoreViewMode === 'compact') return true;
  if (scoreViewMode === 'buttons') return false;
  return window.matchMedia && window.matchMedia('(max-width: 520px)').matches;
}

function setScoreViewMode(mode) {
  scoreViewMode = mode;
  localStorage.setItem('scoreViewMode', mode);
  updateViewToggle();
  closeScorePicker();
  renderContestants();
}

function updateViewToggle() {
  if (!viewCompactBtn || !viewButtonsBtn) return;
  const compact = prefersCompactScores();
  viewCompactBtn.classList.toggle('active', compact);
  viewCompactBtn.setAttribute('aria-pressed', compact ? 'true' : 'false');
  viewButtonsBtn.classList.toggle('active', !compact);
  viewButtonsBtn.setAttribute('aria-pressed', compact ? 'false' : 'true');
}

function closeScorePicker() {
  activePickerContestantId = null;
  if (!scoreSheetBackdrop || !scoreSheetGrid) return;
  scoreSheetBackdrop.classList.remove('open');
  scoreSheetBackdrop.setAttribute('aria-hidden', 'true');
  scoreSheetGrid.innerHTML = '';
}

function openScorePicker(contestant, allowed, used, selected, locked) {
  if (locked || !scoreSheetBackdrop || !scoreSheetGrid) return;
  activePickerContestantId = contestant.id;
  scoreSheetTitle.textContent = 'Score kiezen';
  scoreSheetSubtitle.textContent = contestant.name;
  scoreSheetGrid.innerHTML = '';

  allowed.forEach((points) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'score-btn';
    btn.textContent = points;

    const isSelected = selected[contestant.id] === points;
    const isUsedByOtherContestant = used.has(points) && !isSelected;
    if (isUsedByOtherContestant) {
      btn.classList.add('used');
      btn.disabled = true;
      btn.title = 'Deze score is al gebruikt in deze categorie.';
    }
    if (isSelected) btn.classList.add('selected');

    btn.addEventListener('click', () => {
      submitScore(contestant.id, points);
    });
    scoreSheetGrid.appendChild(btn);
  });

  if (typeof selected[contestant.id] === 'number') {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'score-clear-btn';
    clearBtn.textContent = 'Score verwijderen';
    clearBtn.addEventListener('click', () => {
      clearScore(contestant.id);
    });
    scoreSheetGrid.appendChild(clearBtn);
  }

  scoreSheetBackdrop.classList.add('open');
  scoreSheetBackdrop.setAttribute('aria-hidden', 'false');
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

async function refreshExistingScores() {
  if (!currentScoringId || !currentCategory || !currentJudgeId) return;
  try {
    const res = await fetch(`/api/judge-scores?scoring=${encodeURIComponent(currentScoringId)}&category=${encodeURIComponent(currentCategory)}&judgeId=${encodeURIComponent(currentJudgeId)}`);
    if (!res.ok) return;
    const data = await res.json();
    const scoresMap = data.scores || {};
    const used = getUsedScoresSet(currentScoringId, currentCategory, currentJudgeId);
    const selected = getSelectedScores(currentScoringId, currentCategory, currentJudgeId);
    used.clear();
    Object.keys(selected).forEach((cid) => { delete selected[cid]; });
    Object.entries(scoresMap).forEach(([cid, pts]) => {
      if (typeof pts === 'number') {
        used.add(pts);
        selected[Number(cid)] = pts;
      }
    });
  } catch (err) {
    console.error('Failed to refresh existing scores', err);
  }
}

async function toggleDone() {
  if (!currentScoringId || !currentJudgeId) return;
  const currentlyDoneText = doneIndicatorEl && doneIndicatorEl.textContent;
  const wantDone = !currentlyDoneText; // if there is text, assume marked done
  status('Bezig met opslaan...');
  try {
    const res = await fetch('/api/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scoring: currentScoringId, judgeId: currentJudgeId, done: wantDone }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      status(data.error || `Fout ${res.status}`, true);
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
      status(data.error || `Fout ${res.status}`, true);
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
  updateViewToggle();
  const scoring = config.scorings[currentScoringId];
  if (!scoring) return;

  const allowed = allowedScoresForCategory(scoring, currentCategory);
  const used = getUsedScoresSet(currentScoringId, currentCategory, currentJudgeId);
  const selected = getSelectedScores(currentScoringId, currentCategory, currentJudgeId);
  const locked = isLocked(currentScoringId, currentCategory, currentJudgeId);
  const compact = prefersCompactScores();

  (scoring.contestants || []).forEach((c) => {
    const row = document.createElement('div');
    row.className = compact ? 'contestant compact' : 'contestant';
    const zeroed = isZeroedForCategory(scoring, currentCategory, c.id);
    if (zeroed) row.classList.add('zeroed');
    if (locked) row.classList.add('locked');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'contestant-name';
    nameSpan.textContent = c.name;
    row.appendChild(nameSpan);

    if (compact) {
      const selectedScore = selected[c.id];
      const scorePill = document.createElement('span');
      scorePill.className = 'compact-score';
      if (zeroed) {
        scorePill.classList.add('zeroed');
        scorePill.textContent = '0';
      } else if (typeof selectedScore === 'number') {
        scorePill.classList.add('selected');
        scorePill.textContent = selectedScore;
      } else {
        scorePill.textContent = locked ? 'Vergrendeld' : 'Kies score';
      }
      row.appendChild(scorePill);

      if (!zeroed && !locked) {
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', `Score kiezen voor ${c.name}`);
        row.addEventListener('click', () => openScorePicker(c, allowed, used, selected, locked));
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openScorePicker(c, allowed, used, selected, locked);
          }
        });
      }

      contestantsEl.appendChild(row);
      return;
    }

    const scoresDiv = document.createElement('div');
    scoresDiv.className = 'scores';

    if (zeroed) {
      const zeroBtn = document.createElement('button');
      zeroBtn.type = 'button';
      zeroBtn.className = 'score-btn zeroed';
      zeroBtn.textContent = '0';
      zeroBtn.disabled = true;
      scoresDiv.appendChild(zeroBtn);
      row.appendChild(scoresDiv);
      contestantsEl.appendChild(row);
      return;
    }

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

    if (typeof selected[c.id] === 'number' && !locked) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'score-clear-btn';
      clearBtn.textContent = 'Wis';
      clearBtn.title = 'Score verwijderen zodat je opnieuw kunt kiezen';
      clearBtn.addEventListener('click', () => {
        clearScore(c.id);
      });
      scoresDiv.appendChild(clearBtn);
    }

    row.appendChild(scoresDiv);
    contestantsEl.appendChild(row);
  });
}

async function submitScore(contestantId, points) {
  if (!config || !currentScoringId || !currentJudgeId) return;
  const scoring = config.scorings[currentScoringId];
  if (isZeroedForCategory(scoring, currentCategory, contestantId)) {
    status('Deze groep heeft 0 voor deze categorie en kan niet gescoord worden.', true);
    return;
  }

  status('Bezig met opslaan...');

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
      status(data.error || `Fout ${res.status}`, true);
      return;
    }

    const used = getUsedScoresSet(currentScoringId, currentCategory, currentJudgeId);
    const selected = getSelectedScores(currentScoringId, currentCategory, currentJudgeId);

    const previous = selected[contestantId];
    if (typeof previous === 'number' && previous !== points) {
      used.delete(previous);
    }

    used.add(points);
    selected[contestantId] = points;
    status('Opgeslagen');
    if (activePickerContestantId === contestantId) {
      closeScorePicker();
    }
    renderContestants();
  } catch (err) {
    console.error(err);
    status('Netwerkfout bij opslaan van score', true);
  }
}

async function clearScore(contestantId) {
  if (!config || !currentScoringId || !currentJudgeId) return;
  const scoring = config.scorings[currentScoringId];
  if (isZeroedForCategory(scoring, currentCategory, contestantId)) return;

  status('Score verwijderen...');

  try {
    const res = await fetch('/api/score', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scoring: currentScoringId,
        category: currentCategory,
        judgeId: currentJudgeId,
        contestantId,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      status(data.error || `Fout ${res.status}`, true);
      return;
    }

    const used = getUsedScoresSet(currentScoringId, currentCategory, currentJudgeId);
    const selected = getSelectedScores(currentScoringId, currentCategory, currentJudgeId);
    const previous = selected[contestantId];
    if (typeof previous === 'number') used.delete(previous);
    delete selected[contestantId];

    status('Score verwijderd');
    if (activePickerContestantId === contestantId) {
      closeScorePicker();
    }
    renderContestants();
  } catch (err) {
    console.error(err);
    status('Netwerkfout bij verwijderen van score', true);
  }
}

async function handleJudgeLogin() {
  const judgeId = Number(judgeSelect.value);
  const password = judgePasswordInput.value || '';
  if (!judgeId || !password) {
    setLoginStatus('Gelieve jurylid en wachtwoord in te vullen.', true);
    return;
  }
  try {
    const res = await fetch('/api/judge-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judgeId, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoginStatus(data.error || `Fout ${res.status}`, true);
      return;
    }
    currentJudgeId = data.judgeId;
    currentJudgeName = data.judgeName;
    judgeInfoEl.textContent = `Ingelogd als ${currentJudgeName}`;
    document.getElementById('login-section').style.display = 'none';
    judgeContent.style.display = 'block';
    setLoginStatus('');
    await refreshLockState();
    await refreshDoneState();
    await refreshExistingScores();
    renderContestants();
  } catch (err) {
    console.error(err);
    setLoginStatus('Kon niet inloggen.', true);
  }
}

scoringSelect.addEventListener('change', async () => {
  currentScoringId = scoringSelect.value;
  status('');
  closeScorePicker();
  repopulateCategories();
  await refreshLockState();
  await refreshDoneState();
  await refreshExistingScores();
  renderContestants();
});

categorySelect.addEventListener('change', async () => {
  currentCategory = categorySelect.value;
  status('');
  closeScorePicker();
  await refreshLockState();
  await refreshExistingScores();
  renderContestants();
});

lockToggleBtn.addEventListener('click', () => {
  toggleLock();
});

doneToggleBtn.addEventListener('click', () => {
  toggleDone();
});

if (viewCompactBtn) {
  viewCompactBtn.addEventListener('click', () => setScoreViewMode('compact'));
}

if (viewButtonsBtn) {
  viewButtonsBtn.addEventListener('click', () => setScoreViewMode('buttons'));
}

if (scoreSheetCloseBtn) {
  scoreSheetCloseBtn.addEventListener('click', closeScorePicker);
}

if (scoreSheetBackdrop) {
  scoreSheetBackdrop.addEventListener('click', (event) => {
    if (event.target === scoreSheetBackdrop) closeScorePicker();
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeScorePicker();
});

if (window.matchMedia) {
  const compactQuery = window.matchMedia('(max-width: 520px)');
  compactQuery.addEventListener('change', () => {
    if (scoreViewMode === 'auto') renderContestants();
  });
}

judgeLoginBtn.addEventListener('click', () => {
  handleJudgeLogin();
});

loadConfig().catch((err) => {
  console.error(err);
  status('Kon de app niet initialiseren', true);
});
