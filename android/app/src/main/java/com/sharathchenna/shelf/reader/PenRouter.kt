package com.sharathchenna.shelf.reader

import android.content.Context
import android.view.InputDevice
import android.view.MotionEvent
import android.widget.FrameLayout

/**
 * A page that takes the pen first and keeps a resting hand off it: the hand and the pen sorted
 * apart before either reaches the page. The pen's pointer goes on, alone, to [pen]; the page
 * itself is reached through [page]. Shared by the book reader's layer (PenLayer) and the PDF one.
 */
abstract class PenRouter(context: Context) : FrameLayout(context) {
    protected val density = resources.displayMetrics.density
    protected open val slopPx: Float get() = 8 * density

    /** The pen's stroke, as single-pointer events (a hand on the screen too is left out of them). */
    protected abstract fun pen(e: MotionEvent): Boolean

    /** A hand's tap (a finger down and up without moving), before it reaches the page; true keeps it from the page. */
    protected open fun onHandTap(x: Float, y: Float): Boolean = false

    /** The page beneath, as the event would have reached it. */
    protected fun page(e: MotionEvent): Boolean = super.dispatchTouchEvent(e)

    /** What the touch going on now is: a hand, a hand being ignored, or the pen (by its pointer's id). */
    private sealed interface Gesture {
        data object None : Gesture
        data object Hand : Gesture
        data object Ignored : Gesture
        data class Pen(val id: Int, val downTime: Long) : Gesture
    }

    private var gesture: Gesture = Gesture.None
    /** When the pen was last on or over the screen: a hand touching soon after is resting, not reading. */
    protected var penAt = 0L

    protected fun isPen(e: MotionEvent, i: Int) = e.getToolType(i).let { it == MotionEvent.TOOL_TYPE_STYLUS || it == MotionEvent.TOOL_TYPE_ERASER }

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
            Gesture.None, Gesture.Hand -> handTap(e) ?: super.dispatchTouchEvent(e)
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

    private var handX = 0f
    private var handY = 0f
    private var handMoved = false

    /** A finger's tap offered to [onHandTap]; when it's taken, the page's touch ends as a cancelled one. */
    private fun handTap(e: MotionEvent): Boolean? {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { handX = e.x; handY = e.y; handMoved = false }
            MotionEvent.ACTION_MOVE -> if (kotlin.math.hypot(e.x - handX, e.y - handY) > slopPx) handMoved = true
            MotionEvent.ACTION_POINTER_DOWN -> handMoved = true
            MotionEvent.ACTION_UP -> if (!handMoved && e.eventTime - e.downTime < 400 && onHandTap(e.x, e.y)) {
                val cancel = MotionEvent.obtain(e).apply { action = MotionEvent.ACTION_CANCEL }
                super.dispatchTouchEvent(cancel)
                cancel.recycle()
                return true
            }
        }
        return null
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


    override fun dispatchGenericMotionEvent(e: MotionEvent): Boolean {
        if (e.isFromSource(InputDevice.SOURCE_STYLUS) || (e.pointerCount > 0 && isPen(e, 0))) penAt = e.eventTime
        return super.dispatchGenericMotionEvent(e)
    }

    private companion object {
        /** How long after the pen is lifted, or last hovered, a touch is taken as the hand resting. */
        const val PEN_GRACE_MS = 1500L
    }
}
