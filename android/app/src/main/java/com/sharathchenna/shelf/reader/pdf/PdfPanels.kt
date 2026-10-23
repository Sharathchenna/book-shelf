package com.sharathchenna.shelf.reader.pdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Rect
import android.util.Base64
import android.util.Size
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.pdf.PdfDocument
import com.sharathchenna.shelf.data.Highlight
import com.sharathchenna.shelf.reader.InkThumbnail
import com.sharathchenna.shelf.reader.colorHex
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import com.sharathchenna.shelf.ui.theme.hex
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

/** The page a highlight or drawing is on (its `cfi` is "page:N", N from 1), from 0. */
fun pageOf(h: Highlight): Int = (Regex("^page:(\\d+)").find(h.cfi)?.groupValues?.get(1)?.toIntOrNull() ?: (h.sectionIndex + 1)) - 1

/** Part of a page as a picture: the page drawn sharp enough to read, cut to `area` (the page's points). */
suspend fun pagePicture(doc: PdfDocument, page: Int, area: PageRect, pageWidth: Float, pageHeight: Float, maxWidth: Int = 1400): Bitmap? = runCatching {
    val pad = 6f
    val l = (area.left - pad).coerceAtLeast(0f); val t = (area.top - pad).coerceAtLeast(0f)
    val r = (area.right + pad).coerceAtMost(pageWidth); val b = (area.bottom + pad).coerceAtMost(pageHeight)
    val scale = (maxWidth / (r - l)).coerceIn(1f, 3f)
    doc.getPageBitmapSource(page).use { source ->
        source.getBitmap(Size((pageWidth * scale).toInt(), (pageHeight * scale).toInt()), Rect((l * scale).toInt(), (t * scale).toInt(), (r * scale).toInt(), (b * scale).toInt()))
    }
}.getOrNull()

/** A picture as the site's reader routes take one: JPEG, in base64. */
suspend fun jpegBase64(bitmap: Bitmap): String = withContext(Dispatchers.Default) {
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, 82, out)
    Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

/** The bounding box of a passage's lines. */
fun List<PageRect>.union(): PageRect? = if (isEmpty()) null else PageRect(minOf { it.left }, minOf { it.top }, maxOf { it.right }, maxOf { it.bottom })

// ---- pages and page bookmarks ----------------------------------------------------------------

/** A PDF's bookmarked pages, kept on this device. */
object PageMarks {
    private fun prefs(context: Context) = context.getSharedPreferences("pdf-bookmarks", Context.MODE_PRIVATE)
    fun load(context: Context, bookId: String): Set<Int> = prefs(context).getStringSet(bookId, emptySet()).orEmpty().mapNotNull { it.toIntOrNull() }.toSet()
    fun save(context: Context, bookId: String, pages: Set<Int>) = prefs(context).edit().putStringSet(bookId, pages.map { it.toString() }.toSet()).apply()
}

/** The pages as a grid of small pictures, the one open marked, bookmarked ones flagged. */
@Composable
fun PageGrid(doc: PdfDocument, current: Int, marks: Set<Int>, onGo: (Int) -> Unit) {
    val paper = LocalPaper.current
    var onlyMarked by remember { mutableStateOf(false) }
    val pages = remember(onlyMarked, marks, doc) { if (onlyMarked) marks.sorted() else (0 until doc.pageCount).toList() }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            androidx.compose.material3.FilterChip(selected = !onlyMarked, onClick = { onlyMarked = false }, label = { Text("All ${doc.pageCount} pages") })
            androidx.compose.material3.FilterChip(selected = onlyMarked, onClick = { onlyMarked = true }, label = { Text(if (marks.isEmpty()) "Bookmarks" else "Bookmarks  ${marks.size}") })
        }
        if (onlyMarked && marks.isEmpty()) {
            Text("No bookmarks yet. Tap the bookmark in the bar to keep a page.", fontFamily = Sans, fontSize = 14.sp, color = paper.muted, modifier = Modifier.padding(22.dp))
            return
        }
        LazyVerticalGrid(GridCells.Adaptive(104.dp), contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            items(pages, key = { it }) { page ->
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable { onGo(page) }) {
                    PageThumb(doc, page, Modifier.fillMaxWidth().then(if (page == current) Modifier.border(2.dp, paper.accent, RoundedCornerShape(4.dp)) else Modifier))
                    Text(
                        (if (page in marks) "★ " else "") + "${page + 1}",
                        fontFamily = Sans, fontSize = 12.sp, color = if (page == current) paper.accent else paper.muted, modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun PageThumb(doc: PdfDocument, page: Int, modifier: Modifier) {
    val bitmap by produceState<Bitmap?>(null, doc, page) {
        value = runCatching {
            val info = doc.getPageInfo(page)
            val w = 220
            doc.getPageBitmapSource(page).use { it.getBitmap(Size(w, (w * info.height.toFloat() / info.width).toInt()), null) }
        }.getOrNull()
    }
    val shape = RoundedCornerShape(4.dp)
    bitmap?.let { Image(it.asImageBitmap(), "Page ${page + 1}", modifier.aspectRatio(it.width.toFloat() / it.height).clip(shape).background(androidx.compose.ui.graphics.Color.White)) }
        ?: Box(modifier.aspectRatio(0.72f).clip(shape).background(LocalPaper.current.sunk))
}

// ---- the notes, figures and all --------------------------------------------------------------

/**
 * The PDF's highlights, figures and drawings in page order, each a tap from its place; a figure
 * kept from the page (a loop round it, "Save as a clip") shows as itself.
 */
@Composable
fun PdfNotesList(doc: PdfDocument, notes: List<Highlight>, sizes: (Int) -> Pair<Float, Float>?, onGo: (Highlight) -> Unit, onEdit: (Highlight) -> Unit, onSend: () -> Unit) {
    val paper = LocalPaper.current
    val shown = notes.filter { !it.isDeleted }.sortedWith(compareBy({ pageOf(it) }, { it.rects?.firstOrNull()?.getOrNull(1) ?: 0.0 }, { it.createdAt }))
    if (shown.isEmpty()) {
        Text(
            "Draw the pen across text to highlight it, write anywhere on the page, or loop round a figure to keep it.",
            fontFamily = Sans, fontSize = 14.sp, lineHeight = 20.sp, color = paper.muted, modifier = Modifier.padding(22.dp),
        )
        return
    }
    LazyColumn(contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        item {
            Row(Modifier.padding(horizontal = 4.dp, vertical = 4.dp)) {
                androidx.compose.material3.OutlinedButton(onClick = onSend) { Text("Send to Obsidian") }
            }
        }
        items(shown, key = { it.id }) { n ->
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable { onGo(n) }.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("PAGE ${pageOf(n) + 1}", style = Eyebrow, color = paper.muted)
                val figure = n.ink == null && n.text.isBlank() && !n.rects.isNullOrEmpty()
                if (figure) Figure(doc, n, sizes)
                if (n.text.isNotBlank()) Text(
                    n.text, fontFamily = Serif, fontSize = 15.sp, lineHeight = 22.sp, maxLines = 6, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.background(hex(colorHex(n.color)).copy(alpha = 0.32f)).padding(horizontal = 2.dp),
                )
                n.ink?.let { InkThumbnail(it) }
                n.ink?.recognized?.let { Text(it, fontFamily = Sans, fontStyle = FontStyle.Italic, fontSize = 13.sp, color = paper.muted) }
                n.note?.takeIf { it.isNotBlank() }?.let { Text(it, fontFamily = Sans, fontSize = 14.sp, color = paper.muted) }
                TextButton(onClick = { onEdit(n) }, contentPadding = PaddingValues(0.dp)) { Text("Edit") }
            }
        }
    }
}

@Composable
private fun Figure(doc: PdfDocument, n: Highlight, sizes: (Int) -> Pair<Float, Float>?) {
    val page = pageOf(n)
    val bitmap by produceState<Bitmap?>(null, n.id) {
        val (w, h) = sizes(page) ?: return@produceState
        val area = fractionsToPage(n.rects.orEmpty(), w, h).union() ?: return@produceState
        value = pagePicture(doc, page, area, w, h, maxWidth = 700)
    }
    bitmap?.let { Image(it.asImageBitmap(), "A figure from page ${page + 1}", Modifier.widthIn(max = 360.dp).heightIn(max = 260.dp).clip(RoundedCornerShape(8.dp))) }
}

// ---- search inside the PDF -------------------------------------------------------------------

data class PdfHit(val page: Int, val rects: List<PageRect>, val before: String, val match: String, val after: String)

/** Every place a word or phrase is in the PDF, a few words either side; the one chosen is shown on its page. */
@Composable
fun PdfSearch(doc: PdfDocument, onGo: (PdfHit) -> Unit) {
    val paper = LocalPaper.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var searched by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val hits = remember { mutableStateListOf<PdfHit>() }
    val field = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { field.requestFocus() } }

    fun run() {
        val q = query.trim()
        if (q.length < 2 || busy) return
        busy = true; searched = q; hits.clear()
        scope.launch {
            runCatching {
                val found = doc.searchDocument(q, 0 until doc.pageCount)
                for (i in 0 until found.size()) {
                    val page = found.keyAt(i)
                    val text = runCatching { doc.getPageContent(page)?.textContents?.joinToString("\n") { it.text } }.getOrNull().orEmpty()
                    for (m in found.valueAt(i)) {
                        val at = m.textStartIndex.coerceIn(0, text.length)
                        val end = (at + q.length).coerceAtMost(text.length)
                        hits += PdfHit(page, m.bounds.map { PageRect(it.left, it.top, it.right, it.bottom) }, text.substring((at - 60).coerceAtLeast(0), at), text.substring(at, end), text.substring(end, (end + 80).coerceAtMost(text.length)))
                        if (hits.size >= 300) break
                    }
                    if (hits.size >= 300) break
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
                if (query.isEmpty()) Text("Words in this PDF", fontFamily = Sans, fontSize = 15.sp, color = paper.faint)
                BasicTextField(
                    query, { query = it }, singleLine = true,
                    textStyle = TextStyle(fontFamily = Sans, fontSize = 15.sp, color = paper.fg), cursorBrush = SolidColor(paper.accent),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { run() }),
                    modifier = Modifier.fillMaxWidth().focusRequester(field),
                )
            }
        }
        val status = when {
            busy -> "Searching…"
            searched == null -> null
            hits.isEmpty() -> "“$searched” isn't in this PDF."
            hits.size >= 300 -> "The first 300 places"
            else -> "${hits.size} place${if (hits.size == 1) "" else "s"}"
        }
        status?.let { Text(it.uppercase(), style = Eyebrow, color = paper.muted, modifier = Modifier.padding(horizontal = 22.dp, vertical = 6.dp)) }
        LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
            items(hits) { hit ->
                Column(Modifier.fillMaxWidth().clickable { onGo(hit) }.padding(horizontal = 22.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("PAGE ${hit.page + 1}", style = Eyebrow, color = paper.faint)
                    Text(
                        buildAnnotatedString {
                            append("…" + hit.before.replace('\n', ' ').trimStart())
                            withStyle(SpanStyle(fontWeight = FontWeight(600), background = androidx.compose.ui.graphics.Color(0x55FFB648))) { append(hit.match) }
                            append(hit.after.replace('\n', ' ').trimEnd() + "…")
                        },
                        fontFamily = Serif, fontSize = 15.sp, lineHeight = 21.sp, color = paper.fg, maxLines = 3, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

// ---- the PDF as text -------------------------------------------------------------------------

/**
 * A page's lines as paragraphs to read: a line runs on into the next unless it ends a sentence
 * well short of the measure (or the next is set apart), and a word broken at a line's end is
 * mended.
 */
fun paragraphs(lines: List<String>): List<String> {
    val clean = lines.map { it.trim() }.filter { it.isNotEmpty() }
    if (clean.isEmpty()) return emptyList()
    val measure = clean.map { it.length }.sorted()[clean.size * 3 / 4]
    val out = mutableListOf<StringBuilder>()
    var current = StringBuilder()
    clean.forEachIndexed { i, line ->
        if (current.isNotEmpty()) {
            if (current.endsWith("-") && line.firstOrNull()?.isLowerCase() == true) current.setLength(current.length - 1) else current.append(' ')
        }
        current.append(line)
        val next = clean.getOrNull(i + 1)
        val ends = line.last() in ".!?:\"”)" && line.length < measure * 0.8
        if (next == null || ends || (line.length < measure * 0.5 && next.firstOrNull()?.isUpperCase() == true)) {
            out += current; current = StringBuilder()
        }
    }
    if (current.isNotEmpty()) out += current
    return out.map { it.toString() }
}

/** The PDF read as text, a page after another, in the app's type; a page's number takes the reader to it as a page. */
@Composable
fun PdfTextView(doc: PdfDocument, start: Int, ink: androidx.compose.ui.graphics.Color, onPage: (Int) -> Unit, modifier: Modifier = Modifier) {
    val list = rememberLazyListState(initialFirstVisibleItemIndex = start.coerceAtLeast(0))
    LazyColumn(modifier, state = list, horizontalAlignment = Alignment.CenterHorizontally, contentPadding = PaddingValues(top = 72.dp, bottom = 96.dp)) {
        items((0 until doc.pageCount).toList(), key = { it }) { page ->
            val text by produceState<List<String>?>(null, page) {
                value = runCatching { paragraphs(doc.getPageContent(page)?.textContents?.flatMap { it.text.split('\n') }.orEmpty()) }.getOrDefault(emptyList())
            }
            Column(Modifier.widthIn(max = 680.dp).fillMaxWidth().padding(horizontal = 28.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(
                    "PAGE ${page + 1}", style = Eyebrow, color = ink.copy(alpha = 0.45f),
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable { onPage(page) }.padding(vertical = 4.dp),
                )
                when {
                    text == null -> Box(Modifier.heightIn(min = 400.dp))
                    text!!.isEmpty() -> Text("No text on this page; it may be a picture. Tap the page number to see it.", fontFamily = Sans, fontSize = 14.sp, color = ink.copy(alpha = 0.5f))
                    else -> text!!.forEach { p -> Text(p, fontFamily = Serif, fontSize = 19.sp, lineHeight = 30.sp, color = ink.copy(alpha = 0.9f)) }
                }
            }
        }
    }
}

// ---- citations -------------------------------------------------------------------------------

/** A numbered citation's number, from the words around a tap: "[12]", "[3, 7]" (the first), "[4–6]". */
fun citationNear(text: String): Int? = Regex("""\[(\d{1,3})(?:\s*[,–-]\s*\d{1,3})*]""").find(text)?.groupValues?.get(1)?.toIntOrNull()

/** A reference, as found in the paper's list of them: where it is, and what it says. */
data class Reference(val number: Int, val page: Int, val rects: List<PageRect>, val text: String)

/**
 * Finds reference `n` in the paper's list: the last place "[n]" starts a line (the references
 * come at the end), and the text from there to the next numbered entry.
 */
suspend fun findReference(doc: PdfDocument, n: Int): Reference? = runCatching {
    val found = doc.searchDocument("[$n]", 0 until doc.pageCount)
    for (i in found.size() - 1 downTo 0) {
        val page = found.keyAt(i)
        val content = doc.getPageContent(page)?.textContents.orEmpty()
        val lines = content.flatMap { c -> c.text.split('\n') }
        val at = lines.indexOfLast { it.trimStart().startsWith("[$n]") }
        if (at < 0) continue
        val entry = StringBuilder(lines[at].trim())
        var j = at + 1
        while (j < lines.size && !Regex("""^\s*\[\d{1,3}]""").containsMatchIn(lines[j]) && entry.length < 600) {
            entry.append(' ').append(lines[j].trim()); j++
        }
        val match = found.valueAt(i).last()
        return Reference(n, page, match.bounds.map { PageRect(it.left, it.top, it.right, it.bottom) }, entry.toString().removePrefix("[$n]").trim())
    }
    null
}.getOrNull()

@Composable
fun ReferenceCard(ref: Reference, onGo: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    val paper = LocalPaper.current
    Column(
        modifier.widthIn(max = 560.dp).fillMaxWidth().padding(16.dp)
            .shadow(8.dp, RoundedCornerShape(18.dp))
            .background(paper.raised, RoundedCornerShape(18.dp)).padding(start = 18.dp, end = 8.dp, top = 12.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("REFERENCE ${ref.number}", style = Eyebrow, color = paper.muted, modifier = Modifier.weight(1f))
            IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "Close", modifier = Modifier.size(18.dp)) }
        }
        Text(ref.text, fontFamily = Serif, fontSize = 15.sp, lineHeight = 22.sp, color = paper.fg, maxLines = 6, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = 10.dp))
        TextButton(onClick = onGo) { Text("Go to it, page ${ref.page + 1}") }
    }
}

