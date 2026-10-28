import type { PageFeatures, PageType } from '../shared/types';
import { domainOf, getSearchQuery, matchesDomain } from '../shared/url';

const ALWAYS_FEED = ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'threads.net', 'bsky.app'];

/** Stage 1a: what the URL alone tells us. Returns null when the URL is inconclusive. */
export function urlPageType(url: string): PageType | null {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  const host = domainOf(url);

  if (getSearchQuery(url)) return 'search';
  if (matchesDomain(host, 'youtube.com')) return path.startsWith('/watch') ? 'video' : 'feed';
  if (ALWAYS_FEED.some((d) => matchesDomain(host, d))) return 'feed';
  if (matchesDomain(host, 'reddit.com')) return path.includes('/comments/') ? 'article' : 'feed';
  if (matchesDomain(host, 'linkedin.com') && (path === '/' || path.startsWith('/feed'))) return 'feed';
  if (host === 'news.ycombinator.com' && !path.startsWith('/item')) return 'feed';

  if (/(^|\/)(cart|basket|checkout|bag)(\/|$)/.test(path)) return 'cart';
  if (
    /(^|\/|-)(apply|application|applications|signup|sign-up|register|registration|onboarding|survey|forms?)(\/|$|-)/.test(path) ||
    matchesDomain(host, 'typeform.com') ||
    matchesDomain(host, 'forms.gle') ||
    (host === 'docs.google.com' && path.startsWith('/forms'))
  ) {
    return 'form';
  }
  if (
    /(^|\/)(docs?|documentation|guides?|tutorials?|getting-started|quickstart|quick-start|reference|learn|manual|handbook)(\/|$)/.test(path) ||
    /^(docs?|developers?|learn)\./.test(host)
  ) {
    return 'docs';
  }
  return null;
}

/** Stage 1b: URL + page features. */
export function classify(url: string, f?: PageFeatures): PageType {
  const byUrl = urlPageType(url);
  if (byUrl === 'search' || byUrl === 'feed') return byUrl;
  if (f?.hasPassword && f.inputCount <= 3) return 'auth';
  if (byUrl) return byUrl;
  if (!f) return 'other';

  if (f.videoDuration > 120 && f.wordCount < 1500) return 'video';
  if (f.cartWords) return 'cart';
  if ((f.inputCount >= 3 && f.formCount >= 1) || f.inputCount >= 5) return 'form';
  if (f.codeBlocks >= 3 && f.hasNav) return 'docs';
  if (f.hasArticle || f.wordCount >= 600) return 'article';
  return 'other';
}

/** Page types that never become tasks on their own. */
export const IGNORED_TYPES: ReadonlySet<PageType> = new Set(['search', 'feed', 'auth']);
