package com.sharathchenna.shelf

import com.sharathchenna.shelf.data.Look
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.data.ShelfJson
import com.sharathchenna.shelf.data.Topic
import com.sharathchenna.shelf.ui.library.Sort
import com.sharathchenna.shelf.ui.library.fmtMinutes
import com.sharathchenna.shelf.ui.library.groupOf
import com.sharathchenna.shelf.ui.library.matches
import com.sharathchenna.shelf.ui.library.sortBooks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BookcaseTest {
    private val topics = listOf(Topic("ai", "AI", emptyList(), ""), Topic("history", "History", emptyList(), ""))
    private fun book(id: String, topic: String, added: Long, minutes: Int, hue: Double = 0.0) =
        ShelfBook(id = id, kind = "book", title = "Title $id", author = "Author", topic = topic, minutes = minutes, added = added, look = Look("#000000", "#ffffff", false, "bands", 40, 220, hue))

    @Test fun `sorts by topic order, then by when added`() {
        val books = listOf(book("b", "history", 1, 10), book("a", "ai", 2, 10), book("c", "ai", 1, 10))
        assertEquals(listOf("c", "a", "b"), sortBooks(books, Sort.Topic, topics).map { it.id })
    }

    @Test fun `sorts by colour, then height`() {
        val books = listOf(book("a", "ai", 1, 10, hue = 200.0), book("b", "ai", 1, 10, hue = 20.0))
        assertEquals(listOf("b", "a"), sortBooks(books, Sort.Colour, topics).map { it.id })
    }

    @Test fun `groups lengths as the site does`() {
        val byKey = topics.associateBy { it.key }
        assertEquals("quick", groupOf(book("a", "ai", 1, 9), Sort.Length, byKey)?.key)
        assertEquals("sitting", groupOf(book("a", "ai", 1, 29), Sort.Length, byKey)?.key)
        assertEquals("book", groupOf(book("a", "ai", 1, 600), Sort.Length, byKey)?.key)
        assertEquals(null, groupOf(book("a", "ai", 1, 600), Sort.Colour, byKey))
    }

    @Test fun `filters on every word typed`() {
        val byKey = topics.associateBy { it.key }
        assertTrue(matches(book("x", "history", 1, 10), "history title", byKey))
        assertFalse(matches(book("x", "history", 1, 10), "history ai", byKey))
    }

    @Test fun `formats minutes like the site`() {
        assertEquals("45 min", fmtMinutes(45))
        assertEquals("2 h 5 min", fmtMinutes(125))
        assertEquals("12 h", fmtMinutes(700))
    }

    @Test fun `reads the library endpoint's JSON, ignoring fields it doesn't know`() {
        val json = """{"updatedAt":"x","topics":[],"books":[{"id":"1","kind":"tweet","title":"t","author":"@a","topic":"ai","minutes":1,
            "look":{"color":"#000000","fg":"#ffffff","light":false,"style":"sans","w":30,"h":210,"hue":4},"somethingNew":true}],"items":[],"clips":[],"files":[]}"""
        val library = ShelfJson.decodeFromString<com.sharathchenna.shelf.data.Library>(json)
        assertEquals("tweet", library.books.single().kind)
    }
}
