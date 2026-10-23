package com.sharathchenna.shelf

import com.sharathchenna.shelf.data.Look
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.data.Topic
import com.sharathchenna.shelf.ui.library.AREA
import com.sharathchenna.shelf.ui.library.Sort
import com.sharathchenna.shelf.ui.library.lastName
import com.sharathchenna.shelf.ui.library.shelve
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ShelfLayoutTest {
    private val topics = listOf("ai", "history", "mind").associateWith { Topic(it, it.uppercase(), emptyList(), "") }
    private fun book(id: String, topic: String, w: Int = 50, h: Int = 220) =
        ShelfBook(id = id, kind = "book", title = id, author = "A", topic = topic, minutes = 10, look = Look("#000000", "#ffffff", false, "bands", w, h, 0.0))
    private val labelWidth = { label: String, icon: Boolean, count: Int -> (if (icon) 21f else 0f) + label.length * 7f + 6f + count.toString().length * 7f + 17f }

    @Test fun `books stand on the plank and a full shelf wraps`() {
        val books = (1..12).map { book("b$it", "ai") }
        val rows = shelve(books, width = 400f, sort = Sort.Topic, topics = topics, labelWidth = labelWidth)
        assertTrue(rows.size > 1)
        rows.forEach { row ->
            row.books.forEach { p -> assertEquals(AREA - p.book.look.h, p.y, 0.01f) }
            assertTrue(row.books.last().x + row.books.last().book.look.w <= 400f - 28f)
        }
        assertEquals(12, rows.sumOf { it.books.size })
    }

    @Test fun `labels on one shelf never overlap, and each run gets one`() {
        val books = listOf(book("a1", "ai"), book("h1", "history"), book("m1", "mind"))
        val rows = shelve(books, width = 1200f, sort = Sort.Topic, topics = topics, labelWidth = labelWidth)
        val labels = rows.flatMap { it.labels }
        assertEquals(listOf("ai", "history", "mind"), labels.map { it.key })
        rows.forEach { row ->
            row.labels.zipWithNext().forEach { (a, b) -> assertTrue(b.x >= a.x + labelWidth(a.label, a.icon != null, a.count)) }
        }
    }

    @Test fun `the surname at the foot of a spine`() {
        assertEquals("Isaacson", lastName("Walter Isaacson"))
        assertEquals("Vaswani", lastName("Ashish Vaswani et al."))
        assertEquals("karpathy", lastName("@karpathy"))
    }
}
