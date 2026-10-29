import { describe, expect, it } from 'vitest';
import { classify, urlPageType } from '../../src/background/classifier';
import type { PageFeatures } from '../../src/shared/types';

const features = (o: Partial<PageFeatures> = {}): PageFeatures => ({
  formCount: 0,
  inputCount: 0,
  wordCount: 0,
  hasArticle: false,
  codeBlocks: 0,
  hasNav: false,
  videoDuration: 0,
  hasPassword: false,
  cartWords: false,
  cartEmpty: false,
  completionText: false,
  headings: [],
  ...o,
});

describe('urlPageType', () => {
  it.each([
    ['https://www.google.com/search?q=x', 'search'],
    ['https://www.youtube.com/watch?v=abc', 'video'],
    ['https://www.youtube.com/', 'feed'],
    ['https://x.com/home', 'feed'],
    ['https://www.reddit.com/r/js/comments/1/title', 'article'],
    ['https://www.reddit.com/r/js', 'feed'],
    ['https://shop.com/cart', 'cart'],
    ['https://jobs.acme.com/apply/123', 'form'],
    ['https://docs.google.com/forms/d/1/viewform', 'form'],
    ['https://react.dev/learn/thinking', 'docs'],
    ['https://developer.chrome.com/x', 'docs'],
  ])('%s → %s', (url, type) => expect(urlPageType(url)).toBe(type));

  it('is null when the URL says nothing', () => expect(urlPageType('https://acme.com/about')).toBeNull());
});

describe('classify', () => {
  it('search and feed win over page features', () => {
    expect(classify('https://www.google.com/search?q=x', features({ inputCount: 9 }))).toBe('search');
  });
  it('a small form with a password is a login page', () => {
    expect(classify('https://jobs.acme.com/apply', features({ hasPassword: true, inputCount: 2 }))).toBe('auth');
  });
  it('falls back to features when the URL is inconclusive', () => {
    expect(classify('https://a.com/x', features({ videoDuration: 600, wordCount: 100 }))).toBe('video');
    expect(classify('https://a.com/x', features({ cartWords: true }))).toBe('cart');
    expect(classify('https://a.com/x', features({ inputCount: 3, formCount: 1 }))).toBe('form');
    expect(classify('https://a.com/x', features({ codeBlocks: 4, hasNav: true }))).toBe('docs');
    expect(classify('https://a.com/x', features({ wordCount: 900 }))).toBe('article');
    expect(classify('https://a.com/x', features())).toBe('other');
  });
  it('is "other" with no URL hint and no features', () => expect(classify('https://a.com/x')).toBe('other'));
});
