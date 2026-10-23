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
class PenLayer(context: Context, private val webViews: () -> List<Pair<WebView, IntArray>>) : FrameLayout(context) {
    var listener: PenListener? = null
    var highlight = true
    var write = true

    private enum class Mode { Unknown, Text, Blank }

    private val slop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
    private val density = resources.displayMetrics.density
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

    /** What the touch going on now is: a hand, a hand being ignored, or the pen (by its pointer's id). */
    private sealed interface Gesture {
        data object None : Gesture
        data object Hand : Gesture
        data object Ignored : Gesture
        data class Pen(val id: Int, val downTime: Long) : Gesture
    }

    private var gesture: Gesture = Gesture.None
    /** When the pen was last on or over the screen: a hand touching soon after is resting, not reading. */
    private var penAt = 0L

    private fun isPen(e: MotionEvent, i: Int) = e.getToolType(i).let { it == MotionEvent.TOOL_TYPE_STYLUS || it == MotionEvent.TOOL_TYPE_ERASER }

    /** A palm, as the screen reports it: a contact far wider than a fingertip, or one the system has called off. */
    private fun isPalm(e: MotionEvent, i: Int) =
        e.getTouchMajor(i) > 120 * density || e.flags and MotionEvent.FLAG_CANCELED != 0

    private fun penNear(now: Long) = now - penAt < PEN_GRACE_MS

    /**
     * The hand and the pen, sorted. A hand on its own reads the page as ever, unless it touches as
     * a palm or while the pen is in use (hovering, or lifted a moment ago): then it's ignored, so a
     * hand resting on the screen neither scrolls nor turns. When the pen comes down while a hand is
     * resting, the hand's touch is cancelled for the page and only the pen is followed from then on.
     */
    override fun dispatchTouchEvent(e: MotionEvent): Boolean {
        val i = e.actionIndex
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> gesture = when {
                isPen(e, 0) -> Gesture.Pen(e.getPointerId(0), e.eventTime)
                isPalm(e, 0) || penNear(e.eventTime) -> Gesture.Ignored
                else -> Gesture.Hand
            }
            MotionEvent.ACTION_POINTER_DOWN -> if (isPen(e, i) && gesture !is Gesture.Pen) {
                if (gesture == Gesture.Hand) {
                    val cancel = MotionEvent.obtain(e).apply { action = MotionEvent.ACTION_CANCEL }
                    super.dispatchTouchEvent(cancel)
                    cancel.recycle()
                }
                gesture = Gesture.Pen(e.getPointerId(i), e.eventTime)
            } else if (gesture == Gesture.Hand && isPalm(e, i)) {
                // A palm joining a finger: the page's touch ends, and the rest of it is ignored.
                val cancel = MotionEvent.obtain(e).apply { action = MotionEvent.ACTION_CANCEL }
                super.dispatchTouchEvent(cancel)
                cancel.recycle()
                gesture = Gesture.Ignored
            }
        }
        val result = when (val g = gesture) {
            Gesture.None, Gesture.Hand -> super.dispatchTouchEvent(e)
            Gesture.Ignored -> true
            is Gesture.Pen -> {
                penAt = e.eventTime
                val at = e.findPointerIndex(g.id)
                if (at < 0) true
                else {
                    // The pen's pointer on its own, as if no hand were there.
                    val action = when {
                        e.actionMasked == MotionEvent.ACTION_POINTER_DOWN && i == at -> MotionEvent.ACTION_DOWN
                        e.actionMasked == MotionEvent.ACTION_POINTER_DOWN -> MotionEvent.ACTION_MOVE
                        e.actionMasked == MotionEvent.ACTION_POINTER_UP && i == at -> MotionEvent.ACTION_UP
                        e.actionMasked == MotionEvent.ACTION_POINTER_UP -> MotionEvent.ACTION_MOVE
                        else -> e.actionMasked
                    }
                    val alone = single(e, at, action, g.downTime)
                    val handled = pen(alone)
                    alone.recycle()
                    // The pen lifted with the hand still down: the rest of the hand's touch is ignored.
                    if (action == MotionEvent.ACTION_UP && e.actionMasked == MotionEvent.ACTION_POINTER_UP) gesture = Gesture.Ignored
                    handled
                }
            }
        }
        if (e.actionMasked == MotionEvent.ACTION_UP || e.actionMasked == MotionEvent.ACTION_CANCEL) gesture = Gesture.None
        return result
    }

    /** One pointer of an event as an event of its own, its history kept. */
    private fun single(e: MotionEvent, index: Int, action: Int, downTime: Long): MotionEvent {
        val props = arrayOf(MotionEvent.PointerProperties().also { e.getPointerProperties(index, it) })
        fun coords(h: Int) = arrayOf(MotionEvent.PointerCoords().also { if (h < 0) e.getPointerCoords(index, it) else e.getHistoricalPointerCoords(index, h, it) })
        val first = if (e.historySize > 0 && action == MotionEvent.ACTION_MOVE) 0 else -1
        val out = MotionEvent.obtain(
            downTime, if (first == 0) e.getHistoricalEventTime(0) else e.eventTime, action, 1, props, coords(first),
            e.metaState, e.buttonState, e.xPrecision, e.yPrecision, e.deviceId, e.edgeFlags, e.source, e.flags,
        )
        if (first == 0) {
            for (h in 1 until e.historySize) out.addBatch(e.getHistoricalEventTime(h), coords(h), e.metaState)
            out.addBatch(e.eventTime, coords(-1), e.metaState)
        }
        return out
    }

    /** The pen's own stroke: a tap or a long press for the page, a scroll in an article, or a stroke the pen keeps. */
    private fun pen(e: MotionEvent): Boolean {
        if (!highlight && !write) return super.dispatchTouchEvent(e)
        if (e.actionMasked == MotionEvent.ACTION_DOWN) {
            tracking = true
            taken = false
            begin(e)
        }
        if (!tracking) return super.dispatchTouchEvent(e)
        if (!taken) {
            val dx = e.x - downX; val dy = e.y - downY
            if (e.actionMasked == MotionEvent.ACTION_MOVE && hypot(dx, dy) > slop) {
                if (scrolling && !button && !eraser && kotlin.math.abs(dy) > kotlin.math.abs(dx) * 1.2f) {
                    // Up or down the page: the page scrolls, flings and all, as under a finger.
                    tracking = false
                    path.reset(); invalidate()
                    return super.dispatchTouchEvent(e)
                }
                taken = true
                // The page had the touch until now; it ends there, as a cancelled one.
                val cancel = MotionEvent.obtain(e).apply { action = MotionEvent.ACTION_CANCEL }
                super.dispatchTouchEvent(cancel)
                cancel.recycle()
            } else {
                // A tap, or a long press for the system's own selection: the page's.
                if (e.actionMasked == MotionEvent.ACTION_UP || e.actionMasked == MotionEvent.ACTION_CANCEL) tracking = false
                return super.dispatchTouchEvent(e)
            }
        }
        stroke(e)
        return true
    }

    private fun begin(e: MotionEvent) {
        downX = e.x; downY = e.y
        button = e.buttonState and (MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY) != 0
        eraser = e.getToolType(0) == MotionEvent.TOOL_TYPE_ERASER
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
            penAt = e.eventTime
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
        /** How long after the pen is lifted, or last hovered, a touch is taken as the hand resting. */
        const val PEN_GRACE_MS = 1500L

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
