export type PageType = 'form' | 'docs' | 'article' | 'video' | 'cart' | 'search' | 'feed' | 'auth' | 'other';

export type RuleId =
  | 'abandoned_form'
  | 'partial_reading'
  | 'partial_video'
  | 'unfinished_checkout'
  | 'unsent_draft'
  | 'unsent_message'
  | 'new_messages'
  | 'saved';

export type TaskStatus = 'candidate' | 'active' | 'nudged' | 'snoozed' | 'resumed' | 'done' | 'dismissed' | 'expired';

/** Page shape, computed by the content script. Used only for classification. */
export interface PageFeatures {
  formCount: number;
  inputCount: number;
  wordCount: number;
  hasArticle: boolean;
  codeBlocks: number;
  hasNav: boolean;
  videoDuration: number;
  hasPassword: boolean;
  cartWords: boolean;
  /** The page says the cart is empty ("Your cart is empty"). */
  cartEmpty: boolean;
  completionText: boolean;
  headings: string[];
}

/** Engagement signals. Counts and lengths only — never field values or typed text. */
export interface PageSignals {
  fieldsFilled: number;
  fieldsTotal: number;
  submitted: boolean;
  /** Whether something is typed in a text box — never the text, nor even its exact length. */
  draft: DraftLevel;
  scrollMax: number;
  lastHeading: string;
  videoPct: number;
  videoDuration: number;
  completed: boolean;
  lastKeyAt: number;
}

export type DraftLevel = 'none' | 'short' | 'long';

export interface PageMessage {
  type: 'page';
  url: string;
  title: string;
  activeSec: number;
  signals: PageSignals;
  features?: PageFeatures;
}

export interface Visit {
  id: string;
  tabId: number;
  url: string;
  normUrl: string;
  domain: string;
  title: string;
  pageType: PageType;
  prevVisitId?: string;
  startedAt: number;
  lastActiveAt: number;
  leftAt?: number;
  activeSec: number;
  lastContentSec: number;
  closed: boolean;
  pinned?: boolean;
  features?: PageFeatures;
  signals: PageSignals;
}

export type Meta = Record<string, string | number>;

export interface Candidate {
  key: string;
  rule: RuleId;
  score: number;
  evidence: string[];
  visitIds: string[];
  url: string;
  urls: string[];
  title: string;
  domain: string;
  tabId?: number;
  leftAt: number;
  lastHeading?: string;
  meta: Meta;
}

export interface Task {
  key: string;
  rule: RuleId;
  status: TaskStatus;
  score: number;
  url: string;
  urls: string[];
  tabId?: number;
  title: string;
  domain: string;
  visitIds: string[];
  evidence: string[];
  meta: Meta;
  lastHeading?: string;
  label: string;
  /** Short status of what was left, e.g. "Application not complete". Never numbers. */
  note: string;
  createdAt: number;
  updatedAt: number;
  leftAt: number;
  resumedAt?: number;
  snoozeUntil?: number;
  finishedAt?: number;
  nudgeCount: number;
  lastNudgedAt?: number;
}

export type NotifAction = 'resume' | 'snooze' | 'dismiss' | 'openPanel';

export interface NotifRef {
  kind: 'task' | 'welcome';
  key?: string;
  /** actions[0] also runs when the notification body is clicked. */
  actions: NotifAction[];
  at: number;
}

/** A messaging/email tab, watched only through the unread number in its title. */
export interface InboxEntry {
  tabId: number;
  appId: string;
  /** Same app + account across several tabs = one card. Email address or Gmail's /u/N, else ''. */
  account: string;
  url: string;
  count: number;
  /** Count when you last looked at the tab; anything above it is new. */
  seen: number;
  newSince?: number;
}

export interface State {
  visits: Record<string, Visit>;
  tabVisit: Record<number, string>;
  tasks: Record<string, Task>;
  focusedTabId: number | null;
  windowFocused: boolean;
  lastNudgeAt: number;
  lastKeyAt: number;
  idleSince: number | null;
  suppressed: Record<string, number>;
  notifs: Record<string, NotifRef>;
  pendingScroll: Record<number, string>;
  inbox: Record<number, InboxEntry>;
}

export interface Prefs {
  nudgesEnabled: boolean;
  inPageToast: boolean;
  pausedUntil: number;
  quietStart: number | null;
  quietEnd: number | null;
  watchMessages: boolean;
  blocklist: string[];
}

export type PanelMessage =
  | { type: 'action'; action: 'resume' | 'done' | 'dismiss' | 'snooze' | 'restore'; key: string; minutes?: number }
  | { type: 'setPrefs'; prefs: Partial<Prefs> }
  | { type: 'pauseNudges'; minutes: number }
  | { type: 'refresh' }
  | { type: 'saveTabs'; tabIds: number[]; close: boolean }
  /** Something dropped on the panel: a link, or a page dragged from the address bar. */
  | { type: 'saveUrl'; url: string; title?: string; close: boolean }
  | { type: 'testNudge' }
  | { type: 'clearAll' };

