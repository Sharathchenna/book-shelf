package com.sharathchenna.shelf.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.material.icons.outlined.Replay
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import coil3.compose.AsyncImage
import com.sharathchenna.shelf.data.Library
import com.sharathchenna.shelf.data.LibraryFile
import com.sharathchenna.shelf.data.Progress
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.data.Topic
import com.sharathchenna.shelf.data.TriageChange
import com.sharathchenna.shelf.ui.Listen
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.library.BookSheetHost
import com.sharathchenna.shelf.ui.library.Cover
import com.sharathchenna.shelf.ui.library.KIND_LABEL
import com.sharathchenna.shelf.ui.library.fmtMinutes
import com.sharathchenna.shelf.ui.library.hostOf
import com.sharathchenna.shelf.ui.openBook
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import com.sharathchenna.shelf.ui.theme.hex
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import java.util.Locale
import kotlin.math.roundToInt

/** Something being read: its book or clipping, its file, and where the owner is in it. */
internal data class InProgress(val book: ShelfBook, val file: LibraryFile, val progress: Progress)

/** Everything started and not finished, the most recently read first. */
internal fun inProgress(library: Library?): List<InProgress> {
    library ?: return emptyList()
    val byFile = library.books.filter { it.fileId != null }.associateBy { it.fileId }
    return library.files.mapNotNull { f ->
        val p = f.progress?.takeIf { it.fraction > 0.0 && it.fraction < 0.99 } ?: return@mapNotNull null
        byFile[f.id]?.takeIf { it.trashed == null }?.let { InProgress(it, f, p) }
    }.sortedByDescending { it.progress.updatedAt }
}

/** "Friday evening". */
private fun greeting(): String {
    val now = LocalDateTime.now()
    val day = now.dayOfWeek.getDisplayName(java.time.format.TextStyle.FULL, Locale.UK)
    val part = when (now.hour) { in 5..11 -> "morning"; in 12..16 -> "afternoon"; in 17..21 -> "evening"; else -> "night" }
    return "$day $part"
}

/**
 * Home: what you're reading, biggest, with the next two beside it and the day's review when
 * there's one; under them, rows as Reader's home has them: recently added, quick reads, long
 * reads, saved for later. A tap opens a thing; a long press takes it down for its details, Listen
 * and Keep offline.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(nav: NavHostController, onAdd: () -> Unit, onNotes: () -> Unit) {
    val shelf = LocalShelf.current
    val library by shelf.library.collectAsState()
    val context = LocalContext.current
    val paper = LocalPaper.current
    val scope = rememberCoroutineScope()
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    var due by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { shelf.api.review(todayMs()) }.onSuccess { due = it.deck.size } }

    val books = library?.books.orEmpty()
    val topics = library?.topics.orEmpty()
    val reading = remember(library) { inProgress(library) }
    val started = remember(reading) { reading.map { it.book.id }.toSet() }
    val shelves = remember(books, started) { homeShelves(books, started) }
    val details: (ShelfBook) -> Unit = { open = it.id }
    val read: (ShelfBook) -> Unit = { b ->
        if (!b.seen) scope.launch { runCatching { shelf.triage(TriageChange(listOf(b.id), seen = true)) } }
        openBook(context, nav, b)
    }

    BookSheetHost(open, nav, onClose = { open = null }) {
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { refreshing = true; scope.launch { runCatching { shelf.sync() }; refreshing = false } },
            modifier = Modifier.fillMaxSize(),
        ) {
            Page { side ->
                LazyVerticalStaggeredGrid(
                    columns = StaggeredGridCells.Adaptive(300.dp),
                    contentPadding = PaddingValues(start = side, end = side, bottom = 48.dp),
                    horizontalArrangement = Arrangement.spacedBy(20.dp),
                    verticalItemSpacing = 20.dp,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    item(key = "head", span = StaggeredGridItemSpan.FullLine) {
                        Row(Modifier.statusBarsPadding().padding(top = 36.dp, bottom = 6.dp), verticalAlignment = Alignment.Bottom) {
                            Column(Modifier.weight(1f)) {
                                Text(greeting(), fontFamily = Sans, fontSize = 15.sp, color = paper.muted)
                                Text(
                                    if (reading.isNotEmpty()) "Pick up where you left off" else "What to read next",
                                    fontFamily = Serif, fontWeight = FontWeight(420), fontSize = 46.sp, lineHeight = 50.sp, letterSpacing = (-0.03).em, color = paper.fg,
                                )
                            }
                            Pill("Add", Icons.Outlined.Add, dark = true, onClick = onAdd)
                        }
                    }
                    item(key = "reading", span = StaggeredGridItemSpan.FullLine) {
                        when {
                            library == null -> Text("Taking the books out…", fontFamily = Sans, color = paper.muted)
                            else -> Reading(reading, topics, due, onOpen = read, onDetails = details, onReview = onNotes, onListen = { nav.navigate(Listen(it)) })
                        }
                    }
                    if (library != null && shelves.isEmpty()) item(key = "none", span = StaggeredGridItemSpan.FullLine) {
                        Text(
                            "Nothing waiting. Share a link to Shelf from any app, or tap Add, and it's saved here.",
                            fontFamily = Sans, fontSize = 15.sp, color = paper.muted, modifier = Modifier.padding(top = 22.dp),
                        )
                    }
                    shelves.forEach { row ->
                        item(key = "shelf-${row.key}", span = StaggeredGridItemSpan.FullLine) {
                            HomeShelf(row, topics, onOpen = read, onDetails = details)
                        }
                    }
                }
            }
        }
    }
}

/** What's being read: the latest large, the next two beside it (under it, on a narrow screen), and the review when it's due. */
@Composable
private fun Reading(
    reading: List<InProgress>,
    topics: List<Topic>,
    due: Int,
    onOpen: (ShelfBook) -> Unit,
    onDetails: (ShelfBook) -> Unit,
    onReview: () -> Unit,
    onListen: (String) -> Unit,
) {
    val topic = { b: ShelfBook -> topics.find { it.key == b.topic } }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val wide = maxWidth >= 860.dp
        val first = reading.firstOrNull()
        val next = reading.drop(1).take(if (wide) 2 else 3)
        val hero: @Composable (Modifier) -> Unit = { m ->
            if (first != null) Hero(first, topic(first.book), onOpen, onDetails, onListen, m) else NothingYet(m)
        }
        val side: @Composable () -> Unit = {
            next.forEach { Next(it, topic(it.book), onOpen, onDetails) }
            if (due > 0) ReviewPrompt(due, onReview)
        }
        if (wide) {
            Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                hero(Modifier.weight(1.5f).fillMaxHeight())
                if (next.isNotEmpty() || due > 0) Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp)) { side() }
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) { hero(Modifier.fillMaxWidth()); side() }
        }
    }
}

/** "Book · Sebastian Raschka", or an article's site. (Not "chapter 7 of 12": a book's sections count its front matter too.) */
private fun eyebrow(r: InProgress, source: String?): String =
    listOfNotNull(KIND_LABEL[r.book.kind] ?: "Book", (if (r.book.kind == "book") r.book.author else source)?.takeIf { it.isNotBlank() }).joinToString(" · ")

/** The chapter, and the time left in the whole. */
private fun whereLine(r: InProgress): String {
    val chapter = r.file.sections.getOrNull(r.progress.sectionIndex)?.title?.takeIf { r.file.sections.size > 1 && it.isNotBlank() }
    val left = (r.book.minutes * (1 - r.progress.fraction)).roundToInt().coerceAtLeast(1)
    return listOfNotNull(chapter, "${fmtMinutes(left)} left").joinToString(" · ")
}

@Composable
private fun Hero(r: InProgress, topic: Topic?, onOpen: (ShelfBook) -> Unit, onDetails: (ShelfBook) -> Unit, onListen: (String) -> Unit, modifier: Modifier) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val shape = RoundedCornerShape(24.dp)
    var narrated by remember(r.file.id) { mutableStateOf(false) }
    LaunchedEffect(r.file.id) { narrated = runCatching { shelf.api.voices(r.file.id).any { it.sections > 0 } }.getOrDefault(false) }
    val source = if (r.book.kind == "book") null else shelf.clip(r.book.id)?.source?.takeIf { it.isNotBlank() } ?: hostOf(r.book.url)
    Row(
        modifier.clip(shape).background(paper.raised).border(1.dp, paper.rule, shape)
            .combinedClickable(onLongClick = { onDetails(r.book) }, onClick = { onOpen(r.book) }).padding(26.dp),
        horizontalArrangement = Arrangement.spacedBy(28.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(r.book, topic, Modifier.width(150.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(eyebrow(r, source).uppercase(), style = Eyebrow, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(r.book.title, fontFamily = Serif, fontWeight = FontWeight(450), fontSize = 30.sp, lineHeight = 35.sp, color = paper.fg, maxLines = 3, overflow = TextOverflow.Ellipsis)
            Text(whereLine(r), fontFamily = Sans, fontSize = 15.sp, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Bar(r.progress.fraction.toFloat(), Modifier.padding(top = 4.dp))
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Pill(if (r.book.kind == "book") "Continue reading" else "Continue", Icons.AutoMirrored.Outlined.MenuBook, dark = true) { onOpen(r.book) }
                if (narrated) Pill("Listen", Icons.Outlined.Headphones) { onListen(r.file.id) }
            }
        }
    }
}

/** Nothing started yet: a pointer to what is waiting. */
@Composable
private fun NothingYet(modifier: Modifier) {
    val paper = LocalPaper.current
    val shape = RoundedCornerShape(24.dp)
    Column(modifier.clip(shape).background(paper.raised).border(1.dp, paper.rule, shape).padding(28.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Nothing on the go", fontFamily = Serif, fontSize = 24.sp, color = paper.fg)
        Text("Start something saved below, or a book from the Library, and it waits for you here.", fontFamily = Sans, fontSize = 15.sp, color = paper.muted)
    }
}

/** One of the next things being read, small. */
@Composable
private fun Next(r: InProgress, topic: Topic?, onOpen: (ShelfBook) -> Unit, onDetails: (ShelfBook) -> Unit) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val shape = RoundedCornerShape(18.dp)
    val source = if (r.book.kind == "book") r.book.author else shelf.clip(r.book.id)?.source?.takeIf { it.isNotBlank() } ?: hostOf(r.book.url) ?: r.book.author
    Row(
        Modifier.fillMaxWidth().clip(shape).background(paper.raised).border(1.dp, paper.rule, shape)
            .combinedClickable(onLongClick = { onDetails(r.book) }, onClick = { onOpen(r.book) }).padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Thumb(r.book, topic)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(listOfNotNull(KIND_LABEL[r.book.kind], source.takeIf { it.isNotBlank() }).joinToString(" · "), fontFamily = Sans, fontSize = 12.5.sp, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(r.book.title, fontFamily = Serif, fontWeight = FontWeight(450), fontSize = 17.sp, lineHeight = 21.sp, color = paper.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Bar(r.progress.fraction.toFloat(), Modifier.padding(top = 3.dp))
        }
    }
}

/** A book's cover, small; an article's picture, or its initial on its colour. */
@Composable
private fun Thumb(book: ShelfBook, topic: Topic?) {
    if (book.kind == "book") {
        Cover(book, topic, Modifier.width(46.dp))
        return
    }
    Box(Modifier.size(64.dp).clip(RoundedCornerShape(12.dp)).background(hex(book.look.color)), contentAlignment = Alignment.Center) {
        if (book.image != null) AsyncImage(book.image, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Text(book.title.take(1), fontFamily = Serif, fontSize = 24.sp, color = hex(book.look.fg))
    }
}

/** The day's review, when there's something in it. */
@Composable
private fun ReviewPrompt(due: Int, onReview: () -> Unit) {
    val paper = LocalPaper.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(paper.accent.copy(alpha = 0.10f)).clickable(onClick = onReview).padding(horizontal = 18.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Replay, null, tint = paper.accent, modifier = Modifier.size(24.dp))
        Column(Modifier.weight(1f)) {
            Text("$due highlight${if (due == 1) "" else "s"} to look at again", fontFamily = Sans, fontWeight = FontWeight(600), fontSize = 15.sp, color = paper.fg)
            Text("From your reading · a minute or two", fontFamily = Sans, fontSize = 13.sp, color = paper.muted)
        }
        Pill("Review", null, dark = true, onClick = onReview)
    }
}

/** How far through, as a bar in the site's green. */
@Composable
internal fun Bar(progress: Float, modifier: Modifier = Modifier) {
    val paper = LocalPaper.current
    Box(modifier.fillMaxWidth().height(5.dp).clip(CircleShape).background(paper.sunk)) {
        Box(Modifier.fillMaxWidth(progress.coerceIn(0f, 1f)).height(5.dp).clip(CircleShape).background(paper.accent))
    }
}

/** A rounded button: ink for the main thing, outlined for the rest. */
@Composable
internal fun Pill(text: String, icon: ImageVector?, dark: Boolean = false, onClick: () -> Unit) {
    val paper = LocalPaper.current
    Row(
        Modifier.clip(CircleShape).background(if (dark) paper.fg else Color.Transparent)
            .then(if (dark) Modifier else Modifier.border(1.dp, paper.rule, CircleShape))
            .clickable(onClick = onClick).padding(horizontal = 18.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        icon?.let { Icon(it, null, tint = if (dark) paper.bg else paper.fg, modifier = Modifier.size(18.dp)) }
        Text(text, fontFamily = Sans, fontWeight = FontWeight(500), fontSize = 15.sp, color = if (dark) paper.bg else paper.fg, maxLines = 1)
    }
}

/** One of a row of filters, with its count. */
@Composable
internal fun Choice(label: String, count: Int?, on: Boolean, onClick: () -> Unit) {
    val paper = LocalPaper.current
    Row(
        Modifier.clip(CircleShape).background(if (on) paper.fg else Color.Transparent)
            .then(if (on) Modifier else Modifier.border(1.dp, paper.rule, CircleShape))
            .clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(label, fontFamily = Sans, fontWeight = FontWeight(500), fontSize = 14.sp, color = if (on) paper.bg else paper.fg)
        count?.let { Text("$it", fontFamily = Sans, fontSize = 14.sp, color = if (on) paper.bg.copy(alpha = 0.6f) else paper.faint) }
    }
}

/** A row of things on Home, as Reader's home has them: what's new, what's quick, what's long, what's saved for later. */
internal data class HomeRow(val key: String, val title: String, val icon: String, val books: List<ShelfBook>)

internal fun homeShelves(books: List<ShelfBook>, started: Set<String>): List<HomeRow> {
    val live = books.filter { it.trashed == null && it.pct < 1 && it.id !in started }
    val toRead = live.filter { it.place != "archive" && (it.kind != "book" || it.fileId != null) }
    return listOf(
        HomeRow("new", "Recently added", "agent", live.filter { it.place == "inbox" }.sortedByDescending { it.added }),
        HomeRow("quick", "Quick reads", "quick", toRead.filter { it.minutes <= 12 }.sortedByDescending { it.added }),
        HomeRow("long", "Long reads", "long", toRead.filter { it.minutes in 25..600 }.sortedByDescending { it.added }),
        HomeRow("later", "Saved for later", "reading", live.filter { it.place == "later" && (it.kind != "book" || it.fileId != null) }.sortedByDescending { it.added }),
    ).filter { it.books.isNotEmpty() }.map { it.copy(books = it.books.take(20)) }
}

/** One of Home's rows: its heading, and its things side by side, scrolled sideways. */
@Composable
private fun HomeShelf(row: HomeRow, topics: List<Topic>, onOpen: (ShelfBook) -> Unit, onDetails: (ShelfBook) -> Unit) {
    val paper = LocalPaper.current
    Column(Modifier.padding(top = 18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            com.sharathchenna.shelf.ui.library.Glyph(row.icon, 22.dp)
            Spacer(Modifier.width(10.dp))
            Text(row.title, fontFamily = Serif, fontWeight = FontWeight(450), fontSize = 24.sp, color = paper.fg)
            Text("  ${row.books.size}", fontFamily = Sans, fontSize = 14.sp, color = paper.faint)
        }
        androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            items(row.books.size, key = { row.books[it].id }) { i ->
                val b = row.books[i]
                ShelfCard(b, topics.find { it.key == b.topic }, onClick = { onOpen(b) }, onLongClick = { onDetails(b) })
            }
        }
    }
}

/** A thing on one of Home's rows: its picture (or cover), its title, and who or where it's from. */
@Composable
private fun ShelfCard(b: ShelfBook, topic: Topic?, onClick: () -> Unit, onLongClick: () -> Unit) {
    val paper = LocalPaper.current
    Column(
        Modifier.width(158.dp).clip(RoundedCornerShape(14.dp)).combinedClickable(onLongClick = onLongClick, onClick = onClick).padding(4.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(Modifier.size(150.dp), contentAlignment = Alignment.Center) {
            if (b.kind == "book") Cover(b, topic, Modifier.height(150.dp))
            else Box(Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).background(hex(b.look.color)), contentAlignment = Alignment.Center) {
                if (b.image != null) AsyncImage(b.image, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                else Text(b.title.take(1), fontFamily = Serif, fontSize = 44.sp, color = hex(b.look.fg))
            }
            if (!b.seen) Box(Modifier.align(Alignment.TopStart).padding(8.dp).size(10.dp).clip(CircleShape).background(paper.accent).border(1.5.dp, paper.bg, CircleShape))
        }
        Text(b.title, fontFamily = Serif, fontWeight = FontWeight(500), fontSize = 15.sp, lineHeight = 19.sp, color = paper.fg, maxLines = 3, overflow = TextOverflow.Ellipsis)
        Text(
            listOfNotNull((if (b.kind == "book") b.author else hostOf(b.url) ?: b.author).takeIf { it.isNotBlank() }, fmtMinutes(b.minutes)).joinToString(" · "),
            fontFamily = Sans, fontSize = 12.5.sp, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}
