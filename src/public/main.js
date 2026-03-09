const judgeSelect = document.getElementById('judge-select');
const judgePasswordInput = document.getElementById('judge-password');
const judgeLoginBtn = document.getElementById('judge-login-btn');
const loginStatusEl = document.getElementById('login-status');
const judgeContent = document.getElementById('judge-content');
const judgeInfoEl = document.getElementById('judge-info');
const judgeOldPasswordInput = document.getElementById('judge-old-password');
const judgeNewPasswordInput = document.getElementById('judge-new-password');
const judgeConfirmPasswordInput = document.getElementById('judge-confirm-password');
const judgeChangeBtn = document.getElementById('judge-change-btn');

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
let currentJudgeName = null;
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
  if (!config || !currentScoringId || !currentJudgeId) return;

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
    renderContestants();
  } catch (err) {
    console.error(err);
    status('Netwerkfout bij opslaan van score', true);
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

async function handleJudgePasswordChange() {
  if (!currentJudgeId) {
    setLoginStatus('Je moet eerst inloggen.', true);
    return;
  }
  const oldPwd = judgeOldPasswordInput.value || '';
  const newPwd = judgeNewPasswordInput.value || '';
  const confirmPwd = judgeConfirmPasswordInput.value || '';
  const statusElLocal = document.getElementById('judge-password-status');

  if (!oldPwd || !newPwd || !confirmPwd) {
    statusElLocal.textContent = 'Vul huidig, nieuw en bevestig wachtwoord in.';
    statusElLocal.classList.add('error');
    return;
  }
  if (newPwd !== confirmPwd) {
    statusElLocal.textContent = 'Nieuw wachtwoord en bevestiging komen niet overeen.';
    statusElLocal.classList.add('error');
    return;
  }

  try {
    const res = await fetch('/api/judge-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judgeId: currentJudgeId, oldPassword: oldPwd, newPassword: newPwd }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusElLocal.textContent = data.error || `Fout ${res.status}`;
      statusElLocal.classList.add('error');
      return;
    }
    judgeOldPasswordInput.value = '';
    judgeNewPasswordInput.value = '';
    judgeConfirmPasswordInput.value = '';
    statusElLocal.textContent = 'Wachtwoord bijgewerkt.';
    statusElLocal.classList.remove('error');
  } catch (err) {
    console.error(err);
    statusElLocal.textContent = 'Kon wachtwoord niet wijzigen.';
    statusElLocal.classList.add('error');
  }
}

scoringSelect.addEventListener('change', async () => {
  currentScoringId = scoringSelect.value;
  status('');
  repopulateCategories();
  await refreshLockState();
  await refreshDoneState();
  await refreshExistingScores();
  renderContestants();
});

categorySelect.addEventListener('change', async () => {
  currentCategory = categorySelect.value;
  status('');
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

judgeLoginBtn.addEventListener('click', () => {
  handleJudgeLogin();
});

judgeChangeBtn.addEventListener('click', () => {
  handleJudgePasswordChange();
});

loadConfig().catch((err) => {
  console.error(err);
  status('Kon de app niet initialiseren', true);
});
