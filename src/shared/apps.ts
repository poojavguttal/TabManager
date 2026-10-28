// Messaging and email web apps. Used for "unsent message" and "new messages" tasks.
import { domainOf, matchesDomain } from './url';

export interface MessagingApp {
  id: string;
  name: string;
  kind: 'chat' | 'email';
  domains: string[];
  /** Only URLs under this path count (for sites that are more than a messenger). */
  pathPrefix?: string;
}

export const MESSAGING_APPS: MessagingApp[] = [
  { id: 'teams', name: 'Microsoft Teams', kind: 'chat', domains: ['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft'] },
  { id: 'slack', name: 'Slack', kind: 'chat', domains: ['app.slack.com'] },
  { id: 'whatsapp', name: 'WhatsApp', kind: 'chat', domains: ['web.whatsapp.com'] },
  { id: 'discord', name: 'Discord', kind: 'chat', domains: ['discord.com'], pathPrefix: '/channels' },
  { id: 'messenger', name: 'Messenger', kind: 'chat', domains: ['messenger.com'] },
  { id: 'telegram', name: 'Telegram', kind: 'chat', domains: ['web.telegram.org'] },
  { id: 'gchat', name: 'Google Chat', kind: 'chat', domains: ['chat.google.com'] },
  { id: 'linkedin', name: 'LinkedIn messages', kind: 'chat', domains: ['linkedin.com'], pathPrefix: '/messaging' },
  { id: 'gmail', name: 'Gmail', kind: 'email', domains: ['mail.google.com'] },
  { id: 'outlook', name: 'Outlook', kind: 'email', domains: ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'outlook.cloud.microsoft'] },
  { id: 'yahoo', name: 'Yahoo Mail', kind: 'email', domains: ['mail.yahoo.com'] },
  { id: 'proton', name: 'Proton Mail', kind: 'email', domains: ['mail.proton.me'] },
];

export function findApp(url: string): MessagingApp | undefined {
  const host = domainOf(url);
  let path = '/';
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  return MESSAGING_APPS.find((a) => a.domains.some((d) => matchesDomain(host, d)) && (!a.pathPrefix || path.startsWith(a.pathPrefix)));
}

/** Identifies the account so the same inbox open in several tabs counts once. */
export function accountOf(url: string, title: string): string {
  const email = title.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
  if (email) return email[0].toLowerCase();
  const gmailIndex = url.match(/\/mail\/u\/(\d+)/);
  return gmailIndex ? `u${gmailIndex[1]}` : '';
}

/**
 * Unread count from the tab title — the only thing read from messaging/email tabs.
 * "(3) WhatsApp", "Inbox (12) - me@gmail.com - Gmail", "(1) Chat | Microsoft Teams".
 * Slack-style titles mark unread with a leading "*" or "!" and no count; that counts as 1.
 * Returns null when the title has no marker: for chat apps that means nothing unread; for email it can
 * also mean "this view doesn't show it" (Gmail shows the subject while you read an email).
 */
export function unreadFromTitle(title: string): number | null {
  const m = title.match(/\((\d[\d,]*)\+?\)/);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  if (/^[*!•]\s/.test(title)) return 1;
  return null;
}
