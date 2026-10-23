package com.sharathchenna.shelf.ui.library

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.ViewWeek
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import coil3.compose.AsyncImage
import com.sharathchenna.shelf.BuildConfig
import com.sharathchenna.shelf.data.Library
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.data.Topic
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.PaperGrain
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import com.sharathchenna.shelf.ui.theme.hex
import kotlinx.coroutines.launch

private enum class View { Shelf, Topics }

/**
 * The library, as the site's home page has it: the owner's name over a line of counts, the
 * bookcase (or its topics), and a book taken off the shelf into your hands, beside the shelf on a
 * wide screen and over it on a narrow one.
 */
@Composable
fun LibraryPane(nav: NavHostController) {
    val shelf = LocalShelf.current
    val library by shelf.library.collectAsState()
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    BackHandler(enabled = open != null) { open = null }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 840.dp
        Bookcase(library, selected = open, onOpen = { open = it })
        // The book in your hands: a sheet from the side on the tablet, the whole screen on a phone.
        AnimatedVisibility(open != null, enter = fadeIn(), exit = fadeOut()) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = if (wide) 0.18f else 0f)).clickable(remember { MutableInteractionSource() }, null) { open = null })
        }
        AnimatedVisibility(
            open != null,
            enter = slideInHorizontally { it / 3 } + fadeIn(),
            exit = slideOutHorizontally { it / 3 } + fadeOut(),
            modifier = Modifier.align(Alignment.CenterEnd),
        ) {
            val id = open
            Box(
                if (wide) Modifier.fillMaxHeight().width(480.dp).statusBarsPadding().navigationBarsPadding().padding(12.dp).clip(RoundedCornerShape(24.dp))
                else Modifier.fillMaxSize(),
            ) {
                if (id != null) BookCard(id, nav, onClose = { open = null })
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Bookcase(library: Library?, selected: String?, onOpen: (String) -> Unit) {
    val shelf = LocalShelf.current
    val scope = rememberCoroutineScope()
    val paper = LocalPaper.current
    var refreshing by remember { mutableStateOf(false) }
    var view by rememberSaveable { mutableStateOf(View.Shelf) }
    var sort by rememberSaveable { mutableStateOf(Sort.Topic) }
    var tag by rememberSaveable { mutableStateOf<Tag?>(null) }
    var only by rememberSaveable { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }

    val books = library?.books.orEmpty()
    val topics = library?.topics.orEmpty()
    val topicByKey = remember(topics) { topics.associateBy { it.key } }
    val counts = remember(books) { books.groupingBy { it.topic }.eachCount() }
    val present = remember(topics, counts) { topics.filter { (counts[it.key] ?: 0) > 0 } }
    val shown = remember(books, sort, tag, only, query, topics) {
        sortBooks(books.filter { (tag?.test?.invoke(it) ?: true) && (only == null || it.topic == only) && matches(it, query, topicByKey) }, sort, topics)
    }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            scope.launch { runCatching { shelf.sync() }; refreshing = false }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            // The site's shelf is drawn at its own size on the tablet, a little smaller on a phone.
            val scale = if (maxWidth < 700.dp) 0.78f else 1f
            val content = maxWidth.value.coerceAtMost(1180f) - 2 * 32f
            val shelfWidth = content / scale
            val labelWidth = rememberLabelWidth(scale)
            val rows = remember(shown, shelfWidth, sort, labelWidth) { shelve(shown, shelfWidth, sort, topicByKey, labelWidth) }
            val side = ((maxWidth.value - content) / 2).dp

            when {
                library == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Taking the books out…", color = paper.muted) }
                view == View.Topics -> TopicGrid(present, counts, header = { Hero(library, books, present, view, { view = it }, sort, { sort = it }, query, { query = it }) }) { only = it; view = View.Shelf }
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = side, end = side, bottom = 48.dp)) {
                    item(key = "hero") { Hero(library, books, present, view, { view = it }, sort, { sort = it }, query, { query = it }) }
                    item(key = "chips") {
                        Chips(books, present, counts, only, tag, onOnly = { only = it; tag = null }, onTag = { tag = it }, onAll = { only = null; tag = null })
                        Spacer(Modifier.height(30.dp))
                    }
                    if (shown.isEmpty()) {
                        item(key = "none") {
                            Text(
                                if (query.isNotBlank()) "Nothing on the shelves matches “$query”." else "Nothing on the shelves matches.",
                                color = paper.muted, fontFamily = Sans, fontSize = 14.sp,
                                modifier = Modifier.fillMaxWidth().padding(24.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            )
                        }
                    }
                    rows.forEachIndexed { i, row ->
                        item(key = "row-$sort-$i-${row.books.firstOrNull()?.book?.id}") {
                            ShelfRowView(row, last = i == rows.lastIndex, width = shelfWidth, scale = scale, selected = selected, onOpen = { onOpen(it.id) },
                                onLabel = if (sort == Sort.Topic) ({ key -> only = key }) else null)
                        }
                    }
                    item(key = "hint") {
                        Text("Tap a spine to take it down.", color = paper.faint, fontFamily = Sans, fontSize = 12.5.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                    }
                }
            }
        }
    }
}

/** "<owner>'s library", the counts under it, and the tools: shelf or topics, search, and how the shelf is arranged. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Hero(
    library: Library,
    books: List<ShelfBook>,
    topics: List<Topic>,
    view: View,
    onView: (View) -> Unit,
    sort: Sort,
    onSort: (Sort) -> Unit,
    query: String,
    onQuery: (String) -> Unit,
) {
    val paper = LocalPaper.current
    val compact = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp < 600
    val stats = remember(books, topics) {
        val n = { k: Int, one: String, many: String -> "$k ${if (k == 1) one else many}" }
        buildList {
            add(n(books.count { it.kind == "book" }, "book", "books"))
            books.count { it.kind != "book" }.takeIf { it > 0 }?.let { add(n(it, "clipping", "clippings")) }
            topics.count { it.key != "unsorted" }.takeIf { it > 0 }?.let { add(n(it, "topic", "topics")) }
            val hours = maxOf(1, Math.round(books.sumOf { it.minutes } / 60.0).toInt())
            add("${n(hours, "hour", "hours")} of reading")
            books.count { it.pct > 0 && it.pct < 1 }.takeIf { it > 0 }?.let { add("$it in progress") }
            books.count { it.pct >= 1 }.takeIf { it > 0 }?.let { add("$it read") }
        }
    }
    Column(Modifier.statusBarsPadding().padding(top = 36.dp, bottom = 24.dp)) {
        Text(
            library.owner?.let { "$it’s library" } ?: "Library",
            fontFamily = Serif, fontWeight = FontWeight(420), fontSize = if (compact) 42.sp else 60.sp, lineHeight = if (compact) 44.sp else 60.sp, letterSpacing = (-0.03).em, color = paper.fg,
        )
        FlowRow(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            // Each count is one piece, so a line breaks between counts, never inside one.
            stats.forEachIndexed { i, s ->
                val (number, words) = s.split(" ", limit = 2).let { it[0] to it.getOrElse(1) { "" } }
                Text(
                    androidx.compose.ui.text.buildAnnotatedString {
                        withStyle(androidx.compose.ui.text.SpanStyle(color = paper.fg, fontWeight = FontWeight(500))) { append(number) }
                        append(" $words")
                        if (i < stats.lastIndex) withStyle(androidx.compose.ui.text.SpanStyle(color = paper.faint)) { append("  ·  ") }
                    },
                    fontFamily = Sans, fontSize = 14.sp, color = paper.muted, maxLines = 1, softWrap = false,
                )
            }
        }
        FlowRow(Modifier.padding(top = 26.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Segments(listOf(View.Shelf to ("Shelf" to Icons.Outlined.ViewWeek), View.Topics to ("Topics" to Icons.Outlined.GridView)), view, onView)
            SearchField(query, onQuery)
            if (view == View.Shelf) {
                Row(Modifier.clip(CircleShape).background(paper.sunk.copy(alpha = 0.6f)).padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (!compact) Text("Arrange by", fontFamily = Sans, fontSize = 12.5.sp, color = paper.faint, modifier = Modifier.padding(horizontal = 8.dp))
                    Sort.entries.forEach { s ->
                        Pill(s.label, on = sort == s) { onSort(s) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Pill(text: String, on: Boolean, icon: ImageVector? = null, onClick: () -> Unit) {
    val paper = LocalPaper.current
    Row(
        Modifier.clip(CircleShape).background(if (on) paper.raised else Color.Transparent).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.let { Icon(it, null, Modifier.size(16.dp), tint = if (on) paper.fg else paper.muted); Spacer(Modifier.width(6.dp)) }
        Text(text, fontFamily = Sans, fontWeight = FontWeight(if (on) 500 else 400), fontSize = 13.5.sp, color = if (on) paper.fg else paper.muted, maxLines = 1, softWrap = false)
    }
}

@Composable
private fun <T> Segments(options: List<Pair<T, Pair<String, ImageVector>>>, value: T, onChange: (T) -> Unit) {
    Row(Modifier.clip(CircleShape).background(LocalPaper.current.sunk.copy(alpha = 0.6f)).padding(4.dp)) {
        options.forEach { (v, label) -> Pill(label.first, on = v == value, icon = label.second) { onChange(v) } }
    }
}

/**
 * The library's search: a field only once it's tapped, since a text field on screen takes the
 * focus (and the keyboard) as soon as a keyboard cover is attached.
 */
@Composable
private fun SearchField(query: String, onQuery: (String) -> Unit) {
    val paper = LocalPaper.current
    var editing by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    Row(
        Modifier.widthIn(min = 260.dp).height(42.dp).clip(CircleShape).background(paper.raised).border(1.dp, paper.rule, CircleShape)
            .clickable { editing = true }.padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Search, null, Modifier.size(16.dp), tint = paper.faint)
        Spacer(Modifier.width(8.dp))
        if (editing || query.isNotEmpty()) {
            LaunchedEffect(Unit) { if (query.isEmpty()) focus.requestFocus() }
            Box(Modifier.width(200.dp)) {
                if (query.isEmpty()) Text("Search the library", fontFamily = Sans, fontSize = 14.sp, color = paper.faint)
                BasicTextField(
                    query, onQuery, singleLine = true, cursorBrush = SolidColor(paper.accent),
                    textStyle = TextStyle(fontFamily = Sans, fontSize = 14.sp, color = paper.fg), modifier = Modifier.fillMaxWidth().focusRequester(focus),
                )
            }
            Icon(Icons.Outlined.Close, "Clear search", Modifier.size(18.dp).clip(CircleShape).clickable { onQuery(""); editing = false }, tint = paper.muted)
        } else {
            Text("Search the library", fontFamily = Sans, fontSize = 14.sp, color = paper.faint, modifier = Modifier.width(200.dp))
        }
    }
}

/** All, then each topic with its clay figure and count, then the tags: what you're reading, favourites, and so on. */
@Composable
private fun Chips(books: List<ShelfBook>, topics: List<Topic>, counts: Map<String, Int>, only: String?, tag: Tag?, onOnly: (String?) -> Unit, onTag: (Tag?) -> Unit, onAll: () -> Unit) {
    val paper = LocalPaper.current
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Chip(on = only == null && tag == null, onClick = onAll) { ChipText("All"); ChipCount(books.size, only == null && tag == null) } }
        items(topics, key = { it.key }) { t ->
            val on = only == t.key
            Chip(on = on, color = hex(t.shades[0]), onClick = { onOnly(if (on) null else t.key) }) {
                Glyph(t.key, 18.dp); Spacer(Modifier.width(6.dp)); ChipText(t.name, on); ChipCount(counts[t.key] ?: 0, on)
            }
        }
        val tags = Tag.entries.mapNotNull { t -> books.count(t.test).takeIf { n -> n > 0 && (t.icon != null || n < books.size) }?.let { t to it } }
        if (tags.isNotEmpty()) item { Box(Modifier.padding(horizontal = 6.dp).size(1.dp, 16.dp).background(paper.rule)) }
        items(tags, key = { it.first.name }) { (t, n) ->
            val on = tag == t
            Chip(on = on, onClick = { onTag(if (on) null else t) }) {
                t.icon?.let { Glyph(it, 18.dp); Spacer(Modifier.width(6.dp)) }
                ChipText(t.label, on); ChipCount(n, on)
            }
        }
    }
}

@Composable
private fun Chip(on: Boolean, color: Color? = null, onClick: () -> Unit, content: @Composable () -> Unit) {
    val paper = LocalPaper.current
    val fill = if (on) (color ?: paper.fg) else paper.raised
    Row(
        Modifier.height(34.dp).clip(CircleShape).background(fill).border(1.dp, if (on) fill else paper.rule, CircleShape).clickable(onClick = onClick).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // On a chosen chip the words take whichever ink reads on its fill (the "All" chip is light in the dark).
        val ink = if (!on) paper.fg else if (fill.luminance() > 0.5f) Color(0xFF18201C) else Color.White
        androidx.compose.runtime.CompositionLocalProvider(LocalChipOn provides on, LocalChipInk provides ink) { content() }
    }
}

private val LocalChipOn = androidx.compose.runtime.staticCompositionLocalOf { false }
private val LocalChipInk = androidx.compose.runtime.staticCompositionLocalOf { Color.Unspecified }

@Composable
private fun ChipText(text: String, on: Boolean = LocalChipOn.current) {
    Text(text, fontFamily = Sans, fontWeight = FontWeight(500), fontSize = 13.sp, color = if (on) LocalChipInk.current else LocalPaper.current.fg)
}

@Composable
private fun ChipCount(n: Int, on: Boolean = LocalChipOn.current) {
    Text("  $n", fontFamily = Sans, fontSize = 13.sp, color = if (on) LocalChipInk.current.copy(alpha = 0.7f) else LocalPaper.current.faint)
}

/** Each topic as its painted plate (public/library/topics on the site), with how many books it holds. */
@Composable
private fun TopicGrid(topics: List<Topic>, counts: Map<String, Int>, header: @Composable () -> Unit, onTopic: (String) -> Unit) {
    val paper = LocalPaper.current
    BoxWithConstraints {
        val side = ((maxWidth.value - maxWidth.value.coerceAtMost(1180f) + 64f) / 2).dp
        LazyVerticalGrid(
            columns = GridCells.Adaptive(240.dp),
            contentPadding = PaddingValues(start = side, end = side, bottom = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(18.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) { header() }
            items(topics, key = { it.key }) { t ->
                Column(Modifier.clip(RoundedCornerShape(18.dp)).background(paper.raised).border(1.dp, paper.rule, RoundedCornerShape(18.dp)).clickable { onTopic(t.key) }) {
                    AsyncImage(
                        "${BuildConfig.SITE_URL}/library/topics/${t.key}.webp", null, contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxWidth().aspectRatio(1.5f).background(hex(t.shades[3])),
                    )
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Glyph(t.key, 20.dp); Spacer(Modifier.width(8.dp))
                            Text(t.name, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                            Text("${counts[t.key] ?: 0}", fontFamily = Sans, fontSize = 13.sp, color = paper.faint)
                        }
                        Text(t.blurb, fontFamily = Sans, fontSize = 13.sp, lineHeight = 18.sp, color = paper.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}
