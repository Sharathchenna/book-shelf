package com.sharathchenna.shelf.ui.library

import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.data.Topic
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * The bookcase's arranging, as lib/bookcase.ts does it on the site: four orders, the label over
 * each run of books, and the tags to filter by.
 */

enum class Sort(val label: String) { Topic("Topic"), Recent("Recent"), Colour("Colour"), Length("Length") }

fun sortBooks(books: List<ShelfBook>, sort: Sort, topics: List<Topic>): List<ShelfBook> {
    val order = topics.withIndex().associate { (i, t) -> t.key to i }
    return when (sort) {
        Sort.Topic -> books.sortedWith(compareBy({ order[it.topic] ?: 99 }, { it.added }))
        Sort.Recent -> books.sortedByDescending { it.added }
        Sort.Colour -> books.sortedWith(compareBy({ it.look.hue }, { it.look.h }))
        Sort.Length -> books.sortedBy { it.minutes }
    }
}

data class Group(val key: String, val label: String, val icon: String? = null)

private val month = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.UK).withZone(ZoneId.systemDefault())

/** The label over a run of books: a topic, a month or a length; none when sorted by colour. */
fun groupOf(book: ShelfBook, sort: Sort, topics: Map<String, Topic>): Group? = when (sort) {
    Sort.Topic -> Group(book.topic, topics[book.topic]?.name ?: book.topic, book.topic)
    Sort.Recent -> month.format(Instant.ofEpochMilli(book.added)).let { Group(it, it) }
    Sort.Length -> when {
        book.minutes < 10 -> Group("quick", "Under 10 min", "quick")
        book.minutes < 30 -> Group("sitting", "One sitting")
        book.minutes < 180 -> Group("evening", "An evening", "long")
        else -> Group("book", "A book", "reading")
    }
    Sort.Colour -> null
}

enum class Tag(val label: String, val icon: String?, val test: (ShelfBook) -> Boolean) {
    Reading("Reading now", "reading", { it.pct > 0 && it.pct < 1 }),
    Favourite("Favourites", "favorite", { it.favorite }),
    Finished("Finished", "finished", { it.pct >= 1 }),
    Quick("Under 10 min", "quick", { it.minutes < 10 }),
    Agent("From your phone or agent", "agent", { it.agent }),
    Books("Books", null, { it.kind == "book" }),
    Papers("Papers", null, { it.kind == "paper" }),
    Articles("Articles", null, { it.kind == "article" || it.kind == "newsletter" }),
    Posts("Tweets", null, { it.kind == "tweet" }),
}

/** Whether a book matches every word typed, against its title, author, topic, tags and year. */
fun matches(book: ShelfBook, query: String, topics: Map<String, Topic>): Boolean {
    val words = query.lowercase().trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (words.isEmpty()) return true
    val haystack = "${book.title} ${book.author} ${topics[book.topic]?.name ?: ""} ${book.tags.joinToString(" ")} ${book.year ?: ""}".lowercase()
    return words.all { it in haystack }
}

fun fmtMinutes(m: Int): String = when {
    m < 60 -> "$m min"
    m < 600 -> "${m / 60} h" + if (m % 60 != 0) " ${m % 60} min" else ""
    else -> "${Math.round(m / 60.0)} h"
}

val KIND_LABEL = mapOf("book" to "Book", "article" to "Article", "paper" to "Paper", "newsletter" to "Newsletter", "tweet" to "Tweet")
