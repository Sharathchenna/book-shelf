package com.sharathchenna.shelf.reader

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.mikepenz.markdown.m3.Markdown
import com.sharathchenna.shelf.data.Highlight
import com.sharathchenna.shelf.data.Ink
import com.sharathchenna.shelf.data.Quote
import com.sharathchenna.shelf.data.ShelfJson
import com.sharathchenna.shelf.ink.InkCanvas
import com.sharathchenna.shelf.ink.InkDraft
import com.sharathchenna.shelf.ink.Recognizer
import com.sharathchenna.shelf.ink.drawInk
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.hex
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.readium.r2.shared.publication.Link
import java.io.File
import java.time.Instant
import java.util.UUID
import kotlin.coroutines.resume

// ---- the panels ------------------------------------------------------------------------------

@Composable
fun PanelContent(
    panel: Panel,
    book: OpenedBook,
    bookId: String,
    notes: List<Highlight>,
    ai: AiTask?,
    here: () -> Pair<Int, Double>,
    controller: ReaderController,
    onClose: () -> Unit,
    onEdit: (Highlight) -> Unit,
    onAi: (AiTask) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(start = 20.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                when (panel) { Panel.Contents -> "Contents"; Panel.Notes -> "Highlights & notes"; Panel.Ai -> "Ask" },
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, "Close") }
        }
        when (panel) {
            Panel.Contents -> Contents(book.publication.tableOfContents.ifEmpty { book.publication.readingOrder }) { link ->
                controller.navigator?.go(link, animated = false)
                onClose()
            }
            Panel.Notes -> NotesList(book, notes, onGo = { n -> book.locatorOf(n)?.let(controller::go); onClose() }, onEdit = onEdit)
            Panel.Ai -> AiPanel(bookId, ai ?: AiTask.Chat(null), here, onAi)
        }
    }
}

@Composable
private fun Contents(links: List<Link>, onGo: (Link) -> Unit) {
    val flat = remember(links) {
        buildList {
            fun walk(items: List<Link>, depth: Int) {
                for (l in items) {
                    add(l to depth); walk(l.children, depth + 1)
                }
            }
            walk(links, 0)
        }
    }
    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        items(flat) { (link, depth) ->
            Text(
                link.title ?: link.href.toString(),
                style = if (depth == 0) MaterialTheme.typography.bodyLarge else MaterialTheme.typography.bodyMedium,
                modifier = Modifier.fillMaxWidth().clickable { onGo(link) }.padding(start = 20.dp + (depth * 16).dp, end = 20.dp, top = 10.dp, bottom = 10.dp),
            )
        }
    }
}

@Composable
private fun NotesList(book: OpenedBook, notes: List<Highlight>, onGo: (Highlight) -> Unit, onEdit: (Highlight) -> Unit) {
    val paper = LocalPaper.current
    if (notes.isEmpty()) {
        Text(
            "Select text to highlight it or add a note, or draw in the margin with the pen.",
            color = paper.muted,
            modifier = Modifier.padding(20.dp),
        )
        return
    }
    LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        items(notes, key = { it.id }) { n ->
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable { onGo(n) }.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(sectionTitle(book, n.sectionIndex).uppercase(), style = Eyebrow, color = paper.muted)
                if (n.text.isNotBlank()) {
                    Text(
                        n.text,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = if (n.ink == null) Modifier.background(hex(colorHex(n.color)).copy(alpha = 0.35f)) else Modifier,
                        maxLines = 6,
                    )
                }
                n.ink?.let { ink -> InkThumbnail(ink) }
                n.ink?.recognized?.let { Text(it, style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic), color = paper.muted) }
                n.note?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = paper.muted) }
                TextButton(onClick = { onEdit(n) }, contentPadding = PaddingValues(0.dp)) { Text("Edit") }
            }
        }
    }
}

@Composable
fun InkThumbnail(ink: Ink, modifier: Modifier = Modifier) {
    // As tall as a few lines of text, as wide as the drawing's shape needs (up to the panel's width).
    val ratio = (ink.size[0] / ink.size[1]).toFloat().coerceIn(0.2f, 8f)
    Canvas(modifier.height(120.dp).aspectRatio(ratio, matchHeightConstraintsFirst = true).clip(RoundedCornerShape(12.dp)).background(LocalPaper.current.sunk)) {
        val scale = minOf(size.width / ink.size[0].toFloat(), size.height / ink.size[1].toFloat())
        drawInk(ink, scale)
    }
}

private fun sectionTitle(book: OpenedBook, index: Int): String =
    if (book.isPdf) "Page ${index + 1}" else book.linkFor(index)?.title ?: book.titles.getOrNull(index)?.takeIf { it.isNotBlank() } ?: "Section ${index + 1}"

fun colorHex(name: String) = "#%06X".format(0xFFFFFF and (HIGHLIGHT_ARGB[name] ?: HIGHLIGHT_ARGB.getValue("yellow")))

// ---- the AI panel ----------------------------------------------------------------------------

@Serializable
private data class ChatMessage(val role: String, val content: String)

/** Explain, Recap and Chat, streamed from the site's reader routes as they're written. */
@Composable
private fun AiPanel(bookId: String, task: AiTask, here: () -> Pair<Int, Double>, onAi: (AiTask) -> Unit) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val scope = rememberCoroutineScope()
    val messages = remember(task) { mutableStateListOf<ChatMessage>() }
    var answer by remember(task) { mutableStateOf("") }
    var error by remember(task) { mutableStateOf<String?>(null) }
    var busy by remember(task) { mutableStateOf(false) }
    var draft by remember(task) { mutableStateOf("") }
    val list = rememberLazyListState()

    fun run(path: String, body: kotlinx.serialization.json.JsonObject, chat: Boolean) {
        busy = true; error = null; answer = ""
        scope.launch {
            runCatching { shelf.api.stream(path, body).collect { answer = it } }.onFailure { error = it.message }
            if (chat && answer.isNotBlank()) messages += ChatMessage("assistant", answer.trim())
            if (chat) answer = ""
            busy = false
        }
    }

    LaunchedEffect(task) {
        when (task) {
            is AiTask.Explain -> run("/api/reader/explain", buildJsonObject {
                put("bookId", bookId); put("sectionIndex", task.sectionIndex); put("sectionFraction", task.fraction); put("selection", task.text); put("action", task.action)
            }, chat = false)
            is AiTask.Recap -> run("/api/reader/recap", buildJsonObject {
                put("bookId", bookId); put("sectionIndex", task.sectionIndex); put("sectionFraction", task.fraction)
            }, chat = false)
            is AiTask.Chat -> Unit
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        LazyColumn(Modifier.weight(1f), state = list, contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            when (task) {
                is AiTask.Explain -> item { Text("“${task.text.take(400)}”", style = MaterialTheme.typography.bodyLarge.copy(fontStyle = FontStyle.Italic), color = paper.muted) }
                is AiTask.Recap -> item { Text("WHERE YOU ARE", style = Eyebrow, color = paper.muted) }
                is AiTask.Chat -> {
                    task.quote?.let { item { Text("“${it.take(400)}”", style = MaterialTheme.typography.bodyLarge.copy(fontStyle = FontStyle.Italic), color = paper.muted) } }
                    if (messages.isEmpty() && answer.isEmpty()) item { Text("Ask anything about what you've read so far. It won't give away what's ahead.", color = paper.muted) }
                    items(messages) { m ->
                        if (m.role == "user") Text(m.content, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 32.dp))
                        else Markdown(m.content)
                    }
                }
            }
            if (answer.isNotEmpty()) item { Markdown(answer) }
            if (busy && answer.isEmpty()) item { Text("Thinking…", color = paper.muted) }
            error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
        }
        if (task !is AiTask.Chat) {
            Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { onAi(AiTask.Chat((task as? AiTask.Explain)?.text)) }) { Text("Ask a follow-up") }
            }
        } else {
            Row(Modifier.padding(12.dp).navigationBarsPadding(), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(draft, { draft = it }, placeholder = { Text("Ask about the book…") }, modifier = Modifier.weight(1f), maxLines = 4)
                IconButton(enabled = draft.isNotBlank() && !busy, onClick = {
                    val question = draft.trim()
                    draft = ""
                    messages += ChatMessage("user", question)
                    val (section, fraction) = here()
                    run("/api/reader/chat", buildJsonObject {
                        put("bookId", bookId); put("sectionIndex", section); put("sectionFraction", fraction)
                        task.quote?.let { put("quote", it) }
                        put("messages", buildJsonArray { messages.forEach { m -> add(buildJsonObject { put("role", m.role); put("content", m.content) }) } })
                    }, chat = true)
                }) { Icon(Icons.AutoMirrored.Outlined.Send, "Send") }
            }
        }
    }
    LaunchedEffect(messages.size, answer.length) { if (messages.isNotEmpty() || answer.isNotEmpty()) list.animateScrollToItem(maxOf(0, list.layoutInfo.totalItemsCount - 1)) }
}

// ---- a highlight's sheet ---------------------------------------------------------------------

data class NoteEdit(val note: Highlight, val focusNote: Boolean = false)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteSheet(edit: NoteEdit, onSave: (Highlight) -> Unit, onRemove: (Highlight) -> Unit, onExplain: (Highlight) -> Unit, onDismiss: () -> Unit) {
    var note by remember(edit) { mutableStateOf(edit.note.note.orEmpty()) }
    var color by remember(edit) { mutableStateOf(edit.note.color) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(edit) { if (edit.focusNote) focus.requestFocus() }
    ModalBottomSheet(onDismissRequest = { onSave(edit.note.copy(note = note.ifBlank { null }, color = color)) }) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 32.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (edit.note.text.isNotBlank()) Text("“${edit.note.text.take(600)}”", style = MaterialTheme.typography.bodyLarge.copy(fontStyle = FontStyle.Italic))
            edit.note.ink?.let { InkThumbnail(it) }
            if (edit.note.ink == null) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    HIGHLIGHT_ARGB.keys.forEach { c ->
                        Box(
                            Modifier.size(32.dp).clip(CircleShape).background(hex(colorHex(c)))
                                .then(if (c == color) Modifier.border(3.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier)
                                .clickable { color = c },
                        )
                    }
                }
            }
            OutlinedTextField(note, { note = it }, label = { Text("Note") }, modifier = Modifier.fillMaxWidth().focusRequester(focus), minLines = 2)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onSave(edit.note.copy(note = note.ifBlank { null }, color = color)) }) { Text("Save") }
                if (edit.note.text.isNotBlank()) OutlinedButton(onClick = { onExplain(edit.note) }) { Text("Explain") }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { onRemove(edit.note) }) { Text("Remove", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

// ---- reading settings ------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(settings: ReaderSettings, isPdf: Boolean, onChange: (ReaderSettings) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 32.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("THEME", style = Eyebrow, color = LocalPaper.current.muted)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("light" to "Paper", "sepia" to "Sepia", "dark" to "Night").forEach { (k, label) ->
                    FilterChip(selected = settings.theme == k, onClick = { onChange(settings.copy(theme = k)) }, label = { Text(label) })
                }
            }
            if (!isPdf) {
                Text("TYPE", style = Eyebrow, color = LocalPaper.current.muted)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("original" to "Book's own", "serif" to "Serif", "sans" to "Sans").forEach { (k, label) ->
                        FilterChip(selected = settings.font == k, onClick = { onChange(settings.copy(font = k)) }, label = { Text(label) })
                    }
                }
                Text("Size ${Math.round(settings.fontSize * 100)}%")
                Slider(value = settings.fontSize.toFloat(), onValueChange = { onChange(settings.copy(fontSize = (Math.round(it * 20) / 20.0))) }, valueRange = 0.7f..2f)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Scroll instead of turning pages", Modifier.weight(1f))
                    Switch(settings.scroll, { onChange(settings.copy(scroll = it)) })
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Two pages side by side when there's room", Modifier.weight(1f))
                    Switch(settings.spread, { onChange(settings.copy(spread = it)) })
                }
            }
        }
    }
}

// ---- drawing in an EPUB's margin -------------------------------------------------------------

private val PENS = listOf("#1F1D1A", "#B0382F", "#2F5FB0", "#1E7A58")

/** Where a drawing goes: the paragraph nearest it, as the page's own script finds it. */
@Serializable
private data class Anchor(val text: String, val before: String, val after: String, val progression: Double, val left: Double, val top: Double, val dpr: Double)

/**
 * The page's script, given a point in the page (CSS px): the text block whose lines are nearest
 * that height, and the start of its text (up to 120 characters, at a word) as the anchor both
 * readers can find, with where that starts on screen.
 */
private fun anchorScript(y: Double) = """
(function(y){
  var blocks = document.querySelectorAll('p,li,blockquote,h1,h2,h3,h4,h5,h6,pre,figcaption,dd,dt,td');
  var best = null, bestD = 1e9;
  for (var i = 0; i < blocks.length; i++) {
    var r = blocks[i].getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.right < 0 || r.left > innerWidth) continue;
    if (!blocks[i].textContent.trim()) continue;
    var d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < bestD) { bestD = d; best = blocks[i]; }
  }
  if (!best) return null;
  var walker = document.createTreeWalker(best, NodeFilter.SHOW_TEXT), node, first = null;
  while ((node = walker.nextNode())) { if (node.data.trim()) { first = node; break; } }
  if (!first) return null;
  var full = best.textContent.replace(/\s+/g, ' ').trim();
  var text = full.length > 120 ? full.slice(0, 120).replace(/\s+\S*$/, '') : full;
  var start = first.data.search(/\S/);
  // The anchor text's own range, as Readium will find and box it: from its first character to
  // its last, counting characters with whitespace collapsed.
  var range = document.createRange();
  range.setStart(first, start);
  var want = text.length, seen = 0, space = false, node2 = first, offset = start, end = null;
  walker = document.createTreeWalker(best, NodeFilter.SHOW_TEXT);
  walker.currentNode = first;
  while (node2 && !end) {
    for (var o = node2 === first ? start : 0; o < node2.data.length; o++) {
      var blank = /\s/.test(node2.data[o]);
      if (blank && space) continue;
      space = blank; seen++;
      if (seen >= want) { end = [node2, o + 1]; break; }
    }
    node2 = end ? null : walker.nextNode();
  }
  if (end) range.setEnd(end[0], end[1]); else range.setEndAfter(best.lastChild || best);
  var rect = range.getBoundingClientRect();
  if (!rect.width) rect = best.getBoundingClientRect();
  var head = document.createRange(); head.setStart(document.body, 0); head.setEnd(first, start);
  var before = head.toString().replace(/\s+/g, ' ');
  var all = document.body.textContent.replace(/\s+/g, ' ');
  var at = before.length;
  return JSON.stringify({ text: text, before: before.slice(-32).trimStart(), after: full.slice(text.length, text.length + 32).trimEnd(),
    progression: all.length ? at / all.length : 0, left: rect.left, top: rect.top, dpr: devicePixelRatio });
})($y)
"""

/** The page web views Readium shows now (two in a spread), with where each is in the window. */
private fun visibleWebViews(root: View?): List<Pair<WebView, IntArray>> {
    val found = mutableListOf<Pair<WebView, IntArray>>()
    fun walk(v: View) {
        if (!v.isShown) return
        if (v is WebView) {
            val at = IntArray(2).also { v.getLocationInWindow(it) }
            if (at[0] + v.width > 0) found += v to at
            return
        }
        if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
    }
    root?.let(::walk)
    return found
}

private suspend fun WebView.evaluate(script: String): String? = suspendCancellableCoroutine { c -> evaluateJavascript(script) { c.resume(it) } }

/**
 * Drawing in the margin with the stylus. Done places the drawing beside the paragraph nearest it:
 * its anchor is that paragraph's opening words (found by quote, as highlights are), and it's
 * drawn in the page by Readium from then on, moving with the text.
 */
@Composable
fun MarginInk(controller: ReaderController, book: OpenedBook, onPlaced: (Highlight) -> Unit, onClose: () -> Unit, onError: (String) -> Unit) {
    val draft = remember { InkDraft() }
    var pen by remember { mutableStateOf(PENS[0]) }
    var penOnly by remember { mutableStateOf(true) }
    var origin by remember { mutableStateOf(Offset.Zero) }
    val scope = rememberCoroutineScope()
    val paper = LocalPaper.current
    Box(Modifier.fillMaxSize().onGloballyPositioned { origin = it.positionInWindow() }) {
        InkCanvas(draft, pen, widthDp = 2.2f, penOnly = penOnly)
        Row(
            Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(12.dp).background(paper.raised, RoundedCornerShape(20.dp)).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            PENS.forEach { c ->
                Box(Modifier.size(26.dp).clip(CircleShape).background(hex(c)).then(if (c == pen) Modifier.border(3.dp, paper.accent, CircleShape) else Modifier).clickable { pen = c })
            }
            FilterChip(selected = penOnly, onClick = { penOnly = !penOnly }, label = { Text("Pen only") })
            IconButton(onClick = draft::undo) { Icon(Icons.AutoMirrored.Outlined.Undo, "Undo") }
            TextButton(onClick = onClose) { Text("Cancel") }
            Button(enabled = !draft.isEmpty, onClick = {
                scope.launch {
                    val note = place(draft, origin, controller, book)
                    if (note == null) onError("Couldn't find a paragraph near the drawing.") else onPlaced(note)
                    onClose()
                }
            }) { Text("Done") }
        }
    }
}

/** Turns a drawing (in screen pixels) into a margin note anchored to the nearest paragraph. */
private suspend fun place(draft: InkDraft, overlay: Offset, controller: ReaderController, book: OpenedBook): Highlight? {
    val bounds = draft.bounds() ?: return null
    val centerX = overlay.x + (bounds[0] + bounds[2]) / 2
    val centerY = overlay.y + (bounds[1] + bounds[3]) / 2
    val views = visibleWebViews(controller.epub?.view)
    val (web, at) = views.minByOrNull { (v, a) -> if (centerX >= a[0] && centerX <= a[0] + v.width) 0f else minOf(kotlin.math.abs(centerX - a[0]), kotlin.math.abs(centerX - a[0] - v.width)) } ?: return null
    val density = web.resources.displayMetrics.density
    val raw = web.evaluate(anchorScript(((centerY - at[1]) / density).toDouble())) ?: return null
    // evaluateJavascript hands back the JSON string as a JSON string.
    val json = runCatching { ShelfJson.decodeFromString<String>(raw) }.getOrNull() ?: return null
    val anchor = runCatching { ShelfJson.decodeFromString<Anchor>(json) }.getOrNull() ?: return null
    val unit = anchor.dpr.toFloat()
    val pad = 4 * unit
    // The drawing's box, in screen pixels, then in the page's CSS px from the anchor's corner.
    val boxLeft = overlay.x + bounds[0] - pad
    val boxTop = overlay.y + bounds[1] - pad
    val anchorLeft = at[0] + anchor.left.toFloat() * unit
    val anchorTop = at[1] + anchor.top.toFloat() * unit
    val ink = draft.toInk(
        place = "margin",
        originX = bounds[0] - pad,
        originY = bounds[1] - pad,
        unit = unit,
        size = listOf(((bounds[2] - bounds[0] + 2 * pad) / unit).toDouble(), ((bounds[3] - bounds[1] + 2 * pad) / unit).toDouble()),
    ).copy(offset = listOf(((boxLeft - anchorLeft) / unit).toDouble(), ((boxTop - anchorTop) / unit).toDouble()))
    val section = controller.navigator?.currentLocator?.value?.let(book::sectionOf) ?: 0
    val now = Instant.now().toString()
    return Highlight(
        id = UUID.randomUUID().toString().replace("-", "").take(16),
        text = anchor.text,
        quote = Quote(anchor.before, anchor.after),
        progression = anchor.progression,
        color = "blue",
        ink = ink,
        sectionIndex = section,
        createdAt = now,
        updatedAt = now,
    )
}

// ---- drawing on a PDF page -------------------------------------------------------------------

/**
 * A PDF page on its own, for drawing on with the pen: the page rendered by Android's PdfRenderer,
 * the drawing kept in units of the page's width, so it lands in the same place at any size, here
 * and on the site.
 */
@Composable
fun PageSketch(pdf: File, page: Int, onSave: (Ink) -> Unit, onDismiss: () -> Unit) {
    var bitmap by remember { mutableStateOf<Bitmap?>(null) }
    val draft = remember { InkDraft() }
    var pen by remember { mutableStateOf(PENS[1]) }
    var imageOrigin by remember { mutableStateOf(Offset.Zero) }
    var overlayOrigin by remember { mutableStateOf(Offset.Zero) }
    var imageWidth by remember { mutableStateOf(1f) }
    val context = LocalContext.current
    LaunchedEffect(page) {
        bitmap = withContext(Dispatchers.IO) {
            runCatching {
                ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
                    PdfRenderer(fd).use { renderer ->
                        renderer.openPage(page.coerceIn(0, renderer.pageCount - 1)).use { p ->
                            val width = context.resources.displayMetrics.widthPixels.coerceAtMost(2400)
                            val bmp = Bitmap.createBitmap(width, (width.toFloat() * p.height / p.width).toInt(), Bitmap.Config.ARGB_8888)
                            bmp.eraseColor(android.graphics.Color.WHITE)
                            p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            bmp
                        }
                    }
                }
            }.getOrNull()
        }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(LocalPaper.current.bg).statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Page ${page + 1}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 12.dp))
                PENS.forEach { c -> Box(Modifier.size(26.dp).clip(CircleShape).background(hex(c)).then(if (c == pen) Modifier.border(3.dp, LocalPaper.current.accent, CircleShape) else Modifier).clickable { pen = c }) }
                IconButton(onClick = draft::undo) { Icon(Icons.AutoMirrored.Outlined.Undo, "Undo") }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Button(enabled = !draft.isEmpty && bitmap != null, onClick = {
                    val bmp = bitmap!!
                    val ox = imageOrigin.x - overlayOrigin.x
                    val oy = imageOrigin.y - overlayOrigin.y
                    onSave(draft.toInk("page", ox, oy, imageWidth, listOf(1.0, bmp.height.toDouble() / bmp.width)))
                }) { Text("Save") }
            }
            HorizontalDivider()
            BoxWithConstraints(Modifier.fillMaxSize().onGloballyPositioned { overlayOrigin = it.positionInWindow() }, contentAlignment = Alignment.Center) {
                bitmap?.let { bmp ->
                    Image(
                        bmp.asImageBitmap(),
                        contentDescription = "Page ${page + 1}",
                        modifier = Modifier.aspectRatio(bmp.width.toFloat() / bmp.height).onGloballyPositioned {
                            imageOrigin = it.positionInWindow(); imageWidth = it.size.width.toFloat()
                        },
                    )
                }
                InkCanvas(draft, pen, widthDp = 2f, penOnly = true)
            }
        }
    }
}
