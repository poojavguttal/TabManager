# Tab Resume

A Chrome extension that keeps a to-do list of what you left behind in your tabs — half-filled forms, docs you stopped
reading, unsent messages, new emails, and tabs you haven't been back to — plus any tab you pick yourself. Check things
off, or click one to jump back to it.

**Your own to-dos:** get tabs off your tab bar and onto the list —
- **Drag and drop** onto the panel: drag the icon at the left of the address bar (or any link). If the page is open, its
  tab closes. (Chrome doesn't let extensions receive tabs dragged from the tab strip itself.)
- **+ Add** in the panel: pick open tabs; "Close these tabs after adding" is on by default.
- **Right-click** a page → **Add to Tab Resume** or **Move to Tab Resume (closes the tab)**; right-click a link →
  **Add link to Tab Resume**.
- **Alt+Shift+S** adds the tab you're on.

To-dos stay until you check them off — even after the tab is closed — and get reminders like everything else.

**Runs 100% on your computer.** No servers, no accounts, no AI model, no network requests.

## Setup

```bash
npm install
npm run build          # outputs dist/
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick `dist/`.
2. Pin Tab Resume and click its icon to open the side panel.
3. Optional: click **Turn on** in the panel to let it notice unfinished forms, drafts and reading (Chrome asks for site
   access at that point — not at install).

`npm run dev` rebuilds on change; then hit reload on the extension card.

## Privacy & permissions

| Permission | Why |
|---|---|
| `tabs` | Tab titles and URLs — for the Open tabs list, new-message counts, and jumping back to a tab |
| `storage` | Your list, kept in `chrome.storage.local` on this device only |
| `sidePanel`, `notifications`, `alarms`, `idle` | The panel, reminders, and not reminding you while you're away |
| `scripting`, `favicon` | Registering the page sensor once you turn it on; showing site icons |
| `contextMenus` | The right-click **Add / Move to Tab Resume** items |
| Site access (optional) | Only after you click **Turn on** — powers form/draft/reading detection. Revocable in Settings |

What the page sensor sends to the extension: counts of fields you filled, whether a text box has *no / a short / a long*
draft, scroll %, the heading you stopped at, video progress, and whether you submitted. **Never** field values, typed
text, its exact length, or which keys you pressed. Sites on the blocklist (banking, health, email, password managers by
default) aren't tracked at all.

New messages and emails come from the unread number in the tab **title** ("(3) WhatsApp", "Inbox (12) – Gmail"), so no
email content is ever read. We deliberately don't use the Gmail API: it would need Google's *restricted* mail scope, an
OAuth client and a security review — far more access than a number in a title.

## How it works

```
page sensor (opt-in)  →  background worker  →  chrome.storage.local  →  side panel
  counts only              tracker → classifier → rules → lifecycle → reminders
```

| File | Role |
|---|---|
| `src/content/sensor.ts` | Engagement signals on the page (counts and levels only) |
| `src/background/tracker.ts` | Tab events + sensor reports → visits; unread counts from titles |
| `src/background/classifier.ts` | Page type from URL + page shape |
| `src/background/rules.ts` | The rules below, plus scoring |
| `src/background/lifecycle.ts` | To-do state: active, snoozed, done, auto-completed |
| `src/background/labels.ts` | Item names and short statuses ("Application not complete") |
| `src/background/nudges.ts` | Reminders and their guardrails |
| `src/shared/config.ts` | **Every threshold** — tune here |

### Rules

| Rule | Shows up when | Needs page detection |
|---|---|---|
| Unsent message | text typed in Teams, Slack, WhatsApp, Discord… not sent, away ≥1 min | yes |
| Form not complete | ≥2 fields filled by you, not submitted, away ≥2 min or tab closed | yes |
| Draft not sent | a long draft in a text box, not sent, away ≥2 min | yes |
| Checkout not complete | cart/checkout page with interaction, no confirmation | yes |
| Reading / setup not finished | docs or article, ≥45 s active, scrolled 15–85 %, away ≥5 min | yes |
| Video not finished | video >2 min, watched 10–90 %, away ≥20 min (scored on watch time) | yes |
| New messages / emails | unread number in an open messaging or email tab went up since you last looked | no |
| To do | you added it (drag and drop, + Add, right-click, or Alt+Shift+S) | no |

Items finish on their own when you submit (and land on a confirmation page), send the message, read past 85 % or watch
past 90 %. New-message items disappear when you visit the tab.

**Open tabs** (second tab in the panel) lists tabs you haven't visited for over an hour (not searches, feeds, logins, messaging apps, pinned tabs or to-dos), one per page — click to go there, **+** to
move it to your to-do list, **×** to close it.

### Reminders

- **Closing** — you close a tab with unfinished work: "Saved for later … [Reopen] [Not needed]".
- **Welcome back** — after ≥15 min away from the computer.
- **Stale** — an important item untouched for ≥20 min.

Guardrails: max 1 reminder per 20 min, 3 per item, none while typing / fullscreen / locked, quiet hours, pause button.
New messages never trigger reminders.
