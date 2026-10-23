package com.sharathchenna.shelf.reader.pdf

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/*
 * The plain geometry of the PDF reader, kept apart from Android so it can be tested: a page's
 * highlights in the site's terms (app/components/reader/pdf-reader-view.tsx: each line of a
 * selection a rectangle of fractions of the page, [x, y, w, h]) and in the page's own points, and
 * what a pen stroke was meant as.
 */

/** A rectangle in a page's points, top-left origin. */
data class PageRect(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width get() = right - left
    val height get() = bottom - top
    fun contains(x: Float, y: Float, pad: Float = 0f) = x >= left - pad && x <= right + pad && y >= top - pad && y <= bottom + pad
}

/** The site's rectangles ([x, y, w, h], fractions of the page) as the page's points. */
fun fractionsToPage(rects: List<List<Double>>, pageWidth: Float, pageHeight: Float): List<PageRect> = rects.filter { it.size == 4 }.map { (x, y, w, h) ->
    PageRect((x * pageWidth).toFloat(), (y * pageHeight).toFloat(), ((x + w) * pageWidth).toFloat(), ((y + h) * pageHeight).toFloat())
}

/**
 * A selection's rectangles (the page's points) as the site keeps them: lines that are one line
 * (overlapping by half their height, near each other) merged, at most 300, as fractions.
 */
fun pageToFractions(rects: List<PageRect>, pageWidth: Float, pageHeight: Float): List<List<Double>> {
    val sorted = rects.filter { it.width > 0.5f && it.height > 0.5f }.sortedWith(compareBy({ it.top }, { it.left }))
    val merged = mutableListOf<PageRect>()
    for (r in sorted) {
        val last = merged.lastOrNull()
        val sameLine = last != null && min(last.bottom, r.bottom) - max(last.top, r.top) > 0.5f * min(last.height, r.height)
        if (last != null && sameLine && r.left - last.right < 12f) {
            merged[merged.lastIndex] = PageRect(min(last.left, r.left), min(last.top, r.top), max(last.right, r.right), max(last.bottom, r.bottom))
        } else merged += r
    }
    return merged.take(300).map {
        listOf((it.left / pageWidth).toDouble(), (it.top / pageHeight).toDouble(), (it.width / pageWidth).toDouble(), (it.height / pageHeight).toDouble())
    }
}

/** What a pen stroke on a PDF page was meant as, decided when the pen lifts. */
sealed interface Stroke {
    /** Writing or drawing: kept as ink. */
    data object Ink : Stroke
    /** A loop drawn around something: the text inside it, or the picture if there's little text. */
    data class Loop(val bounds: PageRect) : Stroke
    /** A tall bracket beside a passage: the lines it spans, on the side it opens to. */
    data class Bracket(val top: Float, val bottom: Float, val x: Float, val opensRight: Boolean) : Stroke
}

/**
 * Reads a stroke (x, y pairs in screen pixels) as a gesture, forgivingly: only a large, nearly
 * closed loop or a tall, narrow, nearly straight mark counts; anything else, letters included, is
 * ink. `dp` is the screen's pixels per dp, so the sizes hold at any density.
 */
fun classify(xs: FloatArray, ys: FloatArray, dp: Float): Stroke {
    val n = xs.size
    if (n < 8) return Stroke.Ink
    val l = xs.min(); val r = xs.max(); val t = ys.min(); val b = ys.max()
    val w = r - l; val h = b - t
    var length = 0f
    for (i in 1 until n) length += hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
    val gap = hypot(xs[n - 1] - xs[0], ys[n - 1] - ys[0])
    val diagonal = hypot(w, h)
    // The area the stroke encloses (shoelace): a loop holds most of its box, a line out and back holds none.
    var twice = 0f
    for (i in 0 until n) { val j = (i + 1) % n; twice += xs[i] * ys[j] - xs[j] * ys[i] }
    val area = abs(twice) / 2
    // A loop: big enough not to be a letter, its ends meeting, and going round rather than back and forth.
    if (w > 56 * dp && h > 40 * dp && gap < max(48 * dp, diagonal * 0.3f) && length > (w + h) * 1.3f && area > w * h * 0.4f) {
        return Stroke.Loop(PageRect(l, t, r, b))
    }
    // A bracket: tall, narrow, and nearly as long as it is tall (a straight mark, or a [ or ] shape).
    if (h > 64 * dp && w < h * 0.35f && length < h * 1.9f) {
        // A [ opens right: its ends lie right of its middle; a plain line opens towards the page's text, right by default.
        val middle = xs[n / 2]
        val ends = (xs[0] + xs[n - 1]) / 2
        return Stroke.Bracket(t, b, if (ends >= middle) r else l, opensRight = ends >= middle - 2 * dp)
    }
    return Stroke.Ink
}

/** Whether a stroke heads up or down the page rather than along it: the start of a scroll. */
fun isVertical(dx: Float, dy: Float) = abs(dy) > abs(dx) * 1.2f
