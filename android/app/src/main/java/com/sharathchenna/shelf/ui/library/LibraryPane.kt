package com.sharathchenna.shelf.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.layout.AnimatedPane
import androidx.compose.material3.adaptive.layout.ListDetailPaneScaffoldRole
import androidx.compose.material3.adaptive.navigation.NavigableListDetailPaneScaffold
import androidx.compose.material3.adaptive.navigation.rememberListDetailPaneScaffoldNavigator
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import coil3.compose.AsyncImage
import com.sharathchenna.shelf.BuildConfig
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.data.Topic
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.hex
import kotlinx.coroutines.launch

/**
 * The library: the bookcase (or the topics) beside the open book's card. On the tablet both
 * panes show at once; on a narrow window the card takes the screen, and Back returns to the shelf.
 */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
fun LibraryPane(nav: NavHostController) {
    val navigator = rememberListDetailPaneScaffoldNavigator<String>()
    val scope = rememberCoroutineScope()
    NavigableListDetailPaneScaffold(
        navigator = navigator,
        listPane = {
            AnimatedPane {
                Bookcase(
                    selected = navigator.currentDestination?.contentKey,
                    onOpen = { id -> scope.launch { navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, id) } },
                )
            }
        },
        detailPane = {
            AnimatedPane {
                val id = navigator.currentDestination?.contentKey
                if (id == null) EmptyCard() else BookCard(id, nav)
            }
        },
    )
}

private enum class View { Shelf, Topics }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Bookcase(selected: String?, onOpen: (String) -> Unit) {
    val shelf = LocalShelf.current
    val library by shelf.library.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var view by rememberSaveable { mutableStateOf(View.Shelf) }
    var sort by rememberSaveable { mutableStateOf(Sort.Topic) }
    var tag by rememberSaveable { mutableStateOf<Tag?>(null) }
    var only by rememberSaveable { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var filtering by rememberSaveable { mutableStateOf(false) }
    val paper = LocalPaper.current

    val lib = library
    val topics = lib?.topics.orEmpty()
    val topicByKey = remember(topics) { topics.associateBy { it.key } }
    val shown = remember(lib, sort, tag, only, query) {
        val books = lib?.books.orEmpty().filter { (tag?.test?.invoke(it) ?: true) && (only == null || it.topic == only) && matches(it, query, topicByKey) }
        sortBooks(books, sort, topics)
    }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            scope.launch {
                runCatching { shelf.sync() }
                refreshing = false
            }
        },
        modifier = Modifier.fillMaxSize().background(paper.bg),
    ) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Column(Modifier.padding(horizontal = 24.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Library", style = MaterialTheme.typography.displaySmall, modifier = Modifier.weight(1f))
                    SingleChoiceSegmentedButtonRow {
                        View.entries.forEachIndexed { i, v ->
                            SegmentedButton(selected = view == v, onClick = { view = v; if (v == View.Shelf) Unit }, shape = SegmentedButtonDefaults.itemShape(i, View.entries.size)) { Text(v.name) }
                        }
                    }
                }
                // A button until it's wanted: a text field on screen takes the focus (and brings up
                // the keyboard) as soon as a keyboard cover is attached.
                if (filtering || query.isNotEmpty()) {
                    val field = remember { FocusRequester() }
                    LaunchedEffect(Unit) { if (query.isEmpty()) field.requestFocus() }
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        placeholder = { Text("Filter by title, author, topic or year") },
                        leadingIcon = { Icon(Icons.Outlined.Search, null) },
                        trailingIcon = { IconButton(onClick = { query = ""; filtering = false }) { Icon(Icons.Outlined.Close, "Clear") } },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().focusRequester(field),
                    )
                } else {
                    OutlinedButton(onClick = { filtering = true }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Outlined.Search, null)
                        Text("  Filter by title, author, topic or year", modifier = Modifier.weight(1f))
                    }
                }
                if (view == View.Shelf) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(Sort.entries) { s -> FilterChip(selected = sort == s, onClick = { sort = s }, label = { Text(s.label) }) }
                        item { Spacer(Modifier.width(12.dp)) }
                        only?.let { key -> item { FilterChip(selected = true, onClick = { only = null }, label = { Text(topicByKey[key]?.name ?: key) }) } }
                        items(Tag.entries) { t -> FilterChip(selected = tag == t, onClick = { tag = if (tag == t) null else t }, label = { Text(t.label) }) }
                    }
                }
            }
            when {
                lib == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Fetching the library…", color = paper.muted) }
                view == View.Topics -> Topics(topics, lib.books, onTopic = { only = it; view = View.Shelf })
                shown.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Nothing on the shelf matches.", color = paper.muted) }
                else -> Shelves(shown, sort, topicByKey, selected, onOpen)
            }
        }
    }
}

/** The books in rows as wide as the window, each run under its label (a topic, a month, a length). */
@Composable
private fun Shelves(books: List<ShelfBook>, sort: Sort, topics: Map<String, Topic>, selected: String?, onOpen: (String) -> Unit) {
    val paper = LocalPaper.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val room = maxWidth.value - 48
        val runs = remember(books, sort, room) {
            val groups = mutableListOf<Pair<Group?, MutableList<ShelfBook>>>()
            for (book in books) {
                val group = groupOf(book, sort, topics)
                if (groups.isEmpty() || groups.last().first?.key != group?.key) groups += group to mutableListOf()
                groups.last().second += book
            }
            groups.map { (group, members) ->
                val rows = mutableListOf<MutableList<ShelfBook>>(mutableListOf())
                var used = 0f
                for (b in members) {
                    val w = b.look.w * SPINE_SCALE + 3
                    if (used + w > room && rows.last().isNotEmpty()) {
                        rows += mutableListOf<ShelfBook>()
                        used = 0f
                    }
                    rows.last() += b
                    used += w
                }
                group to rows
            }
        }
        LazyColumn(contentPadding = PaddingValues(start = 24.dp, end = 24.dp, bottom = 48.dp)) {
            for ((group, rows) in runs) {
                if (group != null) {
                    item(key = "g:${group.key}") {
                        Text(group.label.uppercase(), style = Eyebrow, color = paper.muted, modifier = Modifier.padding(top = 20.dp, bottom = 6.dp))
                    }
                }
                rows.forEachIndexed { i, row ->
                    item(key = "r:${group?.key}:$i:${row.first().id}") {
                        Column {
                            Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 14.dp)) {
                                row.forEach { b -> Spine(b, selected = b.id == selected, onClick = { onOpen(b.id) }) }
                            }
                            // The plank.
                            Box(Modifier.fillMaxWidth().height(10.dp).background(paper.wood, RoundedCornerShape(bottomStart = 3.dp, bottomEnd = 3.dp)))
                        }
                    }
                }
            }
        }
    }
}

/** Each topic as a plate from the site (public/library/topics), with how many books it holds. */
@Composable
private fun Topics(topics: List<Topic>, books: List<ShelfBook>, onTopic: (String) -> Unit) {
    val paper = LocalPaper.current
    val counts = remember(books) { books.groupingBy { it.topic }.eachCount() }
    LazyVerticalGrid(columns = GridCells.Adaptive(220.dp), contentPadding = PaddingValues(24.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        items(topics.filter { (counts[it.key] ?: 0) > 0 }, key = { it.key }) { t ->
            Column(Modifier.clip(RoundedCornerShape(16.dp)).background(paper.raised).clickable { onTopic(t.key) }) {
                AsyncImage(
                    model = "${BuildConfig.SITE_URL}/library/topics/${t.key}.webp",
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().aspectRatio(1.6f).background(hex(t.shades.getOrNull(3), Color.LightGray)),
                )
                Column(Modifier.padding(14.dp)) {
                    Text(t.name, style = MaterialTheme.typography.titleLarge)
                    Text("${counts[t.key]} on the shelf", style = MaterialTheme.typography.labelMedium, color = paper.muted)
                    Text(t.blurb, style = MaterialTheme.typography.bodySmall, color = paper.muted, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                }
            }
        }
    }
}

@Composable
private fun EmptyCard() {
    Box(Modifier.fillMaxSize().background(LocalPaper.current.raised), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(36.dp, 120.dp).background(LocalPaper.current.sunk, RoundedCornerShape(3.dp)))
            Text("Take a book off the shelf.", style = MaterialTheme.typography.titleLarge, color = LocalPaper.current.muted, modifier = Modifier.padding(top = 16.dp))
        }
    }
}
