package com.sharathchenna.shelf.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Tab
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import coil3.compose.AsyncImage
import com.sharathchenna.shelf.BuildConfig
import com.sharathchenna.shelf.data.ReviewCard
import com.sharathchenna.shelf.data.SearchResult
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.Reader
import com.sharathchenna.shelf.ui.Web
import com.sharathchenna.shelf.ui.library.KIND_LABEL
import com.sharathchenna.shelf.ui.library.fmtMinutes
import com.sharathchenna.shelf.ui.openBook
import com.sharathchenna.shelf.ui.openExternal
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.update.Updates
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId

@Composable
private fun Heading(title: String, subtitle: String? = null) {
    Column(Modifier.statusBarsPadding().padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 8.dp)) {
        Text(title, style = MaterialTheme.typography.displaySmall)
        subtitle?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = LocalPaper.current.muted) }
    }
}

// ---- clippings -------------------------------------------------------------------------------

private val CLIP_TABS = listOf("article" to "Articles", "paper" to "Papers", "newsletter" to "Newsletters", "tweet" to "Posts")

/** The clippings, a tab per kind, newest first, as cards in as many columns as fit. */
@Composable
fun ClippingsScreen(nav: NavHostController) {
    val shelf = LocalShelf.current
    val library by shelf.library.collectAsState()
    val context = LocalContext.current
    val present = CLIP_TABS.filter { (kind, _) -> library?.books?.any { it.kind == kind } == true }
    var tab by rememberSaveable { mutableStateOf(0) }
    Column(Modifier.fillMaxSize().background(LocalPaper.current.bg)) {
        Heading("Clippings")
        if (present.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Nothing clipped yet. Share a link to Shelf to save it.", color = LocalPaper.current.muted) }
            return
        }
        val selected = tab.coerceIn(0, present.lastIndex)
        PrimaryScrollableTabRow(selectedTabIndex = selected, edgePadding = 24.dp) {
            present.forEachIndexed { i, (_, label) -> Tab(selected = selected == i, onClick = { tab = i }, text = { Text(label) }) }
        }
        val kind = present[selected].first
        val items = library?.books.orEmpty().filter { it.kind == kind }.sortedByDescending { it.added }
        LazyVerticalStaggeredGrid(
            columns = StaggeredGridCells.Adaptive(300.dp),
            contentPadding = PaddingValues(24.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalItemSpacing = 16.dp,
        ) {
            items(items, key = { it.id }) { clip -> ClipCard(clip) { openBook(context, nav, clip) } }
        }
    }
}

@Composable
private fun ClipCard(book: ShelfBook, onClick: () -> Unit) {
    val paper = LocalPaper.current
    Column(Modifier.clip(RoundedCornerShape(16.dp)).background(paper.raised).clickable(onClick = onClick)) {
        book.image?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().size(width = 300.dp, height = 150.dp)) }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(book.author.uppercase(), style = Eyebrow, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(book.title, style = MaterialTheme.typography.titleLarge, maxLines = 3, overflow = TextOverflow.Ellipsis)
            book.dek?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = paper.muted, maxLines = 4, overflow = TextOverflow.Ellipsis) }
            Text(
                fmtMinutes(book.minutes) + when {
                    book.fileId != null || book.readable -> " · Read here"
                    else -> ""
                },
                style = MaterialTheme.typography.labelMedium,
                color = paper.accent,
            )
        }
    }
}

// ---- search ----------------------------------------------------------------------------------

/** The site's search by meaning, over everything: books, papers, articles, newsletters and posts. */
@Composable
fun SearchScreen(nav: NavHostController) {
    val shelf = LocalShelf.current
    val context = LocalContext.current
    val paper = LocalPaper.current
    var query by rememberSaveable { mutableStateOf("") }
    var results by remember { mutableStateOf<List<SearchResult>>(emptyList()) }
    var state by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    LaunchedEffect(query) {
        if (query.trim().length < 2) {
            results = emptyList(); state = null; return@LaunchedEffect
        }
        delay(350)
        state = "Searching…"
        runCatching { shelf.api.search(query) }
            .onSuccess { results = it; state = if (it.isEmpty()) "Nothing found." else null }
            .onFailure { state = it.message }
    }
    Column(Modifier.fillMaxSize().background(paper.bg)) {
        Heading("Search", "By meaning, across books, papers, articles, newsletters and posts.")
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            leadingIcon = { Icon(Icons.Outlined.Search, null) },
            placeholder = { Text("What are you looking for?") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = {}),
            modifier = Modifier.padding(horizontal = 24.dp).fillMaxWidth().widthIn(max = 900.dp).focusRequester(focus),
        )
        state?.let { Text(it, color = paper.muted, modifier = Modifier.padding(24.dp)) }
        LazyColumn(contentPadding = PaddingValues(horizontal = 24.dp, vertical = 12.dp)) {
            items(results, key = { it.kind + it.id }) { r ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable {
                        val book = shelf.book(r.id)
                        when {
                            book != null -> openBook(context, nav, book)
                            r.paperId != null -> nav.navigate(Web("/reader/paper/${r.paperId}", r.title, prepare = true))
                            r.articleId != null -> nav.navigate(Web("/reader/clip/${r.articleId}", r.title, prepare = true))
                            else -> openExternal(context, shelf.api.absolute(r.href))
                        }
                    }.padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AsyncImage(r.image, null, contentScale = ContentScale.Crop, modifier = Modifier.size(48.dp, 64.dp).clip(RoundedCornerShape(4.dp)).background(paper.sunk))
                    Column(Modifier.weight(1f)) {
                        Text((KIND_LABEL[r.kind] ?: r.kind).uppercase(), style = Eyebrow, color = paper.muted)
                        Text(r.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(r.subtitle, style = MaterialTheme.typography.bodySmall, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                HorizontalDivider(color = paper.line)
            }
        }
    }
}

// ---- the daily review ------------------------------------------------------------------------

private fun todayMs(): Long = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()

/** Five highlights a day, spaced like flashcards (lib/review.ts): keep one in rotation, or be done with it. */
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
    Column(Modifier.fillMaxSize().background(paper.bg)) {
        Heading("Today's review", if (total > 0) "$done of $total seen" else null)
        val card = deck?.firstOrNull()
        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
            when {
                error != null -> Text(error!!, color = paper.muted)
                deck == null -> Text("Finding today's highlights…", color = paper.muted)
                card == null -> Text(if (total > 0) "That's today's five. Back tomorrow." else "Highlight something while reading, and it comes back here.", color = paper.muted, style = MaterialTheme.typography.titleLarge)
                else -> Column(Modifier.widthIn(max = 720.dp).clip(RoundedCornerShape(20.dp)).background(paper.raised).padding(32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("${card.title} · ${card.author}".uppercase(), style = Eyebrow, color = paper.muted)
                    Text("“${card.text}”", style = MaterialTheme.typography.headlineSmall)
                    card.note?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = paper.muted) }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        val seen = { keep: Boolean ->
                            scope.launch {
                                runCatching { shelf.api.reviewed(card, keep, todayMs()) }
                                deck = deck!!.drop(1)
                                done++
                            }
                        }
                        Button(onClick = { seen(true) }) { Text("Keep it coming") }
                        OutlinedButton(onClick = { seen(false) }) { Text("Done with it") }
                        TextButton(onClick = { nav.navigate(Reader(card.fileId, at = card.id)) }) { Text("Open in the book") }
                    }
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
    Column(Modifier.fillMaxSize().background(paper.bg)) {
        Heading("On this device", "Books here open without a connection. Highlights and your place are sent when you're back online.")
        if (downloads.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Nothing yet. Choose “Keep offline” on a book's card.", color = paper.muted) }
            return
        }
        LazyColumn(contentPadding = PaddingValues(24.dp)) {
            items(downloads.values.toList(), key = { it.bookId }) { d ->
                Row(Modifier.fillMaxWidth().clickable { nav.navigate(Reader(d.bookId)) }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(d.title, style = MaterialTheme.typography.titleMedium)
                        Text("${d.format.uppercase()} · ${"%.1f".format(d.bytes / 1_000_000.0)} MB", style = MaterialTheme.typography.bodySmall, color = paper.muted)
                    }
                    TextButton(onClick = { scope.launch { shelf.removeDownload(d.bookId) } }) { Text("Remove") }
                }
                HorizontalDivider(color = paper.line)
            }
        }
    }
}

// ---- settings --------------------------------------------------------------------------------

@Composable
fun SettingsScreen() {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var update by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().background(paper.bg)) {
        Heading("Settings")
        Column(Modifier.padding(24.dp).widthIn(max = 640.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Column {
                Text("SITE", style = Eyebrow, color = paper.muted)
                Text(BuildConfig.SITE_URL, style = MaterialTheme.typography.bodyLarge)
            }
            Column {
                Text("APP", style = Eyebrow, color = paper.muted)
                Text("Version ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodyLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = {
                        update = "Checking…"
                        scope.launch { update = Updates.check(context, install = true) }
                    }) { Text("Check for an update") }
                    update?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = paper.muted) }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("THIS DEVICE", style = Eyebrow, color = paper.muted)
                Text("Signing out removes the token, your downloads and anything not yet sent from this device.", style = MaterialTheme.typography.bodyMedium, color = paper.muted)
                OutlinedButton(onClick = { scope.launch { runCatching { shelf.sync() }; shelf.signOut() } }) { Text("Sign out") }
            }
        }
    }
}
