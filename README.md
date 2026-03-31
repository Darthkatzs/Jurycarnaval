# Jurycarnaval

Jurycarnaval is a small web application to support live judging at a carnaval parade.

It is designed for:

- A fixed set of judges (e.g. 11) each scoring groups/floats.
- Multiple *scorings* (e.g. **groups** and **floats**), each with its own contestants and categories.
- Scoring under time pressure on mobile phones, over a local network or simple public deployment.

The app is intentionally simple: JSON config/state on disk, a single Node/Express server, and static HTML/JS frontends.

## Features

- **Per-judge login** with passwords
  - Each judge has a password (default `"password"`, changeable by the judge).
  - Judges cannot see or change other judges' scores.
- **Per-category scoring with one-use points**
  - For each category, each permitted score value can be used **only once per judge**.
  - UI greys out used scores and highlights the selected one per contestant.
- **Locks and "done" flags**
  - Judges can lock a category once all contestants are scored.
  - Judges can mark an entire scoring as "done" once all categories are complete.
- **Head judge view**
  - Password-protected `/head` UI for totals, status per judge, and Excel export.
  - Head judge can change their own password.
- **Admin view**
  - `/admin` shows a matrix of per-judge, per-category completion/lock state.
  - `/admin/config-ui` (if enabled) can be used to edit `config.json`.
- **File-based persistence**
  - `config.json` for configuration (judges, scorings, contestants, categories, scores allowed).
  - `state.json` for scores, locks, zero overrides, done flags, and passwords.

## Tech stack

- Node.js + Express
- File-backed JSON for config and state (no database)
- Frontend: plain HTML/CSS/JS
- Excel export via `xlsx` package

## Getting started

### Requirements

- Node.js 18+ (earlier versions may work but are not tested)
- npm

### Install dependencies

```bash
npm install
```

### Local development

```bash
npm run dev
```

By default the server listens on:

- `PORT` from the environment, or
- `CARNAVAL_JUDGE_PORT` from the environment, or
- `3100` if neither is set.

Open `http://localhost:3100/` for the judge UI.

### Production / Railway

The app is intended to be deployed on Railway or a similar Node host.

- Railway should run `npm start`.
- The app binds to `process.env.PORT` automatically.
- Ensure `config.json` and `state.json` are persisted between deploys (volume, mounted folder, or by checking them into the repo and treating `state.json` as ephemeral).

## URLs and roles

### Judge

- `GET /` – main judge UI (Dutch only)
  - Per-judge login (jurylid + wachtwoord)
  - Scoring selection (e.g. Groups / Floats)
  - Category selection (e.g. Entertainment, Kostumering, Carnavalesk)
  - Per-category scoring buttons
  - Lock category & mark scoring as done
  - Link to change judge password

- `GET /judge-password.html` – judge password change UI
  - Judge selects self, enters current + new password.

### Admin

- `GET /admin` – admin status UI
  - Matrix of judges vs categories:
    - **Vergrendeld** (locked)
    - **Voltooid** (all scores entered)
    - **Ontbrekend** (missing scores)
  - Judge-level "done" indicator.

- `GET /admin/config-ui` – config editor UI (if used)

### Head judge

- `GET /head` – head judge UI
  - Password-protected via a single head password.
  - Shows totals (per category + overall) for the selected scoring.
  - Shows same judge status matrix as the admin page.
  - Allows the head judge to change the head password.
  - Provides an "Export naar Excel" button.

- `GET /head/export.xlsx?scoring=...&password=...` – Excel export
  - Password-protected via the head password.
  - Produces an `.xlsx` file with:
    - A `<scoring> Totals` sheet (per contestant/category + overall).
    - A `<scoring> Raw` sheet (per contestant, per category, per judge).

## Configuration

### `config.json`

`config.json` defines judges and *scorings*.

Minimal shape (example):

```json
{
  "judges": [
    { "id": 1, "name": "Judge 1" },
    { "id": 2, "name": "Judge 2" }
  ],
  "scorings": {
    "groups": {
      "id": "groups",
      "label": "Groups",
      "contestants": [
        { "id": 1, "name": "Group 1" },
        { "id": 2, "name": "Group 2" }
      ],
      "categories": ["entertainment", "kostumering", "carnavalesk"],
      "allowedScores": [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    },
    "floats": {
      "id": "floats",
      "label": "Floats",
      "contestants": [],
      "categories": ["entertainment", "kostumering", "carnavalesk"],
      "allowedScores": [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    }
  },
  "defaultScoring": "groups"
}
```

Notes:

- `judges` is a flat list used everywhere.
- `scorings` is a map keyed by scoring id (e.g. `"groups"`, `"floats"`).
- Each scoring defines its own contestants, categories, and allowedScores.

### `state.json`

`state.json` is created/maintained by the server. It contains:

- `scores[scoringId][category][judgeId][contestantId] = points`
- `locks[scoringId][category][judgeId] = boolean`
- `zeroed[scoringId][category][contestantId] = true`
- `done[scoringId][judgeId] = boolean`
- `headPassword = string`
- `judgePasswords[judgeId] = string`

You normally do **not** edit `state.json` by hand during the event, but it is useful for backup/restore or debugging.

## API overview

The backend lives in `src/server.js` and exposes:

### Config & admin

- `GET /api/config` – public config (judges + scorings; no passwords).
- `GET /admin/config` – raw `config.json` (no passwords).
- `POST /admin/config` – update `config.json` (with basic validation).

### Judge auth & passwords

- `POST /api/judge-login`
  - Body: `{ judgeId, password }`
  - Validates a judge's password and returns `{ ok, judgeId, judgeName }`.

- `POST /api/judge-password`
  - Body: `{ judgeId, oldPassword, newPassword }`
  - Lets a judge change their own password (min length enforced).

### Scoring

- `POST /api/score`
  - Body: `{ scoring, category, judgeId, contestantId, points }`
  - Validates inputs, enforces:
    - category exists for scoring
    - contestant exists
    - judge exists
    - points is in `allowedScores`
    - category not locked for this judge
    - contestant not zeroed by admin
    - one-use-per-score per judge/category

- `GET /api/judge-scores?scoring=...&category=...&judgeId=...`
  - Returns existing scores for that judge/category, used for restoring UI on reload.

### Locks & done flags

- `GET /api/lock?scoring=...&category=...&judgeId=...`
  - Returns `{ locked: boolean }`.

- `POST /api/lock`
  - Body: `{ scoring, category, judgeId, locked }`
  - Allows a judge to lock/unlock a category, but only after scoring all contestants.

- `GET /api/done?scoring=...&judgeId=...`
  - Returns `{ done: boolean }`.

- `POST /api/done`
  - Body: `{ scoring, judgeId, done }`
  - Marks a scoring as done for a judge, only if all categories/contestants have scores.

### Zero overrides (admin)

- `POST /admin/zero`
  - Body: `{ scoring, category, contestantId, zero }`
  - When `zero` is truthy, that contestant gets 0 for everyone in that category.

### Head judge APIs

- `GET /head/totals?scoring=...`
  - Requires head password via `X-Head-Password` header or `?password=...`.
  - Returns structured totals used by the head UI.

- `GET /head/export.xlsx?scoring=...&password=...`
  - Same password requirement.
  - Returns Excel file (see above).

- `POST /head/password`
  - Body: `{ oldPassword, newPassword }`
  - Changes `headPassword` in `state.json`.

### Status matrix

- `GET /admin/status?scoring=...`
  - Public to admin/head UIs.
  - Returns per-judge per-category:
    - `complete` – all contestants scored.
    - `locked` – category locked by that judge.
    - `done` – judge marked the entire scoring as done.

## Frontend code

Frontends live in `src/public/`:

- `index.html` + `main.js`
  - Judge login & scoring UI (Dutch text).
- `judge-password.html`
  - Separate UI to change a judge's password.
- `admin.html` + `admin-status.js` + `admin-status.css`
  - Admin status matrix.
- `head.html`
  - Head judge view:
    - Uses `admin-status.js` to render the same status matrix into `#head-status-table`.
    - Uses Fetch APIs to pull totals and export.

All styling is simple inline CSS or tiny CSS files; the target is mobile friendliness, not design perfection.

## Development notes

- All user-facing text in the jury app is currently in Dutch (except internal API names).
- The system is designed to be robust under poor network conditions and quick reloads:
  - Judge UI re-fetches lock/done state and existing scores on each change of judge/scoring/category.
- `state.json` includes passwords in plain text; treat it as sensitive and do not commit it to a public repo.

For a deeper dive into how everything fits together (data model, flows, edge cases), see `ARCHITECTURE.md`.
