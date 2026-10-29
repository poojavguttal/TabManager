import { describe, expect, it } from 'vitest';
import { domainOf, getSearchQuery, isBlocked, isTrackable, matchesDomain, normalizeUrl } from '../../src/shared/url';

describe('normalizeUrl', () => {
  it('drops the fragment and tracking params', () => {
    expect(normalizeUrl('https://a.com/x?utm_source=t&id=3&fbclid=9#top')).toBe('https://a.com/x?id=3');
  });
  it('sorts params so order does not matter', () => {
    expect(normalizeUrl('https://a.com/x?b=2&a=1')).toBe(normalizeUrl('https://a.com/x?a=1&b=2'));
  });
  it('drops a trailing slash but keeps the root', () => {
    expect(normalizeUrl('https://a.com/jobs/')).toBe('https://a.com/jobs');
    expect(normalizeUrl('https://a.com/')).toBe('https://a.com/');
  });
  it('returns the input when it is not a URL', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('domainOf / matchesDomain', () => {
  it('strips www', () => expect(domainOf('https://www.github.com/x')).toBe('github.com'));
  it('is empty for junk', () => expect(domainOf('???')).toBe(''));
  it('matches subdomains but not look-alikes', () => {
    expect(matchesDomain('docs.github.com', 'github.com')).toBe(true);
    expect(matchesDomain('notgithub.com', 'github.com')).toBe(false);
  });
});

describe('isTrackable', () => {
  it('accepts only http(s)', () => {
    expect(isTrackable('https://a.com')).toBe(true);
    expect(isTrackable('chrome://extensions')).toBe(false);
    expect(isTrackable(undefined)).toBe(false);
  });
});

describe('isBlocked', () => {
  const list = ['chase.com', 'bank', '  '];
  it('blocks a domain and its subdomains', () => {
    expect(isBlocked('https://secure.chase.com/login', list)).toBe(true);
  });
  it('treats a bare word as "anywhere in the hostname"', () => {
    expect(isBlocked('https://mybank.example.org', list)).toBe(true);
  });
  it('ignores blank entries and unrelated sites', () => {
    expect(isBlocked('https://github.com', list)).toBe(false);
  });
});

describe('getSearchQuery', () => {
  it('reads the query from known engines', () => {
    expect(getSearchQuery('https://www.google.com/search?q=vitest+mocks')).toBe('vitest mocks');
    expect(getSearchQuery('https://duckduckgo.com/?q=hello')).toBe('hello');
    expect(getSearchQuery('https://search.yahoo.com/search?p=news')).toBe('news');
  });
  it('is undefined for non-search pages and empty queries', () => {
    expect(getSearchQuery('https://www.google.com/maps?q=x')).toBeUndefined();
    expect(getSearchQuery('https://www.google.com/search?q=')).toBeUndefined();
  });
});
