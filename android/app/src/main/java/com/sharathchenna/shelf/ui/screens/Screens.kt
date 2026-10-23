package com.sharathchenna.shelf.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import coil3.compose.AsyncImage
import com.sharathchenna.shelf.BuildConfig
import com.sharathchenna.shelf.data.Clip
import com.sharathchenna.shelf.data.ReviewCard
import com.sharathchenna.shelf.data.SearchResult
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.Reader
import com.sharathchenna.shelf.ui.Web
import com.sharathchenna.shelf.ui.library.KIND_LABEL
import com.sharathchenna.shelf.ui.library.fmtMinutes
import com.sharathchenna.shelf.ui.library.hostOf
import com.sharathchenna.shelf.ui.openBook
import com.sharathchenna.shelf.ui.openExternal
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.PaperGrain
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import com.sharathchenna.shelf.ui.theme.hex
import com.sharathchenna.shelf.update.Updates
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** A page of its own, on the site's paper, at the site's reading width. */
@Composable
private fun Page(content: @Composable (side: androidx.compose.ui.unit.Dp) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        content(((maxWidth.value - maxWidth.value.coerceAtMost(1180f) + 64f) / 2).dp)
    }
}

/** A section's title (with its count, small, as the site sets it) and a line about it. */
@Composable
private fun Heading(title: String, count: Int? = null, subtitle: String? = null) {
    val paper = LocalPaper.current
    Column(Modifier.statusBarsPadding().padding(top = 36.dp, bottom = 24.dp)) {
        Text(
            buildAnnotatedString {
                append(title)
                count?.let { withStyle(SpanStyle(fontFamily = Sans, fontSize = 16.sp, color = paper.muted, letterSpacing = 0.sp)) { append("  $it") } }
            },
            fontFamily = Serif, fontWeight = FontWeight(420),
            fontSize = if (androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp < 600) 38.sp else 52.sp,
            lineHeight = if (androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp < 600) 42.sp else 56.sp,
            letterSpacing = (-0.03).em, color = paper.fg,
        )
        subtitle?.let { Text(it, fontFamily = Sans, fontSize = 15.sp, lineHeight = 22.sp, color = paper.muted, modifier = Modifier.padding(top = 10.dp)) }
    }
}

// ---- clippings -------------------------------------------------------------------------------

/** The site's clipping sections, in its order and words (lib/clippings.ts, app/components/clip-page.tsx). */
private val SECTIONS = listOf(
    Triple("article", "Articles", "Essays and long reads from around the web, with notes in the margins."),
    Triple("paper", "Papers", "Research worth the close read: abstracts, authors and where each one appeared."),
    Triple("newsletter", "Newsletters", "Issues worth keeping from the newsletters in the inbox."),
    Triple("tweet", "Tweets", "Posts that stuck, kept here in case they disappear."),
)

private val monthYear = DateTimeFormatter.ofPattern("MMM yyyy", Locale.UK)
private fun dateOf(iso: String?): String? = runCatching { LocalDate.parse(iso!!.take(10)).format(monthYear) }.getOrNull()

/** The clippings, a section at a time, newest first, as cards in as many columns as fit. */
@Composable
fun ClippingsScreen(nav: NavHostController) {
    val shelf = LocalShelf.current
    val library by shelf.library.collectAsState()
    val context = LocalContext.current
    val paper = LocalPaper.current
    val books = library?.books.orEmpty()
    val present = SECTIONS.filter { (kind, _, _) -> books.any { it.kind == kind } }
    var tab by rememberSaveable { mutableStateOf(0) }
    Page { side ->
        if (present.isEmpty()) {
            Column(Modifier.padding(horizontal = side)) {
                Heading("Clippings", subtitle = "Nothing clipped yet. Share a link to Shelf from any app, and it's saved here.")
            }
            return@Page
        }
        val selected = tab.coerceIn(0, present.lastIndex)
        val (kind, label, blurb) = present[selected]
        val items = books.filter { it.kind == kind }.sortedByDescending { it.added }
        LazyVerticalStaggeredGrid(
            columns = StaggeredGridCells.Adaptive(320.dp),
            contentPadding = PaddingValues(start = side, end = side, bottom = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(20.dp),
            verticalItemSpacing = 20.dp,
        ) {
            item(span = StaggeredGridItemSpan.FullLine) {
                Column {
                    Heading(label, count = items.size, subtitle = blurb)
                    Row(Modifier.clip(CircleShape).background(paper.sunk.copy(alpha = 0.6f)).padding(4.dp).padding(bottom = 0.dp)) {
                        present.forEachIndexed { i, (k, l, _) ->
                            val on = i == selected
                            Text(
                                buildAnnotatedString {
                                    append(l)
                                    withStyle(SpanStyle(color = paper.faint)) { append("  ${books.count { it.kind == k }}") }
                                },
                                fontFamily = Sans, fontWeight = FontWeight(if (on) 500 else 400), fontSize = 13.5.sp, color = if (on) paper.fg else paper.muted,
                                modifier = Modifier.clip(CircleShape).background(if (on) paper.raised else Color.Transparent).clickable { tab = i }.padding(horizontal = 14.dp, vertical = 8.dp),
                            )
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                }
            }
            items(items, key = { it.id }) { b -> ClipCard(b, shelf.clip(b.id)) { openBook(context, nav, b) } }
        }
    }
}

/** A clipping as the site's cards show it: its picture, where it's from and how long it takes, its title and summary, who and when. */
@Composable
private fun ClipCard(book: ShelfBook, clip: Clip?, onClick: () -> Unit) {
    val paper = LocalPaper.current
    val shape = RoundedCornerShape(20.dp)
    Column(Modifier.clip(shape).background(paper.raised).border(1.dp, paper.rule, shape).clickable(onClick = onClick)) {
        val tweet = clip?.tweet
        if (tweet == null) book.image?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().aspectRatio(1.9f)) }
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val source = tweet?.let { "${it.name}  @${it.handle}" } ?: clip?.source?.takeIf { it.isNotBlank() } ?: hostOf(book.url) ?: book.author
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (tweet?.avatar != null) {
                    AsyncImage(tweet.avatar, null, Modifier.size(20.dp).clip(CircleShape))
                } else {
                    Box(Modifier.size(20.dp).clip(RoundedCornerShape(5.dp)).background(hex(book.look.color)), contentAlignment = Alignment.Center) {
                        Text(source.trim().take(1).uppercase(), fontFamily = Serif, fontSize = 11.sp, color = hex(book.look.fg))
                    }
                }
                Spacer(Modifier.width(8.dp))
                Text(source, fontFamily = Sans, fontWeight = FontWeight(500), fontSize = 13.sp, color = paper.fg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (tweet == null) Text("  ·  ${fmtMinutes(book.minutes)} read", fontFamily = Sans, fontSize = 13.sp, color = paper.muted, maxLines = 1)
            }
            if (tweet != null) {
                Text(tweet.text, style = MaterialTheme.typography.bodyLarge, maxLines = 12, overflow = TextOverflow.Ellipsis)
                tweet.media.firstOrNull()?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().aspectRatio(1.6f).clip(RoundedCornerShape(12.dp))) }
            } else {
                Text(book.title, fontFamily = Serif, fontWeight = FontWeight(450), fontSize = 21.sp, lineHeight = 27.sp, color = paper.fg)
                book.dek?.let { Text(it, fontFamily = Sans, fontSize = 14.sp, lineHeight = 20.sp, color = paper.muted, maxLines = 4, overflow = TextOverflow.Ellipsis) }
            }
            val by = listOfNotNull(clip?.author?.takeIf { tweet == null && it != source }, dateOf(clip?.published) ?: dateOf(clip?.saved)).joinToString("  ·  ")
            if (by.isNotEmpty()) Text(by, fontFamily = Sans, fontSize = 12.5.sp, color = paper.faint)
        }
    }
}

// ---- search ----------------------------------------------------------------------------------

/** The site's examples (app/components/search-palette.tsx). */
private val EXAMPLES = listOf("papers about attention in transformers", "a slow-burn story with a twist", "essays on doing great work", "something about habits")

/** One search, by meaning, across everything on the site. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SearchScreen(nav: NavHostController) {
    val shelf = LocalShelf.current
    val context = LocalContext.current
    val paper = LocalPaper.current
    var query by rememberSaveable { mutableStateOf("") }
    var results by remember { mutableStateOf<List<SearchResult>>(emptyList()) }
    var state by remember { mutableStateOf<String?>(null) }
    var searching by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    LaunchedEffect(query) {
        if (query.trim().length < 2) {
            results = emptyList(); state = null; searching = false; return@LaunchedEffect
        }
        delay(400)
        searching = true
        runCatching { shelf.api.search(query) }
            .onSuccess { results = it; state = if (it.isEmpty()) "Nothing on the site matches that." else null }
            .onFailure { results = emptyList(); state = it.message ?: "Couldn't reach the site." }
        searching = false
    }
    Page { side ->
        LazyColumn(contentPadding = PaddingValues(start = side, end = side, bottom = 48.dp)) {
            item {
                Heading("Search", subtitle = "Describe what you're after, in your own words. It searches books, papers, articles, newsletters and tweets by meaning.")
                Row(
                    Modifier.widthIn(max = 760.dp).fillMaxWidth().height(56.dp).clip(RoundedCornerShape(18.dp)).background(paper.raised).border(1.dp, paper.rule, RoundedCornerShape(18.dp)).padding(horizontal = 18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.Search, null, Modifier.size(20.dp), tint = paper.faint)
                    Spacer(Modifier.width(12.dp))
                    Box(Modifier.weight(1f)) {
                        if (query.isEmpty()) Text("Search books, papers, articles, newsletters, tweets…", fontFamily = Sans, fontSize = 16.sp, color = paper.faint, maxLines = 1)
                        BasicTextField(
                            query, { query = it }, singleLine = true, cursorBrush = SolidColor(paper.accent),
                            textStyle = TextStyle(fontFamily = Sans, fontSize = 16.sp, color = paper.fg),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = {}),
                            modifier = Modifier.fillMaxWidth().focusRequester(focus),
                        )
                    }
                    if (query.isNotEmpty()) Icon(Icons.Outlined.Close, "Clear", Modifier.size(20.dp).clip(CircleShape).clickable { query = "" }, tint = paper.muted)
                }
                Spacer(Modifier.height(18.dp))
                when {
                    query.trim().length < 2 -> {
                        Text("Try:", fontFamily = Sans, fontSize = 13.sp, color = paper.muted)
                        FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            EXAMPLES.forEach { e ->
                                Text(e, fontFamily = Sans, fontSize = 14.sp, color = paper.fg, modifier = Modifier.clip(CircleShape).background(paper.chip).clickable { query = e }.padding(horizontal = 14.dp, vertical = 8.dp))
                            }
                        }
                    }
                    searching -> Text("Searching by meaning…", fontFamily = Sans, fontSize = 14.sp, color = paper.muted)
                    state != null -> Text(state!!, fontFamily = Sans, fontSize = 14.sp, color = paper.muted)
                    else -> Text("RANKED BY MEANING", style = Eyebrow, color = paper.faint)
                }
                Spacer(Modifier.height(8.dp))
            }
            items(results, key = { it.kind + it.id }) { r ->
                Row(
                    Modifier.widthIn(max = 760.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable {
                        val book = shelf.book(r.id)
                        when {
                            book != null -> openBook(context, nav, book)
                            r.paperId != null -> nav.navigate(Web("/reader/paper/${r.paperId}", r.title, prepare = true))
                            r.articleId != null -> nav.navigate(Web("/reader/clip/${r.articleId}", r.title, prepare = true))
                            else -> openExternal(context, shelf.api.absolute(r.href))
                        }
                    }.padding(vertical = 12.dp, horizontal = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AsyncImage(r.image, null, contentScale = ContentScale.Crop, modifier = Modifier.size(44.dp, 60.dp).clip(RoundedCornerShape(4.dp)).background(paper.sunk))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text((KIND_LABEL[r.kind] ?: r.kind).uppercase(), style = Eyebrow, color = paper.faint)
                        Text(r.title, fontFamily = Serif, fontSize = 18.sp, lineHeight = 23.sp, color = paper.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(r.subtitle, fontFamily = Sans, fontSize = 13.sp, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                HorizontalDivider(Modifier.widthIn(max = 760.dp), color = paper.rule)
            }
        }
    }
}

// ---- the daily review ------------------------------------------------------------------------

private fun todayMs(): Long = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()

private val HIGHLIGHTER = mapOf("yellow" to 0xFFFFD84D, "green" to 0xFF8BD17C, "blue" to 0xFF7CB8FF, "pink" to 0xFFFF8FB8)

/** A few of your own highlights each day, one at a time (lib/review.ts), in the site's words. */
@Composable
fun ReviewScreen(nav: NavHostController) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val scope = rememberCoroutineScope()
    var deck by remember { mutableStateOf<List<ReviewCard>?>(null) }
    var done by remember { mutableStateOf(0) }
    var total by remember { mutableStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        runCatching { shelf.api.review(todayMs()) }
            .onSuccess { deck = it.deck; done = it.done; total = it.total }
            .onFailure { error = it.message }
    }
    Page { side ->
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = side)) {
            Heading(
                "Today, from your highlights",
                subtitle = "A few of your highlights come back each day. Keep one and it returns in a few days, then less and less often.",
            )
            val card = deck?.firstOrNull()
            when {
                error != null -> Text(error!!, fontFamily = Sans, color = paper.muted)
                deck == null -> Text("Finding today's highlights…", fontFamily = Sans, color = paper.muted)
                card == null -> Text(
                    if (total > 0) "That's all for today. More tomorrow." else "Nothing to look back on yet. Highlight something as you read, and from tomorrow it can come back here.",
                    fontFamily = Serif, fontSize = 22.sp, lineHeight = 30.sp, color = paper.muted, modifier = Modifier.widthIn(max = 640.dp),
                )
                else -> Column(Modifier.widthIn(max = 760.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    if (total > 1) Text("${done + 1} of $total", fontFamily = Sans, fontSize = 13.sp, color = paper.faint)
                    Column(
                        Modifier.clip(RoundedCornerShape(22.dp)).background(paper.raised).border(1.dp, paper.rule, RoundedCornerShape(22.dp))
                            .clickable { nav.navigate(Reader(card.fileId, at = card.id)) }.padding(28.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Text(
                            buildAnnotatedString {
                                withStyle(SpanStyle(background = Color(HIGHLIGHTER[card.color] ?: 0xFFFFD84D).copy(alpha = 0.35f))) { append(card.text.trim()) }
                            },
                            fontFamily = Serif, fontSize = 24.sp, lineHeight = 34.sp, color = paper.fg,
                        )
                        card.note?.let { Text(it, fontFamily = Sans, fontSize = 14.sp, color = paper.muted) }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(card.title + if (card.author.isNotBlank()) ", ${card.author}" else "", fontFamily = Sans, fontSize = 13.sp, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                            Spacer(Modifier.width(6.dp))
                            Icon(Icons.AutoMirrored.Outlined.ArrowForward, "Open it in the book", Modifier.size(14.dp), tint = paper.muted)
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        val seen = { keep: Boolean ->
                            scope.launch {
                                runCatching { shelf.api.reviewed(card, keep, todayMs()) }
                                deck = deck!!.drop(1)
                                done++
                            }
                        }
                        Button(onClick = { seen(true) }) { Text("Next") }
                        OutlinedButton(onClick = { seen(false) }) { Text("Done with it") }
                    }
                    Text("Next keeps it coming back. Done with it leaves the review; it stays a highlight.", fontFamily = Sans, fontSize = 12.5.sp, color = paper.faint)
                }
            }
        }
    }
}

// ---- downloads -------------------------------------------------------------------------------

/** The books kept on this device, to read without a connection. */
@Composable
fun DownloadsScreen(nav: NavHostController) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val scope = rememberCoroutineScope()
    val downloads by shelf.downloads.collectAsState(initial = emptyMap())
    val library by shelf.library.collectAsState()
    val total = downloads.values.sumOf { it.bytes }
    Page { side ->
        LazyColumn(contentPadding = PaddingValues(start = side, end = side, bottom = 48.dp)) {
            item {
                Heading(
                    "Offline",
                    count = downloads.size.takeIf { it > 0 },
                    subtitle = if (downloads.isEmpty()) "Nothing kept offline yet. Choose “Keep offline” on a book's card, and it opens here without a connection."
                    else "These open without a connection, using ${mb(total)} on this device. Highlights and your place are sent when you're back online.",
                )
            }
            items(downloads.values.toList(), key = { it.bookId }) { d ->
                val book = library?.books?.find { it.fileId == d.bookId }
                Row(
                    Modifier.widthIn(max = 760.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable { nav.navigate(Reader(d.bookId)) }.padding(vertical = 12.dp, horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Box(Modifier.size(40.dp, 58.dp).clip(RoundedCornerShape(3.dp)).background(book?.let { hex(it.look.color) } ?: paper.sunk)) {
                        (book?.photo ?: book?.image)?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
                    }
                    Column(Modifier.weight(1f)) {
                        Text(d.title, fontFamily = Serif, fontSize = 18.sp, color = paper.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text("${d.format.uppercase()}  ·  ${mb(d.bytes)}", fontFamily = Sans, fontSize = 13.sp, color = paper.muted)
                    }
                    TextButton(onClick = { scope.launch { shelf.removeDownload(d.bookId) } }) { Text("Remove") }
                }
                HorizontalDivider(Modifier.widthIn(max = 760.dp), color = paper.rule)
            }
        }
    }
}

private fun mb(bytes: Long): String = if (bytes < 1_000_000) "${maxOf(1, bytes / 1000)} KB" else "%.1f MB".format(Locale.UK, bytes / 1_000_000.0)

// ---- settings --------------------------------------------------------------------------------

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    val paper = LocalPaper.current
    Column(
        Modifier.widthIn(max = 640.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(paper.raised).border(1.dp, paper.rule, RoundedCornerShape(20.dp)).padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(title.uppercase(), style = Eyebrow, color = paper.faint)
        content()
    }
}

@Composable
fun SettingsScreen() {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var update by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }
    val site = BuildConfig.SITE_URL.removePrefix("https://").removePrefix("http://")
    val cache = remember { File(context.filesDir, "books").walkTopDown().filter { it.isFile }.sumOf { it.length() } + File(context.filesDir, "audio").walkTopDown().filter { it.isFile }.sumOf { it.length() } }
    Page { side ->
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = side).padding(bottom = 48.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Heading("Settings")
            Section("Library") {
                Text(site, fontFamily = Serif, fontSize = 20.sp, color = paper.fg)
                Text("Signed in as this device. Highlights, notes, drawings and your place sync with the site.", fontFamily = Sans, fontSize = 14.sp, color = paper.muted)
                Text(if (cache == 0L) "Nothing is kept on this device yet." else "Books and narration kept on this device: ${mb(cache)}", fontFamily = Sans, fontSize = 14.sp, color = paper.muted)
            }
            Section("App") {
                Text("Shelf for Android ${BuildConfig.VERSION_NAME}", fontFamily = Serif, fontSize = 20.sp, color = paper.fg)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = {
                        update = "Checking…"
                        scope.launch { update = Updates.check(context, install = true) }
                    }) { Text("Check for updates") }
                    update?.let { Text(it, fontFamily = Sans, fontSize = 13.sp, color = paper.muted) }
                }
            }
            Section("Obsidian") { ObsidianSettings() }
            Section("This device") {
                Text("Signing out forgets this device's token, the books kept offline, and anything not yet sent to the site.", fontFamily = Sans, fontSize = 14.sp, color = paper.muted)
                OutlinedButton(onClick = { confirm = true }) { Text("Sign out") }
            }
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Sign out of Shelf?") },
            text = { Text("Changes are sent to the site first, if there's a connection. Books kept offline are removed from this device.") },
            confirmButton = { TextButton(onClick = { confirm = false; scope.launch { runCatching { shelf.sync() }; shelf.signOut() } }) { Text("Sign out") } },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
}

/**
 * The vault the notes go to: chosen once with Android's folder picker. Each book's highlights,
 * notes and drawings are written to Shelf/<title>.md there, from its notes panel in the reader or
 * all at once here, in the same Markdown as the site's export.
 */
@Composable
private fun ObsidianSettings() {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var vault by remember { mutableStateOf(com.sharathchenna.shelf.data.Vault.name(context)) }
    var status by remember { mutableStateOf<String?>(null) }
    val pick = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.OpenDocumentTree()) { tree ->
        if (tree != null) {
            com.sharathchenna.shelf.data.Vault.choose(context, tree)
            vault = com.sharathchenna.shelf.data.Vault.name(context)
        }
    }
    Text(vault?.let { "Vault: $it" } ?: "No vault chosen", fontFamily = Serif, fontSize = 20.sp, color = paper.fg)
    Text(
        "Highlights, notes and drawings go into a Shelf folder in your vault, a Markdown file a book, written over each time with the latest. Send a book's from its notes in the reader, or every book's from here.",
        fontFamily = Sans, fontSize = 14.sp, lineHeight = 20.sp, color = paper.muted,
    )
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(onClick = { pick.launch(null) }) { Text(if (vault == null) "Choose the vault folder" else "Change") }
        if (vault != null) {
            Button(onClick = {
                status = "Sending…"
                scope.launch {
                    status = runCatching {
                        val books = shelf.api.export().books
                        books.forEach { b -> com.sharathchenna.shelf.data.Vault.write(context, com.sharathchenna.shelf.data.notesFileName(b.meta.title), com.sharathchenna.shelf.data.notesMarkdown(b.meta, b.highlights)) }
                        "Sent ${books.size} book${if (books.size == 1) "" else "s"} to Shelf/ in the vault."
                    }.getOrElse { it.message ?: "Couldn't send them." }
                }
            }) { Text("Send every book's notes") }
        }
    }
    status?.let { Text(it, fontFamily = Sans, fontSize = 13.sp, color = paper.muted) }
}
