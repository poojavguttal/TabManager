import type { Prefs, RuleId, State } from './types';

/** Every threshold the engine uses lives here so it can be tuned in one place. */
export const CONFIG = {
  showThreshold: 0.45,
  nudgeThreshold: 0.7,

  base: {
    unsent_message: 0.8,
    abandoned_form: 0.8,
    unsent_draft: 0.75,
    unfinished_checkout: 0.7,
    partial_reading: 0.6,
    partial_video: 0.5,
    // Below the nudge threshold on purpose: the apps already send their own notifications.
    new_messages: 0.6,
    // Your own to-dos: above the reminder threshold, so they get reminders like everything else.
    saved: 0.75,
  } satisfies Record<RuleId, number>,

  form: { minFilled: 2, minAwayMin: 2 },
  /** Typed text longer than minChars is a "long" draft; at least chatDraft.minChars is "short". */
  draft: { minChars: 20, minAwayMin: 2 },
  /** Chat apps: even a short typed message matters, regardless of time spent. */
  chatDraft: { minChars: 2, minAwayMin: 1 },
  /** Anything left in a cart counts, however long you looked at it; only an empty cart doesn't. */
  cart: { minAwayMin: 2 },
  reading: { minActiveSec: 45, minScroll: 15, maxScroll: 85, minAwayMin: 5 },
  video: { minDuration: 120, minPct: 10, maxPct: 90, minAwayMin: 20 },
  stale: { openHours: 4, awayHours: 2, minActiveSec: 60, boost: 1.2 },
  /** The panel's "Open tabs" view: tabs you haven't visited for at least this long. */
  openTabs: { inactiveMin: 60 },

  engagementFullSec: 120,
  engagementFloor: 0.3,
  recency: { fullHours: 24, floorDays: 7, floor: 0.3 },

  nudge: {
    globalGapMin: 20,
    closingGapMin: 1,
    perTaskGapMin: 60,
    maxPerTask: 3,
    staleAwayMin: 20,
    typingQuietSec: 5,
    welcomeBackIdleMin: 15,
    snoozeMin: 60,
  },

  suppressAfterDismissals: 3,
  taskExpireDays: 7,
  pruneFinishedDays: 14,
  /** Visits that never became an item are dropped this long after you leave them. */
  visitKeepHours: 2,
  maxVisits: 600,


  /** Editors that autosave — typed text there isn't an "unsent draft". */
  draftIgnoreDomains: ['docs.google.com', 'notion.so', 'figma.com', 'overleaf.com', 'coda.io', 'canva.com'],
};

export const DEFAULT_PREFS: Prefs = {
  nudgesEnabled: true,
  inPageToast: false,
  pausedUntil: 0,
  watchMessages: true,
  quietStart: null,
  quietEnd: null,
  blocklist: [
    'mail.google.com',
    'outlook.live.com',
    'outlook.office.com',
    'accounts.google.com',
    'paypal.com',
    'venmo.com',
    'chase.com',
    'bankofamerica.com',
    'wellsfargo.com',
    'capitalone.com',
    'citi.com',
    'mychart.org',
    '1password.com',
    'bitwarden.com',
    'lastpass.com',
    'bank',
    'health',
    'patient',
  ],
};

export const emptyState = (): State => ({
  visits: {},
  tabVisit: {},
  tasks: {},
  focusedTabId: null,
  windowFocused: true,
  lastNudgeAt: 0,
  lastKeyAt: 0,
  idleSince: null,
  suppressed: {},
  notifs: {},
  pendingScroll: {},
  inbox: {},
});

export const RULE_LABELS: Record<RuleId, string> = {
  abandoned_form: 'Form',
  unsent_draft: 'Draft',
  unfinished_checkout: 'Shopping',
  partial_reading: 'Reading',
  partial_video: 'Video',
  unsent_message: 'Message',
  new_messages: 'Inbox',
  saved: 'To do',
};

export const RULE_ICONS: Record<RuleId, string> = {
  abandoned_form: '📝',
  unsent_draft: '✉️',
  unfinished_checkout: '🛒',
  partial_reading: '📖',
  partial_video: '▶️',
  unsent_message: '💬',
  new_messages: '🔔',
  saved: '📌',
};
