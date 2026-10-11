# Shelf

A personal reading site: every book you've read, are reading and mean to read (synced from Goodreads), plus the articles, papers, newsletters and tweets you've saved. It has a built-in reader for your own EPUBs, PDFs and arXiv papers, with Claude beside the page. Search by meaning finds anything on the site.

Live at **[read.sharathchenna.com](https://read.sharathchenna.com)**. Built with Next.js 16 on Cloudflare Workers (OpenNext), with D1 for data and R2 for files. Jev (TypeSafe) ranks search results, and Claude Haiku 5.5 writes the answers.

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Get started](#get-started)
- [Configure](#configure)
- [Deploy to Cloudflare](#deploy-to-cloudflare)
- [Using the site](#using-the-site)
- [Search](#search)
- [The readers](#the-readers)
- [AI features and cost](#ai-features-and-cost)
- [Privacy and security](#privacy-and-security)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)

## What it does

**For visitors**

- **The shelf** (`/`) includes:
  - a drifting marquee of book spines in each cover's colour;
  - the Shelf Engine (an isometric machine that animates your reading);
  - stats, reading by year, insights;
  - a filterable library of covers, where each book opens a card with its details, rating and review.
- **Ask the shelf:** a question in plain words ("a slow-burn horror in a small town") ranks the books by how well they fit. A short answer explains where to start.
- **Clippings:** `/articles`, `/papers`, `/newsletters` and `/tweets`. Each kind of page appears in the top bar once it has something in it.
- **Site search** (**Search** in the top bar, or `⌘K` / `Ctrl+K` anywhere) covers books, papers, articles, newsletter issues and tweets together, ranked by meaning.
- **Locked books:** cards for books that have a file show **Read · locked**. Visitors can see that a book is readable, but not read it.

**For you (signed in)**

- **Sync** pulls your Goodreads shelves now. It also runs every night on its own.
- **Add** saves any link as a clipping: an article, an arXiv link or DOI, a newsletter issue, or a tweet.
- **Add EPUB or PDF** on any book's card.
- A **reader** for EPUBs, PDFs and arXiv papers, with:
  - themes, highlights, notes and in-book search;
  - Explain and Recap;
  - a **chat** panel that knows what you're reading.
- **Papers open in the reader.** arXiv papers become reflowing ebooks, with real equations and figures, built from arXiv's HTML version.

## How it works

```
                 Browser
                    │
        ┌───────────▼────────────┐   Cache API: visitors' page views, 60 s
        │   worker.ts (Workers)   │── cron 02:47 IST → POST /api/sync
        └───────────┬────────────┘
                    │ lazy import
        ┌───────────▼────────────┐
        │ Next.js app (OpenNext)  │
        └──┬─────────┬─────────┬──┘
           │         │         │
       D1 (SQL)  R2 (files)   APIs
       shelf,    EPUB/PDF,    Goodreads RSS, Open Library,
       clippings, covers,     arXiv, Crossref, Semantic Scholar,
       files,    extracted    X embeds, TypeSafe Jev,
       progress, text         Anthropic (Claude Haiku 5.5)
       notes
```

**Stack**

| Piece | Used for |
| --- | --- |
| Next.js 16 (App Router), React 19, Tailwind CSS 4 | The site |
| `@opennextjs/cloudflare` | Running Next.js on Cloudflare Workers |
| Cloudflare D1 | Shelf, clippings, library index, reading progress, highlights and notes (`migrations/`) |
| Cloudflare R2 (S3 API, presigned URLs) | Book files, covers, extracted text for the AI |
| foliate-js | The EPUB reader |
| pdf.js (`pdfjs-dist`, loaded at runtime from `/pdfjs`) | The PDF reader, and reading PDF text in the browser |
| jszip | Parsing uploaded EPUBs, building EPUBs from arXiv papers |
| `@typesafe-ai/sdk` (Jev) | Ranking books and site search by meaning |
| `@anthropic-ai/sdk` (Claude Haiku 5.5) | Answers, Explain, Recap, Chat |
| `jose` | The owner's signed session cookie |
| `jpeg-js` | Picking a spine colour from each cover |

## Get started

You need [Bun](https://bun.sh) and a Cloudflare account (the free plan works for browsing; see [Operations](#operations)).

```bash
bun install                                              # also copies pdf.js into public/pdfjs
bunx wrangler d1 migrations apply book-shelf --local     # creates the local database
cp .env.example .env.local                               # then fill in what you want (all optional)
bun dev
```

Open http://localhost:3000. The local database starts empty. Sign in (footer → **Sign in**, with `OWNER_PASSWORD`) and press **Sync** to pull your Goodreads shelves.

`bun dev` uses a local copy of D1 under `.wrangler/`. To run the real Workers runtime locally instead, copy `.dev.vars.example` to `.dev.vars`, fill it in and run `bun run preview`.

| Command | What it does |
| --- | --- |
| `bun dev` | Development server |
| `bun run lint` | ESLint |
| `bunx tsc --noEmit` | Type check |
| `bun run preview` | Build for Workers and run it locally with `wrangler` |
| `bun run deploy` | Build for Workers and deploy |

## Configure

### `shelf.config.ts`

| Field | Meaning |
| --- | --- |
| `owner` | Your name, shown as "*owner*'s Shelf" |
| `bio` | A line under your name, also the site description |
| `avatar` | Optional image path under `/public` (initials otherwise) |
| `links` | Links shown on your profile |
| `siteUrl` | Where the site is deployed; needed for link previews |
| `goodreadsUserId` | The number in your profile URL (`goodreads.com/user/show/49386460-…`). Keep the profile public. |

### Secrets

Each feature switches on when its keys are set. Locally they go in `.env.local` (or `.dev.vars` for `bun run preview`); in production use `bunx wrangler secret put NAME`.

| Feature | Keys |
| --- | --- |
| Ask the shelf and site search by meaning (Jev) | `TYPESAFE_API_KEY` |
| Answers under search, Explain, Recap and Chat (Claude Haiku 5.5) | `ANTHROPIC_API_KEY` |
| Signing in as the owner | `OWNER_PASSWORD`, `SESSION_SECRET` (32+ random characters, e.g. `openssl rand -base64 48`) |
| Book files in R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |

What happens when keys are missing:

- **No `TYPESAFE_API_KEY`:** both searches fall back to keyword ranking (BM25).
- **No `ANTHROPIC_API_KEY`:** the AI features answer "AI isn't configured".
- **No R2:** development stores files in `./.data`. Production refuses to serve the reader without R2 unless `ALLOW_LOCAL_STORAGE=1` is set, because a Worker has no disk.

### Cloudflare R2

1. Create a bucket and an R2 API token with **Object Read & Write** on it.
2. Browsers upload and download files straight from R2 through short-lived signed URLs, so the bucket needs a CORS rule (**Settings → CORS policy**) that lists every origin the site runs on:

   ```json
   [
     {
       "AllowedOrigins": ["https://read.example.com", "https://book-shelf.you.workers.dev", "http://localhost:3000"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

## Deploy to Cloudflare

1. **Database.** Create it, put the printed `database_id` in `wrangler.jsonc`, and create the tables:

   ```bash
   bunx wrangler login
   bunx wrangler d1 create book-shelf
   bunx wrangler d1 migrations apply book-shelf --remote
   ```

2. **R2.** Set it up as above, including the deployed origins in CORS.
3. **Secrets.** Add each one from the table:

   ```bash
   bunx wrangler secret put OWNER_PASSWORD   # then SESSION_SECRET, TYPESAFE_API_KEY, ANTHROPIC_API_KEY, R2_*
   ```

4. **Deploy:** `bun run deploy`. Alternatively, connect the GitHub repository in **Workers & Pages → your Worker → Settings → Builds**, with build command `bunx opennextjs-cloudflare build` and deploy command `bunx opennextjs-cloudflare deploy`. Every push to `main` then deploys.
5. **Domain.** Add a custom domain to the Worker if you like, set `siteUrl` in `shelf.config.ts`, and add the domain to R2's CORS.

The nightly sync is a Cron Trigger (`triggers.crons` in `wrangler.jsonc`, `17 21 * * *` UTC = 02:47 IST). Deploying registers it.

## Using the site

### Sign in

Use **Sign in** in the footer, or any locked **Read** button. Once signed in, the top bar gains **Add** and **Sync**, and the cards gain their owner controls. The session lasts 30 days. Sign out from the footer.

### Books: Goodreads sync

The site reads your *read*, *currently-reading* and *to-read* shelves from their public RSS feeds. It does this every night, and whenever you press **Sync**, which reports what changed.

- **Enrichment:** new books are looked up on Open Library for a cover, subjects, year, pages and description, and get a spine colour from the cover.
- **Books already on the shelf** keep what they had, so a sync only fetches what's new. A big first import is enriched 25 books per sync.
- **Changes follow Goodreads:** rate, review, move or remove a book there, and the shelf follows.
- **Empty feeds:** a sync never empties the shelf because of a feed that came back empty.

### Clippings: Add

Press **Add** and paste a link (or `arxiv:1706.03762`, or a DOI). Optionally pick the kind, and add a note and tags. The site reads the link, and the clipping appears straight away. Adding a link again refreshes it and keeps its saved date. Each card has **Remove** while you're signed in.

- **Articles** are described from the page's Open Graph and JSON-LD metadata: title, author, publication, excerpt, image, date and reading time.
- **Newsletters** are recognised by platform (Substack, including custom domains, beehiiv, Buttondown, Kit, Ghost and others). Pick the kind yourself to override.
- **Papers** come from several sources:
  - the arXiv API (any arXiv link or `arxiv:<id>`);
  - Crossref (any DOI);
  - the `citation_*` tags that journals and proceedings sites publish for Google Scholar (NeurIPS, ACL Anthology, PMLR, most publishers).

  Semantic Scholar fills in missing abstracts and finds the free arXiv copy of a published paper. OpenReview blocks scripts, so clip a paper's arXiv link instead.
- **Tweets** come from X's public embed endpoints and are stored as plain data: text, author, avatar, photos and likes. The site renders them itself, so no X script loads.

### Book files

Open a book's card and choose **Add EPUB or PDF**. The file uploads straight to R2 and is attached to that book.

- **Your view:** the card then shows **Read** (or **Continue · 42%**) and **Remove file**, and the cover gets a small badge.
- **Matching to books:** files are matched to books when the shelf loads, not only at upload. A book added to Goodreads after its file was uploaded picks the file up after the next sync.

### Keyboard

| Where | Keys |
| --- | --- |
| Anywhere | `⌘K` / `Ctrl+K` site search |
| Shelf | `/` focuses Ask, `R` opens a random unread book |
| Reader | `←`/`→` turn pages, `T` contents, `N` notes, `/` search, `A` settings, `C` chat, `F` fullscreen, `Esc` closes things |
| PDFs | `+` / `-` / `0` zoom in, out and fit |

## Search

The site has two searches. Both use Jev, TypeSafe's model for judging true or false questions, which returns a probability for each question.

**Ask the shelf** (the box on the home page) ranks books only:

1. **Narrowing:** shelves of up to 240 books are ranked in full. Bigger shelves are first narrowed to 120 candidates by BM25 over title, author, subjects, tags, description and review.
2. **Ranking:** Jev answers one question per book, "does this book fit what the reader asked for?". Its probability becomes the % match.
3. **Answer:** Claude Haiku writes a short note on where to start, linking the books it mentions. The results stream first, then the answer.

**Site search** (`⌘K`) covers everything:

1. **Index:** each book and clipping becomes a short card. Books contribute title, author, status, rating, subjects, description and review. Clippings contribute title, author or handle, source, excerpt or abstract, tweet text, tags and your note.
2. **Narrowing:** up to 150 items are ranked in full. More are first narrowed to 100 by keywords.
3. **Ranking:** Jev judges each card against the search, "is this something the person is looking for?". Results below 20% are hidden, unless nothing scores higher.
4. **Display:** results are grouped by kind with a match bar.
5. **Opening a result:**
   - a book opens its card on the shelf;
   - a paper, when you're signed in, opens in the reader;
   - anything else opens its source.

A search costs a fraction of a cent and returns in under a second. Both searches cache recent queries, and allow 20 (Ask) or 40 (site search) searches per minute per address.

## The readers

- **EPUBs** (foliate-js) reflow:
  - four themes: Paper, Sepia, Sage and Night;
  - fonts, text size, line spacing and column width;
  - a two-page or scrolling layout.
- **PDFs** (pdf.js) keep their pages:
  - continuous scrolling, zoom and fit-to-width;
  - the same four themes (Night inverts the page but keeps figures' colours);
  - contents from the PDF's bookmarks, and selectable text.

  The browser extracts the text when you add a PDF, so search and the AI work on PDFs too. Scanned PDFs without a text layer can only be viewed.
- **Papers.** On `/papers`, signed in, a paper with a free PDF opens in the reader, and a small link keeps the source. arXiv papers become ebooks: the browser converts arXiv's HTML version into an EPUB (`app/components/reader/arxiv-epub.ts`). The EPUB has:
  - sections as chapters, and a nested table of contents;
  - real MathML equations;
  - figures, both images and the SVG figures arXiv embeds as `<object>`s;
  - footnotes, and links between sections.

  A **PDF ↗** button opens the original. Other papers, and arXiv papers without an HTML version, open as PDFs, which the server fetches into R2. The first open takes a few seconds, and after that it's instant. The conversion is versioned (`ARXIV_EPUB_BUILD` in `lib/library-types.ts`): ebooks made by an older version are rebuilt the next time they're opened.
- **Both readers** have contents, in-book search, highlights with notes, and a scrubber with chapter ticks and minutes left in the chapter. Your position, highlights and notes are saved to D1 and follow you across devices.

## AI features and cost

All of these are owner-only, apart from the answer under Ask the shelf. They run on Claude Haiku 5.5 and stream as they're written.

- **Explain:** select a passage and choose **Explain**. In a PDF, an image of the selection goes along, so equations that text extraction garbles are still explained.
- **Recap:** **Previously…** in a book, or **Where you left off** in a paper. It's offered automatically when you return after a few days.
- **Chat:** `C`, or the speech-bubble button, opens a panel beside the page.
  - **What it reads:** a paper's whole text, but a book's only up to your page, plus your highlights.
  - **Citations:** answers cite pages and sections as links that jump there.
  - **Quoting:** select text and choose **Ask** to quote it.
  - **History:** each book keeps its conversation on your device.

**No spoilers:** for books, Explain, Recap and Chat only ever receive text from before your current position.

**Cost:** the book's text sits in a cached prompt prefix, so follow-up questions at the same position are cheap. A full-book recap costs a cent or two, and a chat message or Explain much less.

## Privacy and security

- **Locked, not hidden.** Visitors can see which books have a file, but the files themselves are owner-only, and so are your progress and notes and the reader's AI. Every route checks the signed session cookie, so purchased books are never served publicly.
- **Login.** The password is compared in constant time. Wrong passwords are answered slowly, and after 8 wrong tries in 15 minutes an address is turned away. That count lives in memory per Worker instance, so it's a speed bump: use a long password.
- **Scripts in books.** EPUBs can contain scripts. Before a chapter renders, the reader strips `<script>` tags, inline event handlers and `javascript:` links, and `/reader` sends a Content-Security-Policy that blocks scripts from anywhere else. It allows `'wasm-unsafe-eval'` for pdf.js's WebAssembly image decoders, which permits compiling WebAssembly but not JavaScript `eval`.
- **Fetching on your behalf.**
  - The paper importer only fetches the URL stored with a clipping, never one from the request.
  - The arXiv image proxy only serves files from that paper's own `arxiv.org/html/<id>` folder.
- **Rate limits and caches** live in memory per instance. That's fine for a personal site; use a shared store if you scale out.

## Operations

- **Database changes.** Schema changes are SQL files in `migrations/`. Apply them with `bunx wrangler d1 migrations apply book-shelf --remote` before deploying code that needs them. D1 keeps 30 days of point-in-time restore (`wrangler d1 time-travel`).
- **Rendering and caching.** Pages that show the shelf or clippings render per request from D1, so changes show at once.
  - For visitors, `worker.ts` keeps each page at the edge for 60 seconds, and answers those hits before the site's bundle loads, which keeps cold starts cheap.
  - The signed-in owner always gets a fresh render.
  - Cache Components (partial prerendering) is off: OpenNext on Workers serves a partially prerendered page's static shell without resuming its dynamic part.
- **Plans.** The Worker (about 14 MB) fits the free plan's size limit. Free plans allow 10 ms of CPU per request, which covers browsing and search: a page is a few small D1 queries and a render, and AI calls spend their time waiting rather than computing. Parsing an uploaded EPUB can need more, which needs the Workers Paid plan. PDFs are read in the browser and cost the Worker almost nothing.
- **pdf.js** is copied from `node_modules` to `public/pdfjs` on install (`scripts/copy-pdfjs.ts`) and loaded at runtime, so it's in neither the client bundle nor the Worker.
- **Adapter patch.** `patches/@opennextjs%2Fcloudflare@1.20.10.patch` adds Next 16.4's `preview-props.json` to the manifests OpenNext bundles ([opennextjs-cloudflare#1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355)). Remove it, and the `patchedDependencies` entry in `package.json`, once a release includes the fix.
- **`proxy.ts`** runs on OpenNext's Node.js middleware support, which OpenNext labels experimental. It only does an optimistic redirect from `/reader/<id>` to `/login`. The real check happens in every reader page and API route, so the site stays protected if it misbehaves.
- **Types.** Cloudflare bindings are typed by hand in `types/cloudflare.d.ts`. The generated `cloudflare-env.d.ts` (`bun run cf-typegen`) clashes with the DOM types, so it's excluded from the type check.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "Storage refused the upload" / "Upload failed" | The site's origin is missing from the R2 bucket's CORS rule, or the R2 keys are wrong. R2's error replies carry no CORS headers, so any rejection looks like a network error. |
| Shelf is empty after deploying | The production database starts empty: sign in and press **Sync**. Check the Goodreads profile is public and `goodreadsUserId` is set. |
| Search results say "Keyword matches" | `TYPESAFE_API_KEY` isn't set where the site runs. |
| AI features say "AI isn't configured" | `ANTHROPIC_API_KEY` isn't set. |
| A paper opens as a PDF instead of an ebook | It has no HTML version on arXiv (some older or very large papers). |
| A figure is missing from a paper ebook | Check the paper on arxiv.org/html: if arXiv's own page shows no image, its LaTeX conversion dropped it, and **PDF ↗** has it. |
| Local changes don't show in `bun dev` | Restart the dev server; if it still serves an old page, check with `bun run preview`. |

## Project layout

| Path | What it is |
| --- | --- |
| `app/page.tsx` | The shelf: spine marquee, Ask, Shelf Engine, profile, stats, insights, library |
| `app/components/engine/` | The Shelf Engine animation |
| `app/{articles,papers,newsletters,tweets}/`, `app/components/clippings.tsx`, `clip-page.tsx` | The clipping pages |
| `app/components/top-bar.tsx`, `footer.tsx`, `logo.tsx`, `app/icon.svg`, `favicon.ico`, `apple-icon.png` | Site chrome and the logo |
| `migrations/`, `lib/db.ts`, `lib/data.ts`, `lib/library.ts` | D1: schema, shelf, clippings, files, progress and notes |
| `lib/sync.ts`, `lib/goodreads.ts`, `lib/categories.ts`, `app/api/sync/` | Goodreads sync (RSS → Open Library → D1) |
| `lib/clip.ts`, `app/api/clips/`, `app/components/add-clip.tsx` | Adding clippings from the site |
| `app/api/ask/`, `lib/ai/jev.ts`, `lib/ai/haiku.ts`, `lib/search/bm25.ts` | Ask the shelf |
| `app/api/search/`, `lib/search/site.ts`, `app/components/search-palette.tsx` | Site search |
| `lib/auth/session.ts`, `proxy.ts`, `app/login/` | Owner login |
| `lib/storage.ts`, `lib/epub/parse.ts`, `app/api/books/` | Book files (R2), EPUB parsing, PDF finalize, paper import and the arXiv proxies |
| `app/components/book-file.tsx` | A book card's Add / Read / Read · locked / Remove file |
| `app/reader/`, `app/components/reader/` | The readers: EPUB (foliate-js), PDF (pdf.js), arXiv-to-EPUB, panels, chat |
| `app/api/reader/`, `lib/ai/reader.ts` | Explain, Recap and Chat |
| `worker.ts`, `wrangler.jsonc`, `open-next.config.ts`, `patches/` | Cloudflare Workers deployment: edge cache, nightly sync |
| `shelf.config.ts` | Your name, bio, links, site URL and Goodreads id |
