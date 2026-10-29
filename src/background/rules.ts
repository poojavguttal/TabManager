// Deterministic rules: decide WHAT counts as unfinished and how strongly.
import { CONFIG } from '../shared/config';
import type { Candidate, Meta, RuleId, State, Visit } from '../shared/types';
import { findApp } from '../shared/apps';
import { matchesDomain } from '../shared/url';
import { IGNORED_TYPES } from './classifier';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function engagement(activeSec: number): number {
  return clamp(activeSec / CONFIG.engagementFullSec, CONFIG.engagementFloor, 1);
}

export function recency(leftAt: number, now: number): number {
  const { fullHours, floorDays, floor } = CONFIG.recency;
  const age = now - leftAt;
  if (age <= fullHours * HOUR) return 1;
  const t = clamp((age - fullHours * HOUR) / (floorDays * DAY - fullHours * HOUR), 0, 1);
  return 1 - t * (1 - floor);
}

const leftAtOf = (v: Visit) => v.leftAt ?? v.lastActiveAt;
const awayMin = (v: Visit, now: number) => (now - leftAtOf(v)) / MIN;
/** Closing a tab counts as "away long enough" — that's when the closing nudge fires. */
const awayAtLeast = (v: Visit, now: number, min: number) => v.closed || awayMin(v, now) >= min;
const fmtMin = (m: number) => (m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`);
const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function isFocused(s: State, v: Visit): boolean {
  return !v.closed && s.windowFocused && s.focusedTabId === v.tabId && s.tabVisit[v.tabId] === v.id;
}

function isDone(v: Visit): boolean {
  return v.signals.completed;
}

function leftText(v: Visit, now: number): string {
  return v.closed ? `closed ${fmtMin(awayMin(v, now))} ago` : `left ${fmtMin(awayMin(v, now))} ago`;
}

/** Run every rule over the visit history and return scored candidates. */
export function evaluate(s: State, now: number): Candidate[] {
  const visits = Object.values(s.visits).sort((a, b) => a.startedAt - b.startedAt);
  const suppressed = (domain: string, rule: RuleId) => (s.suppressed[`${domain}|${rule}`] ?? 0) >= CONFIG.suppressAfterDismissals;
  const out = new Map<string, Candidate>();

  /** `engagedSec`: how much you engaged with it — active time by default, watch time for videos. */
  const add = (rule: RuleId, v: Visit, evidence: string[], meta: Meta, extra: Partial<Candidate> = {}, engagedSec = v.activeSec) => {
    if (suppressed(v.domain, rule)) return;
    let score = CONFIG.base[rule] * engagement(engagedSec) * recency(leftAtOf(v), now);
    if (rule === 'abandoned_form') {
      const ratio = v.signals.fieldsTotal ? v.signals.fieldsFilled / v.signals.fieldsTotal : 0;
      score *= 0.85 + 0.15 * ratio;
    }
    if (isStale(v, now)) {
      score *= CONFIG.stale.boost;
      evidence.push(`Open for ${fmtMin((now - v.startedAt) / MIN)}, untouched for ${fmtMin(awayMin(v, now))}`);
    }
    const key = `${rule}|${v.normUrl}`;
    out.set(key, {
      key,
      rule,
      score: clamp(score, 0, 1),
      evidence,
      visitIds: [v.id],
      url: v.url,
      urls: [v.url],
      title: v.title,
      domain: v.domain,
      tabId: v.closed ? undefined : v.tabId,
      leftAt: leftAtOf(v),
      lastHeading: v.signals.lastHeading || undefined,
      meta,
      ...extra,
    });
  };

  // ---- Per-visit rules. At most one of form/draft/checkout per visit. ----
  for (const v of visits) {
    if (IGNORED_TYPES.has(v.pageType) || isFocused(s, v) || isDone(v)) continue;
    const sig = v.signals;

    // Messaging/email apps only produce "unsent message" tasks — reading and revisiting them all day is normal.
    const app = findApp(v.url);
    if (app) {
      const cd = CONFIG.chatDraft;
      if (app.kind === 'chat' && sig.draft !== 'none' && awayAtLeast(v, now, cd.minAwayMin)) {
        add('unsent_message', v, ['Typed a message', 'Not sent', cap(leftText(v, now))], { app: app.id }, {
          score: clamp(CONFIG.base.unsent_message * recency(leftAtOf(v), now), 0, 1),
        });
      }
      continue;
    }
    // Forms on those sites (Google Forms lives on docs.google.com) don't autosave, so they still count.
    const autosaves = v.pageType !== 'form' && CONFIG.draftIgnoreDomains.some((d) => matchesDomain(v.domain, d));

    // R4: unfinished checkout. Something left in the cart counts no matter how long you looked, so time spent doesn't lower the score.
    if (v.pageType === 'cart' && !v.cartEmpty && awayAtLeast(v, now, CONFIG.cart.minAwayMin)) {
      add(
        'unfinished_checkout',
        v,
        [`Cart / checkout on ${v.domain}`, 'No order confirmation seen', cap(leftText(v, now))],
        { filled: sig.fieldsFilled },
        { score: clamp(CONFIG.base.unfinished_checkout * recency(leftAtOf(v), now), 0, 1) },
      );
    }
    // R1: abandoned form
    else if (!autosaves && sig.fieldsFilled >= CONFIG.form.minFilled && !sig.submitted && awayAtLeast(v, now, CONFIG.form.minAwayMin)) {
      add('abandoned_form', v, [`Filled ${sig.fieldsFilled} of ${sig.fieldsTotal} fields`, 'Not submitted', cap(leftText(v, now))], {
        filled: sig.fieldsFilled,
        total: sig.fieldsTotal,
      });
    }
    // R5: unsent draft
    else if (!autosaves && sig.draft === 'long' && !sig.submitted && awayAtLeast(v, now, CONFIG.draft.minAwayMin)) {
      add('unsent_draft', v, ['Text typed in a box', 'Not sent', cap(leftText(v, now))], {});
    }

    // R2: partial reading
    const r = CONFIG.reading;
    if (
      (v.pageType === 'docs' || v.pageType === 'article') &&
      v.activeSec >= r.minActiveSec &&
      sig.scrollMax >= r.minScroll &&
      sig.scrollMax <= r.maxScroll &&
      awayAtLeast(v, now, r.minAwayMin)
    ) {
      const ev = [`Read ${sig.scrollMax}% of the page`];
      if (sig.lastHeading) ev.push(`Stopped at "${sig.lastHeading}"`);
      ev.push(cap(leftText(v, now)));
      add('partial_reading', v, ev, { scroll: sig.scrollMax, heading: sig.lastHeading, pageType: v.pageType });
    }

    // R3: partial video
    const vc = CONFIG.video;
    if (sig.videoDuration > vc.minDuration && sig.videoPct >= vc.minPct && sig.videoPct <= vc.maxPct && awayAtLeast(v, now, vc.minAwayMin)) {
      const watched = (sig.videoPct / 100) * sig.videoDuration;
      // Watching involves no clicks or typing (and often another window has focus), so score on watch time.
      add(
        'partial_video',
        v,
        [`Watched ${fmtTime(watched)} of ${fmtTime(sig.videoDuration)}`, cap(leftText(v, now))],
        { watched: fmtTime(watched), duration: fmtTime(sig.videoDuration) },
        {},
        Math.max(v.activeSec, watched),
      );
    }
  }

  // ---- New messages / emails in open messaging tabs ----
  for (const c of inboxCandidates(s, now)) out.set(c.key, c);

  return [...out.values()];
}

/** One card per app + account, however many tabs it's open in. */
function inboxCandidates(s: State, now: number): Candidate[] {
  const out = new Map<string, Candidate>();
  for (const e of Object.values(s.inbox)) {
    if (e.count <= e.seen) continue;
    const app = findApp(e.url);
    if (!app) continue;
    const key = `new_messages|${app.id}|${e.account}`;
    const existing = out.get(key);
    if (existing) {
      existing.leftAt = Math.min(existing.leftAt, e.newSince ?? now);
      continue;
    }
    out.set(key, {
      key,
      rule: 'new_messages',
      score: CONFIG.base.new_messages,
      evidence: ['New since you last looked'],
      visitIds: [],
      url: e.url,
      urls: [e.url],
      title: app.name,
      domain: app.domains[0],
      tabId: e.tabId,
      leftAt: e.newSince ?? now,
      meta: { app: app.id, kind: app.kind, account: e.account.includes('@') ? e.account : '' },
    });
  }
  return [...out.values()];
}

function isStale(v: Visit, now: number): boolean {
  const st = CONFIG.stale;
  return !v.closed && now - v.startedAt > st.openHours * HOUR && awayMin(v, now) > st.awayHours * 60 && v.activeSec >= st.minActiveSec;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
