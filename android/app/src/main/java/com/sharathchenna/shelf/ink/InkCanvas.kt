package com.sharathchenna.shelf.ink

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.isPrimaryPressed
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.ink.authoring.compose.InProgressStrokes
import androidx.ink.brush.Brush
import androidx.ink.brush.StockBrushes
import androidx.ink.strokes.StrokeInput
import com.sharathchenna.shelf.data.Ink
import com.sharathchenna.shelf.data.InkStroke
import com.sharathchenna.shelf.ui.theme.hex

/** A drawing in progress, in screen pixels. Turned into a saved [Ink] once it's placed. */
class InkDraft {
    val strokes = mutableStateListOf<InkStroke>()

    val isEmpty: Boolean get() = strokes.isEmpty()

    fun undo() {
        if (strokes.isNotEmpty()) strokes.removeAt(strokes.lastIndex)
    }

    /** Rubs out every stroke passing within `radius` of a point, as an eraser takes a whole line at a time. */
    fun erase(x: Float, y: Float, radius: Float) {
        strokes.removeAll { s ->
            val p = s.points
            var hit = false
            var i = 0
            // The distance to each segment of the line, not only its points: a quick stroke has few.
            while (!hit && i + 1 < p.size) {
                val ax = p[i].toFloat(); val ay = p[i + 1].toFloat()
                val bx = if (i + 4 < p.size) p[i + 3].toFloat() else ax
                val by = if (i + 4 < p.size) p[i + 4].toFloat() else ay
                val dx = bx - ax; val dy = by - ay
                val len = dx * dx + dy * dy
                val t = if (len == 0f) 0f else (((x - ax) * dx + (y - ay) * dy) / len).coerceIn(0f, 1f)
                val cx = ax + t * dx - x; val cy = ay + t * dy - y
                hit = cx * cx + cy * cy <= radius * radius
                i += 3
            }
            hit
        }
    }

    /** The bounds of everything drawn, as left, top, right, bottom in screen pixels. */
    fun bounds(): FloatArray? {
        if (strokes.isEmpty()) return null
        var l = Float.MAX_VALUE; var t = Float.MAX_VALUE; var r = -Float.MAX_VALUE; var b = -Float.MAX_VALUE
        for (s in strokes) {
            var i = 0
            while (i + 1 < s.points.size) {
                val x = s.points[i].toFloat(); val y = s.points[i + 1].toFloat()
                l = minOf(l, x); t = minOf(t, y); r = maxOf(r, x); b = maxOf(b, y)
                i += 3
            }
        }
        return floatArrayOf(l, t, r, b)
    }

    /**
     * The drawing in a box's own units: points moved so `originX, originY` (screen pixels) is the
     * box's corner, and divided by `unit` (screen pixels per box unit).
     */
    fun toInk(place: String, originX: Float, originY: Float, unit: Float, size: List<Double>): Ink = Ink(
        place = place,
        size = size,
        strokes = strokes.map { s ->
            InkStroke(
                color = s.color,
                width = s.width / unit,
                points = s.points.mapIndexed { i, v ->
                    when (i % 3) {
                        0 -> (v - originX) / unit
                        1 -> (v - originY) / unit
                        else -> v
                    }
                },
            )
        },
    )
}

/**
 * A sheet of glass for the stylus: wet ink from androidx.ink while the pen is down (drawn ahead of
 * the frame, at 144Hz on the tablet), kept as plain strokes once it lifts. Strokes made with a
 * finger are ignored when `penOnly`, so the hand resting on the screen doesn't draw. The pen's
 * eraser end, the pen with its button held, or anything while `erasing`, rubs strokes out instead.
 */
@Composable
fun InkCanvas(draft: InkDraft, color: String, widthDp: Float, penOnly: Boolean, modifier: Modifier = Modifier, erasing: Boolean = false) {
    val density = LocalDensity.current.density
    val width = widthDp * density
    val brush = remember(color, width) {
        Brush.createWithColorIntArgb(StockBrushes.pressurePen(), hex(color).toArgb(), width, 0.1f)
    }
    val radius = 14 * density
    // androidx.ink leaves alone any pointer already consumed, so the palm (and fingers), and the
    // eraser, are taken here first, before the ink sees them.
    val hands = Modifier.pointerInput(penOnly, erasing) {
        awaitPointerEventScope {
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                val button = event.buttons.isPrimaryPressed || event.buttons.isSecondaryPressed
                event.changes.forEach { c ->
                    val rubbing = c.type == PointerType.Eraser || (c.type == PointerType.Stylus && button) || (erasing && (c.type != PointerType.Touch || !penOnly))
                    when {
                        rubbing -> { if (c.pressed) draft.erase(c.position.x, c.position.y, radius); c.consume() }
                        penOnly && c.type == PointerType.Touch -> c.consume()
                    }
                }
            }
        }
    }
    Box(modifier.fillMaxSize().then(hands)) {
        Canvas(Modifier.fillMaxSize()) { draft.strokes.forEach { drawInk(Ink("screen", listOf(1.0, 1.0), strokes = listOf(it)), 1f) } }
        InProgressStrokes(defaultBrush = brush, onStrokesFinished = { finished ->
            for (stroke in finished) {
                val input = StrokeInput()
                val points = ArrayList<Double>(stroke.inputs.size * 3)
                for (i in 0 until stroke.inputs.size) {
                    stroke.inputs.populate(i, input)
                    points += input.x.toDouble()
                    points += input.y.toDouble()
                    points += (if (input.pressure < 0) 0.5f else input.pressure).toDouble()
                }
                draft.strokes += InkStroke(color = color, width = width.toDouble(), points = points)
            }
        })
    }
}
