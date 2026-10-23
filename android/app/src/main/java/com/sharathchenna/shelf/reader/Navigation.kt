package com.sharathchenna.shelf.reader

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import org.readium.r2.navigator.DecorableNavigator
import org.readium.r2.navigator.Decoration
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.services.locateProgression
import org.readium.r2.shared.publication.services.positionsByReadingOrder
import org.readium.r2.shared.publication.services.search.isSearchable
import org.readium.r2.shared.publication.services.search.search

// ---- where you are ---------------------------------------------------------------------------

/**
 * Readium's positions, a book's text in pages of about a thousand characters (or a PDF's pages),
 * chapter by chapter: how far a place is through its chapter, and how long the rest of it takes.
 */
@Composable
fun rememberPositions(book: OpenedBook): List<List<Locator>> =
    produceState(emptyList(), book) { value = runCatching { book.publication.positionsByReadingOrder() }.getOrDefault(emptyList()) }.value

/** About 180 words to a position, read at about 240 a minute. */
private const val MINUTES_PER_POSITION = 0.75

/** "12 min left in the chapter", or a PDF's "Page 4 of 30". */
fun whereLabel(book: OpenedBook, positions: List<List<Locator>>, at: Locator?): String {
    at ?: return ""
    if (book.isPdf) {
        val total = positions.sumOf { it.size }
        return at.locations.position?.let { if (total > 0) "Page $it of $total" else "Page $it" } ?: ""
    }
    val chapter = positions.getOrNull(book.sectionOf(at)) ?: return ""
    val here = at.locations.position ?: return ""
    val left = chapter.count { (it.locations.position ?: 0) > here } * MINUTES_PER_POSITION
    return when {
        chapter.isEmpty() -> ""
        left < 1 -> "Last page of the chapter"
        else -> "${Math.round(left)} min left in the chapter"
    }
}

/** The page's foot while the bars are away: the chapter, what's left of it, and a hairline of the whole book. */
@Composable
fun ReadingFooter(chapter: String, where: String, progress: Float, ink: androidx.compose.ui.graphics.Color, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(chapter, fontFamily = Sans, fontSize = 11.5.sp, color = ink.copy(alpha = 0.5f), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text(where, fontFamily = Sans, fontSize = 11.5.sp, color = ink.copy(alpha = 0.5f), maxLines = 1, modifier = Modifier.padding(start = 16.dp))
        }
        Box(Modifier.fillMaxWidth().height(2.dp).background(ink.copy(alpha = 0.06f))) {
            Box(Modifier.fillMaxWidth(progress.coerceIn(0f, 1f)).height(2.dp).background(ink.copy(alpha = 0.28f)))
        }
    }
}

/**
 * The bar at the page's foot while the bars show: the whole book as a slider, the chapter and
 * how far through as it's dragged, and the place taken there on letting go.
 */
@Composable
fun Scrubber(book: OpenedBook, positions: List<List<Locator>>, progress: Float, onGo: (Locator) -> Unit, modifier: Modifier = Modifier) {
    val paper = LocalPaper.current
    val scope = rememberCoroutineScope()
    var dragging by remember { mutableStateOf<Float?>(null) }
    val all = remember(positions) { positions.flatten() }
    val shown = dragging ?: progress
    val label = remember(shown, all) {
        val at = all.getOrNull(Math.round(shown * (all.size - 1)).coerceAtLeast(0))
        val section = at?.let(book::sectionOf)
        val title = at?.title ?: section?.let { book.linkFor(it)?.title } ?: section?.let { book.titles.getOrNull(it) }
        listOfNotNull(title?.takeIf { it.isNotBlank() }, "${Math.round(shown * 100)}%").joinToString(" · ")
    }
    Column(
        modifier.navigationBarsPadding().padding(12.dp).clip(RoundedCornerShape(20.dp)).background(paper.raised.copy(alpha = 0.97f)).padding(horizontal = 20.dp, vertical = 8.dp),
    ) {
        Text(label, fontFamily = Sans, fontSize = 12.5.sp, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Slider(
            value = shown,
            onValueChange = { dragging = it },
            onValueChangeFinished = {
                val to = dragging ?: return@Slider
                scope.launch {
                    (all.getOrNull(Math.round(to * (all.size - 1))) ?: book.publication.locateProgression(to.toDouble()))?.let(onGo)
                    dragging = null
                }
            },
            colors = SliderDefaults.colors(thumbColor = paper.fg, activeTrackColor = paper.fg, inactiveTrackColor = paper.sunk),
        )
    }
}

// ---- bookmarks -------------------------------------------------------------------------------

/** A page kept to come back to. Kept on this device, as the site has no bookmarks of its own. */
data class Bookmark(val id: String, val locator: Locator, val title: String, val createdAt: Long)

object Bookmarks {
    private fun prefs(context: Context) = context.getSharedPreferences("bookmarks", Context.MODE_PRIVATE)

    fun load(context: Context, bookId: String): List<Bookmark> {
        val raw = prefs(context).getString(bookId, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            (0 until array.length()).mapNotNull { i ->
                val o = array.getJSONObject(i)
                Locator.fromJSON(o.getJSONObject("locator"))?.let { Bookmark(o.getString("id"), it, o.optString("title"), o.optLong("createdAt")) }
            }
        }.getOrDefault(emptyList())
    }

    fun save(context: Context, bookId: String, marks: List<Bookmark>) {
        val array = JSONArray()
        marks.forEach { m -> array.put(JSONObject().put("id", m.id).put("locator", m.locator.toJSON()).put("title", m.title).put("createdAt", m.createdAt)) }
        prefs(context).edit().putString(bookId, array.toString()).apply()
    }
}

/** Whether a bookmark is for the page showing now: the same resource, the same position. */
fun Bookmark.isAt(at: Locator?): Boolean =
    at != null && locator.href == at.href && (locator.locations.position ?: -1) == (at.locations.position ?: -2)

@Composable
fun BookmarksList(book: OpenedBook, marks: List<Bookmark>, onGo: (Bookmark) -> Unit, onRemove: (Bookmark) -> Unit) {
    val paper = LocalPaper.current
    if (marks.isEmpty()) {
        Text("No bookmarks yet. Tap the bookmark in the bar to keep this page.", color = paper.muted, fontFamily = Sans, fontSize = 14.sp, modifier = Modifier.padding(22.dp))
        return
    }
    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        items(marks.sortedBy { it.locator.locations.totalProgression ?: 0.0 }, key = { it.id }) { m ->
            Row(Modifier.fillMaxWidth().clickable { onGo(m) }.padding(start = 22.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(m.title.ifBlank { book.linkFor(book.sectionOf(m.locator))?.title ?: "Bookmark" }, fontFamily = Serif, fontSize = 17.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(
                        listOfNotNull(
                            m.locator.locations.totalProgression?.let { "${Math.round(it * 100)}%" },
                            m.locator.text.highlight?.takeIf { it.isNotBlank() } ?: m.locator.text.after?.take(80),
                        ).joinToString(" · "),
                        fontFamily = Sans, fontSize = 12.5.sp, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                IconButton(onClick = { onRemove(m) }) { Icon(Icons.Outlined.Close, "Remove the bookmark", tint = paper.muted, modifier = Modifier.size(18.dp)) }
            }
        }
    }
}

// ---- search inside the book ------------------------------------------------------------------

/** Whether this book can be searched (an EPUB's text can; a PDF's, through Readium, can't). */
@OptIn(ExperimentalReadiumApi::class)
fun OpenedBook.searchable(): Boolean = !isPdf && publication.isSearchable

/**
 * Every place a word or phrase is in the book, with a few words either side; the one chosen is
 * marked on its page until the panel closes.
 */
@OptIn(ExperimentalReadiumApi::class)
@Composable
fun SearchPanel(book: OpenedBook, controller: ReaderController) {
    val paper = LocalPaper.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var searched by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val results = remember { mutableStateListOf<Locator>() }
    val field = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { field.requestFocus() } }
    DisposableEffect(Unit) {
        onDispose { scope.launch { (controller.navigator as? DecorableNavigator)?.applyDecorations(emptyList(), "search") } }
    }

    fun run() {
        val q = query.trim()
        if (q.length < 2 || busy) return
        busy = true; searched = q; results.clear()
        scope.launch {
            val found = runCatching { book.publication.search(q) }.getOrNull()
            if (found != null) {
                try {
                    while (results.size < 300) {
                        val page = found.next().getOrNull() ?: break
                        results += page.locators
                    }
                } finally {
                    found.close()
                }
            }
            busy = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(paper.chip).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Search, null, tint = paper.muted, modifier = Modifier.size(18.dp))
            Box(Modifier.weight(1f).padding(start = 10.dp)) {
                if (query.isEmpty()) Text("Words in this book", fontFamily = Sans, fontSize = 15.sp, color = paper.faint)
                BasicTextField(
                    query, { query = it },
                    singleLine = true,
                    textStyle = TextStyle(fontFamily = Sans, fontSize = 15.sp, color = paper.fg),
                    cursorBrush = SolidColor(paper.accent),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { run() }),
                    modifier = Modifier.fillMaxWidth().focusRequester(field),
                )
            }
        }
        val status = when {
            busy -> "Searching…"
            searched == null -> null
            results.isEmpty() -> "“$searched” isn't in this book."
            results.size >= 300 -> "The first 300 places"
            else -> "${results.size} place${if (results.size == 1) "" else "s"}"
        }
        status?.let { Text(it.uppercase(), style = Eyebrow, color = paper.muted, modifier = Modifier.padding(horizontal = 22.dp, vertical = 6.dp)) }
        LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
            items(results) { hit ->
                Column(
                    Modifier.fillMaxWidth().clickable {
                        controller.go(hit)
                        scope.launch {
                            (controller.navigator as? DecorableNavigator)?.applyDecorations(
                                listOf(Decoration("search-hit", hit, Decoration.Style.Highlight(tint = 0xFFFFB648.toInt()))), "search",
                            )
                        }
                    }.padding(horizontal = 22.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    val section = book.sectionOf(hit)
                    (hit.title ?: book.linkFor(section)?.title ?: book.titles.getOrNull(section))?.takeIf { it.isNotBlank() }?.let {
                        Text(it.uppercase(), style = Eyebrow, color = paper.faint, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Text(
                        buildAnnotatedString {
                            append("…" + hit.text.before.orEmpty().takeLast(60).trimStart())
                            withStyle(SpanStyle(fontWeight = FontWeight(600), background = androidx.compose.ui.graphics.Color(0x55FFB648))) { append(hit.text.highlight.orEmpty()) }
                            append(hit.text.after.orEmpty().take(80).trimEnd() + "…")
                        },
                        fontFamily = Serif, fontSize = 15.sp, lineHeight = 21.sp, color = paper.fg, maxLines = 3, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}
