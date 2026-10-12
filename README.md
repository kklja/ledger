# Ledger

Personal college notes + schedule + coursework app for Windows (Electron).

## Install / run / update
- Install once from the latest GitHub Release (or `release\` after a local build). After that Ledger updates itself from GitHub Releases: it downloads in the background and installs while it sits in the tray (or Settings → Restart to update).
- Publish a new version: `npm run release` (patch) / `npm run release minor`. Tests, bumps the version, pushes, builds and publishes.
- First-time GitHub hookup: `gh auth login`, then `npm run connect-github`.
- Dev: `npm start` · tests: `npm test` · local installer only: `npm run dist`

## First run
1. Settings → Coursework: enter your Canvas and Blackboard addresses.
2. Coursework → **Sign in to school sites**: Edge opens with Ledger's own profile. Log in (tick "stay signed in" / remember device for Duo), close the window.
3. **Check now**. The AI reads both sites; classes are created automatically.
4. Classes → **Import schedule with AI**: paste your registration-portal schedule to get times, buildings, rooms.
5. Settings → iPhone: scan the QR code (same Wi-Fi). Allow Ledger on *Private* networks if Windows asks.
6. Settings → App: turn on "Start Ledger when I sign in" so reminders and scheduled checks run.

## How it works
- **AI = your subscription.** Ledger runs the Claude Code CLI (`claude -p`) or Codex CLI (`codex exec`) headlessly. API-key env vars are stripped so it can't fall back to API billing.
- **Coursework checks.** At the times in Settings (default 07:30, 12:30, 18:30) the AI gets a browser (Playwright MCP driving Edge, profile in `Documents\Ledger\browser-profile`), reads Canvas/Blackboard (preferring their JSON APIs through your logged-in session) and returns JSON. Ledger validates it, keeps the last good data per site, diffs it, and notifies you about new assignments, moved due dates, grades and announcements. The prompt forbids submitting/changing anything and typing passwords.
- **Syllabus → calendar.** When a syllabus changes or an announcement mentions a date change, the AI re-maps that course; you approve the diff.
- **Notes.** Monospace page with virtual space: click anywhere (past line ends, below the end) and type there. Blocks: spreadsheet tables with formulas (SUM, AVG, ROUND, PV, FV, PMT, NPV), journal entries (balance check), T-accounts, supply/demand graphs (equilibrium + CS/PS shading), charts, images. Paste screenshots with Ctrl+V; Excel ranges paste as tables.
- **Data.** Plain JSON in `Documents\Ledger` (notes, images, settings). `ai-context\` is regenerated for the AI; put syllabus PDFs/slides in `ai-context\courses\<CODE>\files\`.

## Layout
`main/` Electron main process (ai.js CLI runner, lms.js checker prompt/merge/diff, tasks.js prompts, phone.js iPhone bridge, feeds.js iCal/RSS, context.js AI export) · `renderer/` UI (CodeMirror editor in `src/editor`) · `shared/` formula engine, schedule, note↔Markdown · `scripts/` icon, demo seed, preview server, test helpers.
