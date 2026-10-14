# Shelf

A personal reading site: every book you've read, are reading and mean to read (synced from Goodreads), plus the articles, papers, newsletters and tweets you've saved. It has a built-in reader for your own EPUBs, PDFs and arXiv papers, with Claude beside the page. Search by meaning finds anything on the site.

Live at **[read.sharathchenna.com](https://read.sharathchenna.com)**. Built with Next.js 16 on Cloudflare Workers (OpenNext), with D1 for data and R2 for files. Jev (TypeSafe) ranks search results, and Claude Haiku 5.5 writes the answers.

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Get started](#get-started)
- [Configure](#configure)
- [Deploy to Cloudflare](#deploy-to-cloudflare)
- [The library](#the-library)
- [Using the site](#using-the-site)
- [Saving from X and anywhere else](#saving-from-x-and-anywhere-else)
- [Search](#search)
- [The readers](#the-readers)
- [AI features and cost](#ai-features-and-cost)
- [Privacy and security](#privacy-and-security)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)

## What it does

**For visitors**

- **The library** (`/`): every book and clipping on one bookcase, shelved by topic. Arrange it by topic, recency, colour or length, or see each topic as a display of covers. Any spine comes off the shelf as a book in your hands. See [The library](#the-library).
- **The books** (`/books`) include:
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
- **Save from anywhere:** an iPhone share-sheet shortcut and a bookmarklet send posts from X (or any page) here in two taps. Each one is read, summarised and indexed, so it can be found later by what it's about.
- **Add EPUB or PDF** on any book's card.
- A **reader** for EPUBs, PDFs and arXiv papers, with:
  - themes, highlights, notes and in-book search;
  - Explain and Recap;
  - a **chat** panel that knows what you're reading.
- **Papers open in the reader.** arXiv papers become reflowing ebooks, with real equations and figures, built from arXiv's HTML version.
- **Discover papers** (`/papers/discover`): new research from [Papers with Code](https://paperswithcode.co), with **Read** and **Save** on each paper. See [Discovering papers](#discovering-papers).

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
       files,    extracted    FxTwitter / X embeds, TypeSafe Jev,
       progress, text         Anthropic (Claude Haiku 5.5),
       notes                  Workers AI + Vectorize (search index)
```

**Stack**

| Piece | Used for |
| --- | --- |
| Next.js 16 (App Router), React 19, Tailwind CSS 4 | The site |
| `@opennextjs/cloudflare` | Running Next.js on Cloudflare Workers |
| Cloudflare D1 | Shelf, clippings, library index, reading progress, highlights and notes, the bookcase's topics (`migrations/`) |
| Cloudflare R2 (S3 API, presigned URLs) | Book files, covers, extracted text for the AI, narrated chapters |
| Cloudflare Vectorize + Workers AI (`qwen3-embedding-0.6b`) | The search index: an embedding of every book and clipping |
| foliate-js | The EPUB reader |
| pdf.js (`pdfjs-dist`, loaded at runtime from `/pdfjs`) | The PDF reader, and reading PDF text in the browser |
| jszip | Parsing uploaded EPUBs, building EPUBs from arXiv papers and articles |
| `@mozilla/readability` | Finding the article in a saved web page, in the browser |
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
| Answers under search, Explain, Recap and Chat, and enriching clippings (Claude Haiku 5.5) | `ANTHROPIC_API_KEY` |
| Signing in as the owner | `OWNER_PASSWORD`, `SESSION_SECRET` (32+ random characters, e.g. `openssl rand -base64 48`) |
| Book files in R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| Listening on a GPU server (see [On a GPU server](#on-a-gpu-server)) | `NARRATOR_TOKEN`, shared with the server |
| Fish Audio's narrator voices (see [Fish Audio](#fish-audio)) | `FISH_API_KEY` (and `~/narrator/fish-key` on a GPU server) |

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

   And the search index (the `ai` and `vectorize` bindings in `wrangler.jsonc` need no keys):

   ```bash
   bunx wrangler vectorize create book-shelf-search --dimensions=1024 --metric=cosine
   ```

   After the first deploy, press **Sync** once to index everything already on the site.

2. **R2.** Set it up as above, including the deployed origins in CORS.
3. **Secrets.** Add each one from the table:

   ```bash
   bunx wrangler secret put OWNER_PASSWORD   # then SESSION_SECRET, TYPESAFE_API_KEY, ANTHROPIC_API_KEY, R2_*
   ```

4. **Deploy:** `bun run deploy`. Alternatively, connect the GitHub repository in **Workers & Pages → your Worker → Settings → Builds**, with build command `bunx opennextjs-cloudflare build` and deploy command `bunx opennextjs-cloudflare deploy`. Every push to `main` then deploys.
5. **Domain.** Add a custom domain to the Worker if you like, set `siteUrl` in `shelf.config.ts`, and add the domain to R2's CORS.

The nightly sync is a Cron Trigger (`triggers.crons` in `wrangler.jsonc`, `17 21 * * *` UTC = 02:47 IST). Deploying registers it.

## The library

The home page is a bookcase, from [Gloss](https://usegloss.io)'s library: its 24 topics, their painted plates and clay icons (`public/library/`), and the shelf itself.

- **What's on it:** every Goodreads book and every clipping. Books wear their own cover's colour and show their own cover; clippings get a cloth in their topic's colours and a cover with the page's picture printed in the topic's ink. A spine's width is how long it takes to read: from the file's length when there is one, else the page count, or the clipping's reading time.
- **Topics:** Claude Haiku shelves each item onto one of the 24 topics with up to three tags (`lib/ai/shelver.ts`, the `shelving` table): up to 30 items in one call, about $0.001. It runs after a sync, after a save, and once the home page has been served while anything is still unsorted. Signed in, the topic chip on an open book moves it, and a topic you pick is never changed by Haiku again.
- **Arranging:** by topic (a label under each run opens that topic's page), by month added, by colour (a rainbow), or by length. Filters for each topic, Reading now, Favourites, Finished, Under 10 min, saved from your phone or agent, and each kind of thing. `/` searches the shelf; arrow keys walk it.
- **A book in your hands:** click a spine. It comes off the shelf, turns, and opens: a bookplate inside the cover, and on the first page what it is, its tags, how far you are, and the way in:
  - a book with a file opens in the reader (**Continue reading**), or asks visitors to sign in;
  - a book without one opens its card on `/books`;
  - papers and articles open in the reader for you, and at their source for visitors;
  - posts open on X.
- **Signed in,** the page adds your reading over it (`/api/me`): your place in each file, your highlights, the star (favourites; books start with their five-star ratings), and removing a clipping.

The old home page (Ask the shelf, the Shelf Engine, stats, reading by year and every cover) is now **Books**, at `/books`.

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

  [Papers with Code](https://paperswithcode.co) adds, for arXiv papers it knows:
  - the code, with its GitHub stars;
  - a two-sentence summary, shown on the card in place of the abstract;
  - the paper's tasks;
  - any top-three leaderboard places.

  These are looked up again weekly on Sync, 20 papers a run, since stars and places change.
- **Tweets** come from [FxTwitter](https://github.com/FxEmbed/FxEmbed)'s API, which has the full text of long posts, the post being quoted and the one being replied to. X's own embed endpoints are the fallback; they cut long posts short. Posts are stored as plain data: text, author, avatar, photos (and video poster frames), likes, quote and reply. The site renders them itself, so no X script loads.

Each clipping (other than papers, which have abstracts) is also **enriched** when it's saved (`lib/enrich.ts`):

- the text of the page a post links to (or of the article itself) is read;
- Claude Haiku writes a one-line summary and a few topics, and describes each image, including any text, numbers or code in it, so a chart or screenshot can be found by what it shows.

Older clippings without enrichment get it a few at a time on each Sync. Section pages list 60 clippings at a time, with **Show more**; search covers all of them.

### Discovering papers

**Discover new papers** on the Papers page (signed in) opens `/papers/discover`, a feed from the [Papers with Code](https://paperswithcode.co) public API. Hugging Face relaunched the site in 2026. The feeds are:

- **For you:** papers trending in the tasks of the papers you've saved. Your most common tasks come first.
- **Trending:** papers ranked by how fast their code is gaining GitHub stars.
- **Latest:** the newest papers first.

You can filter by search, by task (the chips; a dot marks your own tasks), and by **With code**.

Each paper shows:

- its first page, its two-sentence summary, and **Read the abstract** (with the methods it uses);
- its code and stars, its leaderboard places, and its models, datasets and demos on Hugging Face.

**Save** clips it to your papers. **Read** saves it and opens it in the reader as an ebook, where Explain, Recap and Chat help with the hard parts.

The browser calls the API directly: it's anonymous and allows any site to call it. It is still in beta, so if it changes, Discover shows an error while your saved papers carry on. Papers that aren't on arXiv (blog posts, model cards) only link out.

## Saving from X and anywhere else

Open **Add → Save from your phone →** while signed in.

**iPhone and iPad (share sheet).** Press **Make a token**, then build a three-step shortcut in the Shortcuts app (the panel shows the exact values):

1. A new shortcut, **Save to Shelf**, with **Show in Share Sheet** on.
2. **Get Contents of URL**: `https://<your site>/api/capture`, method POST, header `Authorization` = `Bearer <token>`, JSON body with a Text field `text` = Shortcut Input.
3. **Show Notification** with Contents of URL.

Then, in X: **Share → Share via… → Save to Shelf**. The post is saved, enriched and indexed, and the notification says what was saved, in about five seconds.

- **The token** can only add clippings. It's shown once, stored only as a hash, and never expires.
- **Revoking:** **Make a new token** replaces it, and **Turn off** revokes it.
- **What the shortcut sends:** `/api/capture` saves the first link in whatever was shared, so text with a link in it works too.

**Computers (bookmarklet).** Drag **+ Save to Shelf** from the same panel to your bookmarks bar. On any page, click it: a small window opens with Add filled in and the cursor in the note, and it closes itself after saving. (It opens `/?add=<link>`; signed out, you're asked to sign in first.)

### Book files

Open a book's card and choose **Add EPUB or PDF**. The file uploads straight to R2 and is attached to that book.

- **Your view:** the card then shows **Read** (or **Continue · 42%**) and **Remove file**, and the cover gets a small badge.
- **Matching to books:** files are matched to books when the shelf loads, not only at upload. A book added to Goodreads after its file was uploaded picks the file up after the next sync.

### Keyboard

| Where | Keys |
| --- | --- |
| Anywhere | `⌘K` / `Ctrl+K` site search |
| Library | `/` searches the shelf, `←`/`→` walk it, `Esc` puts a book back |
| Books | `/` focuses Ask, `R` opens a random unread book |
| Reader | `←`/`→` turn pages, `T` contents, `N` notes, `B` brief (papers and articles), `/` search, `A` settings, `C` chat, `L` listen, `F` fullscreen, `Esc` closes things |
| PDFs | `+` / `-` / `0` zoom in, out and fit |

## Search

The site has two searches. Both use Jev, TypeSafe's model for judging true or false questions, which returns a probability for each question.

**Ask the shelf** (the box on the home page) ranks books only:

1. **Narrowing:** shelves of up to 240 books are ranked in full. Bigger shelves are first narrowed to 120 candidates by BM25 over title, author, subjects, tags, description and review, using related words as well as the question's own (see [Related words](#related-words)).
2. **Ranking:** Jev answers one question per book, "does this book fit what the reader asked for?". Its probability becomes the % match.
3. **Answer:** Claude Haiku writes a short note on where to start, linking the books it mentions. The results stream first, then the answer.

**Site search** (`⌘K`) covers everything:

1. **Index:** each book and clipping becomes a short card. Books contribute title, author, status, rating, subjects, description and review. Clippings contribute title, author or handle, source, excerpt or abstract, tweet text, the quoted and replied-to posts, the enrichment (summary, topics, image descriptions, linked page), tags and your note.
2. **Narrowing:** up to 150 items are ranked in full. Beyond that, the candidates are:
   - the 100 nearest the search in the vector index (`lib/search/vectors.ts`), which finds things by meaning even when no word matches;
   - plus the 30 best keyword matches, for exact names and handles, using [related words](#related-words) as well as the search's own.

   When the vector index can't answer (Workers AI is down or over its daily allowance), the 100 best keyword matches stand in for it.

   The index holds an embedding of each item's full text (`@cf/qwen/qwen3-embedding-0.6b`, 1,024 dimensions, in the `book-shelf-search` Vectorize index). Saving a clipping embeds it at once. Sync embeds whatever changed and drops what's gone; a hash of each item's text in D1 (`embeddings`) means unchanged items are never embedded twice.
3. **Ranking:** Jev judges each card against the search, "is this something the person is looking for?". Results below 20% are hidden, unless nothing scores higher.
4. **Display:** results are grouped by kind with a match bar.
5. **Opening a result:**
   - a book opens its card on the shelf;
   - a paper, when you're signed in, opens in the reader;
   - anything else opens its source.

A search costs a fraction of a cent and returns in under a second. Without Jev, results come from the vector index, ranked by similarity (or from keywords, when there's no index). Both searches cache recent queries, and allow 20 (Ask) or 40 (site search) searches per minute per address.

### Related words

Keyword matching only finds the words it's given. "making LLMs answer faster" matches a book called *The Making of the Atomic Bomb* and misses a paper on speculative decoding.

So before narrowing by keywords, Claude Haiku lists up to 12 words and phrases the wanted items are likely to contain (`lib/search/expand.ts`): synonyms, the field's own terms, well-known titles, people, tools and methods. For that search: "speculative decoding", "inference latency", "kv cache"…

These count half as much as the words you typed, so an exact match still comes first. Haiku gets 4 seconds; without `ANTHROPIC_API_KEY`, or if it's slow or fails, the search uses its own words. Each search's related words are cached, and they cost about $0.0001.

This only runs when there is something to narrow: below the limits above, Jev reads everything already.

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
- **Articles and newsletter issues.** Signed in, **Read** on any saved article opens it in the EPUB reader, with themes, listening, highlights, notes and chat. The first time, the site fetches the page and only passes it on; the browser finds the article in it with Mozilla's Readability (`app/components/reader/web-article.ts`) and binds it into an ebook like an X Article's: a chapter per top-level heading, with bold, italic and links, lists, quotes, code, figures, data tables and rules. Its pictures come through the site (`/api/books/clips/asset`, https images from public addresses only). Pages whose article loads with scripts, or sits behind a login, can't be read this way and say so. Reading the page in the browser keeps it off the Worker's CPU limit.
- **X Articles.** An X post that's an Article (a long post with a title) is saved under Articles, with its cover, author and first lines.
  - **Reading:** signed in, the card opens it in the EPUB reader, with themes, listening, highlights and notes. The browser makes the ebook (`app/components/reader/x-article-epub.ts`):
    - the cover, title and author on the first page;
    - a chapter per top-level heading;
    - bold, italic and links, lists, code and quotes;
    - pictures, the posts it embeds, and dividers.
  - **Visibility:** visitors see the card and a link to X; the full text is owner-only.
  - **Where the text comes from:** X's public embeds only give an article's first lines, so `lib/x-article.ts` reads it whole from X's web API, as a logged-out visitor does (a guest token, then the post's GraphQL query).
  - **If X changes that API:** the query id in `lib/x-article.ts` stops working. Articles can still be saved, from vxtwitter's summary, but won't open; update the query id.
  - **Rebuilds:** the conversion is versioned like papers' (`ARTICLE_EPUB_BUILD`).
- **Both readers** have contents, in-book search, highlights with notes, and a scrubber with chapter ticks and minutes left in the chapter. Your position, highlights and notes are saved to D1 and follow you across devices.

## Listening

EPUBs, papers included, can be read aloud. `L`, or the headphones button, starts at the top of the page on screen. The sentence being read is highlighted, and the page turns with it.

To start somewhere else:
- **From a selection:** select text and choose **Listen**.
- **Tap to read:** turn it on with the pointer button in the player, or the switch in the player's menu (phones use the switch). While listening, a tap on any sentence reads from there instead of turning the page. The setting is remembered.

- **The voices.** There are two kinds, and each book keeps the voice you pick for it. A book you haven't picked one for is read in the voice it has chapters saved in, else in your usual voice.
  - **Ethan** (the default) and **Adrian** are narrator voices from [Fish Audio](https://fish.audio), spoken by its S2.1 Pro model through the site (`lib/fish.ts`). They use the free developer tier (`s2.1-pro-free`). See [Fish Audio](#fish-audio).
  - **Heart, Bella, Emma, Michael and George** are [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0), run in the browser with [kokoro-js](https://github.com/hexgrad/kokoro/tree/main/kokoro.js), or on a GPU server. They cost nothing and have no usage limit.
  - **Kokoro's download:** the model downloads from Hugging Face the first time a Kokoro voice is used, 326 MB, then stays in the browser's cache.
  - **Speed:** on a computer's GPU (WebGPU), it speaks several times faster than it reads. Without one, it uses a smaller 92 MB model on the CPU, which is slower than real time, so there are pauses between sentences.
- **Saved chapters.** A chapter you listen to from its start is recorded as it plays (in a Kokoro voice, only on a GPU). **Save the whole book**, in the player's menu, records the rest. Keep the tab open while it runs, or have a GPU server do it with the tab closed.
  - **Where they go:** each chapter is stored as a 64 kbps MP3 in R2 (`audio/<book>/<voice>/<section>.mp3`, about 0.5 MB a minute), with each sentence's timing in D1.
  - **Playback:** saved chapters play straight from storage on any device. A phone needs no model and no GPU, and gets lock-screen and headphone controls: previous and next track change chapter, skip back and forward change sentence.
- **Playing:** speed changes from 0.8× to 2× without changing pitch. A different voice is a separate recording.
- **Turning away:** if you turn away from the page being read, the page stops following until you tap **Back to reading**.
- **Papers** are read for the ear:
  - **Skipped:** citations, the references, data tables, display equations and equation numbers.
  - **Read:** figure captions.
  - **Inline maths** is spoken: "1 over the square root of d k".
- **Books** skip footnote marks and illustration captions.

### Fish Audio

Ethan ("a curious explainer", clear and professional) and Adrian ("a steady and reliable narrator") are two of Fish Audio's official voices (`fi_ethan` and `fi_adrian` in `lib/voices.ts`; more can be added there and in `narrator-server/server.py`).

- **The key:** `FISH_API_KEY`, a Worker secret. The free tier needs no card.
- **The free tier:** the same model as the paid one, under a fair-use policy with no published caps, and up to five requests at once per account. Fish says the free period is for "an initial period", and that free requests may be used to improve its model, so the book's text goes to Fish. The paid model is $15 per million characters, about $20 for a long book.
- **Speed:** each sentence takes about 2–6 seconds to make, and audio starts when the first one is ready.
  - **Listening:** a few sentences are made ahead, so it plays on smoothly.
  - **Saving from the tab:** 4 sentences at once, about 4–7× real time. A 2-hour chapter takes about half an hour.
  - **Saving on the GPU server:** 3 at once, about 4× real time, without using the GPU.
- **Busy or failing:** Fish being busy (too many requests at once) or failing is waited out and retried. No other voice stands in, because a book is read in one voice.
- **Brackets:** S2 reads words in square brackets as directions ("[sad]"), so a book's own brackets are sent as parentheses.

#### Expressive reading

Fish's S2 model takes directions in square brackets: a delivery cue (`[dry]`, `[eager]`), `[emphasis]` before a word to stress, `[break]` for a pause. With **Expressive reading** on (the default, in the player's menu, for Fish voices), Claude Haiku directs a book the way a narrator would (`lib/ai/director.ts`).

- **What gets directed:**
  - **Fiction:** cues on dialogue ("[exasperated] … how can you be [emphasis] so tiresome?"), and a stressed word now and then.
  - **Nonfiction:** almost only emphasis, on the word that carries a claim, and a rare pause.
  - **How much:** at most one sentence in five gets anything (Haiku is told the limit, and the code keeps to it). In testing, a novel's first chapter got a quarter of its sentences directed and Darwin's introduction a fifth.
- **The words never change.** Haiku returns only where each direction goes. The code checks each one: the phrase must really be in the sentence, a cue must be a few plain words, and sound effects (laughing, sighing) are never allowed. It then inserts them into what's sent to Fish (`lib/directions.ts`). The page, and its highlighting, show the book as it is.
- **How it runs:** 40 sentences at a time, about 3 seconds each, nearest the sentence being read first, three at once. A sentence about to be heard waits up to 4 seconds for its direction (longer the further ahead it is), then is read as it is.
- **Kept:** directions are stored in D1 (`directions`, one row per run of 40 sentences, with a hash of the sentences and `DIRECTOR_VERSION`). Listening, saving from the tab and saving on the GPU server all use the same ones. Changing the instructions means bumping `DIRECTOR_VERSION`, so chapters get directed again.
- **Cost:** Haiku costs $0.10 per million tokens in and $0.50 per million out, and only returns the directions. That's roughly 5–10 cents for a long book, once.
- **Without it:** without `ANTHROPIC_API_KEY`, or when Haiku fails, sentences are read as they are. Chapters saved before keep how they were read; save one again to redo it with directions.

### On a GPU server

With a GPU machine of your own, the same Kokoro voices run there (`narrator-server/`) instead of in the browser. On an A100 it saves about 150–200× faster than real time: a 26-hour book in about 10 minutes.
- **Saving:** **Save the whole book** splits the chapters into sentences in the browser, then hands them to the server. The server speaks, encodes and saves each chapter itself, so you can close the tab. The menu shows its progress.
- **Listening:** an unsaved chapter starts at once, sentence by sentence from the server. The server saves that chapter first, and playback switches to the saved copy when it's ready.
- **Phones:** don't download the model, so they can listen to any chapter.
- **When the server is down:** the reader falls back to the voice in the browser.
- **Sharing the GPU.** The server holds GPU memory only while it's working.
  - **The main process** never touches the GPU.
  - **The voice processes** do the speaking:
    - A listening process starts when the reader opens and exits after `LIVE_IDLE` seconds unused (default 600).
    - Up to `WORKERS` saving processes (default 4) run while chapters are queued, and exit `WORKER_IDLE` seconds (default 60) after the last one.
  - **Memory:** each process is capped at `GPU_MB` (default 1536, plus about 0.5 GB for CUDA itself).
  - **Starting:** a process only starts if it fits beside everything else on the GPU with `GPU_RESERVE_MB` (default 1024) to spare. Saving always leaves room for the listening process.
  - **Settings:** these are environment variables in `narrator.service`.
- **Why it's fast:** one sentence at a time leaves a GPU mostly idle. Saving speaks several sentences in each pass, up to Kokoro's 510 phonemes, then cuts each sentence back out using the length the model gives each phoneme. A few processes run side by side.
- **Connection.** The server listens on `127.0.0.1:8880`, and a Cloudflare Tunnel connects it to the Worker through [Workers VPC](https://developers.cloudflare.com/workers-vpc/) (the `NARRATOR` binding in `wrangler.jsonc`).
  - **Private:** the tunnel has no public hostname and the machine opens no ports, so only the Worker can reach it.
  - **Saving back:** the server saves chapters through the same routes the browser uses (`/api/books/[id]/audio/[section]`). It signs those requests with `NARRATOR_TOKEN`, which only those routes accept.
- **Fish voices** are saved here too: the server asks Fish for the sentences (`FISH_AT_ONCE`, default 3) instead of using the GPU, so they need no GPU memory. It needs its own copy of the key in `~/narrator/fish-key` (mode 600); without one, Fish chapters are saved from the tab instead.
- **Setup** on the machine, which needs Linux, an NVIDIA GPU and Python 3.12 via [uv](https://docs.astral.sh/uv/); no root needed:
  ```sh
  mkdir -p ~/narrator && cd ~/narrator            # copy narrator-server/server.py here
  uv venv --python 3.12 .venv && . .venv/bin/activate
  uv pip install torch --index-url https://download.pytorch.org/whl/cu128
  uv pip install "kokoro>=0.9.4" lameenc pip
  (umask 077; openssl rand -hex 32 > site-token)  # then, on your computer:
  ssh <machine> 'cat ~/narrator/site-token' | bunx wrangler secret put NARRATOR_TOKEN
  ```
  - **Tunnel:** `bunx wrangler tunnel create <name>`, put its token in `~/narrator/tunnel-token` (mode 600), then `bunx wrangler vpc service create <name> --type http --tunnel-id <id> --ipv4 127.0.0.1 --http-port 8880`. Put the service id in `wrangler.jsonc`.
  - **Keep it running:** copy `narrator.service` and `narrator-tunnel.service` to `~/.config/systemd/user/` and run `systemctl --user enable --now narrator narrator-tunnel`. To have them start at boot without a login, run `loginctl enable-linger <user>` once.
  - **Restarts:** chapters waiting to be saved are kept in `~/narrator/jobs/` and resume after a restart. `journalctl --user -u narrator` shows what it saved.

## AI features and cost

All of these are owner-only, apart from the answer under Ask the shelf. They run on Claude Haiku 5.5 and stream as they're written.

- **Explain:** select a passage and choose **Explain**. In a PDF, an image of the selection goes along, so equations that text extraction garbles are still explained.
- **More:** beside Explain, **More** offers the rest of Gloss's set (`lib/reader-actions.ts`, prompts in `lib/ai/reader.ts`):
  - **Define** (for a few words): the word as this author uses it; **Simplify** (for longer passages): the same idea in plain words.
  - **Fact-check:** does it still hold up? Haiku searches the web (Anthropic's web search, at most two searches, $0.01 each) and lists the pages it cited. A passage that's opinion or fiction gets one line saying so instead.
  - **Related:** where else the text takes this up, as a few pointers with quoted words: the whole of a paper, or a book up to where you are.
  - **Counterpoint:** the strongest objection a sharp critic would raise, and how the author might answer.

  Each answer can be saved as a note on the passage, like Explain's.
- **Brief:** `B`, or the bookmark-list button, in a paper or article: the gist in two sentences, three to five load-bearing claims and up to three caveats (scope, standing, what it concedes, where its headline outruns its evidence), each linked to the section that shows it (`lib/ai/brief.ts`, Gloss's rules). Haiku reads the whole text with some thinking, takes numbers from the tables rather than the abstract, and makes comparisons only as strong as the evidence. Written the first time it's opened (about 20 seconds, under a cent) and kept in storage (`brief/<id>.json`). Books don't get one: it would give the ending away.
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
- **The narrator's runtime.** ONNX Runtime's WebAssembly (21.6 MB, under the 25 MiB asset limit) is copied to `public/ort` on install (`scripts/copy-ort.ts`), because the reader's CSP doesn't allow loading it from a CDN. The voice model itself comes from Hugging Face, which the reader's CSP allows.
- **Adapter patch.** `patches/@opennextjs%2Fcloudflare@1.20.10.patch` adds Next 16.4's `preview-props.json` to the manifests OpenNext bundles ([opennextjs-cloudflare#1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355)). Remove it, and the `patchedDependencies` entry in `package.json`, once a release includes the fix.
- **`proxy.ts`** runs on OpenNext's Node.js middleware support, which OpenNext labels experimental. It only does an optimistic redirect from `/reader/<id>` to `/login`. The real check happens in every reader page and API route, so the site stays protected if it misbehaves.
- **Search index in development.** Vectorize has no local simulation, so `bun dev` and `bun run preview` use the real index (`"remote": true`). Set `SEARCH_NAMESPACE=dev` in `.env.local` / `.dev.vars` to keep local vectors in their own namespace, with their ids prefixed `dev:`. Workers AI embeddings always run remotely and count against your account's free allowance.
- **Types.** Cloudflare bindings are typed by hand in `types/cloudflare.d.ts`. The generated `cloudflare-env.d.ts` (`bun run cf-typegen`) clashes with the DOM types, so it's excluded from the type check.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "Storage refused the upload" / "Upload failed" | The site's origin is missing from the R2 bucket's CORS rule, or the R2 keys are wrong. R2's error replies carry no CORS headers, so any rejection looks like a network error. |
| Shelf is empty after deploying | The production database starts empty: sign in and press **Sync**. Check the Goodreads profile is public and `goodreadsUserId` is set. |
| Search results say "Keyword matches" | `TYPESAFE_API_KEY` isn't set where the site runs. |
| AI features say "AI isn't configured" | `ANTHROPIC_API_KEY` isn't set. |
| Discover says it couldn't reach Papers with Code | Its API is a beta and rate-limited. Try again in a minute; the page itself and your saved papers don't depend on it. |
| A saved paper has no code link or tasks | Papers with Code doesn't know it (it covers arXiv papers in ML), or it hasn't been looked up yet. Opening Discover, or Sync, fills it in. |
| A paper opens as a PDF instead of an ebook | It has no HTML version on arXiv (some older or very large papers). |
| The shortcut says "Not saved: the token is missing or out of date" | Make a new token in **Add → Save from your phone** and paste it (with `Bearer `) into the shortcut's header. |
| A new clipping doesn't show in search for a few seconds | Vectorize makes new vectors searchable a few seconds after they're written. |
| Listening pauses between sentences | The voice is running in a browser without WebGPU, on the CPU. Save the book on the GPU server, or from Chrome or Safari on a computer; saved chapters play smoothly anywhere. |
| Ethan or Adrian says "Fish Audio isn't set up" | `FISH_API_KEY` isn't set where the site runs. |
| Ethan or Adrian stops with a Fish Audio error | Fish refused or kept failing for over a minute (its free tier may have changed). Pick a Kokoro voice for the book meanwhile; chapters already saved in that voice still play. |
| The menu says "made in this browser" with a GPU server set up | The server isn't answering. On the machine, check `systemctl --user status narrator narrator-tunnel`, and `bunx wrangler tunnel info <name>` for the tunnel. |
| A figure is missing from a paper ebook | Check the paper on arxiv.org/html: if arXiv's own page shows no image, its LaTeX conversion dropped it, and **PDF ↗** has it. |
| Local changes don't show in `bun dev` | Restart the dev server; if it still serves an old page, check with `bun run preview`. |

## Project layout

| Path | What it is |
| --- | --- |
| `app/page.tsx`, `app/components/bookcase/`, `lib/bookcase.ts`, `lib/shelving.ts`, `lib/ai/shelver.ts`, `app/api/shelving/`, `public/library/` | The library: the bookcase, topics, the book in your hands, and shelving by Haiku |
| `app/books/page.tsx` | The books: spine marquee, Ask, Shelf Engine, profile, stats, insights, every cover |
| `app/components/engine/` | The Shelf Engine animation |
| `app/{articles,papers,newsletters,tweets}/`, `app/components/clippings.tsx`, `clip-page.tsx` | The clipping pages |
| `app/components/top-bar.tsx`, `footer.tsx`, `logo.tsx`, `app/icon.svg`, `favicon.ico`, `apple-icon.png` | Site chrome and the logo |
| `migrations/`, `lib/db.ts`, `lib/data.ts`, `lib/library.ts` | D1: schema, shelf, clippings, files, progress and notes |
| `lib/sync.ts`, `lib/goodreads.ts`, `lib/categories.ts`, `app/api/sync/` | Goodreads sync (RSS → Open Library → D1) |
| `lib/clip.ts`, `app/api/clips/`, `app/components/add-clip.tsx` | Adding clippings from the site |
| `lib/pwc.ts`, `app/papers/discover/`, `app/components/papers/discover.tsx` | Discovering papers, and saved papers' code and tasks, from Papers with Code |
| `lib/x-article.ts`, `app/api/books/clips/`, `app/reader/clip/`, `app/components/reader/{clip-opener.tsx,x-article-epub.ts,web-article.ts}` | Articles and X Articles: reading them whole, as ebooks in the reader |
| `app/api/ask/`, `lib/ai/jev.ts`, `lib/ai/haiku.ts`, `lib/search/bm25.ts` | Ask the shelf |
| `app/api/search/`, `lib/search/site.ts`, `lib/search/vectors.ts`, `lib/search/expand.ts`, `app/components/search-palette.tsx` | Site search, its vector index, and Haiku's related words |
| `lib/save.ts`, `lib/enrich.ts`, `app/api/capture/`, `app/components/capture-setup.tsx` | Saving from anywhere: the shared save pipeline, enrichment, the share-sheet endpoint and token, the setup panel |
| `lib/auth/session.ts`, `proxy.ts`, `app/login/` | Owner login |
| `lib/storage.ts`, `lib/epub/parse.ts`, `app/api/books/` | Book files (R2), EPUB parsing, PDF finalize, paper import and the arXiv proxies |
| `app/components/book-file.tsx` | A book card's Add / Read / Read · locked / Remove file |
| `app/reader/`, `app/components/reader/` | The readers: EPUB (foliate-js), PDF (pdf.js), arXiv-to-EPUB, panels, chat |
| `app/api/reader/`, `lib/ai/reader.ts`, `lib/reader-actions.ts` | Explain and the rest of the selection actions, Recap and Chat |
| `lib/ai/brief.ts`, `lib/brief-types.ts`, `app/api/books/[id]/brief/` | The brief on a paper or article |
| `app/components/reader/{narrator,narrator.worker,speech}.ts`, `listen-bar.tsx`, `app/api/books/[id]/audio/` | Listening: the text read aloud, Kokoro in a worker, saved chapters |
| `lib/voices.ts`, `lib/fish.ts` | The narrator's voices, and Fish Audio's |
| `narrator-server/`, `lib/narrator.ts`, `app/api/narrate/`, `app/api/books/[id]/narrate/` | Listening on a GPU server: Kokoro on CUDA behind a Cloudflare Tunnel (Workers VPC) |
| `worker.ts`, `wrangler.jsonc`, `open-next.config.ts`, `patches/` | Cloudflare Workers deployment: edge cache, nightly sync |
| `shelf.config.ts` | Your name, bio, links, site URL and Goodreads id |
