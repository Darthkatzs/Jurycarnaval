# Jurycarnaval Architecture

This document describes how the Jurycarnaval app is structured so you can confidently pick it up on another machine or extend it later.

- Runtime: Node.js + Express
- Persistence: JSON files on disk (`config.json`, `state.json`)
- Frontend: static HTML/CSS/JS, no framework

## Directory layout

At repo root:

- `config.json` – configuration (judges, scorings, contestants, categories, allowed scores)
- `state.json` – runtime state (scores, locks, zero overrides, done flags, head/judge passwords)
- `package.json` / `package-lock.json` – dependencies and scripts
- `src/server.js` – main Express server and API implementation
- `src/public/` – all static assets for judge, admin and head UIs

### `src/public/`

- `index.html` – judge UI (login + scoring)
- `main.js` – judge logic (login, scoring, lock/done handling)
- `admin.html` – admin UI for status matrix
- `admin-status.js` – shared renderer for judge/category status table
- `admin-status.css` – styles for the status table badges
- `head.html` – head judge UI (totals, status, export, head password management)
- `judge-password.html` – separate page to change a judge's password

## Configuration model (`config.json`)

`config.json` configures:

- Who the judges are
- What is being scored
- How scoring is structured (scorings, categories, allowed scores)

Shape (simplified):

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

- `judges` is shared by all scorings.
- `scorings` is a map from ID to configuration.
- `categories` are internal keys; the UI maps them to Dutch labels.
- `allowedScores` is an ordered array of integer score values.

The server includes a small migration path from an older flat config (single scoring) into `scorings.groups` / `scorings.floats` for backwards compatibility.

## State model (`state.json`)

`state.json` is maintained exclusively by the server.

Core shape:

```json
{
  "scores": {
    "groups": {
      "entertainment": {
        "1": { "1": 13, "2": 12 },
        "2": { "1": 11 }
      }
    }
  },
  "locks": {
    "groups": {
      "entertainment": {
        "1": true
      }
    }
  },
  "zeroed": {
    "groups": {
      "entertainment": {
        "2": true
      }
    }
  },
  "done": {
    "groups": {
      "1": true
    }
  },
  "headPassword": "password",
  "judgePasswords": {
    "1": "password",
    "2": "some-other-password"
  }
}
```

Meaning of each section:

- `scores[scoringId][category][judgeId][contestantId] = points`
- `locks[scoringId][category][judgeId] = true/false` – category locked for that judge
- `zeroed[scoringId][category][contestantId] = true` – contestant has 0 for all judges in that category
- `done[scoringId][judgeId] = true/false` – judge finished entire scoring
- `headPassword` – password for head judge UI and Excel export
- `judgePasswords[judgeId]` – per-judge passwords for login

There is a migration step at startup to wrap older (pre-scoring) `scores/locks/zeroed` into the default scoring, if needed.

## Server: `src/server.js`

The server:

1. Loads `config.json` and normalises it into the multi-scoring model.
2. Loads `state.json` (if present), applying migrations.
3. Exposes JSON APIs for judges, admin, and head judge.
4. Serves static assets from `src/public/`.

### Initialisation helpers

Key helpers:

- `getScoringConfig(scoringId)` – returns a valid scoring config, falling back to `defaultScoring`.
- `getJudges()` – returns configured judges.
- `getHeadPassword()` – returns current head password or default.
- `checkHeadPassword(req, res)` – checks head password from header or query.

### Password initialisation

On startup, the server ensures:

- Each judge has an entry in `judgePasswords[judgeId]`, defaulting to `"password"` if missing.
- `headPassword` is set (defaults to `"password"`).

These values are persisted back to `state.json` via `saveState()`.

## API endpoints

### Config & admin

#### `GET /api/config`

Returns a safe view of config for frontends:

```json
{
  "JUDGES": [ { "id": 1, "name": "Judge 1" }, ... ],
  "scorings": {
    "groups": {
      "id": "groups",
      "label": "Groups",
      "categories": ["entertainment", ...],
      "contestants": [...],
      "allowedScores": [13, 12, ...]
    },
    ...
  },
  "defaultScoring": "groups"
}
```

No passwords are ever included.

#### `GET /admin/config`

Returns raw `config.json`.

#### `POST /admin/config`

Replaces `config.json` with the posted object, after basic validation:

- Must include `judges[]`.
- Must include `scorings{}`.

Passwords stay in `state.json` and are unaffected.

### Judge auth

#### `POST /api/judge-login`

Body:

```json
{ "judgeId": 1, "password": "..." }
```

- Finds judge by `id`.
- Compares password against `judgePasswords[judgeId]` (default `"password"`).
- Returns `{ ok: true, judgeId, judgeName }` on success.

#### `POST /api/judge-password`

Body:

```json
{ "judgeId": 1, "oldPassword": "...", "newPassword": "..." }
```

- Verifies `oldPassword`.
- Enforces minimum length on `newPassword` (>= 4 characters).
- Updates `judgePasswords[judgeId]` and persists state.

### Scoring

#### `POST /api/score`

Body:

```json
{
  "scoring": "groups",
  "category": "entertainment",
  "judgeId": 1,
  "contestantId": 3,
  "points": 12
}
```

Steps:

1. Resolve scoring config (`getScoringConfig`).
2. Validate category, judge, contestant, and points.
3. Check that the category is not locked for this judge.
4. Check that the contestant is not zeroed for this scoring/category.
5. Enforce the **one-use-per-score-per-category-per-judge** rule:
   - If another contestant already has the same `points` for this judge/category, reject.
6. Write `scores[scoringId][category][judgeId][contestantId] = points` and persist.

#### `GET /api/judge-scores`

Query parameters:

- `scoring`
- `category`
- `judgeId`

Returns:

```json
{
  "scoring": "groups",
  "category": "entertainment",
  "judgeId": 1,
  "scores": { "1": 13, "2": 12 }
}
```

Used by the judge UI to restore selections on reload.

### Locks & done flags

#### `GET /api/lock`

- Query: `scoring`, `category`, `judgeId`.
- Returns `{ locked: boolean }` for that judge/category/scoring.

#### `POST /api/lock`

Body:

```json
{ "scoring": "groups", "category": "entertainment", "judgeId": 1, "locked": true }
```

- When `locked` is `true`, requires that the judge has scored **all contestants** in that category.
- Writes `locks[scoringId][category][judgeId] = true/false` and persists.

#### `GET /api/done`

- Query: `scoring`, `judgeId`.
- Returns `{ done: boolean }`.

#### `POST /api/done`

Body:

```json
{ "scoring": "groups", "judgeId": 1, "done": true }
```

- When setting `done = true`, verifies that **all categories** are complete for that judge (all contestants have scores in all categories).
- Writes `done[scoringId][judgeId]` and persists.

### Zero overrides (admin)

#### `POST /admin/zero`

Body:

```json
{ "scoring": "groups", "category": "entertainment", "contestantId": 3, "zero": true }
```

Sets or clears `zeroed[scoringId][category][contestantId]`.

When zeroed:

- The judge scoring API treats the contestant as fixed 0 for that category and refuses manual scores.
- Aggregation logic in totals/export honors this 0.

### Status matrix

#### `GET /admin/status`

- Query: `scoring`.
- Returns, for each judge and each category:

```json
{
  "scoring": "groups",
  "categories": ["entertainment", ...],
  "judges": [
    {
      "judgeId": 1,
      "judgeName": "Judge 1",
      "done": true,
      "categories": {
        "entertainment": { "complete": true, "locked": true },
        "kostumering": { "complete": false, "locked": false }
      }
    },
    ...
  ]
}
```

This drives both:

- The **admin page** (`/admin`) via `admin-status.js` + `#status-table`.
- The **head judge page** (`/head`) via `admin-status.js` + `#head-status-table`.

## Head judge endpoints

### `GET /head/totals`

- Query: `scoring`.
- Requires head password via `X-Head-Password` or `?password=...`.

Response:

```json
{
  "scoring": "groups",
  "scoringLabel": "Groups",
  "categories": ["entertainment", ...],
  "contestants": [ { "id": 1, "name": "Group 1" }, ... ],
  "categoryTotals": {
    "entertainment": { "1": 42, "2": 37 },
    ...
  },
  "overallTotals": {
    "1": 120,
    "2": 115
  }
}
```

Aggregation rules:

- For each scoring/category/contestant:
  - If there is a zero override, the category contributes 0 for that contestant.
  - Otherwise, sum all judges' scores for that contestant/category.
- `overallTotals[contestantId]` is the sum of that contestant's totals over all categories.

### `GET /head/export.xlsx`

- Query: `scoring`, `password`.
- Validated via `checkHeadPassword`.
- Builds two sheets using the same logic as `/head/totals`:
  - `<label> Totals` – contestant, per-category totals, and overall.
  - `<label> Raw` – contestant, per-category per-judge raw scores.

### `POST /head/password`

- Body: `{ oldPassword, newPassword }`.
- Uses `X-Head-Password` header for authentication.
- On success, updates `headPassword` and persists to `state.json`.

## Frontend flows

### Judge UI (`index.html` + `main.js`)

1. On load:
   - `GET /api/config` → populate judge, scoring, and category selectors.
2. Login:
   - POST `/api/judge-login` with selected judge + password.
   - On success: hide login, show scoring UI, save `currentJudgeId`.
3. When scoring or category changes:
   - `GET /api/lock`, `/api/done`, `/api/judge-scores` to refresh state.
   - Render contestants with score buttons, marking:
     - Used scores (`used` CSS class).
     - The selected score per contestant (`selected` CSS class).
4. On score button click:
   - `POST /api/score`.
   - Update local `usedScores` and `selectedScores` and re-render.
5. On lock toggle:
   - `POST /api/lock` with `locked: true/false`.
6. On done toggle:
   - `POST /api/done` with `done: true/false`.

### Judge password page (`judge-password.html`)

- `GET /api/config` → populate judge list.
- On submit:
  - `POST /api/judge-password`.

### Admin UI (`admin.html` + `admin-status.js`)

- `GET /api/config` → scoring list.
- On scoring change:
  - `GET /admin/status?scoring=...`.
  - `admin-status.js` renders the table into `#status-table`.

### Head judge UI (`head.html`)

1. Preload config and attempt auto-login using `sessionStorage.headPassword`.
2. On manual login:
   - Try `/head/totals` with `X-Head-Password`.
   - On success: hide login, show content, store password in `sessionStorage`.
3. For totals:
   - `GET /head/totals?scoring=...` with `X-Head-Password`.
4. For status matrix:
   - `GET /admin/status?scoring=...` and render via `admin-status.js` into `#head-status-table`.
5. For export:
   - Open `/head/export.xlsx?scoring=...&password=<current head password>` in a new tab.
6. For changing head password:
   - `POST /head/password` with `oldPassword`, `newPassword` and `X-Head-Password: oldPassword`.

## Security considerations

- Judges are authenticated by per-judge passwords stored in `state.json`.
- Head judge is authenticated by a separate `headPassword`.
- Passwords are currently stored in plain text; this is acceptable for a LAN / single-host event tool but **not** for multi-tenant or internet-exposed use without extra hardening.
- `state.json` must be treated as sensitive and kept off public repos.

## How to extend safely

When extending the app on another machine or for future years:

1. **Copy `config.json` and (optionally) `state.json`** to initialise judges and scorings.
2. Keep the **API contracts** above stable; frontends rely on these shapes.
3. If you add new categories or scorings, ensure:
   - `config.json` is updated.
   - Existing state is either migrated or reset.
4. For major changes (e.g. a database backend), keep the existing API surface where possible so the UIs continue to work.

This document + `README.md` should be enough for a new developer to understand how the system fits together and continue work from scratch.
