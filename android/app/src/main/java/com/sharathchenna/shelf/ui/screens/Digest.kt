package com.sharathchenna.shelf.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import coil3.compose.AsyncImage
import com.sharathchenna.shelf.data.FeedData
import com.sharathchenna.shelf.data.FeedItem
import com.sharathchenna.shelf.data.Library
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.data.TriageChange
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.Web
import com.sharathchenna.shelf.ui.library.faviconOf
import com.sharathchenna.shelf.ui.library.hostOf
import com.sharathchenna.shelf.ui.library.savedOn
import com.sharathchenna.shelf.ui.library.sourceOf
import com.sharathchenna.shelf.ui.library.timeLeft
import com.sharathchenna.shelf.ui.openBook
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import kotlin.math.roundToInt

/*
 * The Daily Digest, as Readwise Reader's: what's new, one card at a time, to decide on there and
 * then. A thing in the Inbox goes to Later or the Archive, or stays (seen); something from the
 * Feed is saved to Later or skipped (seen). A card swiped right is kept, left let go; a tap reads it.
 */

/** One card: something in the Inbox not opened yet, or a Feed item not seen. */
sealed interface DigestCard {
    val key: String
    data class Doc(val book: ShelfBook) : DigestCard { override val key get() = "doc:${book.id}" }
    data class Item(val item: FeedItem) : DigestCard { override val key get() = "item:${item.id}" }
}

/** How many cards a digest holds at most. */
private const val DIGEST_SIZE = 12

/** Today's digest: unopened things in the Inbox, and the Feed's unseen items from the last three days, newest first. */
fun digestCards(library: Library?, feed: FeedData?): List<DigestCard> {
    val docs = library?.books.orEmpty().filter { it.trashed == null && it.place == "inbox" && !it.seen && it.pct == 0.0 }
        .sortedByDescending { it.added }.take(DIGEST_SIZE / 2).map { DigestCard.Doc(it) }
    val since = Instant.now().minus(Duration.ofDays(3))
    val items = feed?.items.orEmpty().filter { !it.seen && it.clipId == null && (runCatching { Instant.parse(it.published) }.getOrNull()?.isAfter(since) ?: true) }
        .take(DIGEST_SIZE - docs.size).map { DigestCard.Item(it) }
    return (docs + items)
}

@Composable
fun DigestScreen(nav: NavHostController, onExit: () -> Unit) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val library by shelf.library.collectAsState()
    val feed by shelf.feed.collectAsState()
    // The cards as they were on opening, so deciding on one doesn't reshuffle the rest.
    var keys by rememberSaveable { mutableStateOf<List<String>?>(null) }
    val fresh = remember(library, feed) { digestCards(library, feed) }
    if (keys == null && (library != null)) keys = fresh.map { it.key }
    val byKey = remember(library, feed) {
        (library?.books.orEmpty().map { DigestCard.Doc(it) } + feed?.items.orEmpty().map { DigestCard.Item(it) }).associateBy { it.key }
    }
    val cards = keys.orEmpty().mapNotNull { byKey[it] }
    var at by rememberSaveable { mutableIntStateOf(0) }
    var kept by rememberSaveable { mutableIntStateOf(0) }

    val decide: (DigestCard, Boolean, String?) -> Unit = { card, keep, place ->
        scope.launch {
            when (card) {
                is DigestCard.Doc -> runCatching {
                    shelf.triage(TriageChange(listOf(card.book.id), place = place, seen = true))
                }
                is DigestCard.Item -> runCatching {
                    if (keep) shelf.placeFeedItem(card.item, place ?: "later") else shelf.markFeed(listOf(card.item.id), true)
                }
            }
        }
        if (keep) kept++
        at++
    }
    val read: (DigestCard) -> Unit = { card ->
        when (card) {
            is DigestCard.Doc -> {
                scope.launch { runCatching { shelf.triage(TriageChange(listOf(card.book.id), seen = true)) } }
                openBook(context, nav, card.book)
            }
            is DigestCard.Item -> scope.launch {
                runCatching { shelf.placeFeedItem(card.item, "feed") }.onSuccess { clipId ->
                    val book = shelf.book(clipId)
                    if (book != null) openBook(context, nav, book) else nav.navigate(Web("/reader/clip/$clipId", card.item.title, prepare = true))
                }
            }
        }
        at++
    }

    Box(Modifier.fillMaxSize().background(paper.bg)) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.WbSunny, null, tint = paper.accent, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(10.dp))
                Text("Daily Digest", fontFamily = Serif, fontSize = 24.sp, color = paper.fg, modifier = Modifier.weight(1f))
                if (cards.isNotEmpty() && at < cards.size) Text("${at + 1} of ${cards.size}", fontFamily = Sans, fontSize = 14.sp, color = paper.muted)
                Spacer(Modifier.width(14.dp))
                Icon(Icons.Outlined.Close, "Leave the digest", tint = paper.fg, modifier = Modifier.size(40.dp).clip(CircleShape).clickable(onClick = onExit).padding(8.dp))
            }
            // How far through: a dash for each card.
            if (cards.size > 1) Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                cards.indices.forEach { i ->
                    Box(Modifier.weight(1f).size(height = 3.dp, width = 1.dp).clip(CircleShape).background(if (i < at) paper.accent else if (i == at) paper.fg else paper.rule))
                }
            }
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                AnimatedContent(at, transitionSpec = { slideInHorizontally { it / 2 } togetherWith slideOutHorizontally { -it / 2 } }, label = "card") { i ->
                    val card = cards.getOrNull(i)
                    if (card == null) Done(cards.size, kept, onExit)
                    else SwipeCard(onLeft = { decide(card, false, if (card is DigestCard.Doc) "archive" else null) }, onRight = { decide(card, true, "later") }) {
                        Card(card, onRead = { read(card) })
                    }
                }
            }
            cards.getOrNull(at)?.let { card ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 18.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally)) {
                    when (card) {
                        is DigestCard.Doc -> {
                            Decision("Archive", Icons.Outlined.Archive) { decide(card, false, "archive") }
                            Decision("Keep in the Inbox", Icons.Outlined.Inbox) { decide(card, true, "inbox") }
                            Decision("Later", Icons.Outlined.Schedule, dark = true) { decide(card, true, "later") }
                        }
                        is DigestCard.Item -> {
                            Decision("Skip", Icons.Outlined.SkipNext) { decide(card, false, null) }
                            Decision("Save to Later", Icons.Outlined.Schedule, dark = true) { decide(card, true, "later") }
                        }
                    }
                }
            }
        }
    }
}

/** A card that can be flung: right to keep it, left to let it go. */
@Composable
private fun SwipeCard(onLeft: () -> Unit, onRight: () -> Unit, content: @Composable () -> Unit) {
    var dx by remember { mutableFloatStateOf(0f) }
    Box(
        Modifier.offset { IntOffset(dx.roundToInt(), 0) }.pointerInput(Unit) {
            detectHorizontalDragGestures(
                onDragEnd = {
                    val limit = size.width * 0.22f
                    when {
                        dx > limit -> onRight()
                        dx < -limit -> onLeft()
                    }
                    dx = 0f
                },
                onDragCancel = { dx = 0f },
            ) { _, amount -> dx += amount }
        },
    ) { content() }
}

@Composable
private fun Card(card: DigestCard, onRead: () -> Unit) {
    val paper = LocalPaper.current
    val shelf = LocalShelf.current
    val feed by shelf.feed.collectAsState()
    val (title, source, icon, image, about, foot) = when (card) {
        is DigestCard.Doc -> Six(card.book.title, sourceOf(card.book, null), faviconOf(card.book.url), card.book.image ?: card.book.photo, card.book.dek, listOfNotNull(card.book.author.takeIf { it.isNotBlank() }, timeLeft(card.book), savedOn(card.book.added)).joinToString(" · "))
        is DigestCard.Item -> {
            val f = feed?.feeds?.find { it.id == card.item.feedId }
            Six(card.item.title, (f?.title ?: hostOf(card.item.url) ?: "").uppercase(), f?.icon ?: faviconOf(f?.site ?: card.item.url), card.item.image, card.item.summary, listOfNotNull(card.item.author, ago(card.item.published)).joinToString(" · "))
        }
    }
    Column(
        Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 20.dp).clip(RoundedCornerShape(26.dp)).background(paper.raised).border(1.dp, paper.rule, RoundedCornerShape(26.dp))
            .clickable(onClick = onRead).verticalScroll(rememberScrollState()),
    ) {
        image?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().aspectRatio(1.9f).background(paper.sunk)) }
        Column(Modifier.padding(28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                icon?.let { AsyncImage(it, null, Modifier.size(16.dp).clip(RoundedCornerShape(3.dp))); Spacer(Modifier.width(8.dp)) }
                Text(source, style = Eyebrow, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(title, fontFamily = Serif, fontWeight = FontWeight(500), fontSize = 30.sp, lineHeight = 36.sp, color = paper.fg)
            about?.let { Text(it.replace(Regex("<[^>]+>"), " ").replace(Regex("\\s+"), " ").trim(), fontFamily = Sans, fontSize = 16.sp, lineHeight = 24.sp, color = paper.muted) }
            if (foot.isNotBlank()) Text(foot, fontFamily = Sans, fontSize = 13.sp, color = paper.faint)
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
                Text("Tap to read it", fontFamily = Sans, fontWeight = FontWeight(600), fontSize = 14.sp, color = paper.accent)
                Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, tint = paper.accent, modifier = Modifier.padding(start = 6.dp).size(16.dp))
            }
        }
    }
}

private data class Six(val a: String, val b: String, val c: String?, val d: String?, val e: String?, val f: String)

@Composable
private fun Decision(label: String, icon: ImageVector, dark: Boolean = false, onClick: () -> Unit) {
    val paper = LocalPaper.current
    Row(
        Modifier.clip(CircleShape).background(if (dark) paper.fg else Color.Transparent).then(if (dark) Modifier else Modifier.border(1.dp, paper.rule, CircleShape))
            .clickable(onClick = onClick).padding(horizontal = 22.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (dark) paper.bg else paper.fg, modifier = Modifier.size(19.dp))
        Spacer(Modifier.width(8.dp))
        Text(label, fontFamily = Sans, fontWeight = FontWeight(600), fontSize = 15.sp, color = if (dark) paper.bg else paper.fg)
    }
}

@Composable
private fun Done(total: Int, kept: Int, onExit: () -> Unit) {
    val paper = LocalPaper.current
    Column(Modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(Icons.Outlined.WbSunny, null, tint = paper.accent, modifier = Modifier.size(44.dp))
        Text(if (total == 0) "Nothing new today" else "That's the digest", fontFamily = Serif, fontSize = 32.sp, color = paper.fg)
        Text(
            if (total == 0) "New saves and the Feed's new items come here, one at a time." else "$kept of $total kept for reading. The rest are out of the way.",
            fontFamily = Sans, fontSize = 15.sp, color = paper.muted,
        )
        Spacer(Modifier.size(8.dp))
        Decision("Back home", Icons.AutoMirrored.Outlined.ArrowForward, dark = true, onClick = onExit)
    }
}

/** Home's way in: the digest, and how many cards are in it. */
@Composable
fun DigestPrompt(count: Int, onOpen: () -> Unit) {
    val paper = LocalPaper.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(paper.raised).border(1.dp, paper.accent.copy(alpha = 0.5f), RoundedCornerShape(18.dp))
            .clickable(onClick = onOpen).padding(horizontal = 20.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.WbSunny, null, tint = paper.accent, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text("Daily Digest", fontFamily = Sans, fontWeight = FontWeight(600), fontSize = 16.sp, color = paper.fg)
            Text("What's new, one at a time: keep it or let it go", fontFamily = Sans, fontSize = 13.sp, color = paper.muted)
        }
        Text("$count", fontFamily = Sans, fontWeight = FontWeight(600), fontSize = 16.sp, color = paper.fg)
        Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, tint = paper.muted, modifier = Modifier.padding(start = 8.dp).size(18.dp))
    }
}
