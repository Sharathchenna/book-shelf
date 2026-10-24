package com.sharathchenna.shelf.reader.pdf

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import androidx.pdf.Highlight
import androidx.pdf.PdfDocument
import androidx.pdf.PdfPoint
import androidx.pdf.PdfRect
import androidx.pdf.view.PdfView
import com.sharathchenna.shelf.data.Ink
import com.sharathchenna.shelf.data.InkStroke
import com.sharathchenna.shelf.reader.PenRouter
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.hypot
import kotlin.math.max

/** A passage the pen (or a gesture) chose on a PDF page: its text, and its lines in the page's points. */
data class PdfPassage(val page: Int, val text: String, val rects: List<PageRect>)

/** What the pen asked of a PDF page. Places on screen are in this layer's pixels. */
interface PdfPenListener {
    /** A tap, by finger or pen; true when it was taken (on a highlight or a drawing), and the page shouldn't have it. */
    fun onTap(page: Int, x: Float, y: Float, screenX: Float, screenY: Float): Boolean
    /** A stroke across text, the pen lifted: a highlight, or with the button held, the reader's menu. */
    fun onPassage(passage: PdfPassage, menu: Boolean, screenX: Float, screenY: Float)
    /** A loop around text or a figure, or a bracket beside a passage: the reader's menu for it, the stroke kept in case it was ink. */
    fun onGesture(passage: PdfPassage?, area: PageRect?, page: Int, stroke: InkStroke, screenX: Float, screenY: Float)
    /** Ink written on a page, a few seconds after the pen last wrote there (in units of the page's width). */
    fun onInk(page: Int, strokes: List<InkStroke>)
    /** The eraser at a point of a page (the page's points), rubbing out whatever's within `radius`. */
    fun onErase(page: Int, x: Float, y: Float, radius: Float)
    fun onNearTop()
    fun onButton()
}

/**
 * Android's PDF view, pen first. A hand resting on the screen is kept off it (PenRouter); the pen
 * across text highlights it, up or down text scrolls, on the blank page writes, round something
 * (or bracketing a passage) offers it to the menu, and its eraser end, or its button on the blank
 * page, rubs out. The page's highlights are drawn by the view; ink, saved and being written, is
 * drawn here over it, page by page, as the view scrolls and zooms.
 */
@SuppressLint("ViewConstructor")
class PdfPenLayer(context: Context) : PenRouter(context) {
    val pdf = PdfView(context)
    var listener: PdfPenListener? = null
    var document: PdfDocument? = null
        set(value) {
            if (field === value) return
            field = value
            pdf.pdfDocument = value
            pageSizes.clear(); textRects.clear()
            value?.let { d -> scope.launch { runCatching { d.getPageInfos(0 until d.pageCount).forEach { pageSizes[it.pageNum] = it.width.toFloat() to it.height.toFloat() } }; invalidate(); onSizes?.invoke() } }
        }
    /** Told as the pages in view change: the first, and how many. */
    var onViewport: ((Int, Int) -> Unit)? = null
    /** Told once the pages' sizes are known, so highlights (kept as fractions of a page) can be placed. */
    var onSizes: (() -> Unit)? = null
    /** The book's saved drawings on pages, as (page, ink). */
    var inks: List<Pair<Int, Ink>> = emptyList()
        set(value) { field = value; invalidate() }
    /** The book's highlights, drawn by the view; a passage being chosen is drawn with them. */
    var highlights: List<Highlight> = emptyList()
        set(value) { field = value; showHighlights() }
    var penColor = "#1F1D1A"
    var penWidthDp = 2.2f
    var highlightColor = 0x66FFD84D
    /** Whether the pen writes on the blank page; off, it's left to the page (as a finger). */
    var write = true
    /** Whether the pen highlights text it's drawn across. */
    var highlight = true
    /** Marking: the pen highlights, writes and gestures; otherwise it scrolls and zooms like a finger. */
    var marking = false
    /** The eraser chosen in the toolbar: the pen rubs out wherever it goes. */
    var erasing = false

    private val scope = MainScope()
    private val pageSizes = HashMap<Int, Pair<Float, Float>>()
    private val textRects = HashMap<Int, List<PageRect>>()
    private val slop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
    override val slopPx get() = slop

    private enum class Kind { None, Text, Ink, Erase }
    private var kind = Kind.None
    private var tracking = false
    private var taken = false
    private var button = false
    private var startPage = -1
    private var start: PdfPoint? = null
    private var downX = 0f
    private var downY = 0f
    private val xs = ArrayList<Float>()
    private val ys = ArrayList<Float>()
    private val ps = ArrayList<Float>()
    private val wetPath = Path()
    private var live: List<Highlight> = emptyList()
    private var selecting: Job? = null
    private var chosen: PdfPassage? = null

    /** Ink written but not yet handed over, a page at a time, in units of the page's width. */
    private val drafts = HashMap<Int, MutableList<InkStroke>>()
    private val flushes = HashMap<Int, Job>()

    private val inkPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val wetPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }

    init {
        setWillNotDraw(false)
        addView(pdf, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        pdf.addOnViewportChangedListener(object : PdfView.OnViewportChangedListener {
            override fun onViewportChanged(firstVisiblePage: Int, visiblePagesCount: Int, pageLocations: android.util.SparseArray<android.graphics.RectF>, zoomLevel: Float) {
                invalidate()
                loadText(firstVisiblePage, visiblePagesCount)
                onViewport?.invoke(firstVisiblePage, visiblePagesCount)
            }
        })
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        drafts.keys.toList().forEach(::flush)
        scope.cancel()
    }

    /** The page tinted as the reader's theme asks: as it is, sepia, or night (inverted, the ink still dark on light). */
    fun tint(theme: String) {
        val matrix = when (theme) {
            "sepia" -> ColorMatrix(floatArrayOf(0.94f, 0f, 0f, 0f, 8f, 0f, 0.9f, 0f, 0f, 4f, 0f, 0f, 0.78f, 0f, -6f, 0f, 0f, 0f, 1f, 0f))
            "dark" -> ColorMatrix(floatArrayOf(-0.86f, 0f, 0f, 0f, 232f, 0f, -0.86f, 0f, 0f, 232f, 0f, 0f, -0.86f, 0f, 232f, 0f, 0f, 0f, 1f, 0f))
            else -> null
        }
        if (matrix == null) pdf.setLayerType(View.LAYER_TYPE_NONE, null)
        else pdf.setLayerType(View.LAYER_TYPE_HARDWARE, Paint().apply { colorFilter = ColorMatrixColorFilter(matrix) })
    }

    fun pageSize(page: Int): Pair<Float, Float>? = pageSizes[page]

    /** The lines of text on the pages in view, for telling text from the blank page under the pen. */
    private fun loadText(first: Int, count: Int) {
        val doc = document ?: return
        for (page in max(0, first - 1)..(first + count)) {
            if (page >= doc.pageCount || textRects.containsKey(page)) continue
            textRects[page] = emptyList()
            scope.launch {
                textRects[page] = runCatching { doc.getPageContent(page)?.textContents?.flatMap { c -> c.bounds.map { PageRect(it.left, it.top, it.right, it.bottom) } } }.getOrNull().orEmpty()
            }
        }
    }

    /** The lines of a page (the page's points), loaded as it comes into view. */
    fun lines(page: Int): List<PageRect> = textRects[page].orEmpty()

    private fun onText(page: Int, p: PdfPoint): Boolean = lines(page).any { it.contains(p.x, p.y, pad = 3f) }

    private fun showHighlights() = pdf.setHighlights(highlights + live)

    override fun onHandTap(x: Float, y: Float): Boolean {
        val p = pdf.viewToPdfPoint(x, y) ?: return false
        return listener?.onTap(p.pageNum, p.x, p.y, x, y) == true
    }

    override fun pen(e: MotionEvent): Boolean {
        if (e.actionMasked == MotionEvent.ACTION_DOWN) begin(e)
        if (!tracking) return page(e)
        if (!taken) {
            val dx = e.x - downX; val dy = e.y - downY
            if (e.actionMasked == MotionEvent.ACTION_MOVE && hypot(dx, dy) > slop) {
                if (kind == Kind.None) {
                    // Reading, or off the pages: the view scrolls, as under a finger.
                    tracking = false
                    return page(e)
                }
                taken = true
                val cancel = MotionEvent.obtain(e).apply { action = MotionEvent.ACTION_CANCEL }
                page(cancel)
                cancel.recycle()
            } else {
                if (e.actionMasked == MotionEvent.ACTION_UP) {
                    tracking = false
                    val p = pdf.viewToPdfPoint(e.x, e.y)
                    if (p != null && listener?.onTap(p.pageNum, p.x, p.y, e.x, e.y) == true) {
                        val cancel = MotionEvent.obtain(e).apply { action = MotionEvent.ACTION_CANCEL }
                        page(cancel)
                        cancel.recycle()
                        return true
                    }
                }
                if (e.actionMasked == MotionEvent.ACTION_CANCEL) tracking = false
                return page(e)
            }
        }
        stroke(e)
        return true
    }

    private fun begin(e: MotionEvent) {
        tracking = true; taken = false
        downX = e.x; downY = e.y
        xs.clear(); ys.clear(); ps.clear(); wetPath.reset()
        chosen = null
        button = e.buttonState and (MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY) != 0
        val p = pdf.viewToPdfPoint(e.x, e.y)
        start = p
        startPage = p?.pageNum ?: -1
        kind = when {
            p == null -> Kind.None
            e.getToolType(0) == MotionEvent.TOOL_TYPE_ERASER || erasing -> Kind.Erase
            !marking -> Kind.None
            onText(p.pageNum, p) -> if (highlight || button) Kind.Text else Kind.None
            button -> Kind.Erase
            write -> Kind.Ink
            else -> Kind.None
        }
        wetPaint.color = runCatching { android.graphics.Color.parseColor(penColor) }.getOrDefault(android.graphics.Color.BLACK)
        wetPaint.strokeWidth = penWidthDp * density
    }

    private fun stroke(e: MotionEvent) {
        for (h in 0 until e.historySize) add(e.getHistoricalX(h), e.getHistoricalY(h), e.getHistoricalPressure(h))
        add(e.x, e.y, e.pressure)
        when (kind) {
            Kind.Text -> if (e.actionMasked == MotionEvent.ACTION_MOVE) select(e.x, e.y, final = false)
            Kind.Ink -> invalidate()
            Kind.Erase -> pdf.viewToPdfPoint(e.x, e.y)?.let { p ->
                val radius = 12 * density / unitScale(p.pageNum).coerceAtLeast(0.01f)
                eraseDraft(p.pageNum, p.x, p.y, radius)
                listener?.onErase(p.pageNum, p.x, p.y, radius)
            }
            Kind.None -> Unit
        }
        if (e.actionMasked == MotionEvent.ACTION_UP) {
            tracking = false
            when (kind) {
                Kind.Text -> select(e.x, e.y, final = true)
                Kind.Ink -> lifted(e.x, e.y)
                else -> Unit
            }
        }
        if (e.actionMasked == MotionEvent.ACTION_CANCEL) {
            tracking = false; wetPath.reset(); live = emptyList(); showHighlights(); invalidate()
        }
    }

    private fun add(x: Float, y: Float, pressure: Float) {
        if (xs.isEmpty()) wetPath.moveTo(x, y) else wetPath.lineTo(x, y)
        xs += x; ys += y; ps += pressure.coerceIn(0f, 1f)
    }

    /** The text from where the pen came down to where it is, shown as it's chosen, and handed over when it lifts. */
    private fun select(x: Float, y: Float, final: Boolean) {
        val doc = document ?: return
        val from = start ?: return
        val to = pdf.viewToPdfPoint(x, y)?.takeIf { it.pageNum == from.pageNum } ?: PdfPoint(from.pageNum, from.x, from.y)
        if (!final && selecting?.isActive == true) return
        val pen = button
        selecting = scope.launch {
            val found = passage(doc, from.pageNum, PointF(from.x, from.y), PointF(to.x, to.y))
            chosen = found ?: chosen
            live = chosen?.rects.orEmpty().map { Highlight(PdfRect(from.pageNum, it.left, it.top, it.right, it.bottom), highlightColor) }
            showHighlights()
            if (final) {
                live = emptyList(); showHighlights()
                chosen?.takeIf { it.text.isNotBlank() }?.let { listener?.onPassage(it, pen, x, y) }
            }
        }
    }

    private fun lifted(x: Float, y: Float) {
        val page = startPage
        if (page < 0 || xs.size < 2) { wetPath.reset(); invalidate(); return }
        val stroke = toPage(page)
        when (val gesture = classify(xs.toFloatArray(), ys.toFloatArray(), density)) {
            Stroke.Ink -> keep(page, stroke)
            is Stroke.Loop -> scope.launch {
                val a = pdf.viewToPdfPoint(gesture.bounds.left, gesture.bounds.top)
                val b = pdf.viewToPdfPoint(gesture.bounds.right, gesture.bounds.bottom)
                val area = if (a != null && b != null && a.pageNum == page && b.pageNum == page) PageRect(a.x, a.y, b.x, b.y) else null
                // The text inside the loop: the lines whose middles it encloses.
                val inside = area?.let { r -> lines(page).filter { r.contains((it.left + it.right) / 2, (it.top + it.bottom) / 2) } }.orEmpty()
                val passage = document?.takeIf { inside.isNotEmpty() }?.let { doc ->
                    val first = inside.minBy { it.top }; val last = inside.maxBy { it.bottom }
                    passage(doc, page, PointF(inside.minOf { it.left } + 1, (first.top + first.bottom) / 2), PointF(inside.maxOf { it.right } - 1, (last.top + last.bottom) / 2))
                }
                wetPath.reset(); invalidate()
                listener?.onGesture(passage?.takeIf { it.text.trim().length >= 3 }, area, page, stroke, x, y)
            }
            is Stroke.Bracket -> scope.launch {
                val top = pdf.viewToPdfPoint(gesture.x, gesture.top)
                val bottom = pdf.viewToPdfPoint(gesture.x, gesture.bottom)
                val passage = if (top != null && bottom != null && top.pageNum == page) bracketed(page, top, bottom, gesture.opensRight) else null
                wetPath.reset(); invalidate()
                if (passage == null) keep(page, stroke) else listener?.onGesture(passage, null, page, stroke, x, y)
            }
        }
    }

    /** The lines beside a bracket: those level with it, in the column on the side it opens to. */
    private suspend fun bracketed(page: Int, top: PdfPoint, bottom: PdfPoint, opensRight: Boolean): PdfPassage? {
        val doc = document ?: return null
        val x = top.x
        val level = lines(page).filter { val mid = (it.top + it.bottom) / 2; mid >= top.y - 4 && mid <= bottom.y + 4 }
        val side = level.filter { if (opensRight) it.left >= x - 6 else it.right <= x + 6 }
        if (side.isEmpty()) return null
        // One column: the lines starting nearest the bracket.
        val edge = if (opensRight) side.minOf { it.left } else side.maxOf { it.right }
        val column = side.filter { if (opensRight) it.left - edge < 60 else edge - it.right < 60 }
        val first = column.minBy { it.top }; val last = column.maxBy { it.bottom }
        return passage(doc, page, PointF(first.left + 1, (first.top + first.bottom) / 2), PointF(last.right - 1, (last.top + last.bottom) / 2))
    }

    private suspend fun passage(doc: PdfDocument, page: Int, from: PointF, to: PointF): PdfPassage? = runCatching {
        val selection = doc.getSelectionBounds(page, from, to) ?: return null
        val text = selection.selectedContents.filterIsInstance<androidx.pdf.content.PdfPageTextContent>()
        PdfPassage(page, text.joinToString(" ") { it.text }.replace(Regex("\\s+"), " ").trim(), text.flatMap { c -> c.bounds.map { PageRect(it.left, it.top, it.right, it.bottom) } })
    }.getOrNull()

    /** A stroke kept for its page, handed over once the pen has rested a moment there. */
    fun keep(page: Int, stroke: InkStroke) {
        drafts.getOrPut(page) { mutableListOf() } += stroke
        wetPath.reset(); invalidate()
        flushes[page]?.cancel()
        flushes[page] = scope.launch { delay(2500); flush(page) }
    }

    private fun flush(page: Int) {
        val strokes = drafts.remove(page) ?: return
        flushes.remove(page)?.cancel()
        if (strokes.isNotEmpty()) listener?.onInk(page, strokes)
        invalidate()
    }

    private fun eraseDraft(page: Int, x: Float, y: Float, radius: Float) {
        val unit = pageSizes[page]?.first ?: return
        val strokes = drafts[page] ?: return
        if (strokes.removeAll { s -> hits(s, x / unit, y / unit, radius / unit) }) invalidate()
    }

    /** Screen pixels per point of a page, at the view's zoom. */
    fun unitScale(page: Int): Float {
        val w = pageSizes[page]?.first ?: return 1f
        val a = pdf.pdfToViewPoint(PdfPoint(page, 0f, 0f)) ?: return 1f
        val b = pdf.pdfToViewPoint(PdfPoint(page, w, 0f)) ?: return 1f
        return (b.x - a.x) / w
    }

    /** The stroke just written in units of its page's width, as saved drawings are (place "page"). */
    private fun toPage(page: Int): InkStroke {
        val w = pageSizes[page]?.first ?: 1f
        val o = pdf.pdfToViewPoint(PdfPoint(page, 0f, 0f)) ?: PointF(0f, 0f)
        val perUnit = unitScale(page) * w
        val points = ArrayList<Double>(xs.size * 3)
        for (i in xs.indices) {
            points += ((xs[i] - o.x) / perUnit).toDouble(); points += ((ys[i] - o.y) / perUnit).toDouble(); points += ps[i].toDouble()
        }
        return InkStroke(color = penColor, width = (penWidthDp * density / perUnit).toDouble(), points = points)
    }

    override fun dispatchDraw(canvas: Canvas) {
        super.dispatchDraw(canvas)
        val first = pdf.firstVisiblePage
        val last = first + pdf.visiblePagesCount
        for ((page, ink) in inks) if (page in first..last) drawStrokes(canvas, page, ink.strokes)
        for ((page, strokes) in drafts) if (page in first..last) drawStrokes(canvas, page, strokes)
        if (kind == Kind.Ink && !wetPath.isEmpty) canvas.drawPath(wetPath, wetPaint)
    }

    private fun drawStrokes(canvas: Canvas, page: Int, strokes: List<InkStroke>) {
        val w = pageSizes[page]?.first ?: return
        val o = pdf.pdfToViewPoint(PdfPoint(page, 0f, 0f)) ?: return
        val perUnit = unitScale(page) * w
        for (s in strokes) {
            inkPaint.color = runCatching { android.graphics.Color.parseColor(s.color) }.getOrDefault(android.graphics.Color.BLACK)
            val p = s.points
            if (p.size == 3) {
                inkPaint.strokeWidth = (s.width * perUnit).toFloat()
                canvas.drawPoint(o.x + (p[0] * perUnit).toFloat(), o.y + (p[1] * perUnit).toFloat(), inkPaint)
            }
            var i = 3
            while (i + 2 < p.size) {
                val pressure = ((p[i - 1] + p[i + 2]) / 2).let { if (it == 0.0) 0.5 else it }
                inkPaint.strokeWidth = (s.width * perUnit * max(0.15, pressure)).toFloat()
                canvas.drawLine(o.x + (p[i - 3] * perUnit).toFloat(), o.y + (p[i - 2] * perUnit).toFloat(), o.x + (p[i] * perUnit).toFloat(), o.y + (p[i + 1] * perUnit).toFloat(), inkPaint)
                i += 3
            }
        }
    }

    override fun dispatchGenericMotionEvent(e: MotionEvent): Boolean {
        if (e.isFromSource(InputDevice.SOURCE_STYLUS) || (e.pointerCount > 0 && isPen(e, 0))) {
            when (e.actionMasked) {
                MotionEvent.ACTION_HOVER_MOVE -> if (e.y < 72 * density) listener?.onNearTop()
                MotionEvent.ACTION_BUTTON_PRESS -> if (e.actionButton and (MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY) != 0) {
                    listener?.onButton(); return true
                }
            }
        }
        return super.dispatchGenericMotionEvent(e)
    }

    companion object {
        /** Whether a stroke (in page-width units) passes within `radius` of a point. */
        fun hits(s: InkStroke, x: Float, y: Float, radius: Float): Boolean {
            val p = s.points
            var i = 0
            while (i + 1 < p.size) {
                val ax = p[i].toFloat(); val ay = p[i + 1].toFloat()
                val bx = if (i + 4 < p.size) p[i + 3].toFloat() else ax
                val by = if (i + 4 < p.size) p[i + 4].toFloat() else ay
                val dx = bx - ax; val dy = by - ay
                val len = dx * dx + dy * dy
                val t = if (len == 0f) 0f else (((x - ax) * dx + (y - ay) * dy) / len).coerceIn(0f, 1f)
                val cx = ax + t * dx - x; val cy = ay + t * dy - y
                if (cx * cx + cy * cy <= radius * radius) return true
                i += 3
            }
            return false
        }
    }
}
