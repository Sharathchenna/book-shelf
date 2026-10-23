package com.sharathchenna.shelf.ink

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import com.sharathchenna.shelf.data.Ink
import com.sharathchenna.shelf.ui.theme.hex
import kotlin.math.max

/*
 * Drawing a saved drawing: as SVG inside a Readium page (and the same way lib/ink.ts draws it
 * on the site), or straight onto a Compose canvas. Each stroke is a run of short segments, each
 * as wide as the pen was pressed there.
 */

private fun r(v: Double) = "%.3f".format(java.util.Locale.ROOT, v)

/** `scale` sizes the picture on its own (a PDF page's drawing is in units of the page's width). */
fun inkSvg(ink: Ink, scale: Double = 1.0): String {
    val (w, h) = ink.size[0] to ink.size[1]
    val parts = StringBuilder()
    for (s in ink.strokes) {
        val p = s.points
        if (p.size == 3) {
            parts.append("<circle cx=\"${r(p[0])}\" cy=\"${r(p[1])}\" r=\"${r(s.width * p[2].ifZero(0.5) / 2)}\" fill=\"${s.color}\"/>")
            continue
        }
        var i = 3
        while (i + 2 < p.size) {
            val width = s.width * max(0.15, ((p[i - 1] + p[i + 2]) / 2).ifZero(0.5))
            parts.append("<line x1=\"${r(p[i - 3])}\" y1=\"${r(p[i - 2])}\" x2=\"${r(p[i])}\" y2=\"${r(p[i + 1])}\" stroke=\"${s.color}\" stroke-width=\"${r(width)}\"/>")
            i += 3
        }
    }
    return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ${r(w)} ${r(h)}\" width=\"${r(w * scale)}\" height=\"${r(h * scale)}\" stroke-linecap=\"round\" fill=\"none\">$parts</svg>"
}

private fun Double.ifZero(v: Double) = if (this == 0.0) v else this

/** Draws a saved drawing scaled by `scale` (screen pixels per drawing unit), from `origin`. */
fun DrawScope.drawInk(ink: Ink, scale: Float, origin: Offset = Offset.Zero) {
    for (s in ink.strokes) {
        val color = hex(s.color)
        val p = s.points
        if (p.size == 3) {
            drawCircle(color, radius = (s.width * p[2].ifZero(0.5) / 2 * scale).toFloat(), center = origin + Offset(p[0].toFloat() * scale, p[1].toFloat() * scale))
            continue
        }
        var i = 3
        while (i + 2 < p.size) {
            val width = (s.width * max(0.15, ((p[i - 1] + p[i + 2]) / 2).ifZero(0.5)) * scale).toFloat()
            drawLine(
                color,
                origin + Offset(p[i - 3].toFloat() * scale, p[i - 2].toFloat() * scale),
                origin + Offset(p[i].toFloat() * scale, p[i + 1].toFloat() * scale),
                strokeWidth = width,
                cap = StrokeCap.Round,
            )
            i += 3
        }
    }
}
