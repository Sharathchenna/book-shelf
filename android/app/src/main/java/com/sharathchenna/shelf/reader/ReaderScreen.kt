package com.sharathchenna.shelf.reader

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.Draw
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.FormatSize
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Info
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.layout.size
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.clickable
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.sharathchenna.shelf.data.Highlight
import com.sharathchenna.shelf.data.Progress
import com.sharathchenna.shelf.data.Shelf
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.theme.LocalPaper
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.readium.r2.navigator.epub.EpubPreferences
import org.readium.r2.navigator.preferences.FontFamily
import org.readium.r2.navigator.preferences.ColumnCount
import org.readium.r2.navigator.preferences.Theme
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.services.locateProgression
import java.time.Instant
import java.util.UUID

/** The reader's panels: beside the page on a wide screen, a sheet on a narrow one. */
enum class Panel { Contents, Notes, Ai, Search, Brief, Info }

/** What the AI panel is doing: explaining a passage, recapping, or chatting. */
sealed interface AiTask {
    data class Explain(val text: String, val action: String, val sectionIndex: Int, val fraction: Double, val image: String? = null) : AiTask
    data class Recap(val sectionIndex: Int, val fraction: Double) : AiTask
    data class Chat(val quote: String?, val image: String? = null) : AiTask
}

/** The reader's settings, kept on the device. */
data class ReaderSettings(
    val theme: String = "light",
    val fontSize: Double = 1.0,
    val scroll: Boolean = false,
    val spread: Boolean = true,
    val font: String = "original",
    /** The pen marks text it's drawn across, as a highlighter. */
    val penHighlight: Boolean = true,
    /** The pen writing where there's no text begins a note in the margin. */
    val penWrite: Boolean = true,
    /** The highlighter's colour, for the pen and the menu alike. */
    val color: String = "yellow",
    /** Space between lines, as a multiple of the type's size; null for the book's own. */
    val lineHeight: Double? = null,
    /** The page's margins, as a multiple of Readium's own. */
    val margins: Double = 1.0,
    /** Text set flush at both edges, hyphenated; null for the book's own. */
    val justify: Boolean? = null,
    /** A PDF's margins trimmed away, its text filling the width. */
    val crop: Boolean = false,
    /** A PDF's text set as a column to read, rather than its pages. */
    val textView: Boolean = false,
    /** Space between paragraphs (Readium's, in rem); null for the book's own. */
    val paragraphSpacing: Double? = null,
    /** The type's weight, 1 the book's own; null for the book's own. */
    val fontWeight: Double? = null,
    /** A PDF's pages: scroll (one after another), single (one at a time) or two (side by side). */
    val pdfLayout: String = "scroll",
    /** A PDF's page fitted to the width, or whole (page) on the screen. */
    val pdfFit: String = "width",
    /** An article's measure: narrow, medium or wide, in the type's own size so it holds as the type grows. */
    val lineWidth: String = "medium",
) {
    /** Whether the book's own styles stand: anything chosen here overrides them. */
    val ownStyles: Boolean get() = font == "original" && lineHeight == null && justify == null && paragraphSpacing == null

    /** The theme to show: "auto" follows the system's light or dark. */
    fun resolve(systemDark: Boolean): ReaderSettings = if (theme == "auto") copy(theme = if (systemDark) "dark" else "light") else this

    /** The look as the book first had it, keeping what isn't about the type. */
    fun booksOwn(): ReaderSettings = copy(font = "original", fontSize = 1.0, lineHeight = null, justify = null, margins = 1.0, paragraphSpacing = null, fontWeight = null)

    fun epub(): EpubPreferences = EpubPreferences(
        theme = themeOf(theme).readium,
        backgroundColor = org.readium.r2.navigator.preferences.Color(themeOf(theme).bg.toInt()),
        textColor = org.readium.r2.navigator.preferences.Color(themeOf(theme).fg.toInt()),
        fontSize = fontSize,
        scroll = scroll,
        // Two pages side by side when the window is wide enough (as on the tablet in landscape).
        columnCount = if (spread) ColumnCount.AUTO else ColumnCount.ONE,
        fontFamily = READER_FONTS.find { it.key == font }?.family ?: when (font) { "serif" -> FontFamily.SERIF; "sans" -> FontFamily.SANS_SERIF; else -> null },
        publisherStyles = ownStyles,
        lineHeight = lineHeight,
        pageMargins = margins,
        textAlign = when (justify) { true -> org.readium.r2.navigator.preferences.TextAlign.JUSTIFY; false -> org.readium.r2.navigator.preferences.TextAlign.START; null -> null },
        hyphens = justify,
        paragraphSpacing = paragraphSpacing,
        fontWeight = fontWeight,
    )

    companion object {
        /** Articles keep settings of their own, set as a magazine sets its pages until changed. */
        private fun prefs(context: Context, article: Boolean) = context.getSharedPreferences(if (article) "reader-article" else "reader", Context.MODE_PRIVATE)

        fun load(context: Context, article: Boolean): ReaderSettings {
            val p = prefs(context, article)
            if (article && !p.contains("font")) return ARTICLE
            return ReaderSettings(
                theme = p.getString("theme", "light")!!,
                fontSize = p.getFloat("fontSize", 1f).toDouble(),
                // Articles read as one long page, as on the site, until set otherwise.
                scroll = p.getBoolean("scroll", article),
                spread = p.getBoolean("spread", true),
                font = p.getString("font", "original")!!,
                penHighlight = p.getBoolean("penHighlight", true),
                penWrite = p.getBoolean("penWrite", true),
                color = p.getString("color", "yellow")!!,
                lineHeight = p.getFloat("lineHeight", 0f).takeIf { it > 0 }?.toDouble(),
                margins = p.getFloat("margins", 1f).toDouble(),
                justify = if (p.contains("justify")) p.getBoolean("justify", false) else null,
                crop = p.getBoolean("crop", false),
                paragraphSpacing = p.getFloat("paragraphSpacing", -1f).takeIf { it >= 0 }?.toDouble(),
                fontWeight = p.getFloat("fontWeight", 0f).takeIf { it > 0 }?.toDouble(),
                pdfLayout = p.getString("pdfLayout", "scroll")!!,
                pdfFit = p.getString("pdfFit", "width")!!,
                lineWidth = p.getString("lineWidth", "medium")!!,
            )
        }

        /** An article as a good read-later app sets it: Fraunces, airy lines, ragged right, one long scroll. */
        val ARTICLE = ReaderSettings(font = "fraunces", fontSize = 1.1, lineHeight = 1.65, margins = 1.0, scroll = true, justify = false)
    }

    fun save(context: Context, article: Boolean) {
        prefs(context, article).edit()
            .putString("theme", theme).putFloat("fontSize", fontSize.toFloat()).putBoolean("spread", spread).putString("font", font)
            .putBoolean("penHighlight", penHighlight).putBoolean("penWrite", penWrite).putString("color", color)
            .putFloat("lineHeight", (lineHeight ?: 0.0).toFloat()).putFloat("margins", margins.toFloat()).putBoolean("crop", crop)
            .apply { if (justify == null) remove("justify") else putBoolean("justify", justify) }
            .putBoolean("scroll", scroll)
            .putFloat("paragraphSpacing", (paragraphSpacing ?: -1.0).toFloat()).putFloat("fontWeight", (fontWeight ?: 0.0).toFloat())
            .putString("pdfLayout", pdfLayout).putString("pdfFit", pdfFit).putString("lineWidth", lineWidth)
            .apply()
    }
}

private sealed interface Phase {
    data class Loading(val progress: Float?) : Phase
    data class Failed(val message: String) : Phase
    /** `restore`: the progression to find again in a scrolled article, when it opens where it was left. */
    data class Ready(val opened: Shelf.Opened, val book: OpenedBook, val initial: Locator?, val restore: Double? = null) : Phase
    /** A PDF, for Android's own PDF view (pdf/PdfReader.kt). */
    data class Pdf(val opened: Shelf.Opened) : Phase
}

/** A book from the library, in Readium: an EPUB laid out as pages or a scroll, or a PDF. */
@Composable
fun ReaderScreen(fileId: String, at: String?, onBack: () -> Unit, onListen: (Int) -> Unit, onOpenNext: (com.sharathchenna.shelf.data.ShelfBook) -> Unit = {}) {
    val shelf = LocalShelf.current
    val context = LocalContext.current
    var phase by remember(fileId) { mutableStateOf<Phase>(Phase.Loading(null)) }
    // Readium's PDF reader, for a device without the system's PDF engine or a PDF that engine can't open.
    var simplePdf by remember(fileId) { mutableStateOf(false) }
    // Opened, it's been seen: its dot in the library goes.
    LaunchedEffect(fileId) {
        val unseen = shelf.library.value?.books?.filter { (it.fileId == fileId || it.id == fileId) && !it.seen }?.map { it.id }.orEmpty()
        if (unseen.isNotEmpty()) runCatching { shelf.triage(com.sharathchenna.shelf.data.TriageChange(unseen, seen = true)) }
    }
    LaunchedEffect(fileId, simplePdf) {
        phase = runCatching {
            val opened = shelf.open(fileId) { phase = Phase.Loading(it) }
            if (opened.file.isPdf && !simplePdf && com.sharathchenna.shelf.reader.pdf.pdfEngineAvailable()) return@runCatching Phase.Pdf(opened)
            val book = BookOpener(context).open(opened.path, opened.file.isPdf).apply { titles = opened.file.sections.map { it.title } }
            val notes = shelf.notes(fileId).first()
            val highlight = notes.find { it.id == at }
            Phase.Ready(opened, book, initialLocator(book, opened.progress, highlight), restore = if (highlight == null && opened.file.clipId != null) opened.progress?.progression else null)
        }.getOrElse { Phase.Failed(it.message ?: "This book wouldn't open.") }
    }
    when (val p = phase) {
        is Phase.Loading -> Box(Modifier.fillMaxSize().background(LocalPaper.current.bg), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                if (p.progress != null) CircularProgressIndicator(progress = { p.progress }) else CircularProgressIndicator()
                Text(if (p.progress != null) "Downloading the book… ${Math.round(p.progress * 100)}%" else "Opening the book…", color = LocalPaper.current.muted, modifier = Modifier.padding(top = 16.dp))
            }
        }
        is Phase.Failed -> Box(Modifier.fillMaxSize().background(LocalPaper.current.bg), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("This book wouldn't open.", style = MaterialTheme.typography.headlineMedium)
                Text(p.message, color = LocalPaper.current.muted, modifier = Modifier.padding(8.dp))
                TextButton(onClick = onBack) { Text("Back to the library") }
            }
        }
        is Phase.Ready -> {
            Reading(p.opened, p.book, p.initial, p.restore, onBack, onListen, onOpenNext)
        }
        is Phase.Pdf -> com.sharathchenna.shelf.reader.pdf.PdfReading(p.opened, at, onBack, onListen, onFallback = { simplePdf = true }, onOpenNext = onOpenNext)
    }
}

/** Where to open: a highlight asked for, else where the owner left off (from either reader). */
private suspend fun initialLocator(book: OpenedBook, progress: Progress?, highlight: Highlight?): Locator? {
    highlight?.let { book.locatorOf(it)?.let { l -> return l } }
    progress ?: return null
    if (book.isPdf) return book.locatorAt((Regex("^page:(\\d+)").find(progress.cfi)?.groupValues?.get(1)?.toIntOrNull() ?: (progress.sectionIndex + 1)) - 1, null)
    if (progress.progression != null) return book.locatorAt(progress.sectionIndex, progress.progression)
    // A place saved by the web reader, as a CFI: found by how far through the book it is.
    return book.publication.locateProgression(progress.fraction) ?: book.locatorAt(progress.sectionIndex, 0.0)
}

@OptIn(ExperimentalMaterial3Api::class, FlowPreview::class)
@Composable
private fun Reading(opened: Shelf.Opened, book: OpenedBook, initial: Locator?, restore: Double?, onBack: () -> Unit, onListen: (Int) -> Unit, onOpenNext: (com.sharathchenna.shelf.data.ShelfBook) -> Unit) {
    val shelf = LocalShelf.current
    val context = LocalContext.current
    val activity = LocalActivity.current as FragmentActivity
    val scope = rememberCoroutineScope()
    val file = opened.file
    val article = file.clipId != null
    val controller = remember { ReaderController() }
    val ready by controller.ready.collectAsState()
    val notes by shelf.notes(file.id).collectAsState(initial = emptyList())
    var settings by remember { mutableStateOf(ReaderSettings.load(context, article)) }
    val behaviour = rememberBehaviour()
    ApplyBehaviour(behaviour)
    // The look as shown: Auto's theme taken from the system.
    val look = settings.resolve(androidx.compose.foundation.isSystemInDarkTheme())
    StatusBarFor(look.theme)
    controller.tapEdges = behaviour.tapEdges
    controller.animate = behaviour.animated
    controller.eink = behaviour.eink
    controller.scrolled = look.scroll
    var chrome by remember { mutableStateOf(true) }
    var panel by remember { mutableStateOf<Panel?>(null) }
    var ai by remember { mutableStateOf<AiTask?>(null) }
    var editing by remember { mutableStateOf<NoteEdit?>(null) }
    var drawing by remember { mutableStateOf(false) }
    var nib by remember { mutableStateOf(behaviour.startNib()) }
    var folded by rememberPaletteFolded()
    var written by remember { mutableStateOf<com.sharathchenna.shelf.data.InkStroke?>(null) }
    var penMenu by remember { mutableStateOf<androidx.compose.ui.geometry.Offset?>(null) }
    var sketching by remember { mutableStateOf<Int?>(null) }
    var showSettings by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var locator by remember { mutableStateOf(initial) }
    var marks by remember { mutableStateOf(Bookmarks.load(context, file.id)) }
    var fresh by remember { mutableStateOf<Highlight?>(null) }
    var picture by remember { mutableStateOf<android.graphics.Bitmap?>(null) }
    // A word held down, looked up (Lookup.kt); a highlight tapped, its bar beside it (HighlightBar.kt); its tags being edited.
    var lookup by remember { mutableStateOf<Lookup?>(null) }
    var tapped by remember { mutableStateOf<Pair<Highlight, android.graphics.RectF?>?>(null) }
    var tagging by remember { mutableStateOf<Highlight?>(null) }
    var selectingTick by remember { mutableStateOf(0) }
    // Where the reading was before a jump (a link, the contents, a note), to go back to, as Reader's "Return to 39%".
    var returnTo by remember { mutableStateOf<ReturnPoint?>(null) }
    var returning by remember { mutableStateOf(false) }
    // Readium's own moves while the book opens (to where it was left, and a scrolled article's settling) aren't the reader's jumps.
    var jumpsFrom by remember { mutableStateOf(Long.MAX_VALUE) }
    LaunchedEffect(ready) { if (ready) { kotlinx.coroutines.delay(if (restore != null) 6000 else 2500); jumpsFrom = System.currentTimeMillis() } }
    val positions = rememberPositions(book)
    val density = androidx.compose.ui.platform.LocalDensity.current.density

    // Highlights and drawings, drawn again whenever they change.
    LaunchedEffect(ready, notes) { if (ready) controller.showNotes(book, notes) }

    // Where the owner is, saved a moment after they stop turning pages. The page the book opens at
    // isn't saved: it's where they already were, and saving it would trade the web reader's exact
    // place (a CFI) for the app's coarser one without their having moved.
    LaunchedEffect(ready) {
        val nav = controller.navigator ?: return@LaunchedEffect
        launch { nav.currentLocator.collect { locator = it } }
        // A scrolled article's place is the page's own scroll, saved below.
        if (article && look.scroll) return@LaunchedEffect
        var at: Pair<Int, Long>? = null
        nav.currentLocator.debounce(1500).collect { l ->
            val section = book.sectionOf(l)
            val here = section to Math.round((l.locations.progression ?: 0.0) * 1000)
            if (at == null || at == here) {
                at = here
                return@collect
            }
            at = here
            shelf.saveProgress(
                file.id,
                Progress(
                    cfi = if (book.isPdf) "page:${section + 1}" else "",
                    fraction = l.locations.totalProgression ?: 0.0,
                    sectionIndex = section,
                    progression = if (book.isPdf) null else l.locations.progression,
                ),
            )
        }
    }

    // A scrolled article's place, read from the page as it scrolls: Readium's own locator can
    // stall on a long page whose pictures change its height as they load.
    var scrolled by remember { mutableStateOf<Double?>(null) }
    LaunchedEffect(ready, article && look.scroll) {
        scrolled = null
        if (!ready || !article || !look.scroll) return@LaunchedEffect
        // Opened where they left off (not at a highlight asked for): the place found again once the page has its pictures.
        if (restore != null) controller.settle(restore)
        launch {
            var at: Long? = null
            snapshotFlow { scrolled }.filterNotNull().debounce(1500).collect { p ->
                val here = Math.round(p * 1000)
                // Not the place it opened at, as above.
                if (at == null || at == here) { at = here; return@collect }
                at = here
                shelf.saveProgress(file.id, Progress(cfi = "", fraction = p, sectionIndex = locator?.let(book::sectionOf) ?: 0, progression = p))
            }
        }
        while (true) {
            controller.pageProgression()?.let { scrolled = it }
            kotlinx.coroutines.delay(400)
        }
    }

    LaunchedEffect(look) { controller.epub?.submitPreferences(look.epub()) }
    // An article's column, masthead colours and room for the bars, put in the page once it's loaded and as the look changes.
    LaunchedEffect(ready, look, locator?.href) { if (ready && article) controller.style("shelf-article", articleCss(look)) }

    // The bars step out of the way of the page: a few seconds after showing, and on a page turn.
    LaunchedEffect(chrome, panel) {
        if (chrome && panel == null) {
            kotlinx.coroutines.delay(4000)
            chrome = false
        }
    }
    // Scrolling down tucks the bars away; scrolling back up brings them, as the best article readers do.
    var lastSeen by remember { mutableStateOf<Double?>(null) }
    LaunchedEffect(locator?.locations?.position, locator?.locations?.progression, scrolled) {
        val now = scrolled ?: locator?.locations?.totalProgression
        val before = lastSeen
        lastSeen = now
        if (panel != null) return@LaunchedEffect
        // Not in e-ink mode, where a screenful back is a page turned, not a reach for the bars.
        chrome = settings.scroll && !behaviour.eink && now != null && before != null && now < before - 0.002
    }

    BackHandler(enabled = panel != null || drawing || editing != null || tapped != null || lookup != null) {
        when {
            tapped != null -> tapped = null
            lookup != null -> { lookup = null; controller.clearSelection() }
            drawing -> { drawing = false; written = null }
            editing != null -> editing = null
            else -> panel = null
        }
    }

    val here = { (locator?.let(book::sectionOf) ?: 0) to (locator?.locations?.progression ?: 0.0) }
    val marked = marks.any { it.isAt(locator) }
    val toggleMark = {
        locator?.let { at ->
            marks = if (marked) marks.filterNot { it.isAt(at) }
            else marks + Bookmark(UUID.randomUUID().toString().take(12), at, at.title ?: book.linkFor(book.sectionOf(at))?.title ?: file.sections.getOrNull(book.sectionOf(at))?.title.orEmpty(), System.currentTimeMillis())
            Bookmarks.save(context, file.id, marks)
        }
        Unit
    }

    // The text just highlighted and when, so a selection highlighted at once (and by the pen) isn't highlighted twice.
    var lastHighlighted by remember { mutableStateOf<Pair<String, Long>?>(null) }

    /** What the selection menu asked for, applied to the text selected now. */
    val onSelection: (SelectionAction) -> Unit = { action ->
        scope.launch {
            val selected = controller.selection() ?: return@launch
            val text = selected.text.highlight?.trim().orEmpty()
            if (text.isEmpty()) return@launch
            val section = book.sectionOf(selected)
            val fraction = selected.locations.progression ?: 0.0
            controller.clearSelection()
            lookup = null
            when (action) {
                SelectionAction.Highlight, SelectionAction.Note -> {
                    val recent = lastHighlighted
                    if (action == SelectionAction.Highlight && recent != null && recent.first == text && System.currentTimeMillis() - recent.second < 4000) return@launch
                    lastHighlighted = text to System.currentTimeMillis()
                    val now = Instant.now().toString()
                    val note = Highlight(
                        id = UUID.randomUUID().toString().replace("-", "").take(16),
                        text = text.take(4000),
                        quote = quoteOf(selected.text),
                        progression = selected.locations.progression,
                        color = settings.color,
                        sectionIndex = section,
                        createdAt = now,
                        updatedAt = now,
                    )
                    shelf.saveNote(file.id, note)
                    if (action == SelectionAction.Note) editing = NoteEdit(note, focusNote = true) else fresh = note
                }
                SelectionAction.Explain, SelectionAction.Define, SelectionAction.Simplify, SelectionAction.Check, SelectionAction.Related, SelectionAction.Counter -> {
                    ai = AiTask.Explain(text, action.action!!, section, fraction)
                    panel = Panel.Ai
                }
                SelectionAction.Ask -> {
                    ai = AiTask.Chat(text)
                    panel = Panel.Ai
                }
            }
        }
    }

    // As text is selected: a single word is looked up (Reader's card); a passage, with Highlight at
    // once on, is highlighted without the menu. Watched until the selection goes.
    LaunchedEffect(selectingTick) {
        if (selectingTick == 0) return@LaunchedEffect
        kotlinx.coroutines.delay(220)
        while (true) {
            val current = (controller.navigator as? org.readium.r2.navigator.SelectableNavigator)?.currentSelection()
            val selected = current?.locator
            val text = selected?.text?.highlight?.trim().orEmpty()
            if (selected == null || text.isEmpty()) { lookup = null; break }
            if (isSingleWord(text)) {
                val height = controller.epub?.view?.height ?: 0
                val low = current.rect?.let { it.centerY() > height * 0.5f } ?: true
                if (lookup?.word != text) lookup = Lookup(text, book.sectionOf(selected), selected.locations.progression ?: 0.0, low)
            } else {
                lookup = null
                if (behaviour.autoHighlight) { onSelection(SelectionAction.Highlight); break }
            }
            kotlinx.coroutines.delay(450)
        }
    }

    // The pen: across text it highlights (with the button held, it selects for the menu, and the
    // eraser end rubs highlights out); where there's no text it begins a note; hovering at the top
    // brings the bar; its button, pressed in the air, turns the page.
    val pen = remember {
        object : PenListener {
            override fun onPassage(menu: Boolean, x: Float, y: Float) {
                if (menu) penMenu = androidx.compose.ui.geometry.Offset(x, y) else onSelection(SelectionAction.Highlight)
            }
            override fun onRubOut() {
                scope.launch {
                    val selected = controller.selection() ?: return@launch
                    controller.clearSelection()
                    val text = selected.text.highlight?.trim().orEmpty()
                    if (text.isEmpty()) return@launch
                    val section = book.sectionOf(selected)
                    notes.filter { it.ink == null && it.sectionIndex == section && (it.text.contains(text) || text.contains(it.text.trim())) }
                        .forEach { shelf.removeNote(file.id, it) }
                }
            }
            override fun onWrite(stroke: com.sharathchenna.shelf.data.InkStroke) {
                written = stroke
                drawing = true
            }
            override fun onNearTop() { if (!chrome) chrome = true }
            override fun onButton() {
                if (controller.eink && controller.scrolled) controller.scrollScreen(1)
                else (controller.navigator as? org.readium.r2.navigator.OverflowableNavigator)?.goForward(animated = controller.animate)
            }
        }
    }

    // The keyboard cover turns pages: arrows, Page Up/Down and Space (Shift+Space goes back),
    // ahead of Compose's own focus moving, and not while typing a question.
    val pageKeys = Modifier.onPreviewKeyEvent { event ->
        if (drawing || panel == Panel.Ai || editing != null) return@onPreviewKeyEvent false
        // The volume keys turn pages when asked to, the key's lifting kept from the system too.
        val volume = behaviour.volumeKeys && (event.key == Key.VolumeDown || event.key == Key.VolumeUp)
        if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent volume
        val nav = controller.navigator as? org.readium.r2.navigator.OverflowableNavigator ?: return@onPreviewKeyEvent false
        val animated = behaviour.animated
        // In e-ink mode a scroll moves a screenful at a time for the keys too.
        if (controller.eink && look.scroll) {
            val step = when {
                event.key == Key.DirectionRight || event.key == Key.DirectionDown || event.key == Key.PageDown || (volume && event.key == Key.VolumeDown) -> 1
                event.key == Key.DirectionLeft || event.key == Key.DirectionUp || event.key == Key.PageUp || (volume && event.key == Key.VolumeUp) -> -1
                event.key == Key.Spacebar -> if (event.isShiftPressed) -1 else 1
                else -> return@onPreviewKeyEvent false
            }
            controller.scrollScreen(step)
            return@onPreviewKeyEvent true
        }
        when {
            event.key == Key.DirectionRight || event.key == Key.PageDown || (volume && event.key == Key.VolumeDown) -> nav.goForward(animated = animated)
            event.key == Key.DirectionLeft || event.key == Key.PageUp || (volume && event.key == Key.VolumeUp) -> nav.goBackward(animated = animated)
            event.key == Key.Spacebar -> if (event.isShiftPressed) nav.goBackward(animated = animated) else nav.goForward(animated = animated)
            else -> return@onPreviewKeyEvent false
        }
        true
    }

    // The book's notes into the Obsidian vault (Settings), or, with no vault chosen, to any app that takes text.
    val sendNotes: () -> Unit = {
        val meta = com.sharathchenna.shelf.data.NotesMeta(
            title = file.title,
            author = file.author.takeIf { it.isNotBlank() },
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
        } else scope.launch {
            message = runCatching { com.sharathchenna.shelf.data.Vault.write(context, name, markdown); "In your vault: Shelf/$name" }.getOrElse { it.message ?: "Couldn't write to the vault." }
        }
    }
    val saveEdit: (Highlight) -> Unit = { note -> scope.launch { shelf.saveNote(file.id, note) }; editing = null }
    val removeEdit: (Highlight) -> Unit = { note -> scope.launch { shelf.removeNote(file.id, note) }; editing = null }
    val explainEdit: (Highlight) -> Unit = { note ->
        editing = null
        ai = AiTask.Explain(note.text, "explain", note.sectionIndex, note.progression ?: 0.0)
        panel = Panel.Ai
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(readerBackground(look.theme)).then(pageKeys)) {
        val wide = maxWidth >= 840.dp
        Row(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f).fillMaxHeight()) {
                NavigatorHost(
                    activity = activity,
                    book = book,
                    initial = initial,
                    preferences = look.epub(),
                    controller = controller,
                    onSelection = onSelection,
                    // A tap on a picture shows it on its own; anywhere else, the bars.
                    onTap = { point ->
                        // A tap away from a highlight's bar or the lookup card puts it away, and does nothing else.
                        if (tapped != null || lookup != null) { tapped = null; if (lookup != null) { lookup = null; controller.clearSelection() } }
                        else scope.launch { picture = controller.pictureAt(point, density) ?: run { chrome = !chrome; null } }
                    },
                    onDecoration = { id, rect ->
                        notes.find { it.id == id }?.let { n -> if (n.ink != null) editing = NoteEdit(n) else tapped = n to rect }
                    },
                    onSelecting = { selectingTick++ },
                    onJump = { _ ->
                        val from = locator
                        if (returning) returning = false
                        else if (from != null && System.currentTimeMillis() >= jumpsFrom) returnTo = ReturnPoint(from, scrolled, ((scrolled ?: from.locations.totalProgression ?: 0.0) * 100).toInt())
                    },
                    pen = pen,
                    penHighlight = (nib == Nib.Highlight || nib == Nib.Erase) && !drawing,
                    penWrite = nib == Nib.Write && !drawing,
                    rubbing = nib == Nib.Erase,
                    // Marking, a stroke down the text marks it too; scrolling is the fingers' while marking.
                    scrolling = false,
                    graceMs = nib.mode.graceMs,
                    gutter = if (article) ARTICLE_GUTTER else null,
                    modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(top = 8.dp, bottom = if (article && look.scroll) 0.dp else 22.dp)
                        // Pages laid out to the edge keep clear of the palette; a scroll's column is narrower than the gap.
                        // Not changed while writing: the page would reflow under the ink.
                        .padding(start = if (!folded && !look.scroll) PaletteWidth else 0.dp),
                )
                if (drawing && !book.isPdf) {
                    MarginInk(
                        controller = controller,
                        book = book,
                        seed = written,
                        onPlaced = { note ->
                            // Saved at once; the handwriting is read after, which the first time means fetching the model.
                            scope.launch {
                                shelf.saveNote(file.id, note)
                                com.sharathchenna.shelf.ink.Recognizer.read(note.ink!!.strokes)?.let { words -> shelf.saveNote(file.id, note.copy(ink = note.ink.copy(recognized = words))) }
                            }
                        },
                        onClose = { drawing = false; written = null },
                        onError = { message = it },
                    )
                }
                if (chrome && !drawing) Box(Modifier.align(Alignment.TopCenter)) {
                    TopBar(
                        title = file.title,
                        chapter = (locator?.let(book::sectionOf) ?: 0).let { section ->
                            locator?.title ?: book.linkFor(section)?.title ?: file.sections.getOrNull(section)?.title ?: ""
                        },
                        percent = ((scrolled ?: locator?.locations?.totalProgression ?: 0.0) * 100).toInt(),
                        onBack = onBack,
                        onPanel = { panel = if (panel == it) null else it },
                        onRecap = { val (s, f) = here(); ai = AiTask.Recap(s, f); panel = Panel.Ai },
                        onDraw = {
                            if (book.isPdf) sketching = locator?.let(book::sectionOf) ?: 0 else drawing = true
                        },
                        onSettings = { showSettings = true },
                        onInfo = { panel = if (panel == Panel.Info) null else Panel.Info },
                        noun = if (article) "article" else "book",
                        onOriginal = (file.clipId ?: file.paperId)?.let { id -> shelf.clip(id)?.url }?.let { url -> { com.sharathchenna.shelf.ui.openExternal(context, url) } },
                        isPdf = book.isPdf,
                        searchable = book.searchable(),
                        marked = marked,
                        onMark = toggleMark,
                        onBrief = if (file.clipId != null || file.paperId != null) ({ panel = if (panel == Panel.Brief) null else Panel.Brief }) else null,
                    )
                }
                val progress = (scrolled ?: locator?.locations?.totalProgression ?: 0.0).toFloat()
                val ink = themeOf(look.theme).ink
                if (article && !drawing && !chrome) ArticleProgress(progress, ink, Modifier.align(Alignment.TopCenter))
                if (chrome && !drawing) {
                    Scrubber(book, positions, progress, onGo = { controller.go(it) }, modifier = Modifier.align(Alignment.BottomCenter).widthIn(max = 720.dp).fillMaxWidth())
                } else if (!drawing) {
                    val section = locator?.let(book::sectionOf) ?: 0
                    // A scrolled article runs to the foot of the screen, fading under the footer.
                    if (article && look.scroll) Box(
                        Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().height(64.dp)
                            .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(androidx.compose.ui.graphics.Color.Transparent, readerBackground(look.theme)))),
                    )
                    ReadingFooter(
                        // An article's title is the page's own masthead; the foot keeps to what's left.
                        chapter = if (article) file.title else locator?.title ?: book.linkFor(section)?.title ?: file.sections.getOrNull(section)?.title.orEmpty(),
                        where = if (article) listOf(minutesLeft(positions, progress), "${Math.round(progress * 100)}%").filter { it.isNotEmpty() }.joinToString("  ·  ") else whereLabel(book, positions, locator),
                        // An article's progress is the line along the top.
                        progress = if (article) 0f else progress,
                        ink = ink,
                        modifier = Modifier.align(Alignment.BottomStart).padding(end = if (panel == null) 230.dp else 0.dp),
                    )
                }
                // Just highlighted: its colour, or a note, a tap away for a few seconds.
                fresh?.let { note ->
                    LaunchedEffect(note.id) { kotlinx.coroutines.delay(5000); if (fresh?.id == note.id) fresh = null }
                    FreshHighlight(
                        note,
                        onColor = { c -> scope.launch { shelf.saveNote(file.id, note.copy(color = c)) }; fresh = null },
                        onNote = { editing = NoteEdit(note, focusNote = true); fresh = null },
                        modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 56.dp),
                    )
                }
                // A highlight tapped: its bar in the margin beside it.
                tapped?.let { (note, rect) ->
                    val current = notes.find { it.id == note.id } ?: note
                    val insets = androidx.compose.foundation.layout.WindowInsets.statusBars
                    val density = androidx.compose.ui.platform.LocalDensity.current
                    val width = androidx.compose.ui.platform.LocalWindowInfo.current.containerSize.width
                    val top = with(density) { insets.getTop(this) + 8.dp.roundToPx() + (rect?.top?.toInt() ?: 200) }
                    // Just past the text's right edge, as Reader sets it, kept on the screen.
                    val left = with(density) { ((rect?.right?.toInt() ?: width) + 28.dp.roundToPx()).coerceAtMost(width - (if (panel != null && wide) 470 else 70).dp.roundToPx()) }
                    HighlightBar(
                        current,
                        onNote = { editing = NoteEdit(current, focusNote = true); tapped = null },
                        onTags = { tagging = current; tapped = null },
                        onAsk = { ai = AiTask.Chat(current.text); panel = Panel.Ai; tapped = null },
                        onColor = { c -> scope.launch { shelf.saveNote(file.id, current.copy(color = c)) } },
                        onRemove = { scope.launch { shelf.removeNote(file.id, current) }; tapped = null; message = "Highlight removed" },
                        modifier = Modifier.align(Alignment.TopStart).offset { androidx.compose.ui.unit.IntOffset(left, (top - 20).coerceAtLeast(0)) },
                    )
                }
                // A word held down, looked up.
                lookup?.let { l ->
                    LookupCard(
                        l, file.id,
                        onHighlight = { onSelection(SelectionAction.Highlight) },
                        onClose = { lookup = null; controller.clearSelection() },
                        // Clear of the word: above it when it's low on the screen, below it when it's high.
                        modifier = if (l.low) Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(start = 24.dp, end = 24.dp, top = 16.dp)
                        else Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(start = 24.dp, end = 24.dp, bottom = 40.dp),
                    )
                }
                // Back to where the reading was before a jump.
                val progressNow = scrolled ?: locator?.locations?.totalProgression ?: 0.0
                returnTo?.takeIf { lookup == null && Math.abs(it.percent - progressNow * 100) >= 1.0 }?.let { point ->
                    ReturnPill(
                        point.percent,
                        onReturn = {
                            returning = true
                            returnTo = null
                            controller.go(point.locator)
                            if (article && look.scroll && point.scrolled != null) scope.launch { controller.settle(point.scrolled) }
                        },
                        onDismiss = { returnTo = null },
                        modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = if (chrome) 130.dp else 64.dp),
                    )
                }
                // At the end: archived (or offered to be), and the next thing a tap away, as Reader does.
                val here = remember(shelf.library.collectAsState().value, file.id) { shelf.library.value?.books?.find { it.fileId == file.id || it.id == file.id } }
                AtTheEnd(
                    here, progressNow, show = lookup == null && returnTo == null && !drawing, onOpenNext = onOpenNext, onBack = onBack,
                    modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = if (chrome) 130.dp else 64.dp),
                )
                // The pen's tools, Ask and Listen, down the page's left side.
                if (!drawing) PenPalette(
                    nib = nib,
                    onNib = { nib = it },
                    color = settings.color,
                    onColor = { c -> settings = settings.copy(color = c); settings.save(context, article) },
                    onAsk = { if (panel == Panel.Ai && ai is AiTask.Chat) panel = null else { ai = AiTask.Chat(null); panel = Panel.Ai } },
                    onListen = { onListen(locator?.let(book::sectionOf) ?: 0) },
                    folded = folded,
                    onFold = { folded = it },
                    modifier = Modifier.align(Alignment.CenterStart),
                )
                penMenu?.let { at ->
                    PenMenu(at, onAction = { penMenu = null; onSelection(it) }, onDismiss = { penMenu = null; controller.clearSelection() })
                }
                message?.let {
                    Snackbar(Modifier.align(Alignment.BottomCenter).padding(24.dp), action = { TextButton(onClick = { message = null }) { Text("OK") } }) { Text(it) }
                }
            }
            if (wide && (panel != null || editing != null)) {
                Box(Modifier.width(400.dp).fillMaxHeight().background(LocalPaper.current.raised).statusBarsPadding().navigationBarsPadding()) {
                    val edit = editing
                    if (edit != null) NoteEditor(edit, onSave = saveEdit, onRemove = removeEdit, onExplain = explainEdit, onClose = { saveEdit(it) })
                    else PanelContent(panel!!, book, file.id, file.paperId != null, notes, ai, here, controller, marks, onRemoveMark = { m -> marks = marks - m; Bookmarks.save(context, file.id, marks) }, onSendNotes = sendNotes, onClose = { panel = null }, onEdit = { editing = NoteEdit(it) }, onAi = { ai = it }, onPanel = { panel = it })
                }
            }
        }
        if (!wide && panel != null) {
            ModalBottomSheet(onDismissRequest = { panel = null }) {
                Box(Modifier.fillMaxWidth().fillMaxHeight(0.85f)) {
                    PanelContent(panel!!, book, file.id, file.paperId != null, notes, ai, here, controller, marks, onRemoveMark = { m -> marks = marks - m; Bookmarks.save(context, file.id, marks) }, onSendNotes = sendNotes, onClose = { panel = null }, onEdit = { editing = NoteEdit(it) }, onAi = { ai = it }, onPanel = { panel = it })
                }
            }
        }
    }

    // On the tablet the note is edited beside the page (above); on a phone, in a sheet.
    if (!LocalConfiguration.current.let { it.screenWidthDp >= 840 }) editing?.let { edit ->
        NoteSheet(edit = edit, onSave = saveEdit, onRemove = removeEdit, onExplain = explainEdit, onDismiss = { editing = null })
    }
    if (showSettings) {
        SettingsSheet(settings, isPdf = book.isPdf, article = article, onChange = { settings = it; it.save(context, article) }, onDismiss = { showSettings = false })
    }
    picture?.let { PictureViewer(it, onDismiss = { picture = null }) }
    tagging?.let { note ->
        TagEditor(
            note, others = notes.flatMap { it.tags }.distinct().sorted(),
            onSave = { tags -> scope.launch { shelf.saveNote(file.id, note.copy(tags = tags)) }; tagging = null },
            onDismiss = { tagging = null },
        )
    }
    sketching?.let { page ->
        PageSketch(
            pdf = opened.path,
            page = page,
            onSave = { ink ->
                val now = Instant.now().toString()
                val note = Highlight(id = UUID.randomUUID().toString().replace("-", "").take(16), cfi = "page:${page + 1}", text = "", color = "blue", ink = ink, sectionIndex = page, createdAt = now, updatedAt = now)
                scope.launch {
                    shelf.saveNote(file.id, note)
                    com.sharathchenna.shelf.ink.Recognizer.read(ink.strokes)?.let { words -> shelf.saveNote(file.id, note.copy(ink = ink.copy(recognized = words))) }
                }
                sketching = null
            },
            onDismiss = { sketching = null },
        )
    }
}

fun readerBackground(theme: String) = themeOf(theme).background

/**
 * The reader's bar: back, where you are, and the three things reached for most (the contents,
 * your highlights, and the page's look); the rest under ⋯. Ask and Listen are in the pen palette.
 */
@Composable
internal fun TopBar(
    title: String,
    chapter: String,
    percent: Int,
    isPdf: Boolean,
    onBack: () -> Unit,
    onPanel: (Panel) -> Unit,
    onRecap: () -> Unit,
    onSettings: () -> Unit,
    searchable: Boolean,
    marked: Boolean,
    onMark: () -> Unit,
    onBrief: (() -> Unit)? = null,
    contentsLabel: String = "Contents and bookmarks",
    /** What's being read, for the menu's words: book, article or PDF. */
    noun: String = if (isPdf) "PDF" else "book",
    /** Drawing with a finger, for a book's margin (the pen draws with Write). */
    onDraw: (() -> Unit)? = null,
    onOriginal: (() -> Unit)? = null,
    /** What it is, where it's from, your note on it (InfoPanel.kt). */
    onInfo: (() -> Unit)? = null,
) {
    val paper = LocalPaper.current
    var more by remember { mutableStateOf(false) }
    Row(
        Modifier.statusBarsPadding().padding(12.dp).shadow(6.dp, RoundedCornerShape(22.dp)).background(paper.raised, RoundedCornerShape(22.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") }
        Column(Modifier.widthIn(max = 340.dp).padding(start = 2.dp, end = 10.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOf("$percent%", chapter.takeIf { it != title }.orEmpty()).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = { onPanel(Panel.Contents) }) { Icon(Icons.AutoMirrored.Outlined.FormatListBulleted, contentsLabel) }
        IconButton(onClick = { onPanel(Panel.Notes) }) { Icon(Icons.Outlined.EditNote, "Highlights and notes") }
        IconButton(onClick = onSettings) { Icon(Icons.Outlined.FormatSize, if (isPdf) "Page and layout" else "Text and layout") }
        onInfo?.let { IconButton(onClick = it) { Icon(Icons.Outlined.Info, "Info") } }
        Box {
            IconButton(onClick = { more = true }) { Icon(Icons.Outlined.MoreHoriz, "More") }
            androidx.compose.material3.DropdownMenu(expanded = more, onDismissRequest = { more = false }) {
                val item = @Composable { label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit ->
                    androidx.compose.material3.DropdownMenuItem(text = { Text(label) }, leadingIcon = { Icon(icon, null) }, onClick = { more = false; onClick() })
                }
                if (searchable) item("Search in the $noun", Icons.Outlined.Search) { onPanel(Panel.Search) }
                item(if (marked) "Remove the bookmark" else "Bookmark this page", if (marked) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, onMark)
                onBrief?.let { item("Brief", Icons.Outlined.AutoAwesome, it) } ?: item("Recap so far", Icons.Outlined.AutoAwesome, onRecap)
                onDraw?.let { item("Draw in the margin", Icons.Outlined.Draw, it) }
                onOriginal?.let { item("Open the original", Icons.AutoMirrored.Outlined.OpenInNew, it) }
            }
        }
    }
}

/** The reader's menu, where the pen lifted after selecting with its button held. */
@Composable
internal fun PenMenu(at: androidx.compose.ui.geometry.Offset, onAction: (SelectionAction) -> Unit, onDismiss: () -> Unit) {
    val paper = LocalPaper.current
    val density = androidx.compose.ui.platform.LocalDensity.current
    Box(Modifier.fillMaxSize().clickable(interactionSource = null, indication = null, onClick = onDismiss)) {
        androidx.compose.foundation.layout.FlowRow(
            Modifier
                .offset { androidx.compose.ui.unit.IntOffset((at.x - with(density) { 180.dp.toPx() }).toInt().coerceAtLeast(16), (at.y + with(density) { 28.dp.toPx() }).toInt()) }
                .width(360.dp)
                .shadow(8.dp, RoundedCornerShape(18.dp))
                .background(paper.raised, RoundedCornerShape(18.dp))
                .padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            SelectionAction.entries.forEach { a ->
                Text(
                    a.label,
                    style = MaterialTheme.typography.labelLarge,
                    color = paper.fg,
                    modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable { onAction(a) }.padding(horizontal = 12.dp, vertical = 9.dp),
                )
            }
        }
    }
}

/** The highlight just made: its colour changed, or a note added, without opening it. */
@Composable
internal fun FreshHighlight(note: Highlight, onColor: (String) -> Unit, onNote: () -> Unit, modifier: Modifier = Modifier) {
    val paper = LocalPaper.current
    Row(
        modifier.shadow(8.dp, RoundedCornerShape(50)).background(paper.raised, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        HIGHLIGHT_ARGB.forEach { (name, argb) ->
            Box(
                Modifier.size(34.dp).clip(androidx.compose.foundation.shape.CircleShape)
                    .then(if (name == note.color) Modifier.border(2.dp, paper.fg, androidx.compose.foundation.shape.CircleShape) else Modifier)
                    .clickable { onColor(name) }.padding(6.dp).clip(androidx.compose.foundation.shape.CircleShape).background(androidx.compose.ui.graphics.Color(argb)),
            )
        }
        TextButton(onClick = onNote) { Text("Add a note") }
    }
}

/** Where the reading was before a jump: its place, a scrolled article's own measure of it, and how far through. */
data class ReturnPoint(val locator: Locator, val scrolled: Double?, val percent: Int)

/** "Return to 39%", with a cross to stay where the jump went. */
@Composable
internal fun ReturnPill(percent: Int, onReturn: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    val paper = LocalPaper.current
    Row(
        modifier.shadow(8.dp, RoundedCornerShape(50)).background(paper.raised, RoundedCornerShape(50)).padding(start = 6.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(Modifier.clip(RoundedCornerShape(50)).clickable(onClick = onReturn).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.History, null, Modifier.size(18.dp), tint = paper.fg)
            Text("  Return to $percent%", style = MaterialTheme.typography.labelLarge, color = paper.fg)
        }
        IconButton(onClick = onDismiss, modifier = Modifier.size(36.dp)) { Icon(Icons.Outlined.Close, "Stay here", Modifier.size(18.dp), tint = paper.muted) }
    }
}

/**
 * At the end of something in the Inbox or Later, as Readwise Reader's auto-archive: a moment after
 * reaching it, it goes to the Archive by itself (unless the reader's set not to), and a pill offers
 * the next thing from where it was, and Undo. Set not to, the pill archives it and opens the next.
 */
@Composable
internal fun AtTheEnd(
    here: com.sharathchenna.shelf.data.ShelfBook?,
    progress: Double,
    show: Boolean,
    onOpenNext: (com.sharathchenna.shelf.data.ShelfBook) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shelf = LocalShelf.current
    val behaviour = rememberBehaviour()
    val scope = rememberCoroutineScope()
    // Where it was before this reading archived it, and whether that was undone (not archived again).
    var archivedFrom by remember(here?.id) { mutableStateOf<String?>(null) }
    var undone by remember(here?.id) { mutableStateOf(false) }
    here ?: return
    val atEnd = progress >= 0.985
    val waiting = here.trashed == null && here.place in setOf("inbox", "later")
    fun move(place: String) = scope.launch { runCatching { shelf.triage(com.sharathchenna.shelf.data.TriageChange(listOf(here.id), place = place)) } }
    LaunchedEffect(atEnd, waiting, behaviour.archiveAtEnd) {
        if (!atEnd || !waiting || !behaviour.archiveAtEnd || undone) return@LaunchedEffect
        // Not on a pass through the end (the scrubber dragged by it), only when the reading stays there.
        kotlinx.coroutines.delay(1500)
        archivedFrom = here.place
        move("archive")
    }
    val from = archivedFrom?.takeIf { here.place == "archive" }
    if (!show || !atEnd || (!waiting && from == null)) return
    val next = remember(here.id, from) {
        shelf.library.value?.books.orEmpty()
            .filter { it.id != here.id && it.trashed == null && it.place == (from ?: here.place) && it.pct < 1 && (it.fileId != null || it.readable) }
            .sortedByDescending { it.added }.firstOrNull()
    }
    val paper = LocalPaper.current
    Row(
        modifier.shadow(8.dp, RoundedCornerShape(50)).background(paper.fg, RoundedCornerShape(50)).clip(RoundedCornerShape(50))
            .clickable {
                if (from == null) move("archive")
                if (next != null) onOpenNext(next) else onBack()
            }
            .padding(start = 20.dp, end = if (from != null) 8.dp else 20.dp, top = 12.dp, bottom = 12.dp).widthIn(max = 560.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Archive, null, Modifier.size(18.dp), tint = paper.bg)
        Column(Modifier.padding(start = 10.dp).weight(1f, fill = false)) {
            Text(
                when {
                    from != null && next != null -> "Archived · Open the next"
                    from != null -> "Archived · Back to the library"
                    next != null -> "Archive and open the next"
                    else -> "Archive it"
                },
                style = MaterialTheme.typography.labelLarge, color = paper.bg,
            )
            next?.let { Text(it.title, style = MaterialTheme.typography.labelSmall, color = paper.bg.copy(alpha = 0.7f), maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        if (from != null) TextButton(onClick = { undone = true; archivedFrom = null; move(from) }) { Text("Undo", color = paper.bg) }
    }
}
