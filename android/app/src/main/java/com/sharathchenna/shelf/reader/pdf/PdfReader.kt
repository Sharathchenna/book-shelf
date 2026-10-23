package com.sharathchenna.shelf.reader.pdf

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.ext.SdkExtensions
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.pdf.Highlight as PdfHighlight
import androidx.pdf.PdfDocument
import androidx.pdf.PdfPoint
import androidx.pdf.PdfRect
import androidx.pdf.SandboxedPdfLoader
import androidx.pdf.selection.model.TextSelection
import androidx.pdf.view.PdfView
import com.sharathchenna.shelf.data.Highlight
import com.sharathchenna.shelf.data.Ink
import com.sharathchenna.shelf.data.InkStroke
import com.sharathchenna.shelf.data.Progress
import com.sharathchenna.shelf.data.Shelf
import com.sharathchenna.shelf.ink.Recognizer
import com.sharathchenna.shelf.reader.AiPanel
import com.sharathchenna.shelf.reader.AiTask
import com.sharathchenna.shelf.reader.BriefPanel
import com.sharathchenna.shelf.reader.ChatPanel
import com.sharathchenna.shelf.reader.Cite
import com.sharathchenna.shelf.reader.FreshHighlight
import com.sharathchenna.shelf.reader.HIGHLIGHT_ARGB
import com.sharathchenna.shelf.reader.NoteEdit
import com.sharathchenna.shelf.reader.NoteEditor
import com.sharathchenna.shelf.reader.NoteSheet
import com.sharathchenna.shelf.reader.Panel
import com.sharathchenna.shelf.reader.PenTool
import com.sharathchenna.shelf.reader.PenTools
import com.sharathchenna.shelf.reader.ReaderSettings
import com.sharathchenna.shelf.reader.SelectionAction
import com.sharathchenna.shelf.reader.SettingsSheet
import com.sharathchenna.shelf.reader.TopBar
import com.sharathchenna.shelf.reader.readerBackground
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

/** Whether this device has the system's PDF engine that Android's PDF library needs (SDK extension 13, from Android 15). */
fun pdfEngineAvailable(): Boolean = runCatching { SdkExtensions.getExtensionVersion(Build.VERSION_CODES.S) >= 13 }.getOrDefault(false)

private enum class PdfPanel { Pages, Notes, Search, Ai, Brief, Pinned }

/** What the menu (a loop, a bracket, the pen's button, or a finger's selection) is for. */
private data class Choice(val passage: PdfPassage?, val area: PageRect?, val page: Int, val stroke: InkStroke?, val x: Float, val y: Float)

private fun newId() = UUID.randomUUID().toString().replace("-", "").take(16)

/**
 * A PDF in Android's own PDF view, read as the best PDF apps read: the pen highlights, writes on
 * the page, and loops or brackets what it wants explained or kept; a figure can be clipped and
 * asked about; the margins can be cropped away, two pages shown side by side, or the text read as
 * a column. Highlights are kept as the site keeps them (each line a rectangle of fractions of the
 * page), so the site's PDF reader and this one show the same ones.
 */
@OptIn(ExperimentalMaterial3Api::class, FlowPreview::class)
@Composable
fun PdfReading(opened: Shelf.Opened, at: String?, onBack: () -> Unit, onListen: (Int) -> Unit, onFallback: () -> Unit) {
    val shelf = LocalShelf.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val file = opened.file
    val paperish = file.paperId != null || file.clipId != null
    var doc by remember { mutableStateOf<PdfDocument?>(null) }
    var failed by remember { mutableStateOf<String?>(null) }
    var layer by remember { mutableStateOf<PdfPenLayer?>(null) }
    var sizesKnown by remember { mutableIntStateOf(0) }
    val notes by shelf.notes(file.id).collectAsState(initial = emptyList())
    val currentNotes by rememberUpdatedState(notes)
    var settings by remember { mutableStateOf(ReaderSettings.load(context, article = false)) }
    var chrome by remember { mutableStateOf(true) }
    var panel by remember { mutableStateOf<PdfPanel?>(null) }
    var ai by remember { mutableStateOf<AiTask?>(null) }
    var editing by remember { mutableStateOf<NoteEdit?>(null) }
    var fresh by remember { mutableStateOf<Highlight?>(null) }
    var choice by remember { mutableStateOf<Choice?>(null) }
    var page by remember { mutableIntStateOf(0) }
    var marks by remember { mutableStateOf(PageMarks.load(context, file.id)) }
    var jumpFrom by remember { mutableStateOf<Int?>(null) }
    var pinned by remember { mutableStateOf<Int?>(null) }
    var tools by remember { mutableStateOf(false) }
    var tool by remember { mutableStateOf(PenTool()) }
    var searchHits by remember { mutableStateOf<List<PdfHighlight>>(emptyList()) }
    var reference by remember { mutableStateOf<Reference?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var showSettings by remember { mutableStateOf(false) }

    // The document, opened by the system's PDF service in its sandbox, and closed with the reader.
    LaunchedEffect(opened.path) {
        runCatching { SandboxedPdfLoader(context, Dispatchers.IO).openDocument(Uri.fromFile(opened.path), null) }
            .onSuccess { doc = it }
            .onFailure { failed = it.message ?: "This PDF wouldn't open here." }
    }
    DisposableEffect(doc) { onDispose { runCatching { doc?.close() } } }

    val count = doc?.pageCount ?: 0
    val first = remember(file.id) {
        notes.find { it.id == at }?.let(::pageOf)
            ?: opened.progress?.let { p -> Regex("^page:(\\d+)").find(p.cfi)?.groupValues?.get(1)?.toIntOrNull()?.minus(1) ?: p.sectionIndex }
            ?: 0
    }

    /** Goes to a page, remembering where the reader was so they can come back. */
    fun go(to: Int, point: PdfPoint? = null) {
        val l = layer ?: return
        if (kotlin.math.abs(to - page) >= 2) jumpFrom = page
        if (point != null) l.pdf.scrollToPosition(point) else l.pdf.scrollToPage(to.coerceIn(0, (count - 1).coerceAtLeast(0)))
    }

    // Highlights and drawings, placed on their pages once the pages' sizes are known.
    LaunchedEffect(notes, sizesKnown, layer, settings.color, searchHits) {
        val l = layer ?: return@LaunchedEffect
        val live = notes.filter { !it.isDeleted }
        l.highlights = live.filter { it.ink == null && !it.rects.isNullOrEmpty() }.flatMap { n ->
            val p = pageOf(n)
            val (w, h) = l.pageSize(p) ?: return@flatMap emptyList()
            val color = (HIGHLIGHT_ARGB[n.color] ?: HIGHLIGHT_ARGB.getValue("yellow")) and 0x00FFFFFF or 0x66000000
            fractionsToPage(n.rects.orEmpty(), w, h).map { PdfHighlight(PdfRect(p, it.left, it.top, it.right, it.bottom), color) }
        } + searchHits
        l.inks = live.filter { it.ink?.place == "page" }.map { pageOf(it) to it.ink!! }
    }
    LaunchedEffect(layer, settings, tool, tools) {
        val l = layer ?: return@LaunchedEffect
        l.tint(settings.theme)
        l.highlightColor = (HIGHLIGHT_ARGB[settings.color] ?: HIGHLIGHT_ARGB.getValue("yellow")) and 0x00FFFFFF or 0x66000000
        l.highlight = settings.penHighlight
        l.write = settings.penWrite
        l.penColor = tool.color
        l.penWidthDp = tool.width
        l.erasing = tools && tool.erasing
    }

    // The place, saved a moment after the reader settles on a page (not the page it opened at).
    LaunchedEffect(doc) {
        if (doc == null) return@LaunchedEffect
        snapshotFlow { page }.drop(1).debounce(1500).collect { p ->
            shelf.saveProgress(file.id, Progress(cfi = "page:${p + 1}", fraction = if (count > 1) p.toDouble() / (count - 1) else 0.0, sectionIndex = p))
        }
    }
    LaunchedEffect(chrome, panel, tools) {
        if (chrome && panel == null && !tools) {
            kotlinx.coroutines.delay(4000)
            chrome = false
        }
    }

    BackHandler(enabled = panel != null || editing != null || choice != null || tools) {
        when {
            choice != null -> choice = null
            editing != null -> editing = null
            tools -> tools = false
            else -> panel = null
        }
    }

    // ---- saving -------------------------------------------------------------------------------

    fun save(passage: PdfPassage, note: String? = null): Highlight? {
        val (w, h) = layer?.pageSize(passage.page) ?: return null
        val now = Instant.now().toString()
        val n = Highlight(
            id = newId(), cfi = "page:${passage.page + 1}", text = passage.text.take(4000), rects = pageToFractions(passage.rects, w, h),
            color = settings.color, note = note, sectionIndex = passage.page, createdAt = now, updatedAt = now,
        )
        scope.launch { shelf.saveNote(file.id, n) }
        return n
    }

    fun clip(page: Int, area: PageRect, text: String): Highlight? {
        val (w, h) = layer?.pageSize(page) ?: return null
        val now = Instant.now().toString()
        val n = Highlight(
            id = newId(), cfi = "page:${page + 1}", text = text, rects = pageToFractions(listOf(area), w, h),
            color = settings.color, sectionIndex = page, createdAt = now, updatedAt = now,
        )
        scope.launch { shelf.saveNote(file.id, n) }
        return n
    }

    suspend fun picture(page: Int, area: PageRect?): String? {
        val d = doc ?: return null
        val (w, h) = layer?.pageSize(page) ?: return null
        val bmp = pagePicture(d, page, area ?: return null, w, h) ?: return null
        return jpegBase64(bmp)
    }

    /** The reader's actions on a passage or a figure: highlighting, the AI's readings, asking. */
    fun act(c: Choice, action: String) {
        choice = null
        layer?.pdf?.clearCurrentSelection()
        val p = c.passage
        val area = c.area ?: p?.rects?.union()
        val fraction = area?.let { a -> layer?.pageSize(c.page)?.second?.let { (a.top / it).toDouble() } } ?: 0.0
        when (action) {
            "highlight" -> fresh = p?.let { save(it) }
            "note" -> p?.let { save(it) }?.let { editing = NoteEdit(it, focusNote = true) }
            "clip" -> area?.let { clip(c.page, it, p?.text.orEmpty()) }?.let { editing = NoteEdit(it, focusNote = true) }
            "ink" -> c.stroke?.let { layer?.keep(c.page, it) }
            "copy" -> p?.let {
                (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Shelf", it.text))
                message = "Copied."
            }
            "ask" -> scope.launch {
                ai = AiTask.Chat(p?.text ?: "The figure on page ${c.page + 1}", picture(c.page, area))
                panel = PdfPanel.Ai
            }
            else -> scope.launch {
                ai = AiTask.Explain(p?.text ?: "The figure on page ${c.page + 1}", action, c.page, fraction, picture(c.page, area))
                panel = PdfPanel.Ai
            }
        }
    }

    val listener = remember {
        object : PdfPenListener {
            override fun onTap(page: Int, x: Float, y: Float, screenX: Float, screenY: Float): Boolean {
                val l = layer ?: return false
                val (w, h) = l.pageSize(page) ?: return false
                val onPage = currentNotes.filter { !it.isDeleted && pageOf(it) == page }
                onPage.firstOrNull { it.ink == null && fractionsToPage(it.rects.orEmpty(), w, h).any { r -> r.contains(x, y, pad = 2f) } }?.let { editing = NoteEdit(it); return true }
                val radius = 10 * context.resources.displayMetrics.density / l.unitScale(page).coerceAtLeast(0.01f)
                onPage.firstOrNull { n -> n.ink?.strokes?.any { PdfPenLayer.hits(it, x / w, y / w, radius / w) } == true }?.let { editing = NoteEdit(it); return true }
                // A numbered citation under the tap: the reference it points to, as a card.
                if (file.paperId != null) {
                    val line = l.lines(page).firstOrNull { it.contains(x, y, pad = 2f) }
                    if (line != null) scope.launch {
                        val d = doc ?: return@launch
                        val around = runCatching {
                            d.getSelectionBounds(page, android.graphics.PointF((x - 24).coerceAtLeast(line.left), (line.top + line.bottom) / 2), android.graphics.PointF((x + 24).coerceAtMost(line.right), (line.top + line.bottom) / 2))
                        }.getOrNull()?.selectedContents?.filterIsInstance<androidx.pdf.content.PdfPageTextContent>()?.joinToString(" ") { it.text }.orEmpty()
                        citationNear(around)?.let { n -> findReference(d, n)?.let { reference = it } }
                    }
                }
                chrome = !chrome
                return false
            }

            override fun onPassage(passage: PdfPassage, menu: Boolean, screenX: Float, screenY: Float) {
                if (menu) choice = Choice(passage, null, passage.page, null, screenX, screenY) else fresh = save(passage)
            }

            override fun onGesture(passage: PdfPassage?, area: PageRect?, page: Int, stroke: InkStroke, screenX: Float, screenY: Float) {
                choice = Choice(passage, area, page, stroke, screenX, screenY)
            }

            override fun onInk(page: Int, strokes: List<InkStroke>) {
                val (w, h) = layer?.pageSize(page) ?: return
                val now = Instant.now().toString()
                val n = Highlight(id = newId(), cfi = "page:${page + 1}", text = "", color = "blue", ink = Ink("page", listOf(1.0, (h / w).toDouble()), strokes = strokes), sectionIndex = page, createdAt = now, updatedAt = now)
                scope.launch {
                    shelf.saveNote(file.id, n)
                    // The handwriting read on the device, for search and the notes (the first time fetches the model).
                    Recognizer.read(strokes)?.let { words -> shelf.saveNote(file.id, n.copy(ink = n.ink!!.copy(recognized = words))) }
                }
            }

            override fun onErase(page: Int, x: Float, y: Float, radius: Float) {
                val (w, h) = layer?.pageSize(page) ?: return
                val onPage = currentNotes.filter { !it.isDeleted && pageOf(it) == page }
                scope.launch {
                    onPage.filter { it.ink == null && fractionsToPage(it.rects.orEmpty(), w, h).any { r -> r.contains(x, y, pad = radius / 2) } }.forEach { shelf.removeNote(file.id, it) }
                    onPage.filter { it.ink != null }.forEach { n ->
                        val ink = n.ink!!
                        val kept = ink.strokes.filterNot { PdfPenLayer.hits(it, x / w, y / w, radius / w) }
                        if (kept.size != ink.strokes.size) {
                            if (kept.isEmpty()) shelf.removeNote(file.id, n) else shelf.saveNote(file.id, n.copy(ink = ink.copy(strokes = kept)))
                        }
                    }
                }
            }

            override fun onNearTop() { if (!chrome) chrome = true }
            override fun onButton() { go(page + 1) }
        }
    }

    // ---- the screen ---------------------------------------------------------------------------

    failed?.let { reason ->
        Box(Modifier.fillMaxSize().background(LocalPaper.current.bg), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("This PDF wouldn't open here.", style = MaterialTheme.typography.headlineSmall)
                Text(reason, color = LocalPaper.current.muted, modifier = Modifier.padding(8.dp))
                TextButton(onClick = onFallback) { Text("Open it in the simple reader") }
                TextButton(onClick = onBack) { Text("Back to the library") }
            }
        }
        return
    }
    val d = doc ?: run {
        Box(Modifier.fillMaxSize().background(LocalPaper.current.bg), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }

    val pageKeys = Modifier.onPreviewKeyEvent { e ->
        if (e.type != KeyEventType.KeyDown || panel == PdfPanel.Ai || editing != null) return@onPreviewKeyEvent false
        when (e.key) {
            Key.DirectionRight, Key.PageDown, Key.DirectionDown -> go(page + 1)
            Key.DirectionLeft, Key.PageUp, Key.DirectionUp -> go(page - 1)
            Key.Spacebar -> go(if (e.isShiftPressed) page - 1 else page + 1)
            else -> return@onPreviewKeyEvent false
        }
        true
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(readerBackground(settings.theme)).then(pageKeys)) {
        val wide = maxWidth >= 840.dp
        val landscape = maxWidth > maxHeight
        Row(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f).fillMaxHeight()) {
                if (settings.textView) {
                    PdfTextView(d, page, if (settings.theme == "dark") androidx.compose.ui.graphics.Color.White else androidx.compose.ui.graphics.Color.Black, onPage = { p ->
                        settings = settings.copy(textView = false)
                        scope.launch { kotlinx.coroutines.delay(300); go(p) }
                    }, modifier = Modifier.fillMaxSize().statusBarsPadding())
                } else AndroidView(
                    modifier = Modifier.fillMaxSize().statusBarsPadding(),
                    factory = { ctx ->
                        PdfPenLayer(ctx).also { l ->
                            l.listener = listener
                            l.onSizes = { sizesKnown++ }
                            l.onViewport = { firstPage, _ ->
                                if (kotlin.math.abs(firstPage - page) >= 3 && jumpFrom == null) jumpFrom = page
                                page = firstPage
                            }
                            l.document = d
                            l.pdf.addOnFirstContentLoadListener(object : PdfView.OnFirstContentLoadListener {
                                override fun onFirstContentLoad() { if (first > 0) l.pdf.scrollToPage(first.coerceIn(0, d.pageCount - 1)); jumpFrom = null }
                            })
                            // A finger's selection gets the reader's menu, not the system's.
                            l.pdf.addSelectionMenuItemPreparer(object : PdfView.SelectionMenuItemPreparer {
                                override fun onPrepareSelectionMenuItems(components: MutableList<androidx.pdf.selection.ContextMenuComponent>) { runCatching { components.clear() } }
                            })
                            l.pdf.addOnSelectionChangedListener(object : PdfView.OnSelectionChangedListener {
                                override fun onSelectionChanged(selection: androidx.pdf.selection.Selection?) {
                                    val text = (selection as? TextSelection)?.text?.toString()?.trim().orEmpty()
                                    val bounds = selection?.bounds.orEmpty()
                                    if (text.isEmpty() || bounds.isEmpty()) return
                                    val p = bounds.first().pageNum
                                    val rects = bounds.filter { it.pageNum == p }.map { PageRect(it.left, it.top, it.right, it.bottom) }
                                    val last = l.pdf.pdfToViewPoint(PdfPoint(p, rects.last().right, rects.last().bottom))
                                    choice = Choice(PdfPassage(p, text, rects), null, p, null, last?.x ?: 0f, last?.y ?: 0f)
                                }
                            })
                            layer = l
                        }
                    },
                    update = { l -> l.pdf.pagesPerRow = if (wide && landscape && settings.spread) 2 else 1 },
                )

                // Crop: the first page's text filling the width, zoomed from fit and slid to its left edge.
                LaunchedEffect(settings.crop, layer, sizesKnown, settings.spread, landscape) {
                    val l = layer ?: return@LaunchedEffect
                    if (!settings.crop) return@LaunchedEffect
                    repeat(20) {
                        val lines = l.lines(page)
                        val size = l.pageSize(page)
                        if (lines.isNotEmpty() && size != null) {
                            val left = lines.minOf { it.left }; val right = lines.maxOf { it.right }
                            val share = (right - left + 16) / size.first
                            if (share in 0.2f..0.95f) {
                                l.pdf.zoom = l.pdf.zoom / share
                                kotlinx.coroutines.delay(60)
                                l.pdf.pdfToViewPoint(PdfPoint(page, left - 8, lines.minOf { it.top }))?.let { v -> l.pdf.scrollBy(v.x.toInt(), 0) }
                            }
                            return@LaunchedEffect
                        }
                        kotlinx.coroutines.delay(150)
                    }
                }

                if (tools) Row(
                    Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = if (chrome) 76.dp else 12.dp)
                        .shadow(4.dp, RoundedCornerShape(24.dp)).background(LocalPaper.current.raised, RoundedCornerShape(24.dp)).padding(horizontal = 10.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    PenTools(tool, onTool = { tool = it }, onUndo = null)
                    TextButton(onClick = { tools = false }) { Text("Done") }
                }

                if (chrome) Box(Modifier.align(Alignment.TopCenter)) {
                    TopBar(
                        title = file.title,
                        chapter = "Page ${page + 1} of $count",
                        percent = if (count > 1) page * 100 / (count - 1) else 0,
                        isPdf = true,
                        onBack = onBack,
                        onPanel = { p ->
                            val want = when (p) { Panel.Contents -> PdfPanel.Pages; Panel.Notes -> PdfPanel.Notes; Panel.Search -> PdfPanel.Search; Panel.Ai -> PdfPanel.Ai; Panel.Brief -> PdfPanel.Brief }
                            panel = if (panel == want) null else want
                        },
                        onRecap = { ai = AiTask.Recap(page, 0.5); panel = PdfPanel.Ai },
                        onChat = { if (panel == PdfPanel.Ai && ai is AiTask.Chat) panel = null else { ai = AiTask.Chat(null); panel = PdfPanel.Ai } },
                        onDraw = { tools = !tools },
                        onSettings = { showSettings = true },
                        onListen = { onListen(page) },
                        searchable = true,
                        marked = page in marks,
                        onMark = {
                            marks = if (page in marks) marks - page else marks + page
                            PageMarks.save(context, file.id, marks)
                        },
                        onBrief = if (paperish) ({ panel = if (panel == PdfPanel.Brief) null else PdfPanel.Brief }) else null,
                        contentsLabel = "Pages and bookmarks",
                    )
                }

                // The foot: the page, or with the bars up, a slider through the pages.
                val ink = if (settings.theme == "dark") androidx.compose.ui.graphics.Color.White else androidx.compose.ui.graphics.Color.Black
                if (chrome) {
                    var dragging by remember { mutableStateOf<Float?>(null) }
                    val paper = LocalPaper.current
                    Column(
                        Modifier.align(Alignment.BottomCenter).widthIn(max = 720.dp).fillMaxWidth().navigationBarsPadding().padding(12.dp)
                            .clip(RoundedCornerShape(20.dp)).background(paper.raised.copy(alpha = 0.97f)).padding(horizontal = 20.dp, vertical = 8.dp),
                    ) {
                        val shown = dragging ?: (if (count > 1) page.toFloat() / (count - 1) else 0f)
                        Text("Page ${Math.round(shown * (count - 1)) + 1} of $count", fontFamily = Sans, fontSize = 12.5.sp, color = paper.muted)
                        Slider(
                            value = shown, onValueChange = { dragging = it },
                            onValueChangeFinished = { dragging?.let { go(Math.round(it * (count - 1))) }; dragging = null },
                            colors = SliderDefaults.colors(thumbColor = paper.fg, activeTrackColor = paper.fg, inactiveTrackColor = paper.sunk),
                        )
                    }
                } else if (!settings.textView) {
                    Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(end = if (panel == null) 230.dp else 0.dp).navigationBarsPadding()) {
                        Text("Page ${page + 1} of $count", fontFamily = Sans, fontSize = 11.5.sp, color = ink.copy(alpha = 0.5f), modifier = Modifier.padding(horizontal = 28.dp, vertical = 6.dp))
                    }
                }

                // Back to where the reader was, after a jump (a link, a reference, the pages, search).
                jumpFrom?.let { from ->
                    LaunchedEffect(from) { kotlinx.coroutines.delay(15000); if (jumpFrom == from) jumpFrom = null }
                    val paper = LocalPaper.current
                    Row(
                        Modifier.align(Alignment.BottomStart).navigationBarsPadding().padding(start = 20.dp, bottom = 64.dp)
                            .shadow(6.dp, RoundedCornerShape(50)).clip(RoundedCornerShape(50)).background(paper.raised)
                            .clickable { val to = from; jumpFrom = null; layer?.pdf?.scrollToPage(to) }
                            .padding(start = 12.dp, end = 16.dp, top = 9.dp, bottom = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, modifier = Modifier.size(18.dp))
                        Text("  Back to page ${from + 1}", fontFamily = Sans, fontSize = 14.sp)
                    }
                }

                // The chat, a tap away while reading.
                if (panel == null && !chrome && !tools) {
                    val paper = LocalPaper.current
                    Row(
                        Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(20.dp)
                            .shadow(6.dp, RoundedCornerShape(50)).clip(RoundedCornerShape(50)).background(paper.fg)
                            .clickable { ai = AiTask.Chat(null); panel = PdfPanel.Ai }
                            .padding(start = 14.dp, end = 18.dp, top = 11.dp, bottom = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.AutoMirrored.Outlined.Chat, null, tint = paper.bg, modifier = Modifier.size(20.dp))
                        Text(if (file.paperId != null) "  Ask about the paper" else "  Ask about it", color = paper.bg, style = MaterialTheme.typography.labelLarge)
                    }
                }

                fresh?.let { n ->
                    LaunchedEffect(n.id) { kotlinx.coroutines.delay(5000); if (fresh?.id == n.id) fresh = null }
                    FreshHighlight(
                        n,
                        onColor = { c -> scope.launch { shelf.saveNote(file.id, n.copy(color = c)) }; fresh = null },
                        onNote = { editing = NoteEdit(n, focusNote = true); fresh = null },
                        modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 56.dp),
                    )
                }

                reference?.let { r ->
                    ReferenceCard(r, onGo = { reference = null; go(r.page, r.rects.firstOrNull()?.let { PdfPoint(r.page, it.left, it.top) }) }, onDismiss = { reference = null }, modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 48.dp))
                }

                choice?.let { c -> ChoiceMenu(c, onAction = { act(c, it) }, onDismiss = { choice = null; layer?.pdf?.clearCurrentSelection() }) }

                message?.let {
                    LaunchedEffect(it) { kotlinx.coroutines.delay(3000); message = null }
                    Snackbar(Modifier.align(Alignment.BottomCenter).padding(24.dp)) { Text(it) }
                }
            }

            if (wide && (panel != null || editing != null)) {
                Box(Modifier.width(if (panel == PdfPanel.Pinned) 520.dp else 400.dp).fillMaxHeight().background(LocalPaper.current.raised).statusBarsPadding().navigationBarsPadding()) {
                    val edit = editing
                    if (edit != null) NoteEditor(
                        edit,
                        onSave = { n -> scope.launch { shelf.saveNote(file.id, n) }; editing = null },
                        onRemove = { n -> scope.launch { shelf.removeNote(file.id, n) }; editing = null },
                        onExplain = { n -> editing = null; ai = AiTask.Explain(n.text, "explain", pageOf(n), 0.0); panel = PdfPanel.Ai },
                        onClose = { n -> scope.launch { shelf.saveNote(file.id, n) }; editing = null },
                    ) else PdfPanelContent(panel!!, d, file.id, file.paperId != null, notes, ai, page, layer, marks, pinned,
                        onGo = { p, point -> go(p, point) }, onClose = { panel = null }, onEdit = { editing = NoteEdit(it) }, onAi = { ai = it },
                        onSearchHits = { searchHits = it }, onPin = { pinned = it; panel = PdfPanel.Pinned }, onSend = { sendNotes(context, file, notes) { message = it } })
                }
            }
        }
        if (!wide && panel != null) {
            ModalBottomSheet(onDismissRequest = { panel = null }) {
                Box(Modifier.fillMaxWidth().fillMaxHeight(0.85f)) {
                    PdfPanelContent(panel!!, d, file.id, file.paperId != null, notes, ai, page, layer, marks, pinned,
                        onGo = { p, point -> go(p, point); panel = null }, onClose = { panel = null }, onEdit = { editing = NoteEdit(it) }, onAi = { ai = it },
                        onSearchHits = { searchHits = it }, onPin = { pinned = it; panel = PdfPanel.Pinned }, onSend = { sendNotes(context, file, notes) { message = it } })
                }
            }
        }
    }

    if (LocalConfiguration.current.screenWidthDp < 840) editing?.let { edit ->
        NoteSheet(
            edit = edit,
            onSave = { n -> scope.launch { shelf.saveNote(file.id, n) }; editing = null },
            onRemove = { n -> scope.launch { shelf.removeNote(file.id, n) }; editing = null },
            onExplain = { n -> editing = null; ai = AiTask.Explain(n.text, "explain", pageOf(n), 0.0); panel = PdfPanel.Ai },
            onDismiss = { editing = null },
        )
    }
    if (showSettings) {
        SettingsSheet(settings, isPdf = true, onChange = { settings = it; it.save(context, article = false) }, onDismiss = { showSettings = false })
    }
}

private fun sendNotes(context: Context, file: com.sharathchenna.shelf.data.LibraryFile, notes: List<Highlight>, onDone: (String) -> Unit) {
    val meta = com.sharathchenna.shelf.data.NotesMeta(
        title = file.title, author = file.author.takeIf { it.isNotBlank() },
        kind = if (file.paperId != null) "paper" else if (file.clipId != null) "article" else "book",
        sections = file.sections.map { it.title },
    )
    val markdown = com.sharathchenna.shelf.data.notesMarkdown(meta, notes)
    val name = com.sharathchenna.shelf.data.notesFileName(file.title)
    if (com.sharathchenna.shelf.data.Vault.folder(context) == null) {
        context.startActivity(
            android.content.Intent.createChooser(
                android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/markdown").putExtra(android.content.Intent.EXTRA_TEXT, markdown).putExtra(android.content.Intent.EXTRA_SUBJECT, name.removeSuffix(".md")),
                "Send the notes",
            ),
        )
    } else kotlinx.coroutines.MainScope().launch {
        onDone(runCatching { com.sharathchenna.shelf.data.Vault.write(context, name, markdown); "In your vault: Shelf/$name" }.getOrElse { it.message ?: "Couldn't write to the vault." })
    }
}

@Composable
private fun PdfPanelContent(
    panel: PdfPanel,
    doc: PdfDocument,
    bookId: String,
    paper: Boolean,
    notes: List<Highlight>,
    ai: AiTask?,
    page: Int,
    layer: PdfPenLayer?,
    marks: Set<Int>,
    pinned: Int?,
    onGo: (Int, PdfPoint?) -> Unit,
    onClose: () -> Unit,
    onEdit: (Highlight) -> Unit,
    onAi: (AiTask) -> Unit,
    onSearchHits: (List<PdfHighlight>) -> Unit,
    onPin: (Int) -> Unit,
    onSend: () -> Unit,
) {
    val task = ai ?: AiTask.Chat(null)
    if (panel == PdfPanel.Ai && task is AiTask.Chat) {
        ChatPanel(bookId, paper, task.quote, here = { page to 0.5 }, initialImage = task.image, onCite = { c -> if (c is Cite.Page) onGo(c.page - 1, null) }, onClose = onClose)
        return
    }
    DisposableEffect(panel) { onDispose { if (panel == PdfPanel.Search) onSearchHits(emptyList()) } }
    val ink = LocalPaper.current
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(start = 22.dp, end = 12.dp, top = 14.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                when (panel) {
                    PdfPanel.Pages -> "Pages"
                    PdfPanel.Notes -> "Highlights & notes"
                    PdfPanel.Search -> "Search"
                    PdfPanel.Brief -> "Brief"
                    PdfPanel.Pinned -> "Page ${(pinned ?: page) + 1}, pinned"
                    PdfPanel.Ai -> when (task) {
                        is AiTask.Explain -> SelectionAction.entries.find { it.action == task.action }?.label ?: "Explain"
                        is AiTask.Recap -> "Recap"
                        is AiTask.Chat -> "Chat"
                    }
                },
                fontFamily = Serif, fontSize = 26.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (panel == PdfPanel.Pages) TextButton(onClick = { onPin(page) }) { Text("Pin this page") }
            Box(Modifier.size(36.dp).clip(CircleShape).background(ink.chip).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Close, "Close", modifier = Modifier.size(18.dp))
            }
        }
        when (panel) {
            PdfPanel.Pages -> PageGrid(doc, page, marks) { onGo(it, null) }
            PdfPanel.Notes -> PdfNotesList(doc, notes, { layer?.pageSize(it) }, onGo = { n ->
                val p = pageOf(n)
                val point = layer?.pageSize(p)?.let { (w, h) -> fractionsToPage(n.rects.orEmpty(), w, h).firstOrNull()?.let { PdfPoint(p, it.left, it.top) } }
                onGo(p, point)
            }, onEdit = onEdit, onSend = onSend)
            PdfPanel.Search -> PdfSearch(doc) { hit ->
                onSearchHits(hit.rects.map { PdfHighlight(PdfRect(hit.page, it.left, it.top, it.right, it.bottom), 0x88FFB648.toInt()) })
                onGo(hit.page, hit.rects.firstOrNull()?.let { PdfPoint(hit.page, it.left, it.top - 40) })
            }
            PdfPanel.Brief -> BriefPanel(bookId) { section -> onGo(section, null) }
            PdfPanel.Pinned -> PinnedPage(doc, pinned ?: page)
            PdfPanel.Ai -> AiPanel(bookId, task, onAi)
        }
    }
}

/** A page held beside the one being read, to compare: its own view, scrolled and zoomed on its own. */
@Composable
private fun PinnedPage(doc: PdfDocument, page: Int) {
    AndroidView(
        modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp),
        factory = { ctx ->
            PdfView(ctx).also { v ->
                v.pdfDocument = doc
                v.addOnFirstContentLoadListener(object : PdfView.OnFirstContentLoadListener {
                    override fun onFirstContentLoad() { v.scrollToPage(page) }
                })
            }
        },
        update = { v -> v.scrollToPage(page) },
    )
}

/**
 * The menu for what the pen looped, bracketed or chose (or a finger selected), where it lifted:
 * the reader's actions on text, or for a figure, asking about it and keeping it; and, for a
 * gesture that was really writing, keeping it as ink.
 */
@Composable
private fun ChoiceMenu(c: Choice, onAction: (String) -> Unit, onDismiss: () -> Unit) {
    val paper = LocalPaper.current
    val density = LocalDensity.current
    val actions = buildList {
        if (c.passage != null) {
            add("highlight" to "Highlight"); add("note" to "Note")
            SelectionAction.entries.filter { it.action != null }.forEach { add(it.action!! to it.label) }
            add("ask" to "Ask"); add("copy" to "Copy")
            if (c.area != null) add("clip" to "Save as a clip")
        } else {
            add("ask" to "Ask about it"); add("explain" to "Explain it"); add("clip" to "Save as a clip")
        }
        if (c.stroke != null) add("ink" to "Keep as ink")
    }
    Box(Modifier.fillMaxSize().clickable(interactionSource = null, indication = null, onClick = onDismiss)) {
        androidx.compose.foundation.layout.FlowRow(
            Modifier
                .offset { IntOffset((c.x - with(density) { 190.dp.toPx() }).toInt().coerceAtLeast(16), (c.y + with(density) { 24.dp.toPx() }).toInt().coerceAtMost(with(density) { 900.dp.toPx() }.toInt())) }
                .width(380.dp)
                .shadow(8.dp, RoundedCornerShape(18.dp))
                .background(paper.raised, RoundedCornerShape(18.dp))
                .padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (c.passage == null && c.area != null) Text("A figure on page ${c.page + 1}", fontFamily = Sans, fontSize = 12.sp, color = paper.muted, modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp))
            actions.forEach { (key, label) ->
                Text(
                    label, style = MaterialTheme.typography.labelLarge, color = if (key == "ink") paper.muted else paper.fg,
                    modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable { onAction(key) }.padding(horizontal = 12.dp, vertical = 9.dp),
                )
            }
        }
    }
}

