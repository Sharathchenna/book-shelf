package com.sharathchenna.shelf

import com.sharathchenna.shelf.reader.pdf.PageRect
import com.sharathchenna.shelf.reader.pdf.Stroke
import com.sharathchenna.shelf.reader.pdf.citationNear
import com.sharathchenna.shelf.reader.pdf.classify
import com.sharathchenna.shelf.reader.pdf.fractionsToPage
import com.sharathchenna.shelf.reader.pdf.pageToFractions
import com.sharathchenna.shelf.reader.pdf.paragraphs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

class PdfGeometryTest {
    @Test fun `highlights go to the site as fractions and come back the same`() {
        val rects = listOf(PageRect(100f, 200f, 300f, 212f), PageRect(72f, 214f, 500f, 226f))
        val fractions = pageToFractions(rects, 612f, 792f)
        assertEquals(2, fractions.size)
        assertEquals(100.0 / 612, fractions[0][0], 1e-6)
        val back = fractionsToPage(fractions, 612f, 792f)
        assertEquals(rects[1].right, back[1].right, 0.01f)
        assertEquals(rects[0].top, back[0].top, 0.01f)
    }

    @Test fun `runs of one line are merged into one rectangle, as the site does`() {
        val fractions = pageToFractions(listOf(PageRect(100f, 200f, 150f, 212f), PageRect(155f, 200f, 300f, 212f)), 612f, 792f)
        assertEquals(1, fractions.size)
        assertEquals(200.0 / 612, fractions[0][2], 1e-6)
    }

    private fun loop(cx: Float, cy: Float, rx: Float, ry: Float, n: Int = 60): Pair<FloatArray, FloatArray> =
        FloatArray(n) { cx + rx * cos(it * 2 * Math.PI / (n - 1)).toFloat() } to FloatArray(n) { cy + ry * sin(it * 2 * Math.PI / (n - 1)).toFloat() }

    @Test fun `a big loop is a loop, a letter o is ink`() {
        val (xs, ys) = loop(500f, 500f, 200f, 120f)
        assertTrue(classify(xs, ys, dp = 2f) is Stroke.Loop)
        val (lx, ly) = loop(500f, 500f, 14f, 14f)
        assertEquals(Stroke.Ink, classify(lx, ly, dp = 2f))
        // Out along a diagonal and back: its ends meet, but it holds nothing.
        val ox = FloatArray(40) { if (it < 20) 100f + it * 20f else 100f + (39 - it) * 20f }
        val oy = FloatArray(40) { if (it < 20) 100f + it * 12f else 100f + (39 - it) * 12f }
        assertEquals(Stroke.Ink, classify(ox, oy, dp = 2f))
    }

    @Test fun `a tall straight mark is a bracket, a scribble is ink`() {
        val ys = FloatArray(30) { 100f + it * 12f }
        val xs = FloatArray(30) { 80f + (it % 2) }
        assertTrue(classify(xs, ys, dp = 2f) is Stroke.Bracket)
        val zx = FloatArray(30) { if (it % 2 == 0) 80f else 180f }
        val zy = FloatArray(30) { 100f + it * 4f }
        assertEquals(Stroke.Ink, classify(zx, zy, dp = 2f))
    }

    @Test fun `lines become paragraphs, broken words mended`() {
        val p = paragraphs(listOf(
            "Attention is all you need, said the paper, and every-",
            "one believed it for a while afterwards, as people do.",
            "Short end.",
            "A new paragraph begins here and runs on across the",
            "line to its end.",
        ))
        assertEquals("Attention is all you need, said the paper, and everyone believed it for a while afterwards, as people do. Short end.", p[0])
        assertEquals(2, p.size)
    }

    @Test fun `a citation's number, from the words around a tap`() {
        assertEquals(12, citationNear("as shown in [12] the model"))
        assertEquals(3, citationNear("prior work [3, 7]"))
        assertEquals(4, citationNear("[4–6]"))
        assertNull(citationNear("no citation here"))
    }
}
