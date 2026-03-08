async function loadJudgeStatus(scoringId) {
  const query = scoringId ? `?scoring=${encodeURIComponent(scoringId)}` : '';
  const res = await fetch(`/admin/status${query}`);
  if (!res.ok) {
    console.error('Failed to load status');
    return;
  }
  const data = await res.json();
  const root = document.getElementById('status-table');
  if (!root) return;

  const categories = data.categories || [];
  const judges = data.judges || [];

  root.innerHTML = '';

  if (!judges.length || !categories.length) {
    root.textContent = 'Nog geen status beschikbaar.';
    return;
  }

  const table = document.createElement('table');
  table.className = 'judge-status-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const thJudge = document.createElement('th');
  thJudge.textContent = 'Jurylid';
  headRow.appendChild(thJudge);
  categories.forEach((cat) => {
    const th = document.createElement('th');
    th.textContent = cat;
    headRow.appendChild(th);
  });
  const thDone = document.createElement('th');
  thDone.textContent = 'Beoordeling klaar';
  headRow.appendChild(thDone);

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  judges.forEach((j) => {
    const tr = document.createElement('tr');
    const tdJudge = document.createElement('td');
    tdJudge.textContent = j.judgeName || `Judge ${j.judgeId}`;
    tr.appendChild(tdJudge);
    categories.forEach((cat) => {
      const td = document.createElement('td');
      const cell = j.categories && j.categories[cat];
      let badgeText = 'Ontbrekend';
      let badgeClass = 'missing';
      if (cell && cell.locked) {
        badgeText = 'Vergrendeld';
        badgeClass = 'locked';
      } else if (cell && cell.complete) {
        badgeText = 'Voltooid';
        badgeClass = 'complete';
      }
      const span = document.createElement('span');
      span.className = `judge-status-badge ${badgeClass}`;
      span.textContent = badgeText;
      td.appendChild(span);
      tr.appendChild(td);
    });
    const tdDone = document.createElement('td');
    const doneSpan = document.createElement('span');
    const isDone = !!j.done;
    doneSpan.className = `judge-status-badge ${isDone ? 'locked' : 'missing'}`;
    doneSpan.textContent = isDone ? 'Ja' : 'Nee';
    tdDone.appendChild(doneSpan);
    tr.appendChild(tdDone);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  root.appendChild(table);
}
