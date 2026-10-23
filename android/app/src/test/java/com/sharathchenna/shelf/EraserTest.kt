package com.sharathchenna.shelf

import com.sharathchenna.shelf.data.InkStroke
import com.sharathchenna.shelf.ink.InkDraft
import org.junit.Assert.assertEquals
import org.junit.Test

class EraserTest {
    private fun line(y: Double) = InkStroke(color = "#000000", width = 2.0, points = listOf(0.0, y, 0.5, 100.0, y, 0.5))

    @Test fun `the eraser takes the strokes it touches and leaves the rest`() {
        val draft = InkDraft()
        draft.strokes += line(10.0)
        draft.strokes += line(200.0)
        draft.erase(100f, 14f, radius = 10f)
        assertEquals(listOf(200.0), draft.strokes.map { it.points[1] })
        // Between the line's two points, where only the segment passes.
        draft.erase(50f, 205f, radius = 10f)
        assertEquals(0, draft.strokes.size)
    }
}
