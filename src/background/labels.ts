// Labels: what the thing is, plus a short status. Built from the page title — no model involved.
import { MESSAGING_APPS } from '../shared/apps';
import type { Meta, RuleId } from '../shared/types';

interface Labelable {
  rule: RuleId;
  title: string;
  domain: string;
  meta: Meta;
}

export function shortTitle(title: string, max = 55): string {
  // Drop only the trailing site name: "Apply – ML Engineer – Acme" → "Apply – ML Engineer"
  const parts = title.split(/(\s+[|\-–—·]\s+)/);
  const t = (parts.length >= 3 ? parts.slice(0, -2).join('') : title).trim() || title;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Names what was left behind plus a short status. No counts, percentages or instructions. */
export function templateLabel(c: Labelable): { label: string; note: string } {
  const title = shortTitle(c.title);
  switch (c.rule) {
    case 'abandoned_form':
      return { label: title, note: 'Form not complete' };
    case 'unsent_draft':
      return { label: `Draft on ${c.domain}`, note: 'Draft not sent' };
    case 'unfinished_checkout':
      return { label: `Cart on ${c.domain}`, note: 'Checkout not complete' };
    case 'partial_reading':
      return { label: title, note: c.meta.pageType === 'docs' ? 'Setup not finished' : 'Stopped partway through' };
    case 'partial_video':
      return { label: title, note: 'Stopped partway through' };
    case 'unsent_message':
      return { label: `Message in ${appName(c.meta.app)}`, note: 'Message not sent' };
    case 'saved':
      return { label: title, note: 'On your to-do list' };
    case 'new_messages':
      return { label: appName(c.meta.app), note: c.meta.kind === 'email' ? 'New emails' : 'New messages' };
  }
}

function appName(id: string | number | undefined): string {
  return MESSAGING_APPS.find((a) => a.id === id)?.name ?? 'messaging app';
}
