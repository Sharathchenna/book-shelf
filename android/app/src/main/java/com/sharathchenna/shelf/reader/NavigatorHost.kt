package com.sharathchenna.shelf.reader

import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.FragmentContainerView
import androidx.fragment.app.FragmentFactory
import com.sharathchenna.shelf.data.Highlight
import com.sharathchenna.shelf.ink.inkSvg
import kotlinx.parcelize.Parcelize
import org.readium.adapter.pdfium.navigator.PdfiumEngineProvider
import org.readium.r2.navigator.DecorableNavigator
import org.readium.r2.navigator.Decoration
import org.readium.r2.navigator.SelectableNavigator
import org.readium.r2.navigator.VisualNavigator
import org.readium.r2.navigator.epub.EpubNavigatorFactory
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.navigator.epub.EpubPreferences
import org.readium.r2.navigator.epub.css.FontStyle
import org.readium.r2.navigator.html.HtmlDecorationTemplate
import org.readium.r2.navigator.html.HtmlDecorationTemplates
import org.readium.r2.navigator.input.InputListener
import org.readium.r2.navigator.input.TapEvent
import org.readium.r2.navigator.pdf.PdfNavigatorFactory
import org.readium.r2.navigator.util.DirectionalNavigationAdapter
import org.readium.r2.navigator.util.SingleFragmentFactory
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.Locator

/** The colours of the site's highlighters (app/components/reader/foliate.ts HIGHLIGHT_HEX). */
val HIGHLIGHT_ARGB = mapOf("yellow" to 0xFFFFD84D.toInt(), "green" to 0xFF8BD17C.toInt(), "blue" to 0xFF7CB8FF.toInt(), "pink" to 0xFFFF8FB8.toInt())

/** The site's typefaces, served into the book's pages for its settings. */
val FRAUNCES = org.readium.r2.navigator.preferences.FontFamily("Fraunces")
val GEIST = org.readium.r2.navigator.preferences.FontFamily("Geist")

/** A drawing in an EPUB's margin, drawn by Readium where its paragraph is, as the page lays out. */
@Parcelize
data class InkMark(val svg: String, val dx: Double, val dy: Double) : Decoration.Style

/** What the reader asks of the selection menu. */
/**
 * What the menu over selected text offers: highlighting, and the web reader's actions
 * (lib/reader-actions.ts), each sent to /api/reader/explain with its `action`.
 */
enum class SelectionAction(val label: String, val action: String? = null) {
    Highlight("Highlight"), Note("Note"), Explain("Explain", "explain"), Define("Define", "define"),
    Simplify("Simplify", "simplify"), Check("Fact-check", "check"), Related("Related", "connect"), Counter("Counterpoint", "counter"), Ask("Ask"),
}

/**
 * The reader's handle on Readium's navigator, whichever kind it is: the EPUB one, which draws
 * highlights and drawings and lets text be selected, or the PDF one, which only turns pages.
 */
class ReaderController {
    /** Taps at a page's edges turn it, and turns are animated: as the reader's settings say. */
    var tapEdges = true
    var animate = true

    var navigator: VisualNavigator? = null
        internal set(value) {
            field = value
            ready.value = value != null
        }

    /** Whether the navigator is in place: highlights can be drawn and places followed. */
    val ready = kotlinx.coroutines.flow.MutableStateFlow(false)
    val epub: EpubNavigatorFragment? get() = navigator as? EpubNavigatorFragment

    /** Draws the book's highlights (as highlighter) and drawings (in the margin). */
    suspend fun showNotes(book: OpenedBook, notes: List<Highlight>) {
        val decorable = navigator as? DecorableNavigator ?: return
        val highlights = notes.filter { it.ink == null }.mapNotNull { n ->
            book.locatorOf(n)?.let { Decoration(id = n.id, locator = it, style = Decoration.Style.Highlight(tint = HIGHLIGHT_ARGB[n.color] ?: HIGHLIGHT_ARGB.getValue("yellow"))) }
        }
        val drawings = notes.filter { it.ink?.place == "margin" }.mapNotNull { n ->
            val ink = n.ink!!
            val (dx, dy) = ink.offset ?: listOf(0.0, 0.0)
            book.locatorOf(n)?.let { Decoration(id = n.id, locator = it, style = InkMark(inkSvg(ink), dx, dy)) }
        }
        decorable.applyDecorations(highlights, "highlights")
        decorable.applyDecorations(drawings, "ink")
    }

    suspend fun selection(): Locator? = (navigator as? SelectableNavigator)?.currentSelection()?.locator

    fun clearSelection() = (navigator as? SelectableNavigator)?.clearSelection()

    fun go(locator: Locator) = navigator?.go(locator, animated = false)
}

/** Readium's stylesheet for a drawing: an element at its paragraph's corner, the SVG drawn from there, over the text. */
@OptIn(ExperimentalReadiumApi::class)
private fun templates(): HtmlDecorationTemplates = HtmlDecorationTemplates.defaultTemplates().apply {
    set(
        InkMark::class,
        HtmlDecorationTemplate(
            layout = HtmlDecorationTemplate.Layout.BOUNDS,
            width = HtmlDecorationTemplate.Width.BOUNDS,
            element = { decoration ->
                val mark = decoration.style as InkMark
                "<div class=\"shelf-ink\"><div style=\"position:absolute;left:${mark.dx}px;top:${mark.dy}px\">${mark.svg}</div></div>"
            },
            stylesheet = ".shelf-ink { pointer-events: none; overflow: visible; } .shelf-ink svg { overflow: visible; }",
        ),
    )
}

/**
 * Readium's navigator fragment, in Compose. The fragment is added to a container view, made by
 * the factory set on the activity's fragment manager (Readium's fragments take their book in
 * their constructor), and removed when the reader closes.
 */
@OptIn(ExperimentalReadiumApi::class)
@Composable
fun NavigatorHost(
    activity: FragmentActivity,
    book: OpenedBook,
    initial: Locator?,
    preferences: EpubPreferences,
    controller: ReaderController,
    onSelection: (SelectionAction) -> Unit,
    /** A tap in the middle of the page, where it fell (in the navigator's pixels). */
    onTap: (android.graphics.PointF) -> Unit,
    onDecoration: (id: String) -> Unit,
    pen: PenListener,
    penHighlight: Boolean,
    penWrite: Boolean,
    scrolling: Boolean,
    graceMs: Long,
    /** For an article: the page's gutters (CSS px), beside a column held to its measure (articleCss). */
    gutter: Double? = null,
    modifier: Modifier = Modifier,
) {
    val tag = "reader"
    val factory: FragmentFactory = remember(book) {
        if (book.isPdf) {
            PdfNavigatorFactory(book.publication, PdfiumEngineProvider()).createFragmentFactory(initialLocator = initial)
        } else {
            EpubNavigatorFactory(book.publication).createFragmentFactory(
                initialLocator = initial,
                initialPreferences = preferences,
                // A link out of the book opens in the browser, over the app.
                listener = object : EpubNavigatorFragment.Listener {
                    override fun onExternalLinkActivated(url: org.readium.r2.shared.util.AbsoluteUrl) {
                        if (url.scheme.value == "http" || url.scheme.value == "https") com.sharathchenna.shelf.ui.openExternal(activity, url.toString())
                    }
                },
                configuration = EpubNavigatorFragment.Configuration(
                    decorationTemplates = templates(),
                    selectionActionModeCallback = SelectionMenu(onSelection),
                ).apply {
                    gutter?.let { readiumCssRsProperties = org.readium.r2.navigator.epub.css.RsProperties(pageGutter = org.readium.r2.navigator.epub.css.Length.Px(it)) }
                    // The site's own type, offered in the reader's settings (assets/fonts).
                    servedAssets = listOf("fonts/.*")
                    addFontFamilyDeclaration(FRAUNCES) {
                        addFontFace { addSource("fonts/Fraunces.ttf"); setFontStyle(FontStyle.NORMAL); setFontWeight(100..900) }
                        addFontFace { addSource("fonts/Fraunces-Italic.ttf"); setFontStyle(FontStyle.ITALIC); setFontWeight(100..900) }
                    }
                    addFontFamilyDeclaration(GEIST) {
                        addFontFace { addSource("fonts/Geist.ttf"); setFontStyle(FontStyle.NORMAL); setFontWeight(100..900) }
                    }
                },
            )
        }
    }
    val containerId = remember { View.generateViewId() }
    AndroidView(
        modifier = modifier,
        factory = { context ->
            // The fragment goes in once the container is in the window, so the manager can find it.
            val container = FragmentContainerView(context).apply {
                id = containerId
                post { attach(activity, containerId, factory, tag, controller, onTap, onDecoration) }
            }
            // The pen reads an EPUB's text; a PDF's pages are images, drawn on in their own sheet.
            PenLayer(context) { visibleWebViews(controller.epub?.view) }.apply { addView(container) }
        },
        update = { layer ->
            layer.listener = pen
            layer.highlight = penHighlight && !book.isPdf
            layer.write = penWrite && !book.isPdf
            layer.scrolling = scrolling
            layer.graceMs = graceMs
        },
    )
    DisposableEffect(book) {
        onDispose {
            val fm = activity.supportFragmentManager
            fm.findFragmentByTag(tag)?.let { fm.beginTransaction().remove(it).commitNowAllowingStateLoss() }
            controller.navigator = null
        }
    }
}

private fun attach(
    activity: FragmentActivity,
    containerId: Int,
    factory: FragmentFactory,
    tag: String,
    controller: ReaderController,
    onTap: (android.graphics.PointF) -> Unit,
    onDecoration: (String) -> Unit,
) {
    val fm = activity.supportFragmentManager
    if (fm.findFragmentByTag(tag) != null || activity.isFinishing) return
    fm.fragmentFactory = factory
    val fragment: Fragment = factory.instantiate(activity.classLoader, (factory as SingleFragmentFactory<*>).fragmentClass.name)
    fm.beginTransaction().replace(containerId, fragment, tag).commitNowAllowingStateLoss()
    val navigator = fragment as VisualNavigator
    controller.navigator = navigator
    // Taps at the edges turn the page (and arrow keys, Page Up/Down and Space on the keyboard cover);
    // a tap in the middle shows or hides the bars.
    navigator.addInputListener(object : InputListener {
        override fun onTap(event: TapEvent): Boolean =
            controller.tapEdges && DirectionalNavigationAdapter(navigator as org.readium.r2.navigator.OverflowableNavigator, animatedTransition = controller.animate).onTap(event)
    })
    navigator.addInputListener(object : InputListener {
        override fun onTap(event: TapEvent): Boolean {
            onTap(event.point)
            return true
        }
    })
    (navigator as? DecorableNavigator)?.let { decorable ->
        val listener = object : DecorableNavigator.Listener {
            override fun onDecorationActivated(event: DecorableNavigator.OnActivatedEvent): Boolean {
                onDecoration(event.decoration.id)
                return true
            }
        }
        decorable.addDecorationListener("highlights", listener)
        decorable.addDecorationListener("ink", listener)
    }
}

/** The menu over selected text: the reader's actions in place of the system's own. */
private class SelectionMenu(private val onAction: (SelectionAction) -> Unit) : ActionMode.Callback {
    override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
        SelectionAction.entries.forEachIndexed { i, a -> menu.add(Menu.NONE, i, i, a.label) }
        return true
    }

    override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean = false

    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
        onAction(SelectionAction.entries[item.itemId])
        mode.finish()
        return true
    }

    override fun onDestroyActionMode(mode: ActionMode) {}
}
