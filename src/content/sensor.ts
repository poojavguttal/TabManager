// Page sensor: measures engagement on the page and reports counts to the background worker.
// Privacy: never reads or sends field values or typed text — only counts, lengths and percentages.
import { CONFIG } from '../shared/config';
import type { DraftLevel, PageFeatures, PageMessage, PageSignals } from '../shared/types';
import { showToast, type ToastRequest } from './toast';

const SEND_EVERY_MS = 5_000;
const FEATURES_EVERY_MS = 30_000;
const ACTIVE_WINDOW_MS = 60_000;

const SUBMIT_TEXT = /^(submit|send|apply|post|publish|reply|comment|place order|pay|confirm|finish|sign up|register|save)\b/i;
const COMPLETION_TEXT =
  /thank(s| you) for (your )?(application|applying|order|submitting|submission|registering|signing up|purchase)|application (has been |was )?(submitted|received)|order (is |has been )?(confirmed|placed)|successfully (submitted|sent|registered)|we('ve| have) received your/i;
const COMPLETION_URL = /(thank-?you|thanks|success|confirmation|confirmed|order-complete|order-received|submitted)|\/(complete|done)(\/|$)/i;
const SKIPPED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'search', 'password', 'checkbox', 'radio', 'range', 'color']);

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

declare global {
  interface Window {
    __tabResumeSensor?: number;
  }
}

// The newest copy wins: re-injection (after enabling access, or an extension reload) quietly retires older ones.
const token = Math.random();
const alive = () => window.__tabResumeSensor === token && !!chrome.runtime?.id;
if (/^https?:$/.test(location.protocol)) {
  window.__tabResumeSensor = token;
  start();
}

function start() {
  let pageUrl = stripHash(location.href);
  let touched = new WeakSet<Element>();
  let editables = new Set<HTMLElement>();
  let signals = freshSignals();
  let activeSec = 0;
  let lastInputAt = Date.now();
  let features: PageFeatures | undefined;
  let featuresDirty = true;
  let lastPayload = '';

  // --- user activity & interaction tracking ---------------------------------
  const markActive = () => (lastInputAt = Date.now());
  for (const ev of ['mousemove', 'click', 'scroll', 'touchstart', 'wheel']) {
    addEventListener(ev, markActive, { passive: true, capture: true });
  }
  addEventListener(
    'keydown',
    () => {
      markActive();
      signals.lastKeyAt = Date.now();
    },
    { capture: true },
  );

  const onEdit = (e: Event) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) {
      touched.add(t);
    } else if (t instanceof HTMLElement && t.isContentEditable) {
      const root = editableRoot(t);
      touched.add(root);
      editables.add(root);
    }
  };
  addEventListener('input', onEdit, { capture: true });
  addEventListener('change', onEdit, { capture: true });

  // A submit only counts if you actually entered something — clicking "Apply" on a job listing
  // starts an application, it doesn't finish one.
  const hasInput = () => {
    updateFormSignals();
    return signals.fieldsFilled > 0 || signals.draft !== 'none';
  };
  addEventListener('submit', () => hasInput() && (signals.submitted = true), { capture: true });
  addEventListener(
    'click',
    (e) => {
      const btn = (e.target as Element | null)?.closest?.('button, input[type=submit], [role=button]');
      if (!btn) return;
      const isSubmitType = btn instanceof HTMLButtonElement ? btn.type === 'submit' : btn instanceof HTMLInputElement;
      const text = (btn.textContent || (btn as HTMLInputElement).value || btn.getAttribute('aria-label') || '').trim();
      if ((SUBMIT_TEXT.test(text) || (isSubmitType && btn.closest('form'))) && hasInput()) signals.submitted = true;
    },
    { capture: true },
  );

  addEventListener('scroll', () => updateScroll(), { passive: true, capture: true });

  // --- periodic loops --------------------------------------------------------
  setInterval(() => {
    checkUrlChange();
    const video = mainVideo();
    if (video && !video.paused) markActive();
    if (document.visibilityState === 'visible' && document.hasFocus() && Date.now() - lastInputAt < ACTIVE_WINDOW_MS) {
      activeSec++;
    }
  }, 1000);

  setInterval(() => send(), SEND_EVERY_MS);
  setInterval(() => (featuresDirty = true), FEATURES_EVERY_MS);
  setTimeout(() => {
    featuresDirty = true;
    send();
  }, 3000);
  document.addEventListener('visibilitychange', () => send(true));
  addEventListener('pagehide', () => send(true));

  updateScroll();
  send();

  chrome.runtime.onMessage.addListener((msg: { type: string; heading?: string; toast?: ToastRequest }) => {
    if (msg.type === 'scrollToHeading' && msg.heading) scrollToHeading(msg.heading);
    if (msg.type === 'toast' && msg.toast) showToast(msg.toast);
  });

  // --- helpers ---------------------------------------------------------------
  function checkUrlChange() {
    const now = stripHash(location.href);
    if (now === pageUrl) return;
    send(true); // flush final state of the previous page
    pageUrl = now;
    touched = new WeakSet();
    editables = new Set();
    signals = freshSignals();
    activeSec = 0;
    featuresDirty = true;
    setTimeout(() => {
      updateScroll();
      featuresDirty = true;
      send();
    }, 1500);
  }

  function send(force = false) {
    if (!alive()) return;
    updateFormSignals();
    updateVideoSignals();
    if (featuresDirty) {
      features = computeFeatures();
      featuresDirty = false;
      if (features.completionText || COMPLETION_URL.test(location.pathname + location.search)) signals.completed = true;
    }
    const msg: PageMessage = { type: 'page', url: location.href, title: document.title, activeSec, signals: { ...signals }, features };
    const payload = JSON.stringify(msg);
    if (!force && payload === lastPayload) return;
    lastPayload = payload;
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {
      // Extension was reloaded; this content script is orphaned.
    }
  }

  function updateFormSignals() {
    let total = 0;
    let filled = 0;
    let draft = 0;
    const fields = document.querySelectorAll<Field>('input, textarea, select');
    for (let i = 0; i < fields.length && i < 400; i++) {
      const el = fields[i];
      if (!isCountable(el)) continue;
      total++;
      if (touched.has(el) && hasValue(el)) {
        filled++;
        if (el instanceof HTMLTextAreaElement) draft = Math.max(draft, el.value.trim().length);
      }
    }
    for (const el of editables) {
      if (el.isConnected) draft = Math.max(draft, (el.textContent || '').trim().length);
    }
    signals.fieldsTotal = total;
    signals.fieldsFilled = filled;
    signals.draft = draftLevel(draft);
  }

  function updateVideoSignals() {
    const v = mainVideo();
    if (!v) return;
    signals.videoDuration = Math.round(v.duration);
    signals.videoPct = Math.round((v.currentTime / v.duration) * 100);
  }

  function updateScroll() {
    const root = scrollRoot();
    const vh = root ? root.clientHeight : innerHeight;
    const top = root ? root.scrollTop : scrollY;
    const height = root ? root.scrollHeight : document.documentElement.scrollHeight;
    const pct = height <= vh * 1.15 ? 100 : Math.min(100, Math.round(((top + vh) / height) * 100));
    signals.scrollMax = Math.max(signals.scrollMax, pct);

    let last = '';
    for (const h of document.querySelectorAll('h1, h2, h3')) {
      if (h.getBoundingClientRect().top < innerHeight * 0.4) last = cleanText(h.textContent);
      else break;
    }
    if (last) signals.lastHeading = last;
  }
}

function freshSignals(): PageSignals {
  return {
    fieldsFilled: 0,
    fieldsTotal: 0,
    submitted: false,
    draft: 'none',
    scrollMax: 0,
    lastHeading: '',
    videoPct: 0,
    videoDuration: 0,
    completed: false,
    lastKeyAt: 0,
  };
}

/** The length is only used here, in the page, and reduced to a coarse level before anything is sent. */
function draftLevel(length: number): DraftLevel {
  if (length > CONFIG.draft.minChars) return 'long';
  return length >= CONFIG.chatDraft.minChars ? 'short' : 'none';
}

function computeFeatures(): PageFeatures {
  const text = (document.body?.innerText || '').slice(0, 200_000);
  const fields = [...document.querySelectorAll<Field>('input, textarea, select')].slice(0, 400);
  const pw = document.querySelector<HTMLInputElement>('input[type=password]');
  return {
    formCount: document.forms.length,
    inputCount: fields.filter(isCountable).length,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    hasArticle: !!document.querySelector('article'),
    codeBlocks: document.querySelectorAll('pre').length,
    hasNav: !!document.querySelector('nav, aside, [role=navigation]'),
    videoDuration: Math.round(mainVideo()?.duration ?? 0),
    hasPassword: !!pw && isVisible(pw),
    cartWords: /\b(subtotal|order summary|proceed to checkout|shopping (cart|bag))\b/i.test(text.slice(0, 30_000)),
    completionText: COMPLETION_TEXT.test(text.slice(0, 6000)),
    headings: [...document.querySelectorAll('h1, h2, h3')].slice(0, 8).map((h) => cleanText(h.textContent)).filter(Boolean),
  };
}

function isCountable(el: Field): boolean {
  if (el.disabled) return false;
  if (el instanceof HTMLInputElement && SKIPPED_INPUT_TYPES.has(el.type)) return false;
  if (el.closest('[role=search], header, nav')) return false;
  const hint = `${el.name} ${el.id} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('placeholder') ?? ''}`;
  if (/search/i.test(hint) || el.name === 'q') return false;
  return isVisible(el);
}

function hasValue(el: Field): boolean {
  if (el instanceof HTMLSelectElement) return el.selectedIndex > 0;
  if (el instanceof HTMLInputElement && el.type === 'file') return (el.files?.length ?? 0) > 0;
  return el.value.trim() !== '';
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function editableRoot(el: HTMLElement): HTMLElement {
  let root = el;
  while (root.parentElement?.isContentEditable) root = root.parentElement;
  return root;
}

function mainVideo(): HTMLVideoElement | undefined {
  let best: HTMLVideoElement | undefined;
  let bestArea = 0;
  for (const v of document.querySelectorAll('video')) {
    if (!(v.duration > 0) || !isFinite(v.duration)) continue;
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) {
      best = v;
      bestArea = area;
    }
  }
  return best;
}

/** Many docs sites scroll an inner container instead of the document. */
function scrollRoot(): HTMLElement | null {
  const doc = document.documentElement;
  if (doc.scrollHeight > innerHeight * 1.15) return null;
  let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2) as HTMLElement | null;
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight * 1.15 && el.clientHeight > innerHeight * 0.5) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return el;
    }
    el = el.parentElement;
  }
  return null;
}

function scrollToHeading(heading: string) {
  const target = [...document.querySelectorAll('h1, h2, h3')].find((h) => cleanText(h.textContent) === heading);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cleanText(s: string | null): string {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function stripHash(url: string): string {
  return url.split('#')[0];
}
