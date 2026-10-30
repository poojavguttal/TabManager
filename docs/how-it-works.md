# How Tab Todos works

## What it notices

| Item | Shows up when | Needs site access |
|---|---|---|
| Message not sent | text typed in Teams, Slack, WhatsApp, Discord… not sent, away ≥1 min | yes |
| Form not complete | ≥2 fields filled by you, not submitted, away ≥2 min or tab closed | yes |
| Draft not sent | a long draft in a text box, not sent, away ≥2 min | yes |
| Checkout not complete | cart/checkout page with something in it, no order confirmation | yes |
| Stopped partway through / Setup not finished | article or docs, ≥45 s reading, scrolled 15–85 %, away ≥5 min | yes |
| Stopped partway through (video) | video >2 min, watched 10–90 %, away ≥20 min | yes |
| New emails / New messages | unread number in an open messaging or email tab went up | no |
| On your to-do list | you added it yourself | no |

Items finish on their own when you submit (and reach a confirmation page), send the message, read past 85 % or watch
past 90 %. New-message items disappear when you look at the inbox. Your own to-dos stay until you check them off.

Never flagged: search results, social feeds, login pages, the tab you're on, and sites on the blocklist (banking,
health, email, password managers by default). Every threshold lives in `src/shared/config.ts`.

## Reminders

At most one every 20 min, one per item per hour, three per item. None while you're typing, in fullscreen, during quiet
hours or while paused. New messages never trigger reminders — the apps already notify you.

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Tab titles and URLs — for Open tabs, unread counts, and jumping back to a tab |
| `storage` | Your list, on this device only |
| `sidePanel`, `notifications`, `alarms`, `idle` | The panel, reminders, and not reminding you while you're away |
| `scripting`, `favicon` | Starting the page sensor once you turn it on; site icons |
| `contextMenus` | The right-click **Add / Move to Tab Todos** items |
| Site access (optional) | Only after you click **Turn on**; revocable in Settings |

The page sensor reports only counts and levels: fields filled, whether a text box has no / a short / a long draft,
scroll %, the heading you stopped at, video progress, and whether you submitted. Never field values, typed text, its
length, or keys pressed. Unread counts come from the tab title ("(3) WhatsApp"), so no email content is read.

## Trace log (for debugging)

Every change to the list is logged locally with its reason — created, status changed, deleted ("you clicked done",
"untouched for 7 days"…), plus reminders sent, browser starts and errors. Newest 1,000 events. View it in
**Settings → Debug**, or click **Download log** to attach it to a bug report.
