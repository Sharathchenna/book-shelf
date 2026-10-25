package com.sharathchenna.shelf.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DoneAll
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.RssFeed
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberSwipeToDismissBoxState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import coil3.compose.AsyncImage
import com.sharathchenna.shelf.data.Feed
import com.sharathchenna.shelf.data.FeedItem
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.Web
import com.sharathchenna.shelf.ui.library.faviconOf
import com.sharathchenna.shelf.ui.library.hostOf
import com.sharathchenna.shelf.ui.openBook
import com.sharathchenna.shelf.ui.openExternal
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant

/**
 * The Feed, as Readwise Reader keeps it apart from the library: what the sites subscribed to have
 * published, unseen first. A tap reads it (it stays in the Feed until saved); swiped right it's
 * saved to Later, left it's seen. The feeds themselves are managed from the bar.
 */
@Composable
fun FeedScreen(nav: NavHostController) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val feed by shelf.feed.collectAsState()
    val library by shelf.library.collectAsState()
    var unseen by rememberSaveable { mutableStateOf(true) }
    var refreshing by remember { mutableStateOf(false) }
    var managing by remember { mutableStateOf(false) }
    var opening by remember { mutableStateOf<String?>(null) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(Unit) { runCatching { shelf.loadFeed() } }

    val feeds = feed?.feeds.orEmpty().associateBy { it.id }
    val items = feed?.items.orEmpty().filter { it.seen != unseen }
    val unseenCount = feed?.items.orEmpty().count { !it.seen }

    val open: (FeedItem) -> Unit = { item ->
        opening = item.id
        scope.launch {
            runCatching { shelf.placeFeedItem(item, "feed") }
                .onSuccess { clipId ->
                    val book = shelf.book(clipId)
                    if (book != null) openBook(context, nav, book) else nav.navigate(Web("/reader/clip/$clipId", item.title, prepare = true))
                }
                .onFailure { snackbar.showSnackbar(it.message ?: "Couldn't open that.") }
            opening = null
        }
    }
    val save: (FeedItem) -> Unit = { item ->
        scope.launch {
            runCatching { shelf.placeFeedItem(item, "later") }
                .onSuccess { snackbar.showSnackbar("Saved to Later") }
                .onFailure { snackbar.showSnackbar(it.message ?: "Couldn't save that.") }
        }
    }

    Box(Modifier.fillMaxSize()) {
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { refreshing = true; scope.launch { runCatching { shelf.loadFeed(check = true) }; refreshing = false } },
            modifier = Modifier.fillMaxSize(),
        ) {
            Page { side ->
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = side, end = side, bottom = 120.dp)) {
                    item(key = "head") {
                        Row(Modifier.statusBarsPadding().padding(top = 36.dp, bottom = 18.dp), verticalAlignment = Alignment.Bottom) {
                            Column(Modifier.weight(1f)) {
                                Text("FEED", style = Eyebrow, color = paper.muted, modifier = Modifier.padding(bottom = 6.dp))
                                Row(verticalAlignment = Alignment.Bottom) {
                                    Text(if (unseen) "Unseen" else "Seen", fontFamily = Serif, fontWeight = FontWeight(420), fontSize = 54.sp, lineHeight = 56.sp, letterSpacing = (-0.03).em, color = paper.fg)
                                    Text("  ${items.size}", fontFamily = Sans, fontSize = 22.sp, color = paper.faint, modifier = Modifier.padding(bottom = 8.dp))
                                }
                            }
                            if (unseen && items.isNotEmpty()) Pill("All seen", Icons.Outlined.DoneAll) { scope.launch { shelf.markFeedAllSeen() } }
                            Spacer(Modifier.width(10.dp))
                            Pill("Feeds  ${feeds.size}", Icons.Outlined.RssFeed) { managing = true }
                        }
                    }
                    if (feed != null && items.isEmpty()) item(key = "none") {
                        Text(
                            when {
                                feeds.isEmpty() -> "No feeds yet. Tap Feeds to subscribe to a site, or Subscribe from an article's Info."
                                unseen -> "All caught up. Pull down to check the feeds now."
                                else -> "Nothing seen yet."
                            },
                            fontFamily = Sans, fontSize = 15.sp, color = paper.muted, modifier = Modifier.padding(vertical = 24.dp),
                        )
                    }
                    items(items, key = { it.id }) { item ->
                        val book = item.clipId?.let { id -> library?.books?.find { it.id == id } }
                        FeedSwipe(item, onSave = { save(item) }, onSeen = { scope.launch { shelf.markFeed(listOf(item.id), !item.seen) } }) {
                            FeedRow(
                                item, feeds[item.feedId], progress = book?.pct ?: 0.0, opening = opening == item.id,
                                onOpen = { open(item) }, onSave = { save(item) },
                                onSeen = { scope.launch { shelf.markFeed(listOf(item.id), !item.seen) } },
                                onOriginal = { openExternal(context, item.url) },
                            )
                        }
                    }
                }
            }
        }
        Row(
            Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 22.dp).clip(CircleShape).background(paper.raised).border(1.dp, paper.rule, CircleShape).padding(5.dp),
        ) {
            listOf(true to "Unseen", false to "Seen").forEach { (k, label) ->
                val on = unseen == k
                Row(Modifier.clip(CircleShape).background(if (on) paper.fg else Color.Transparent).clickable { unseen = k }.padding(horizontal = 18.dp, vertical = 10.dp)) {
                    Text(label, fontFamily = Sans, fontWeight = FontWeight(if (on) 600 else 500), fontSize = 15.sp, color = if (on) paper.bg else paper.fg)
                    if (k && unseenCount > 0) Text("  $unseenCount", fontFamily = Sans, fontSize = 14.sp, color = if (on) paper.bg.copy(alpha = 0.65f) else paper.faint)
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 96.dp))
    }
    if (managing) ManageFeeds(feed?.feeds.orEmpty(), onDismiss = { managing = false })
}

/** Swiped right, saved to Later; left, seen (or unseen again). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FeedSwipe(item: FeedItem, onSave: () -> Unit, onSeen: () -> Unit, content: @Composable () -> Unit) {
    val paper = LocalPaper.current
    val state = rememberSwipeToDismissBoxState(positionalThreshold = { it * 0.3f })
    LaunchedEffect(state.currentValue) {
        when (state.currentValue) {
            SwipeToDismissBoxValue.StartToEnd -> onSave()
            SwipeToDismissBoxValue.EndToStart -> onSeen()
            SwipeToDismissBoxValue.Settled -> return@LaunchedEffect
        }
        state.snapTo(SwipeToDismissBoxValue.Settled)
    }
    SwipeToDismissBox(
        state,
        backgroundContent = {
            val towards = state.dismissDirection
            val later = towards == SwipeToDismissBoxValue.StartToEnd
            Row(
                Modifier.fillMaxSize().background(if (towards == SwipeToDismissBoxValue.Settled) Color.Transparent else if (later) Color(0xFFB7791F) else Color(0xFF4A6FB3)).padding(horizontal = 28.dp),
                horizontalArrangement = if (later) Arrangement.Start else Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (towards != SwipeToDismissBoxValue.Settled) {
                    Icon(if (later) Icons.Outlined.Schedule else Icons.Outlined.TaskAlt, null, tint = Color.White, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(if (later) "Save to Later" else if (item.seen) "Unseen" else "Seen", fontFamily = Sans, fontWeight = FontWeight(600), fontSize = 15.sp, color = Color.White)
                }
            }
        },
        modifier = Modifier.background(paper.bg),
    ) { Box(Modifier.background(paper.bg)) { content() } }
}

/** "3 h", "2 d", or the date. */
internal fun ago(iso: String): String {
    val t = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
    val d = Duration.between(t, Instant.now())
    return when {
        d.toMinutes() < 60 -> "${maxOf(1, d.toMinutes())} min"
        d.toHours() < 24 -> "${d.toHours()} h"
        d.toDays() < 7 -> "${d.toDays()} d"
        else -> com.sharathchenna.shelf.ui.library.savedOn(t.toEpochMilli()) ?: ""
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun FeedRow(item: FeedItem, feed: Feed?, progress: Double, opening: Boolean, onOpen: () -> Unit, onSave: () -> Unit, onSeen: () -> Unit, onOriginal: () -> Unit) {
    val paper = LocalPaper.current
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.background(paper.bg)) {
        Row(
            Modifier.fillMaxWidth().combinedClickable(onLongClick = { menu = true }, onClick = onOpen).padding(start = 18.dp, end = 10.dp, top = 16.dp, bottom = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    (feed?.icon ?: faviconOf(feed?.site ?: item.url))?.let { AsyncImage(it, null, Modifier.size(15.dp).clip(RoundedCornerShape(3.dp))); Spacer(Modifier.width(8.dp)) }
                    Text((feed?.title ?: hostOf(item.url) ?: "").uppercase(), style = Eyebrow, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    Text("  ·  ${ago(item.published)}", fontFamily = Sans, fontSize = 12.sp, color = paper.faint)
                }
                Row(verticalAlignment = Alignment.Top) {
                    if (!item.seen) Box(Modifier.padding(top = 9.dp, end = 8.dp).size(8.dp).clip(CircleShape).background(paper.accent))
                    Text(item.title, fontFamily = Serif, fontWeight = FontWeight(550), fontSize = 19.sp, lineHeight = 24.sp, color = paper.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                item.summary?.let { Text(it, fontFamily = Sans, fontSize = 14.sp, lineHeight = 20.sp, color = paper.muted, maxLines = 3, overflow = TextOverflow.Ellipsis) }
                val foot = listOfNotNull(item.author, item.audio?.seconds?.let { "${maxOf(1, it / 60)} min listen" }, if (opening) "Opening…" else null)
                if (foot.isNotEmpty()) Text(foot.joinToString(" · "), fontFamily = Sans, fontSize = 13.sp, color = paper.faint, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Box {
                    Icon(Icons.Outlined.MoreHoriz, "More", tint = paper.muted, modifier = Modifier.size(34.dp).clip(CircleShape).clickable { menu = true }.padding(6.dp))
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("Save to Later") }, leadingIcon = { Icon(Icons.Outlined.Schedule, null) }, onClick = { menu = false; onSave() })
                        DropdownMenuItem(text = { Text(if (item.seen) "Mark as unseen" else "Mark as seen") }, leadingIcon = { Icon(if (item.seen) Icons.Outlined.Circle else Icons.Outlined.TaskAlt, null) }, onClick = { menu = false; onSeen() })
                        DropdownMenuItem(text = { Text("Open the original") }, leadingIcon = { Icon(Icons.AutoMirrored.Outlined.OpenInNew, null) }, onClick = { menu = false; onOriginal() })
                    }
                }
                item.image?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.size(92.dp, 74.dp).clip(RoundedCornerShape(10.dp)).background(paper.sunk)) }
            }
        }
        Box(Modifier.fillMaxWidth().height(2.dp).background(paper.rule)) {
            if (progress > 0) Box(Modifier.fillMaxWidth(progress.toFloat().coerceIn(0f, 1f)).fillMaxHeight().background(paper.accent))
        }
    }
}

/** The feeds subscribed to, each with Unsubscribe, and a field to subscribe to another site. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ManageFeeds(feeds: List<Feed>, onDismiss: () -> Unit) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var leaving by remember { mutableStateOf<Feed?>(null) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 32.dp).widthIn(max = 720.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Feeds", fontFamily = Serif, fontSize = 28.sp, color = paper.fg)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(url, { url = it; error = null }, placeholder = { Text("A site or a feed: stratechery.com") }, singleLine = true, modifier = Modifier.weight(1f))
                Pill(if (busy) "Finding…" else "Subscribe", Icons.Outlined.RssFeed, dark = true) {
                    if (url.isBlank() || busy) return@Pill
                    busy = true
                    scope.launch {
                        runCatching { shelf.subscribe(url.trim()) }.onSuccess { url = "" }.onFailure { error = it.message ?: "Couldn't subscribe to that." }
                        busy = false
                    }
                }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontFamily = Sans, fontSize = 14.sp) }
            if (feeds.isEmpty()) Text("Nothing subscribed to yet. A site's address is enough: its feed is found for you. YouTube channels and podcasts work too.", fontFamily = Sans, fontSize = 14.sp, color = paper.muted)
            LazyColumn(Modifier.height(if (feeds.size > 6) 420.dp else (feeds.size * 70).dp)) {
                items(feeds, key = { it.id }) { f ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        AsyncImage(f.icon ?: faviconOf(f.site ?: f.url), null, Modifier.size(28.dp).clip(RoundedCornerShape(6.dp)).background(paper.sunk))
                        Column(Modifier.weight(1f)) {
                            Text(f.title, fontFamily = Sans, fontWeight = FontWeight(500), fontSize = 15.sp, color = paper.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(f.error ?: hostOf(f.site ?: f.url).orEmpty(), fontFamily = Sans, fontSize = 13.sp, color = if (f.error != null) MaterialTheme.colorScheme.error else paper.muted, maxLines = 1)
                        }
                        Icon(Icons.Outlined.Close, "Unsubscribe from ${f.title}", tint = paper.muted, modifier = Modifier.size(34.dp).clip(CircleShape).clickable { leaving = f }.padding(7.dp))
                    }
                }
            }
        }
    }
    leaving?.let { f ->
        AlertDialog(
            onDismissRequest = { leaving = null },
            title = { Text("Unsubscribe from ${f.title}?") },
            text = { Text("Its items go from the Feed, except those you saved.") },
            confirmButton = { TextButton(onClick = { leaving = null; scope.launch { runCatching { shelf.unsubscribe(f.id) } } }) { Text("Unsubscribe") } },
            dismissButton = { TextButton(onClick = { leaving = null }) { Text("Cancel") } },
        )
    }
}
