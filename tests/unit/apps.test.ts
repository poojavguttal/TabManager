import { describe, expect, it } from 'vitest';
import { accountOf, findApp, unreadFromTitle } from '../../src/shared/apps';

describe('findApp', () => {
  it('recognises messaging and email apps', () => {
    expect(findApp('https://teams.microsoft.com/v2/')?.id).toBe('teams');
    expect(findApp('https://mail.google.com/mail/u/0/#inbox')?.kind).toBe('email');
  });
  it('respects path prefixes for sites that are more than a messenger', () => {
    expect(findApp('https://www.linkedin.com/messaging/thread/1')?.id).toBe('linkedin');
    expect(findApp('https://www.linkedin.com/jobs/view/1')).toBeUndefined();
    expect(findApp('https://discord.com/channels/1/2')?.id).toBe('discord');
    expect(findApp('https://discord.com/nitro')).toBeUndefined();
  });
  it('ignores everything else', () => expect(findApp('https://github.com')).toBeUndefined());
});

describe('unreadFromTitle', () => {
  it.each([
    ['(3) WhatsApp', 3],
    ['Inbox (1,204) - me@gmail.com - Gmail', 1204],
    ['(99+) Chat | Microsoft Teams', 99],
    ['* general - Acme - Slack', 1],
  ])('%s → %d', (title, n) => expect(unreadFromTitle(title)).toBe(n));

  it('returns null when the title has no count (meaning differs for chat vs email)', () => {
    expect(unreadFromTitle('WhatsApp')).toBeNull();
    expect(unreadFromTitle('Re: Offer letter - me@gmail.com - Gmail')).toBeNull();
  });
});

describe('accountOf', () => {
  it('prefers the email address in the title', () => {
    expect(accountOf('https://mail.google.com/mail/u/1/', 'Inbox (2) - Me@Gmail.com - Gmail')).toBe('me@gmail.com');
  });
  it('falls back to the Gmail account index', () => {
    expect(accountOf('https://mail.google.com/mail/u/2/#inbox', 'Gmail')).toBe('u2');
  });
  it('is empty when nothing identifies the account', () => {
    expect(accountOf('https://web.whatsapp.com/', 'WhatsApp')).toBe('');
  });
});
