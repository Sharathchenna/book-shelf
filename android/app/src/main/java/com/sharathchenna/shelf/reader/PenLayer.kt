package com.sharathchenna.shelf.reader

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.InputDevice
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.webkit.WebView
import android.widget.FrameLayout
import com.sharathchenna.shelf.data.InkStroke
import kotlin.math.hypot

/** What the pen asked of the page, in window pixels where a place matters. */
interface PenListener {
    /** The pen drew over text and lifted: the passage is selected in the page. `menu` when the button was held. */
    fun onPassage(menu: Boolean, x: Float, y: Float)
    /** The eraser end (or the eraser tool) rubbed over text, selected in the page. */
    fun onRubOut()
    /** A stroke written where there's no text: the start of a note in the margin. */
    fun onWrite(stroke: InkStroke)
    /** The pen hovering near the top of the page, where the bar is. */
    fun onNearTop()
    /** The pen's button pressed while it hovers, not touching the screen. */
    fun onButton()
}

/**
 * The page, pen first. Around Readium's navigator: fingers, and the pen's taps and long presses,
 * go to the page as ever; a pen stroke across text marks it as a highlighter would (with the
 * button held, it selects it for the reader's menu, and the eraser end rubs highlights out), and a
 * stroke where there's no text, as in a margin, begins a handwritten note. The stroke is read
 * here, ahead of the page's own handling, so a web view asking not to be intercepted can't keep
 * it, and once it's the pen's the page is told the touch was cancelled.
 */
@SuppressLint("ViewConstructor")
class PenLayer(context: Context, private val webViews: () -> List<Pair<WebView, IntArray>>) : PenRouter(context) {
    var listener: PenListener? = null
    var highlight = true
    var write = true
    /** The palette's eraser: every stroke rubs out, as the pen's eraser end does. */
    var rubbing = false

    private enum class Mode { Unknown, Text, Blank }

    override val slopPx get() = slop
    private val slop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
    private var tracking = false
    private var taken = false
    private var mode = Mode.Unknown
    private var button = false
    private var eraser = false
    private var lifted = false
    private var downX = 0f
    private var downY = 0f
    private var web: Pair<WebView, IntArray>? = null
    private var selecting = false
    private var pending: Pair<Double, Double>? = null
    private val points = ArrayList<Double>()
    private val path = Path()
    private val origin = IntArray(2)
    private val wet = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
        color = 0xFF1F1D1A.toInt(); strokeWidth = 2.2f * density
    }

    init {
        setWillNotDraw(false)
    }

    /** Articles read as a scroll: a pen stroke up or down the page scrolls it, one along a line highlights. */
    var scrolling = false

    /** The pen's own stroke: a tap or a long press for the page, a scroll in an article, or a stroke the pen keeps. */
    override fun pen(e: MotionEvent): Boolean {
        if (!highlight && !write) return page(e)
        if (e.actionMasked == MotionEvent.ACTION_DOWN) {
            tracking = true
            taken = false
            begin(e)
        }
        if (!tracking) return page(e)
        if (!taken) {
            val dx = e.x - downX; val dy = e.y - downY
            if (e.actionMasked == MotionEvent.ACTION_MOVE && hypot(dx, dy) > slop) {
                if (scrolling && !button && !eraser && kotlin.math.abs(dy) > kotlin.math.abs(dx) * 1.2f) {
                    // Up or down the page: the page scrolls, flings and all, as under a finger.
                    tracking = false
                    path.reset(); invalidate()
                    return page(e)
                }
                taken = true
                // The page had the touch until now; it ends there, as a cancelled one.
                val cancel = MotionEvent.obtain(e).apply { action = MotionEvent.ACTION_CANCEL }
                page(cancel)
                cancel.recycle()
            } else {
                // A tap, or a long press for the system's own selection: the page's.
                if (e.actionMasked == MotionEvent.ACTION_UP || e.actionMasked == MotionEvent.ACTION_CANCEL) tracking = false
                return page(e)
            }
        }
        stroke(e)
        return true
    }

    private fun begin(e: MotionEvent) {
        downX = e.x; downY = e.y
        button = e.buttonState and (MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY) != 0
        eraser = e.getToolType(0) == MotionEvent.TOOL_TYPE_ERASER || rubbing
        lifted = false
        pending = null
        points.clear(); path.reset()
        getLocationInWindow(origin)
        val wx = origin[0] + e.x; val wy = origin[1] + e.y
        web = webViews().firstOrNull { (v, at) -> wx >= at[0] && wx <= at[0] + v.width && wy >= at[1] && wy <= at[1] + v.height }
        // Over text or not decides what the stroke is; the page answers before the pen has gone far.
        mode = if (button || eraser || !write) Mode.Text else if (!highlight) Mode.Blank else Mode.Unknown
        if (mode == Mode.Unknown) {
            val (x, y) = css(wx, wy) ?: run { mode = Mode.Blank; return }
            web!!.first.evaluateJavascript("$TEXT_AT($x,$y)") { answer ->
                mode = if (answer?.trim('"') == "text") Mode.Text else Mode.Blank
                when (mode) {
                    Mode.Text -> { path.reset(); invalidate(); select() }
                    else -> invalidate()
                }
                if (lifted) finish()
            }
        }
    }

    private fun stroke(e: MotionEvent) {
        for (h in 0 until e.historySize) add(e.getHistoricalX(h), e.getHistoricalY(h), e.getHistoricalPressure(h))
        add(e.x, e.y, e.pressure)
        when (e.actionMasked) {
            MotionEvent.ACTION_MOVE -> if (mode == Mode.Text) select() else invalidate()
            MotionEvent.ACTION_UP -> { lifted = true; tracking = false; if (mode != Mode.Unknown) finish() }
            MotionEvent.ACTION_CANCEL -> { tracking = false; lifted = false; path.reset(); invalidate(); web?.first?.evaluateJavascript("getSelection().removeAllRanges()", null) }
        }
    }

    private fun add(x: Float, y: Float, pressure: Float) {
        if (points.isEmpty()) path.moveTo(x, y) else path.lineTo(x, y)
        points += (origin[0] + x).toDouble(); points += (origin[1] + y).toDouble(); points += pressure.coerceIn(0f, 1f).toDouble()
    }

    /** The passage from where the pen came down to where it is, selected in the page, a frame at a time. */
    private fun select(then: (() -> Unit)? = null) {
        val (wv, _) = web ?: return then?.invoke() ?: Unit
        val n = points.size
        if (n < 3) return then?.invoke() ?: Unit
        val start = css(origin[0] + downX, origin[1] + downY) ?: return
        val end = css(points[n - 3].toFloat(), points[n - 2].toFloat()) ?: return
        if (selecting && then == null) { pending = end; return }
        selecting = true
        wv.evaluateJavascript("$SELECT(${start.first},${start.second},${end.first},${end.second})") {
            selecting = false
            val next = pending
            pending = null
            if (then != null) then() else if (next != null && tracking) select()
        }
    }

    private fun finish() {
        when (mode) {
            Mode.Blank -> {
                if (points.size >= 6) listener?.onWrite(InkStroke(color = "#1F1D1A", width = (2.2f * density).toDouble(), points = points.toList()))
                path.reset(); invalidate()
            }
            Mode.Text -> select {
                val n = points.size
                if (eraser) listener?.onRubOut()
                else listener?.onPassage(button, points[n - 3].toFloat(), points[n - 2].toFloat())
            }
            Mode.Unknown -> Unit
        }
    }

    /** Window pixels to the CSS pixels of the page under the pen. */
    private fun css(wx: Float, wy: Float): Pair<Double, Double>? {
        val (_, at) = web ?: return null
        return ((wx - at[0]) / density).toDouble() to ((wy - at[1]) / density).toDouble()
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

    override fun dispatchDraw(canvas: Canvas) {
        super.dispatchDraw(canvas)
        // Ink while the pen writes in the margin, until the drawing's own canvas takes it over.
        if (mode == Mode.Blank && !path.isEmpty) canvas.drawPath(path, wet)
    }

    private companion object {

        /** Whether there's a line of text at a point, rather than a margin, a gap or a picture. */
        const val TEXT_AT = """(function(x,y){
          var e = document.elementFromPoint(x, y);
          if (!e || e === document.body || e === document.documentElement) return 'blank';
          var r = document.caretRangeFromPoint(x, y);
          if (!r || r.startContainer.nodeType !== 3) return 'blank';
          var n = r.startContainer, o = Math.max(0, Math.min(r.startOffset, n.length - 1));
          var c = document.createRange(); c.setStart(n, o); c.setEnd(n, Math.min(n.length, o + 1));
          var b = c.getBoundingClientRect();
          return y >= b.top - 14 && y <= b.bottom + 14 && x >= b.left - 48 && x <= b.right + 48 ? 'text' : 'blank';
        })"""

        /** Selects the words from one point to another, whole words at either end. */
        const val SELECT = """(function(x1,y1,x2,y2){
          function at(x, y) { var r = document.caretRangeFromPoint(x, y); return r && r.startContainer.nodeType === 3 ? r : null; }
          var a = at(x1, y1), b = at(x2, y2);
          if (!a || !b) return false;
          if (a.compareBoundaryPoints(Range.START_TO_START, b) > 0) { var t = a; a = b; b = t; }
          var an = a.startContainer, ao = a.startOffset, bn = b.startContainer, bo = b.startOffset;
          var w = /[\p{L}\p{N}'’-]/u;
          while (ao > 0 && w.test(an.data[ao - 1])) ao--;
          while (bo < bn.length && w.test(bn.data[bo])) bo++;
          var s = getSelection();
          s.setBaseAndExtent(an, ao, bn, bo);
          return !s.isCollapsed;
        })"""
    }
}
