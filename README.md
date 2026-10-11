# Shelf

A personal bookshelf site: every book you've read, are reading, and mean to read, built from a Goodreads export. Visitors can **ask the shelf** questions in plain language. Books can carry their own EPUB or PDF: anyone sees which ones, and reading asks for your password.

Everything is managed from the site itself: sign in (footer → **Sign in**) and the top bar gains **Add** and **Sync**. The shelf, clippings, and your reading progress and notes live in a Cloudflare D1 database; book files live in R2.

## Your books

The shelf syncs from Goodreads. Put the number from your profile URL (`goodreads.com/user/show/49386460-…`) in `shelf.config.ts` as `goodreadsUserId` and keep the profile public. The site reads your read, currently-reading and to-read shelves from their RSS feeds:

- **Nightly**, at 02:47 IST (a Cron Trigger on the Worker; see `worker.ts`).
- **Whenever you press Sync** in the top bar. It shows what changed (books added, updated, removed) and the page updates at once.

New books are looked up on Open Library for their cover, subjects, year, pages and description, and get a spine colour from the cover. Books already on the shelf keep what they had, so a sync only fetches what's new; a large first import is looked up 25 books per sync. Rate, review or move a book on Goodreads and the shelf follows.

Edit your name, bio, avatar and links in `shelf.config.ts`.

## Articles, papers, newsletters and tweets

The home page is only books. Things read on the web get their own pages: **/articles**, **/papers**, **/newsletters** and **/tweets**, each linked from the top bar once it has something in it.

Press **Add**, paste a link (or `arxiv:1706.03762`, or a DOI), and optionally pick the kind and add a note and tags. The site reads the link and the clipping appears straight away. Clipping a link again refreshes it, keeping its saved date. Each card has a remove button while you're signed in.

- **Articles** are described from the page's Open Graph and JSON-LD metadata: title, author, publication, excerpt, image, date and reading time.
- **Newsletters** are recognised by platform: Substack (including custom domains), beehiiv, Buttondown, Kit, Ghost and a few others. Pick the kind yourself to override.
- **Papers** come from the arXiv API (any arXiv link or `arxiv:<id>`), Crossref (any DOI), or the `citation_*` tags that journals and proceedings sites (NeurIPS, ACL Anthology, PMLR, most publishers) publish for Google Scholar. Semantic Scholar fills in a missing abstract and finds the free arXiv copy of a journal or conference paper. OpenReview blocks scripts, so clip a paper's arXiv link instead.
- **Tweets** come from X's public embed endpoints and are stored as plain data (text, author, avatar, photos, likes). The site renders them itself, so no X script loads.

## Configure

Copy `.env.example` to `.env.local`. Each feature turns on when its keys are set:

| Feature | Keys |
| --- | --- |
| Ask the shelf, and search the whole site by meaning (Jev ranks) | `TYPESAFE_API_KEY` |
| Short answers, and explain/recap in the reader (Claude Haiku 5.5) | `ANTHROPIC_API_KEY` |
| Reading books on the shelf (password) | `OWNER_PASSWORD`, `SESSION_SECRET` (32+ random characters) |
| Book and PDF storage in Cloudflare R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |

Without `TYPESAFE_API_KEY`, the search box and the site search fall back to keyword search. Without R2, development stores books in `./.data`. Production refuses to start the reader without R2 unless you set `ALLOW_LOCAL_STORAGE=1`.

### Cloudflare R2

1. Create a bucket and an R2 API token with **Object Read & Write** on it.
2. Browsers upload and download books directly from R2 through short-lived signed URLs, so add a CORS rule to the bucket (**Settings → CORS policy**):

   ```json
   [
     {
       "AllowedOrigins": ["https://your-site.example", "http://localhost:3000"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

## Reading books on the shelf

Every book's card can carry its own EPUB or PDF. Sign in with **Sign in** in the footer (or any locked **Read** button), then:

- Open a book's card and choose **Add EPUB or PDF**. It uploads straight to R2, attached to that book. The card then shows **Read** (or **Continue · 42%**) and **Remove file**, and the cover gets a small book badge.
- Visitors see **Read · locked** on those cards. It asks for the password inside the card, then opens the book. Your progress, highlights and notes are never shown to them.
- A file is matched to its book when the shelf loads, not only at upload: a book added to Goodreads after its file was uploaded picks the file up after the next sync.
- EPUBs reflow: themes (Paper, Sepia, Sage, Night), fonts, text size, spacing, column width, two-page or scrolling layout.
- PDFs keep their pages (pdf.js): continuous scrolling, zoom and fit-to-width, the same four themes (Night inverts the page and keeps figures' colours), contents from the PDF's bookmarks, and selectable text. The browser reads the text when you add one, so search, Explain and recap work on PDFs too; scanned PDFs without a text layer can only be viewed.
- **Papers:** on `/papers`, signed in, clicking a paper with a free PDF opens it here (a small link keeps the source). arXiv papers become **ebooks**: the browser builds an EPUB from arXiv's HTML version (sections as chapters, real MathML equations, figures, footnotes, links between them; `app/components/reader/arxiv-epub.ts`), so they read like books, with a **PDF ↗** button for the original. Papers without an HTML version, and other papers, open as PDFs (the server fetches the PDF into R2). The first open takes a few seconds; after that it's instant.
- **Chat** (`C`, or the speech-bubble button): a panel on the right for asking Claude about what you're reading. It has a paper's whole text, but a book's only up to your page (no spoilers), plus your highlights; the text is cached between messages. Answers cite pages and sections as links that jump there. Select a passage and choose **Ask** to quote it (in a PDF, with an image of it). Each book keeps its conversation on your device.
- Both readers have contents, in-book search, and highlights with notes. Your position, highlights and notes sync to R2.
- Select a passage and choose **Explain**, or use the recap button (**Previously…**, or **Where you left off** in a paper). When you come back after a few days, a recap is offered. In a PDF, Explain also sends Claude an image of the selection, so equations and symbols that text extraction garbles still get explained.

**Keyboard:** ←/→ turn pages, `T` contents, `N` notes, `/` search, `A` settings (theme and zoom in PDFs), `+`/`-`/`0` zoom in, out and fit (PDFs), `F` fullscreen, `Esc` closes things. On the shelf, `/` focuses search and `R` opens a random unread book. Anywhere on the site, `⌘K` (or Ctrl+K) opens site search.

### Privacy and safety

- **Locked, not hidden.** Visitors can see which books have a file to read, but the files, your notes and progress, and the reader's AI features are owner-only: every route checks your signed session cookie, so purchased books are never served publicly.
- **Password guessing.** Wrong passwords are answered slowly, and after 8 wrong tries in 15 minutes an address is turned away. That count lives in memory per Worker instance, so it's a speed bump; use a long password.
- **No spoilers.** Explain and recap only send the model text from *before* your current position.
- **pdf.js** is copied from `node_modules` to `public/pdfjs` on install (`scripts/copy-pdfjs.ts`) and loaded from there at runtime, so it's in neither the client bundle nor the Worker. `/reader` allows `'wasm-unsafe-eval'` for its WebAssembly image decoders, which permits compiling WebAssembly but not JavaScript `eval`.
- **Scripts in EPUBs.** EPUBs can contain scripts. Before a chapter renders, the reader strips `<script>`, inline event handlers and `javascript:` links, and `/reader` sends a Content-Security-Policy that blocks scripts from anywhere else.
- **Rate limits.** The rate limit and result cache on `/api/ask` are kept in memory per server instance. That's fine for a personal site, but use a shared store if you scale out.

## Develop

```bash
bun install
bunx wrangler d1 migrations apply book-shelf --local   # once, and after adding a migration
bun dev
```

`bun dev` uses a local copy of the D1 database (under `.wrangler/`), so it starts empty: sign in and press **Sync**.

## Deploy to Cloudflare Workers

The site runs on Workers through [OpenNext](https://opennext.js.org/cloudflare) (`@opennextjs/cloudflare`).

1. Create the database and its tables, and put the printed `database_id` in `wrangler.jsonc`:

   ```bash
   bunx wrangler d1 create book-shelf
   bunx wrangler d1 migrations apply book-shelf --remote
   ```

2. Set up R2 as above: a Worker has no disk, so the reader needs it. Add your Worker's URL (for example `https://book-shelf.<you>.workers.dev`, or your custom domain) to the bucket's CORS `AllowedOrigins`.
3. Sign in and add the secrets from the table above, one at a time:

   ```bash
   bunx wrangler login
   bunx wrangler secret put OWNER_PASSWORD   # then SESSION_SECRET, TYPESAFE_API_KEY, ANTHROPIC_API_KEY, R2_*
   ```

4. Deploy:

   ```bash
   bun run deploy
   ```

5. Set `siteUrl` in `shelf.config.ts` to the deployed URL, so link previews work, then deploy again.

To run the real Workers runtime locally first, copy `.dev.vars.example` to `.dev.vars`, fill it in, and run `bun run preview`.

Notes:

- **Database changes.** Schema changes are SQL files in `migrations/`; apply them with `bunx wrangler d1 migrations apply book-shelf --remote` before deploying code that needs them. D1 keeps 30 days of point-in-time restore (`wrangler d1 time-travel`).
- **Rendering.** Pages that show the shelf or clippings render per request from D1, so changes show at once. For visitors, `worker.ts` keeps each page at the edge for 60 seconds (the signed-in owner always gets a fresh render), and answers those hits before the site's bundle loads, which keeps cold starts cheap. Cache Components (partial prerendering) is off: OpenNext on Workers serves a partially prerendered page's static shell without resuming its dynamic part.
- **Plans.** The worker (about 14 MB) fits the free plan's size limit. Free plans allow 10 ms of CPU per request, which covers browsing and search: a page is a few small D1 queries and a render, and AI calls spend their time waiting, not computing. Parsing an uploaded EPUB can need more, which needs the Workers Paid plan. PDFs are read in the browser, so they cost the Worker almost nothing.
- **Adapter patch.** `patches/@opennextjs%2Fcloudflare@1.20.10.patch` adds Next 16.4's new `preview-props.json` to the manifests OpenNext bundles ([opennextjs-cloudflare#1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355)). Remove it, and the `patchedDependencies` entry in `package.json`, once a release includes the fix.
- **`proxy.ts`** runs on OpenNext's Node.js middleware support, which it labels experimental. It only does the optimistic redirect from a book (`/reader/<id>`) to `/login`; the real check happens in every reader page and API route, so the site stays protected if it misbehaves.

## Layout

| Path | What it is |
| --- | --- |
| `migrations/`, `lib/db.ts`, `lib/data.ts`, `lib/library.ts` | The D1 database: schema, and the shelf, clippings, files, progress and notes |
| `lib/sync.ts`, `lib/goodreads.ts`, `lib/categories.ts`, `app/api/sync/` | Goodreads sync (RSS → Open Library → D1), keyword categories |
| `lib/clip.ts`, `app/api/clips/`, `app/components/add-clip.tsx` | Clipping links from the site |
| `app/components/clippings.tsx`, `app/components/clip-page.tsx`, `app/{articles,papers,newsletters,tweets}/` | The clipping pages |
| `worker.ts`, `wrangler.jsonc`, `open-next.config.ts`, `patches/` | Cloudflare Workers deployment (OpenNext), with the nightly sync |
| `app/components/engine/` | The Shelf Engine: the isometric machine animation on the main page |
| `app/page.tsx` | The shelf: spine marquee, ask box, Shelf Engine, profile, stats, insights, library |
| `app/api/ask/route.ts`, `lib/ai/jev.ts`, `lib/ai/haiku.ts` | Ask the shelf: BM25 pre-filter → Jev ranking → streamed Haiku answer |
| `app/api/search/route.ts`, `lib/search/site.ts`, `app/components/search-palette.tsx` | Site search (Search in the top bar, `⌘K`): books, papers, articles, newsletters and tweets, ranked by Jev |
| `lib/auth/session.ts`, `proxy.ts`, `app/login/` | Owner login (signed JWT cookie) |
| `lib/storage.ts`, `lib/library.ts`, `lib/epub/parse.ts`, `app/api/books/` | Book files (R2 or local), EPUB parsing, PDF finalize and paper import |
| `app/components/book-file.tsx` | A book card's Add / Read / Read · locked / Remove file |
| `app/reader/`, `app/components/reader/` | The readers: EPUBs (foliate-js), PDFs (pdf.js, `pdf-reader-view.tsx`, `pdf.ts`), panels and AI cards |
| `app/api/reader/`, `lib/ai/reader.ts`, `app/components/reader/chat-panel.tsx` | Explain, recap and chat (a book's text only up to the reader's position) |
