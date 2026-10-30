# Tab Todos

A Chrome extension that turns your open tabs into a to-do list. It notices what you left unfinished — a half-filled
form, an unsent message, a cart, a video you stopped halfway — and lets you save any tab yourself, close it, and come
back to it later.

**Everything stays on your computer.** No servers, no accounts, no AI.

## Install

```bash
npm install
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `dist/` folder.
3. Pin Tab Todos and click its icon to open the side panel.
4. Optional: click **Turn on** in the panel so it can notice unfinished forms, drafts and reading.

## Use it

- **Save a tab:** **+ Add** in the panel, drag a link or the address-bar icon onto the panel, right-click a page →
  **Add to Tab Todos**, or press **Alt+Shift+S**.
- **My list:** check items off, or click one to jump back to it.
- **Open tabs:** tabs you haven't touched in over an hour — move them to your list or close them.

See [docs/how-it-works.md](docs/how-it-works.md) for what it detects, reminders, permissions and privacy.

## Repo guide

```
src/
  background/    the extension's engine: tracks tabs, applies the rules, sends reminders
  content/       the page sensor (runs on web pages once you turn it on)
  sidepanel/     the side panel UI (React)
  shared/        settings, types and helpers used everywhere
public/          manifest.json and icons
tests/
  unit/          unit tests, one file per module, plus sample scenarios
  eval/          labeled test set and its report (REPORT.md)
docs/            how it works
scripts/         icon generator
```

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Build the extension into `dist/` |
| `npm run dev` | Rebuild on every change (then reload the extension) |
| `npm test` | Run all unit tests |
| `npm run samples` | Run the sample scenarios with expected outputs |
| `npm run eval` | Score detection on the labeled set; writes `tests/eval/REPORT.md` |
| `npm run typecheck` | Check types |
