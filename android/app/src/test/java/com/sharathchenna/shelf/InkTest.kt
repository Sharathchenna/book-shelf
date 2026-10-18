package com.sharathchenna.shelf

import com.sharathchenna.shelf.data.InkStroke
import com.sharathchenna.shelf.ink.InkDraft
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class InkTest {
    @Test fun `a drawing moves to its box's corner and into the box's units`() {
        val draft = InkDraft()
        draft.strokes += InkStroke("#000000", width = 4.0, points = listOf(110.0, 220.0, 0.5, 130.0, 260.0, 0.8))
        assertArrayEquals(floatArrayOf(110f, 220f, 130f, 260f), draft.bounds(), 0.001f)
        val ink = draft.toInk("margin", originX = 100f, originY = 200f, unit = 2f, size = listOf(20.0, 40.0))
        assertEquals(listOf(5.0, 10.0, 0.5, 15.0, 30.0, 0.8), ink.strokes.single().points)
        assertEquals(2.0, ink.strokes.single().width, 0.0)
    }

    @Test fun `undo takes the last stroke`() {
        val draft = InkDraft()
        draft.strokes += InkStroke("#000000", 1.0, listOf(0.0, 0.0, 1.0))
        draft.strokes += InkStroke("#ff0000", 1.0, listOf(1.0, 1.0, 1.0))
        draft.undo()
        assertEquals("#000000", draft.strokes.single().color)
    }
}
