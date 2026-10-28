const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|dclid$|msclkid$|mc_|igshid$|ref$|ref_|si$|spm$|_hs|yclid$)/i;

export function isTrackable(url: string | undefined): url is string {
  return !!url && /^https?:\/\//.test(url);
}

/** Drops the fragment and tracking params so the same page maps to the same task key. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : u.pathname;
    return `${u.origin}${path}${u.search}`;
  } catch {
    return raw;
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Entries with a dot are domains (subdomains included); bare words match anywhere in the hostname. */
export function isBlocked(url: string, blocklist: string[]): boolean {
  const host = domainOf(url);
  return blocklist.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    return entry.includes('.') ? matchesDomain(host, entry) : host.includes(entry);
  });
}

const SEARCH_ENGINES: { host: RegExp; path: RegExp; param: string }[] = [
  { host: /(^|\.)google\.[a-z.]+$/, path: /^\/search/, param: 'q' },
  { host: /(^|\.)bing\.com$/, path: /^\/search/, param: 'q' },
  { host: /(^|\.)duckduckgo\.com$/, path: /^\/$/, param: 'q' },
  { host: /(^|\.)search\.brave\.com$/, path: /^\/search/, param: 'q' },
  { host: /(^|\.)ecosia\.org$/, path: /^\/search/, param: 'q' },
  { host: /(^|\.)search\.yahoo\.com$/, path: /^\/search/, param: 'p' },
  { host: /(^|\.)perplexity\.ai$/, path: /^\/search/, param: 'q' },
];

export function getSearchQuery(url: string): string | undefined {
  try {
    const u = new URL(url);
    const engine = SEARCH_ENGINES.find((e) => e.host.test(u.hostname) && e.path.test(u.pathname));
    const q = engine && u.searchParams.get(engine.param)?.trim();
    return q || undefined;
  } catch {
    return undefined;
  }
}
