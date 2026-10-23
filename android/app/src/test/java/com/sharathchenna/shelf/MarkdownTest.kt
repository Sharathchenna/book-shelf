package com.sharathchenna.shelf

import com.sharathchenna.shelf.data.Highlight
import com.sharathchenna.shelf.data.NotesMeta
import com.sharathchenna.shelf.data.notesFileName
import com.sharathchenna.shelf.data.notesMarkdown
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownTest {
    private val meta = NotesMeta(title = "Walden", author = "Henry David Thoreau", sections = listOf("Economy", "Where I Lived"))

    @Test fun `notes come out as the site writes them, in reading order`() {
        val md = notesMarkdown(
            meta,
            listOf(
                Highlight(id = "b", text = "I went to the woods", sectionIndex = 1, color = "green", note = "Why he went", createdAt = "2026-10-02T10:00:00Z"),
                Highlight(id = "a", text = "The mass of men\nlead lives", sectionIndex = 0, createdAt = "2026-10-01T10:00:00Z"),
                Highlight(id = "c", text = "gone", sectionIndex = 0, createdAt = "2026-10-03T10:00:00Z", deleted = true),
            ),
        )
        val expected = listOf(
            "---", "title: \"Walden\"", "author: \"Henry David Thoreau\"", "type: book", "highlights: 2", "updated: 2026-10-02", "tags: [reading]", "---", "",
            "# Walden", "", "*Henry David Thoreau*", "",
            "## Economy", "", "> The mass of men", "> lead lives", "", "<small>yellow · 2026-10-01</small>", "",
            "## Where I Lived", "", "> I went to the woods", "", "Why he went", "", "<small>green · 2026-10-02</small>", "",
        ).joinToString("\n")
        assertEquals(expected, md)
        assertFalse(md.contains("gone"))
    }

    @Test fun `a file name every system takes`() {
        assertEquals("Build a Large Language Model (From Scratch).md", notesFileName("Build a Large Language Model (From Scratch)"))
        assertEquals("Why this matters.md", notesFileName("Why: this/matters?"))
        assertTrue(notesFileName("").startsWith("Untitled"))
    }
}
