# Shelf

A personal bookshelf site: every book you've read, are reading, and mean to read, built from a Goodreads export. Visitors can **ask the shelf** questions in plain language. You also get a private **reading room** for your own EPUBs, PDFs and papers.

## Add your books

The shelf syncs from Goodreads. Put the number from your profile URL (`goodreads.com/user/show/49386460-…`) in `shelf.config.ts` as `goodreadsUserId`, keep the profile public, and run:

```bash
bun run import             # read, currently-reading and to-read, from your shelves' RSS feeds
bun run import --refresh   # also look up every book again, not just new ones
bun run import path/to.csv # or a Goodreads "Export Library" CSV instead
```

New books are looked up on Open Library for their cover, subjects, year, pages and description, and get a spine colour from the cover. Books already on the shelf keep what they had, so a sync only fetches what's new. `data/shelf.json` is only rewritten when something changed.

**Nightly sync.** `.github/workflows/goodreads-sync.yml` runs the import every night, commits `data/shelf.json` when it changed, and the push to `main` redeploys the site. Run it by hand from the repo's **Actions** tab (**Goodreads sync → Run workflow**) after logging a book. Rate, review or move a book on Goodreads and the shelf follows.

Edit your name, bio, avatar and links in `shelf.config.ts`.

## Add articles, papers, newsletters and tweets

The home page is only books. Things read on the web get their own pages: **/articles**, **/papers**, **/newsletters** and **/tweets**, each linked from the top bar once it has something in it. Add one by URL:

```bash
bun run clip https://example.com/some-essay --note "Why it's worth keeping" --tags essays,craft
bun run clip https://x.com/someone/status/123 https://someone.substack.com/p/issue   # several at once
bun run clip arxiv:1706.03762 10.1038/nature14539 # papers by arXiv id or DOI
bun run clip --remove https://example.com/some-essay
```

- **Articles** are described from the page's Open Graph and JSON-LD metadata: title, author, publication, excerpt, image, date and reading time.
- **Newsletters** are recognised by platform: Substack (including custom domains), beehiiv, Buttondown, Kit, Ghost and a few others. Pass `--kind newsletter` (or `article`) to override.
- **Papers** come from the arXiv API (any arXiv link or `arxiv:<id>`), Crossref (any DOI), or the `citation_*` tags that journals and proceedings sites (NeurIPS, ACL Anthology, PMLR, most publishers) publish for Google Scholar. Semantic Scholar fills in a missing abstract and finds the free arXiv copy of a journal or conference paper. OpenReview blocks scripts, so clip a paper's arXiv link instead.
- **Tweets** come from X's public embed endpoints and are stored as plain data (text, author, avatar, photos, likes). The site renders them itself, so no X script loads.

Everything lands in `data/clippings.json`, newest first, and can be edited by hand. Clipping a URL again refreshes its metadata but keeps its note, tags and saved date. `--saved 2026-10-11` sets the saved date.

## Configure

Copy `.env.example` to `.env.local`. Each feature turns on when its keys are set:

| Feature | Keys |
| --- | --- |
| Ask the shelf (Jev ranks the books) | `TYPESAFE_API_KEY` |
| Short answers, and explain/recap in the reader (Claude Haiku 5.5) | `ANTHROPIC_API_KEY` |
| Private reading room | `OWNER_PASSWORD`, `SESSION_SECRET` (32+ random characters) |
| Book and PDF storage in Cloudflare R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |

Without `TYPESAFE_API_KEY`, the search box falls back to keyword search. Without R2, development stores books in `./.data`. Production refuses to start the reader without R2 unless you set `ALLOW_LOCAL_STORAGE=1`.

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

## Using the reading room

Sign in at `/login` (or open `/reader`). Then:

- Drop EPUBs or PDFs onto **Your books**. Each one is matched to its book on your shelf by title and author, and the shelf's book popup gets a **Read / Continue** button for you.
- EPUBs reflow: themes (Paper, Sepia, Sage, Night), fonts, text size, spacing, column width, two-page or scrolling layout.
- PDFs keep their pages (pdf.js): continuous scrolling, zoom and fit-to-width, the same four themes (Night inverts the page and keeps figures' colours), contents from the PDF's bookmarks, and selectable text. The browser reads the text when you add one, so search, Explain and recap work on PDFs too; scanned PDFs without a text layer can only be viewed.
- **Papers:** on `/papers`, a paper with a free PDF (arXiv, open proceedings) shows a **Read** button when you're signed in. The first time, the server fetches the PDF into R2; after that it opens straight away.
- Both readers have contents, in-book search, and highlights with notes. Your position, highlights and notes sync to R2.
- Select a passage and choose **Explain**, or use the recap button (**Previously…**, or **Where you left off** in a paper). When you come back after a few days, a recap is offered. In a PDF, Explain also sends Claude an image of the selection, so equations and symbols that text extraction garbles still get explained.

**Keyboard:** ←/→ turn pages, `T` contents, `N` notes, `/` search, `A` settings (theme and zoom in PDFs), `+`/`-`/`0` zoom in, out and fit (PDFs), `F` fullscreen, `Esc` closes things. On the shelf, `/` focuses search and `R` opens a random unread book.

### Privacy and safety

- **Owner only.** Books, PDFs, notes and the reader's AI features are private: every route checks your signed session cookie, so purchased books are never served publicly. Visitors only ever see shelf metadata.
- **No spoilers.** Explain and recap only send the model text from *before* your current position.
- **pdf.js** is copied from `node_modules` to `public/pdfjs` on install (`scripts/copy-pdfjs.ts`) and loaded from there at runtime, so it's in neither the client bundle nor the Worker. `/reader` allows `'wasm-unsafe-eval'` for its WebAssembly image decoders, which permits compiling WebAssembly but not JavaScript `eval`.
- **Scripts in EPUBs.** EPUBs can contain scripts. Before a chapter renders, the reader strips `<script>`, inline event handlers and `javascript:` links, and `/reader` sends a Content-Security-Policy that blocks scripts from anywhere else.
- **Rate limits.** The rate limit and result cache on `/api/ask` are kept in memory per server instance. That's fine for a personal site, but use a shared store if you scale out.

## Develop

```bash
bun install
bun dev
```

## Deploy to Cloudflare Workers

The site runs on Workers through [OpenNext](https://opennext.js.org/cloudflare) (`@opennextjs/cloudflare`).

1. Set up R2 as above: a Worker has no disk, so the reader needs it. Add your Worker's URL (for example `https://book-shelf.<you>.workers.dev`, or your custom domain) to the bucket's CORS `AllowedOrigins`.
2. Sign in and add the secrets from the table above, one at a time:

   ```bash
   bunx wrangler login
   bunx wrangler secret put OWNER_PASSWORD   # then SESSION_SECRET, TYPESAFE_API_KEY, ANTHROPIC_API_KEY, R2_*
   ```

3. Deploy:

   ```bash
   bun run deploy
   ```

4. Set `siteUrl` in `shelf.config.ts` to the deployed URL, so link previews work, then deploy again.

To run the real Workers runtime locally first, copy `.dev.vars.example` to `.dev.vars`, fill it in, and run `bun run preview`.

Notes:

- **Data is baked in.** `data/shelf.json` and `data/clippings.json` are part of the build, so redeploy after `bun run import` or `bun run clip` (pushing to `main` does it).
- **Plans.** The worker (about 14 MB) fits the free plan's size limit. Free plans allow 10 ms of CPU per request, which covers browsing and search: pages are prerendered, and AI calls spend their time waiting, not computing. Parsing an uploaded EPUB can need more, which needs the Workers Paid plan. PDFs are read in the browser, so they cost the Worker almost nothing.
- **Adapter patch.** `patches/@opennextjs%2Fcloudflare@1.20.10.patch` adds Next 16.4's new `preview-props.json` to the manifests OpenNext bundles ([opennextjs-cloudflare#1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355)). Remove it, and the `patchedDependencies` entry in `package.json`, once a release includes the fix.
- **`proxy.ts`** runs on OpenNext's Node.js middleware support, which it labels experimental. It only does the optimistic redirect from `/reader` to `/login`; the real check happens in every reader page and API route, so the site stays protected if it misbehaves.

## Layout

| Path | What it is |
| --- | --- |
| `scripts/import.ts` | Goodreads feeds (or CSV) → enriched `data/shelf.json` |
| `.github/workflows/goodreads-sync.yml` | Nightly import, committed and deployed |
| `lib/goodreads.ts`, `lib/csv.ts`, `lib/categories.ts` | Goodreads RSS and CSV parsing, keyword categories |
| `scripts/clip.ts`, `app/components/clippings.tsx`, `app/components/clip-page.tsx`, `app/{articles,papers,newsletters,tweets}/` | Clip articles, papers, newsletters and tweets → `data/clippings.json`, and their pages |
| `wrangler.jsonc`, `open-next.config.ts`, `patches/` | Cloudflare Workers deployment (OpenNext) |
| `app/components/engine/` | The Shelf Engine: the isometric machine animation on the main page |
| `app/page.tsx` | The shelf: spine marquee, ask box, Shelf Engine, profile, stats, insights, library |
| `app/api/ask/route.ts`, `lib/ai/jev.ts`, `lib/ai/haiku.ts` | Ask the shelf: BM25 pre-filter → Jev ranking → streamed Haiku answer |
| `lib/auth/session.ts`, `proxy.ts`, `app/login/` | Owner login (signed JWT cookie) |
| `lib/storage.ts`, `lib/library.ts`, `lib/epub/parse.ts`, `app/api/books/` | Book storage (R2 or local), library index, EPUB parsing, PDF finalize and paper import |
| `app/reader/`, `app/components/reader/` | The reading room: EPUBs (foliate-js), PDFs (pdf.js, `pdf-reader-view.tsx`, `pdf.ts`), panels and AI cards |
| `app/api/reader/`, `lib/ai/reader.ts` | Explain and recap, using only text before the reader's position |
