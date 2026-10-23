package com.sharathchenna.shelf.data

import kotlinx.serialization.Serializable

/*
 * The site's data as the app sees it, mirroring the TypeScript types: ShelfBook and Look
 * (lib/bookcase.ts), Item and Clip (lib/types.ts), LibraryBook, Progress, Highlight and Ink
 * (lib/library-types.ts). Unknown fields are ignored, so the site can add to them freely.
 */

/** GET /api/library: everything on the bookcase, and what's behind each card. */
@Serializable
data class Library(
    /** The owner's name, for "<owner>'s library". */
    val owner: String? = null,
    val updatedAt: String = "",
    val topics: List<Topic> = emptyList(),
    val books: List<ShelfBook> = emptyList(),
    val items: List<Item> = emptyList(),
    val clips: List<Clip> = emptyList(),
    val files: List<LibraryFile> = emptyList(),
)

@Serializable
data class Topic(val key: String, val name: String, val shades: List<String>, val blurb: String)

/** One book or clipping as the bookcase draws it. `kind` is "book" or a clipping's kind. */
@Serializable
data class ShelfBook(
    val id: String,
    val kind: String,
    val title: String,
    val author: String,
    val year: Int? = null,
    val url: String? = null,
    val topic: String,
    val minutes: Int,
    val dek: String? = null,
    val tags: List<String> = emptyList(),
    val favorite: Boolean = false,
    val pct: Double = 0.0,
    val measured: Boolean = false,
    val highlights: Int = 0,
    val added: Long = 0,
    val image: String? = null,
    val photo: String? = null,
    val color: String? = null,
    val rating: Int? = null,
    val agent: Boolean = false,
    val fileId: String? = null,
    val readable: Boolean = false,
    val look: Look,
)

/** A spine: its cloth, the colour of its lettering, its style and its size in px. */
@Serializable
data class Look(
    val color: String,
    val fg: String,
    val light: Boolean,
    val style: String,
    val w: Int,
    val h: Int,
    val hue: Double,
)

/** A book from Goodreads. */
@Serializable
data class Item(
    val id: String,
    val title: String,
    val series: String? = null,
    val author: String,
    val year: Int? = null,
    val pages: Int? = null,
    val status: String,
    val rating: Int? = null,
    val dateRead: String? = null,
    val dateAdded: String? = null,
    val review: String? = null,
    val tags: List<String> = emptyList(),
    val subjects: List<String> = emptyList(),
    val category: String = "",
    val goodreadsId: String? = null,
    val cover: String? = null,
    val color: String = "#777777",
    val description: String? = null,
)

/** A clipping: an article, paper, newsletter issue or post. */
@Serializable
data class Clip(
    val id: String,
    val kind: String,
    val url: String,
    val title: String? = null,
    val author: String? = null,
    val source: String = "",
    val excerpt: String? = null,
    val image: String? = null,
    val published: String? = null,
    val saved: String,
    val minutes: Int? = null,
    val note: String? = null,
    val via: String? = null,
    val tags: List<String> = emptyList(),
    val paper: Paper? = null,
    val tweet: Tweet? = null,
    val xArticle: XArticle? = null,
    val enriched: Enrichment? = null,
) {
    @Serializable
    data class Paper(val authors: List<String> = emptyList(), val year: Int? = null, val arxiv: String? = null, val doi: String? = null, val pdf: String? = null)

    @Serializable
    data class Tweet(val name: String, val handle: String, val avatar: String? = null, val text: String, val media: List<String> = emptyList(), val likes: Int? = null)

    @Serializable
    data class XArticle(val handle: String, val avatar: String? = null)

    @Serializable
    data class Enrichment(val summary: String, val topics: List<String> = emptyList())

    /** What the site's reader can open (lib/clippings.ts readableClip). */
    val readable: Boolean get() = xArticle != null || kind == "article" || kind == "newsletter" || (kind == "paper" && paper?.pdf != null)
}

/** A file in the reader: an EPUB or PDF, with where the owner is in it. */
@Serializable
data class LibraryFile(
    val id: String,
    val format: String? = null,
    val title: String,
    val author: String,
    val paperId: String? = null,
    val clipId: String? = null,
    val shelfItemId: String? = null,
    val sections: List<Section> = emptyList(),
    val totalChars: Int = 0,
    val bytes: Long = 0,
    val addedAt: String = "",
    val progress: Progress? = null,
) {
    val isPdf: Boolean get() = format == "pdf"
}

@Serializable
data class Section(val title: String, val chars: Int = 0)

/**
 * Where the owner is in a book. The web reader saves a CFI; the app saves `cfi = ""` with
 * `progression` (through the section), which both readers can go to.
 */
@Serializable
data class Progress(
    val cfi: String = "",
    val fraction: Double = 0.0,
    val sectionIndex: Int = 0,
    val progression: Double? = null,
    val updatedAt: String = "",
)

/**
 * A highlight, note or drawing, in the format the web reader shares (lib/anchor.ts): found by
 * its text and quote in section `sectionIndex`, or on PDF page `sectionIndex + 1`.
 */
@Serializable
data class Highlight(
    val id: String,
    val cfi: String = "",
    val rects: List<List<Double>>? = null,
    val text: String,
    val quote: Quote? = null,
    val progression: Double? = null,
    val color: String = "yellow",
    val note: String? = null,
    val ink: Ink? = null,
    val sectionIndex: Int = 0,
    val createdAt: String,
    val updatedAt: String? = null,
    val deleted: Boolean? = null,
) {
    val changedAt: String get() = updatedAt ?: createdAt
    val isDeleted: Boolean get() = deleted == true
}

@Serializable
data class Quote(val before: String = "", val after: String = "")

/**
 * A stylus drawing. On a PDF page, points are in units of the page's width and `size` is
 * [1, height / width]; in an EPUB's margin, they're in the drawing's own box of `size`.
 */
@Serializable
data class Ink(
    val place: String,
    val size: List<Double>,
    /** In an EPUB's margin: where the drawing's box sits from its paragraph's corner. */
    val offset: List<Double>? = null,
    val strokes: List<InkStroke>,
    val recognized: String? = null,
)

/** Points as x, y, pressure triples. */
@Serializable
data class InkStroke(val color: String, val width: Double, val points: List<Double>)

@Serializable
data class BookOpen(
    val book: LibraryFile,
    val fileUrl: String,
    val progress: Progress? = null,
    val notes: List<Highlight> = emptyList(),
    val original: String? = null,
)

@Serializable
data class Device(val id: String, val name: String, val created: String)

@Serializable
data class SignIn(val token: String, val device: Device)

@Serializable
data class SearchResult(
    val id: String,
    val kind: String,
    val title: String,
    val subtitle: String = "",
    val image: String? = null,
    val href: String = "",
    val paperId: String? = null,
    val articleId: String? = null,
    val match: Double = 0.0,
)

@Serializable
data class Review(val done: Int = 0, val total: Int = 0, val deck: List<ReviewCard> = emptyList())

@Serializable
data class ReviewCard(
    val id: String,
    val fileId: String,
    val text: String,
    val note: String? = null,
    val color: String = "yellow",
    val title: String,
    val author: String = "",
)

/** A chapter read aloud: a short-lived MP3 URL and its sentences' timings. */
@Serializable
data class AudioSection(
    val section: Int,
    val voice: String,
    val duration: Double,
    val url: String,
    val lines: List<AudioLine> = emptyList(),
)

@Serializable
data class AudioLine(val start: Int, val end: Int, val text: String, val t0: Double, val t1: Double)

@Serializable
data class Voices(val voices: List<VoiceCount> = emptyList())

@Serializable
data class VoiceCount(val voice: String, val sections: Int)

@Serializable
data class NarratedSections(val sections: List<NarratedSection> = emptyList())

@Serializable
data class NarratedSection(val section: Int, val duration: Double)
