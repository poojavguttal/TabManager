// Labeled evaluation set: realistic situations, each with the answer a person would expect.
// `expect` is what should appear in the panel (or null = nothing should appear).
// Labels are written from what a user would want, NOT from what the code currently does —
// a case the engine gets wrong stays here as a known miss. Add a case for every bug you find.
import type { PageFeatures, PageSignals, RuleId } from '../../src/shared/types';

export interface EvalCase {
  id: string;
  /** What happened, in plain words. */
  story: string;
  url: string;
  title: string;
  features?: Partial<PageFeatures>;
  signals?: Partial<PageSignals>;
  activeSec: number;
  awayMin: number;
  closed?: boolean;
  /** Messaging tabs: the tab title when first seen, and now (unread counts are read from titles). */
  unread?: { before: string; now: string };
  expect: RuleId | null;
  /** Expected short status, when something should appear. */
  note?: string;
}

const article = { wordCount: 2400, hasArticle: true, headings: ['Intro', 'Setup', 'Results'] };
const docs = { wordCount: 1800, codeBlocks: 6, hasNav: true };
const form = { formCount: 1, inputCount: 9 };

export const CASES: EvalCase[] = [
  // ---- Forms ----
  { id: 'form-job-half', story: 'Filled 4 of 9 fields on a job application, switched tabs', url: 'https://jobs.lever.co/acme/123/apply', title: 'Acme – Senior Engineer Application', features: form, signals: { fieldsFilled: 4, fieldsTotal: 9 }, activeSec: 240, awayMin: 30, expect: 'abandoned_form', note: 'Form not complete' },
  { id: 'form-job-closed', story: 'Half-filled application, closed the tab', url: 'https://boards.greenhouse.io/acme/jobs/5/application', title: 'Job Application for Designer at Acme', features: form, signals: { fieldsFilled: 3, fieldsTotal: 12 }, activeSec: 180, awayMin: 1, closed: true, expect: 'abandoned_form', note: 'Form not complete' },
  { id: 'form-survey', story: 'Started a survey, answered 5 questions, left for an hour', url: 'https://acme.typeform.com/to/abc', title: 'Customer survey', features: { formCount: 1, inputCount: 6 }, signals: { fieldsFilled: 5, fieldsTotal: 12 }, activeSec: 150, awayMin: 60, expect: 'abandoned_form', note: 'Form not complete' },
  { id: 'form-gform-old', story: 'Google Form half done 3 days ago', url: 'https://docs.google.com/forms/d/e/1/viewform', title: 'Event registration', features: form, signals: { fieldsFilled: 3, fieldsTotal: 8 }, activeSec: 200, awayMin: 3 * 1440, expect: 'abandoned_form', note: 'Form not complete' },
  { id: 'form-submitted', story: 'Filled and submitted an application', url: 'https://jobs.lever.co/acme/123/apply', title: 'Acme – Application', features: form, signals: { fieldsFilled: 9, fieldsTotal: 9, submitted: true }, activeSec: 400, awayMin: 20, expect: null },
  { id: 'form-confirmed', story: 'Application went through, confirmation page seen', url: 'https://jobs.acme.com/apply/thanks', title: 'Thank you for applying', signals: { completed: true, fieldsFilled: 6, fieldsTotal: 6 }, activeSec: 300, awayMin: 20, expect: null },
  { id: 'form-one-field', story: 'Typed only an email into a newsletter box', url: 'https://blog.example.com/post', title: 'Some post', features: { formCount: 1, inputCount: 1, wordCount: 300 }, signals: { fieldsFilled: 1, fieldsTotal: 1 }, activeSec: 40, awayMin: 30, expect: null },
  { id: 'form-just-left', story: 'Half-filled form, switched tabs 30 seconds ago', url: 'https://jobs.lever.co/acme/9/apply', title: 'Acme – Application', features: form, signals: { fieldsFilled: 4, fieldsTotal: 9 }, activeSec: 200, awayMin: 0.5, expect: null },
  { id: 'form-login', story: 'Typed username + password on a login page and left', url: 'https://app.example.com/login', title: 'Sign in', features: { formCount: 1, inputCount: 2, hasPassword: true }, signals: { fieldsFilled: 2, fieldsTotal: 2 }, activeSec: 20, awayMin: 30, expect: null },
  { id: 'form-search-page', story: 'Used filters on a Google search results page', url: 'https://www.google.com/search?q=flights+to+goa', title: 'flights to goa - Google Search', signals: { fieldsFilled: 3, fieldsTotal: 5 }, activeSec: 90, awayMin: 30, expect: null },
  { id: 'form-gdocs-editor', story: 'Edited a Google Doc (autosaves) and left', url: 'https://docs.google.com/document/d/1/edit', title: 'Notes - Google Docs', signals: { fieldsFilled: 2, fieldsTotal: 2, draft: 'long' }, activeSec: 600, awayMin: 30, expect: null },

  // ---- Drafts ----
  { id: 'draft-comment', story: 'Wrote a long comment on a forum, never posted', url: 'https://forum.example.com/t/topic/42', title: 'Topic about caching - Example Forum', features: { wordCount: 900, hasArticle: true, inputCount: 1 }, signals: { draft: 'long', scrollMax: 90 }, activeSec: 200, awayMin: 15, expect: 'unsent_draft', note: 'Draft not sent' },
  { id: 'draft-github-review', story: 'Typed a long PR review comment, did not submit', url: 'https://github.com/acme/app/pull/12/files', title: 'Fix login by dev · Pull Request #12 · acme/app', signals: { draft: 'long' }, activeSec: 300, awayMin: 25, expect: 'unsent_draft', note: 'Draft not sent' },
  { id: 'draft-short', story: 'Typed "ok" in a comment box and left', url: 'https://forum.example.com/t/topic/43', title: 'Another topic', signals: { draft: 'short' }, activeSec: 60, awayMin: 15, expect: null },
  { id: 'draft-notion', story: 'Wrote notes in Notion (autosaves)', url: 'https://www.notion.so/acme/Plan-123', title: 'Plan', signals: { draft: 'long' }, activeSec: 400, awayMin: 30, expect: null },

  // ---- Checkout ----
  { id: 'cart-address', story: 'Entered shipping address at checkout, left', url: 'https://shop.example.com/checkout', title: 'Checkout – Example Shop', signals: { fieldsFilled: 4, fieldsTotal: 10 }, activeSec: 120, awayMin: 20, expect: 'unfinished_checkout', note: 'Checkout not complete' },
  { id: 'cart-browse', story: 'Looked at the cart for a minute, left', url: 'https://www.example-store.com/cart', title: 'Your cart', activeSec: 60, awayMin: 45, expect: 'unfinished_checkout', note: 'Checkout not complete' },
  // Product decision: anything left in a cart shows, however briefly you looked.
  { id: 'cart-glance', story: 'Opened a cart with items for 5 seconds, left', url: 'https://www.example-store.com/cart', title: 'Your cart', features: { cartWords: true, wordCount: 300 }, activeSec: 5, awayMin: 45, expect: 'unfinished_checkout', note: 'Checkout not complete' },
  { id: 'cart-empty', story: 'Opened the cart, it said "Your cart is empty"', url: 'https://www.example-store.com/cart', title: 'Your cart', features: { cartEmpty: true, wordCount: 120 }, activeSec: 10, awayMin: 45, expect: null },
  { id: 'cart-product-page', story: 'Looked at a product page with an "Add to cart" button', url: 'https://www.example-store.com/p/blue-shoes', title: 'Blue shoes – Example Store', features: { wordCount: 400, hasNav: true }, activeSec: 90, awayMin: 45, expect: null },
  { id: 'cart-ordered', story: 'Placed the order, saw the confirmation', url: 'https://shop.example.com/checkout/thank-you', title: 'Order confirmed', signals: { completed: true }, activeSec: 120, awayMin: 20, expect: null },

  // ---- Reading ----
  { id: 'read-article-half', story: 'Read 40% of a long article', url: 'https://blog.example.com/how-we-scaled', title: 'How we scaled to 1M users | Example Blog', features: article, signals: { scrollMax: 40, lastHeading: 'Setup' }, activeSec: 240, awayMin: 30, expect: 'partial_reading', note: 'Stopped partway through' },
  { id: 'read-docs-setup', story: 'Halfway through a setup guide', url: 'https://react.dev/learn/installation', title: 'Installation – React', features: docs, signals: { scrollMax: 50, lastHeading: 'Add React to a project' }, activeSec: 300, awayMin: 40, expect: 'partial_reading', note: 'Setup not finished' },
  { id: 'read-finished', story: 'Read an article to the end', url: 'https://blog.example.com/done', title: 'Finished post', features: article, signals: { scrollMax: 98 }, activeSec: 400, awayMin: 30, expect: null },
  { id: 'read-skim-top', story: 'Opened an article, read the intro only', url: 'https://blog.example.com/skim', title: 'Skimmed post', features: article, signals: { scrollMax: 8 }, activeSec: 50, awayMin: 30, expect: null },
  { id: 'read-quick-glance', story: 'Scrolled an article for 15 seconds', url: 'https://news.example.com/story', title: 'Breaking story', features: article, signals: { scrollMax: 50 }, activeSec: 15, awayMin: 30, expect: null },
  { id: 'read-feed', story: 'Scrolled the Reddit front page', url: 'https://www.reddit.com/', title: 'Reddit', signals: { scrollMax: 50 }, activeSec: 600, awayMin: 30, expect: null },
  { id: 'read-twitter', story: 'Scrolled X for 10 minutes', url: 'https://x.com/home', title: 'Home / X', signals: { scrollMax: 60 }, activeSec: 600, awayMin: 30, expect: null },
  { id: 'read-reddit-thread', story: 'Read half of a long Reddit thread', url: 'https://www.reddit.com/r/programming/comments/abc/some_title', title: 'Some title : r/programming', signals: { scrollMax: 45 }, activeSec: 180, awayMin: 30, expect: 'partial_reading', note: 'Stopped partway through' },
  { id: 'read-landing', story: 'Short company landing page, scrolled halfway', url: 'https://acme.com/', title: 'Acme – We build things', features: { wordCount: 250, hasNav: true }, signals: { scrollMax: 50 }, activeSec: 60, awayMin: 30, expect: null },

  // ---- Video ----
  { id: 'video-half', story: 'Watched 12 of 30 minutes of a talk, came back 25 min later', url: 'https://www.youtube.com/watch?v=abc', title: 'Conference talk - YouTube', signals: { videoPct: 40, videoDuration: 1800 }, activeSec: 40, awayMin: 25, expect: 'partial_video', note: 'Stopped partway through' },
  { id: 'video-too-soon', story: 'Paused a video 10 minutes ago', url: 'https://www.youtube.com/watch?v=def', title: 'Tutorial - YouTube', signals: { videoPct: 40, videoDuration: 1800 }, activeSec: 40, awayMin: 10, expect: null },
  { id: 'video-finished', story: 'Watched to the end', url: 'https://www.youtube.com/watch?v=ghi', title: 'Music video - YouTube', signals: { videoPct: 97, videoDuration: 240 }, activeSec: 30, awayMin: 30, expect: null },
  { id: 'video-few-seconds', story: 'Watched the first 5% of a long video', url: 'https://www.youtube.com/watch?v=jkl', title: 'Long video - YouTube', signals: { videoPct: 5, videoDuration: 3600 }, activeSec: 20, awayMin: 30, expect: null },
  { id: 'video-short-clip', story: 'Half of a 90 second clip', url: 'https://www.youtube.com/watch?v=mno', title: 'Short clip - YouTube', signals: { videoPct: 50, videoDuration: 90 }, activeSec: 45, awayMin: 30, expect: null },
  { id: 'video-course', story: 'Course video on another site, 60% watched', url: 'https://learn.example.com/course/1/lesson/4', title: 'Lesson 4: Hooks', features: { videoDuration: 1500, wordCount: 200 }, signals: { videoPct: 60, videoDuration: 1500 }, activeSec: 100, awayMin: 30, expect: 'partial_video', note: 'Stopped partway through' },

  // ---- Messaging ----
  { id: 'msg-teams-draft', story: 'Typed a reply in Teams, did not send', url: 'https://teams.microsoft.com/v2/', title: 'Chat | Microsoft Teams', signals: { draft: 'short' }, activeSec: 20, awayMin: 3, expect: 'unsent_message', note: 'Message not sent' },
  { id: 'msg-whatsapp-draft', story: 'Typed a WhatsApp message, closed the tab', url: 'https://web.whatsapp.com/', title: 'WhatsApp', signals: { draft: 'long' }, activeSec: 30, awayMin: 1, closed: true, expect: 'unsent_message', note: 'Message not sent' },
  { id: 'msg-slack-read', story: 'Read Slack for 20 minutes, nothing typed', url: 'https://app.slack.com/client/T1/C1', title: 'general - Acme - Slack', signals: { scrollMax: 50 }, activeSec: 1200, awayMin: 30, expect: null },
  { id: 'msg-whatsapp-new', story: 'Two new WhatsApp messages arrived while away', url: 'https://web.whatsapp.com/', title: '(2) WhatsApp', unread: { before: 'WhatsApp', now: '(2) WhatsApp' }, activeSec: 0, awayMin: 10, expect: 'new_messages', note: 'New messages' },
  { id: 'msg-gmail-new', story: 'New email arrived in Gmail', url: 'https://mail.google.com/mail/u/0/#inbox', title: 'Inbox (4) - me@gmail.com - Gmail', unread: { before: 'Inbox (3) - me@gmail.com - Gmail', now: 'Inbox (4) - me@gmail.com - Gmail' }, activeSec: 0, awayMin: 10, expect: 'new_messages', note: 'New emails' },
  { id: 'msg-gmail-old-unread', story: 'Gmail with 2,000 old unread, nothing new', url: 'https://mail.google.com/mail/u/0/#inbox', title: 'Inbox (2,000) - me@gmail.com - Gmail', unread: { before: 'Inbox (2,000) - me@gmail.com - Gmail', now: 'Inbox (2,000) - me@gmail.com - Gmail' }, activeSec: 0, awayMin: 10, expect: null },
  { id: 'msg-gmail-reading', story: 'Reading an email (title shows the subject, no count)', url: 'https://mail.google.com/mail/u/0/#inbox/abc', title: 'Re: Offer - me@gmail.com - Gmail', unread: { before: 'Inbox (3) - me@gmail.com - Gmail', now: 'Re: Offer - me@gmail.com - Gmail' }, activeSec: 0, awayMin: 10, expect: null },
];
