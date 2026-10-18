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
import androidx.compose.material.icons.outlined.Headphones
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
enum class Panel { Contents, Notes, Ai }

/** What the AI panel is doing: explaining a passage, recapping, or chatting. */
sealed interface AiTask {
    data class Explain(val text: String, val action: String, val sectionIndex: Int, val fraction: Double) : AiTask
    data class Recap(val sectionIndex: Int, val fraction: Double) : AiTask
    data class Chat(val quote: String?) : AiTask
}

/** The reader's settings, kept on the device. */
data class ReaderSettings(val theme: String = "light", val fontSize: Double = 1.0, val scroll: Boolean = false, val spread: Boolean = true, val font: String = "original") {
    fun epub(): EpubPreferences = EpubPreferences(
        theme = when (theme) { "dark" -> Theme.DARK; "sepia" -> Theme.SEPIA; else -> Theme.LIGHT },
        fontSize = fontSize,
        scroll = scroll,
        // Two pages side by side when the window is wide enough (as on the tablet in landscape).
        columnCount = if (spread) ColumnCount.AUTO else ColumnCount.ONE,
        fontFamily = when (font) { "serif" -> FontFamily.SERIF; "sans" -> FontFamily.SANS_SERIF; else -> null },
        publisherStyles = font == "original",
    )

    companion object {
        fun load(context: Context, article: Boolean): ReaderSettings {
            val p = context.getSharedPreferences("reader", Context.MODE_PRIVATE)
            return ReaderSettings(
                theme = p.getString("theme", "light")!!,
                fontSize = p.getFloat("fontSize", 1f).toDouble(),
                // Articles read as one long page, as on the site.
                scroll = if (article) true else p.getBoolean("scroll", false),
                spread = p.getBoolean("spread", true),
                font = p.getString("font", "original")!!,
            )
        }
    }

    fun save(context: Context, article: Boolean) {
        context.getSharedPreferences("reader", Context.MODE_PRIVATE).edit()
            .putString("theme", theme).putFloat("fontSize", fontSize.toFloat()).putBoolean("spread", spread).putString("font", font)
            .apply { if (!article) putBoolean("scroll", scroll) }
            .apply()
    }
}

private sealed interface Phase {
    data class Loading(val progress: Float?) : Phase
    data class Failed(val message: String) : Phase
    data class Ready(val opened: Shelf.Opened, val book: OpenedBook, val initial: Locator?) : Phase
}

/** A book from the library, in Readium: an EPUB laid out as pages or a scroll, or a PDF. */
@Composable
fun ReaderScreen(fileId: String, at: String?, onBack: () -> Unit, onListen: (Int) -> Unit) {
    val shelf = LocalShelf.current
    val context = LocalContext.current
    var phase by remember(fileId) { mutableStateOf<Phase>(Phase.Loading(null)) }
    LaunchedEffect(fileId) {
        phase = runCatching {
            val opened = shelf.open(fileId) { phase = Phase.Loading(it) }
            val book = BookOpener(context).open(opened.path, opened.file.isPdf).apply { titles = opened.file.sections.map { it.title } }
            val notes = shelf.notes(fileId).first()
            Phase.Ready(opened, book, initialLocator(book, opened.progress, notes.find { it.id == at }))
        }.getOrElse { Phase.Failed(it.message ?: "This book wouldn't open.") }
    }
    when (val p = phase) {
        is Phase.Loading -> Box(Modifier.fillMaxSize().background(LocalPaper.current.bg), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                if (p.progress != null) CircularProgressIndicator(progress = { p.progress }) else CircularProgressIndicator()
                Text(if (p.progress != null) "Downloading… ${Math.round(p.progress * 100)}%" else "Opening…", color = LocalPaper.current.muted, modifier = Modifier.padding(top = 16.dp))
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
            Reading(p.opened, p.book, p.initial, onBack, onListen)
        }
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
private fun Reading(opened: Shelf.Opened, book: OpenedBook, initial: Locator?, onBack: () -> Unit, onListen: (Int) -> Unit) {
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
    var chrome by remember { mutableStateOf(true) }
    var panel by remember { mutableStateOf<Panel?>(null) }
    var ai by remember { mutableStateOf<AiTask?>(null) }
    var editing by remember { mutableStateOf<NoteEdit?>(null) }
    var drawing by remember { mutableStateOf(false) }
    var sketching by remember { mutableStateOf<Int?>(null) }
    var showSettings by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var locator by remember { mutableStateOf(initial) }

    // Highlights and drawings, drawn again whenever they change.
    LaunchedEffect(ready, notes) { if (ready) controller.showNotes(book, notes) }

    // Where the owner is, saved a moment after they stop turning pages.
    LaunchedEffect(ready) {
        val nav = controller.navigator ?: return@LaunchedEffect
        launch { nav.currentLocator.collect { locator = it } }
        nav.currentLocator.debounce(1500).collect { l ->
            val section = book.sectionOf(l)
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

    LaunchedEffect(settings) { controller.epub?.submitPreferences(settings.epub()) }

    // The bars step out of the way of the page: a few seconds after showing, and on a page turn.
    LaunchedEffect(chrome, panel) {
        if (chrome && panel == null) {
            kotlinx.coroutines.delay(4000)
            chrome = false
        }
    }
    LaunchedEffect(locator?.locations?.position, locator?.locations?.progression) { if (panel == null) chrome = false }

    BackHandler(enabled = panel != null || drawing || editing != null) {
        when {
            drawing -> drawing = false
            editing != null -> editing = null
            else -> panel = null
        }
    }

    val here = { (locator?.let(book::sectionOf) ?: 0) to (locator?.locations?.progression ?: 0.0) }

    /** What the selection menu asked for, applied to the text selected now. */
    val onSelection: (SelectionAction) -> Unit = { action ->
        scope.launch {
            val selected = controller.selection() ?: return@launch
            val text = selected.text.highlight?.trim().orEmpty()
            if (text.isEmpty()) return@launch
            val section = book.sectionOf(selected)
            val fraction = selected.locations.progression ?: 0.0
            controller.clearSelection()
            when (action) {
                SelectionAction.Highlight, SelectionAction.Note -> {
                    val now = Instant.now().toString()
                    val note = Highlight(
                        id = UUID.randomUUID().toString().replace("-", "").take(16),
                        text = text.take(4000),
                        quote = quoteOf(selected.text),
                        progression = selected.locations.progression,
                        color = "yellow",
                        sectionIndex = section,
                        createdAt = now,
                        updatedAt = now,
                    )
                    shelf.saveNote(file.id, note)
                    if (action == SelectionAction.Note) editing = NoteEdit(note, focusNote = true)
                }
                SelectionAction.Explain, SelectionAction.Define -> {
                    ai = AiTask.Explain(text, if (action == SelectionAction.Define) "define" else "explain", section, fraction)
                    panel = Panel.Ai
                }
                SelectionAction.Ask -> {
                    ai = AiTask.Chat(text)
                    panel = Panel.Ai
                }
            }
        }
    }

    // The keyboard cover turns pages: arrows, Page Up/Down and Space (Shift+Space goes back),
    // ahead of Compose's own focus moving, and not while typing a question.
    val pageKeys = Modifier.onPreviewKeyEvent { event ->
        if (event.type != KeyEventType.KeyDown || drawing || panel == Panel.Ai || editing != null) return@onPreviewKeyEvent false
        val nav = controller.navigator as? org.readium.r2.navigator.OverflowableNavigator ?: return@onPreviewKeyEvent false
        when (event.key) {
            Key.DirectionRight, Key.PageDown -> nav.goForward(animated = true)
            Key.DirectionLeft, Key.PageUp -> nav.goBackward(animated = true)
            Key.Spacebar -> if (event.isShiftPressed) nav.goBackward(animated = true) else nav.goForward(animated = true)
            else -> return@onPreviewKeyEvent false
        }
        true
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(readerBackground(settings.theme)).then(pageKeys)) {
        val wide = maxWidth >= 840.dp
        Row(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f).fillMaxHeight()) {
                NavigatorHost(
                    activity = activity,
                    book = book,
                    initial = initial,
                    preferences = settings.epub(),
                    controller = controller,
                    onSelection = onSelection,
                    onTap = { chrome = !chrome },
                    onDecoration = { id -> notes.find { it.id == id }?.let { editing = NoteEdit(it) } },
                    modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(top = 8.dp),
                )
                if (drawing && !book.isPdf) {
                    MarginInk(
                        controller = controller,
                        book = book,
                        onPlaced = { note ->
                            // Saved at once; the handwriting is read after, which the first time means fetching the model.
                            scope.launch {
                                shelf.saveNote(file.id, note)
                                com.sharathchenna.shelf.ink.Recognizer.read(note.ink!!.strokes)?.let { words -> shelf.saveNote(file.id, note.copy(ink = note.ink.copy(recognized = words))) }
                            }
                        },
                        onClose = { drawing = false },
                        onError = { message = it },
                    )
                }
                if (chrome && !drawing) Box(Modifier.align(Alignment.TopCenter)) {
                    TopBar(
                        title = file.title,
                        chapter = (locator?.let(book::sectionOf) ?: 0).let { section ->
                            locator?.title ?: book.linkFor(section)?.title ?: file.sections.getOrNull(section)?.title ?: ""
                        },
                        percent = ((locator?.locations?.totalProgression ?: 0.0) * 100).toInt(),
                        onBack = onBack,
                        onPanel = { panel = if (panel == it) null else it },
                        onRecap = { val (s, f) = here(); ai = AiTask.Recap(s, f); panel = Panel.Ai },
                        onDraw = {
                            if (book.isPdf) sketching = locator?.let(book::sectionOf) ?: 0 else drawing = true
                        },
                        onSettings = { showSettings = true },
                        onListen = { onListen(locator?.let(book::sectionOf) ?: 0) },
                        isPdf = book.isPdf,
                    )
                }
                message?.let {
                    Snackbar(Modifier.align(Alignment.BottomCenter).padding(24.dp), action = { TextButton(onClick = { message = null }) { Text("OK") } }) { Text(it) }
                }
            }
            if (wide && panel != null) {
                Box(Modifier.width(400.dp).fillMaxHeight().background(LocalPaper.current.raised).statusBarsPadding()) {
                    PanelContent(panel!!, book, file.id, notes, ai, here, controller, onClose = { panel = null }, onEdit = { editing = NoteEdit(it) }, onAi = { ai = it })
                }
            }
        }
        if (!wide && panel != null) {
            ModalBottomSheet(onDismissRequest = { panel = null }) {
                Box(Modifier.fillMaxWidth().fillMaxHeight(0.85f)) {
                    PanelContent(panel!!, book, file.id, notes, ai, here, controller, onClose = { panel = null }, onEdit = { editing = NoteEdit(it) }, onAi = { ai = it })
                }
            }
        }
    }

    editing?.let { edit ->
        NoteSheet(
            edit = edit,
            onSave = { note -> scope.launch { shelf.saveNote(file.id, note) }; editing = null },
            onRemove = { note -> scope.launch { shelf.removeNote(file.id, note) }; editing = null },
            onExplain = { note ->
                editing = null
                ai = AiTask.Explain(note.text, "explain", note.sectionIndex, note.progression ?: 0.0)
                panel = Panel.Ai
            },
            onDismiss = { editing = null },
        )
    }
    if (showSettings) {
        SettingsSheet(settings, isPdf = book.isPdf, onChange = { settings = it; it.save(context, article) }, onDismiss = { showSettings = false })
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

fun readerBackground(theme: String) = when (theme) {
    "dark" -> androidx.compose.ui.graphics.Color(0xFF000000)
    "sepia" -> androidx.compose.ui.graphics.Color(0xFFFAF4E8)
    else -> androidx.compose.ui.graphics.Color(0xFFFFFFFF)
}

@Composable
private fun TopBar(
    title: String,
    chapter: String,
    percent: Int,
    isPdf: Boolean,
    onBack: () -> Unit,
    onPanel: (Panel) -> Unit,
    onRecap: () -> Unit,
    onDraw: () -> Unit,
    onSettings: () -> Unit,
    onListen: () -> Unit,
) {
    val paper = LocalPaper.current
    Row(
        Modifier.statusBarsPadding().padding(12.dp).background(paper.raised.copy(alpha = 0.96f), RoundedCornerShape(20.dp)).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to the library") }
        Column(Modifier.width(260.dp).padding(horizontal = 4.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("$percent% · $chapter", style = MaterialTheme.typography.labelSmall, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = { onPanel(Panel.Contents) }) { Icon(Icons.AutoMirrored.Outlined.FormatListBulleted, "Contents") }
        IconButton(onClick = { onPanel(Panel.Notes) }) { Icon(Icons.Outlined.EditNote, "Highlights and notes") }
        IconButton(onClick = { onPanel(Panel.Ai) }) { Icon(Icons.AutoMirrored.Outlined.Chat, "Ask about the book") }
        TextButton(onClick = onRecap) { Text("Recap") }
        IconButton(onClick = onDraw) { Icon(Icons.Outlined.Draw, if (isPdf) "Draw on this page" else "Draw in the margin") }
        IconButton(onClick = onListen) { Icon(Icons.Outlined.Headphones, "Listen") }
        if (!isPdf) IconButton(onClick = onSettings) { Icon(Icons.Outlined.FormatSize, "Text and layout") }
    }
}
