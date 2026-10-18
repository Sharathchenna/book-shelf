package com.sharathchenna.shelf.reader

import android.content.Context
import com.sharathchenna.shelf.data.Highlight
import com.sharathchenna.shelf.data.Quote
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.readium.adapter.pdfium.document.PdfiumDocumentFactory
import org.readium.r2.shared.publication.Link
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.util.asset.AssetRetriever
import org.readium.r2.shared.util.getOrElse
import org.readium.r2.shared.util.http.DefaultHttpClient
import org.readium.r2.shared.util.mediatype.MediaType
import org.readium.r2.streamer.PublicationOpener
import org.readium.r2.streamer.parser.DefaultPublicationParser
import java.io.File
import java.util.zip.ZipFile

/** A book opened with Readium, and how the site's section numbers map onto it. */
class OpenedBook(val publication: Publication, private val spine: List<String>, val isPdf: Boolean) {
    /** The site's titles for its sections, for when the book's own table of contents has none. */
    var titles: List<String> = emptyList()

    /** The reading-order link for one of the site's sections (an index into the full EPUB spine). */
    fun linkFor(sectionIndex: Int): Link? {
        if (isPdf) return publication.readingOrder.firstOrNull()
        val href = spine.getOrNull(sectionIndex) ?: return publication.readingOrder.getOrNull(sectionIndex)
        return publication.readingOrder.find { it.url().toString().substringBefore('#') == href }
    }

    /** The site's section number for a place in the book. */
    fun sectionOf(locator: Locator): Int {
        if (isPdf) return (locator.locations.position ?: 1) - 1
        val href = locator.href.toString().substringBefore('#')
        return spine.indexOf(href).takeIf { it >= 0 } ?: publication.readingOrder.indexOfFirst { it.url().toString() == href }.coerceAtLeast(0)
    }

    /** Where a highlight is, as Readium finds it: its section, and its text with a little either side. */
    fun locatorOf(note: Highlight): Locator? {
        if (isPdf) {
            val page = note.sectionIndex + 1
            val link = publication.readingOrder.firstOrNull() ?: return null
            return Locator(link.url(), link.mediaType ?: MediaType.PDF, locations = Locator.Locations(position = page))
        }
        val link = linkFor(note.sectionIndex) ?: return null
        return Locator(
            href = link.url(),
            mediaType = link.mediaType ?: MediaType.XHTML,
            locations = Locator.Locations(progression = note.progression),
            text = Locator.Text(before = note.quote?.before, highlight = note.text, after = note.quote?.after),
        )
    }

    /** The start of a section, `progression` of the way through it. */
    fun locatorAt(sectionIndex: Int, progression: Double?): Locator? {
        if (isPdf) {
            val link = publication.readingOrder.firstOrNull() ?: return null
            return Locator(link.url(), link.mediaType ?: MediaType.PDF, locations = Locator.Locations(position = sectionIndex + 1))
        }
        val link = linkFor(sectionIndex) ?: return null
        return publication.locatorFromLink(link)?.copy(locations = Locator.Locations(progression = progression ?: 0.0))
    }

    fun close() = publication.close()
}

/** The quote format the site keeps (lib/anchor.ts): 32 characters each side, whitespace collapsed. */
fun quoteOf(text: Locator.Text): Quote {
    val squash = { s: String? -> (s ?: "").replace(Regex("\\s+"), " ") }
    return Quote(before = squash(text.before).takeLast(32).trimStart(), after = squash(text.after).take(32).trimEnd())
}

/** Opens downloaded books with Readium: EPUBs, and PDFs through Pdfium. */
class BookOpener(context: Context) {
    private val http = DefaultHttpClient()
    private val assets = AssetRetriever(context.contentResolver, http)
    private val opener = PublicationOpener(DefaultPublicationParser(context, http, assets, PdfiumDocumentFactory(context)))

    suspend fun open(file: File, isPdf: Boolean): OpenedBook = withContext(Dispatchers.IO) {
        val asset = assets.retrieve(file, if (isPdf) MediaType.PDF else MediaType.EPUB).getOrElse { throw IllegalStateException("Couldn't read this file: ${it.message}") }
        val publication = opener.open(asset, allowUserInteraction = false).getOrElse { throw IllegalStateException("Couldn't open this book: ${it.message}") }
        OpenedBook(publication, if (isPdf) emptyList() else spineOf(file), isPdf)
    }

    /**
     * Every item in the EPUB's spine, in order, as paths from the root of the book. The site and
     * the web reader count every spine item, where Readium's reading order leaves out the ones
     * marked `linear="no"`; this is how the two numberings meet.
     */
    private fun spineOf(file: File): List<String> = runCatching {
        ZipFile(file).use { zip ->
            fun read(path: String) = zip.getEntry(path)?.let { e -> zip.getInputStream(e).bufferedReader().readText() }
            val container = read("META-INF/container.xml") ?: return emptyList()
            val opfPath = Regex("full-path\\s*=\\s*[\"']([^\"']+)").find(container)?.groupValues?.get(1) ?: return emptyList()
            val opf = read(opfPath) ?: return emptyList()
            val base = opfPath.substringBeforeLast('/', "").let { if (it.isEmpty()) "" else "$it/" }
            val attr = { tag: String, name: String -> Regex("\\b$name\\s*=\\s*[\"']([^\"']*)").find(tag)?.groupValues?.get(1) }
            val manifest = Regex("<item\\b[^>]*>").findAll(opf).mapNotNull { m ->
                val id = attr(m.value, "id") ?: return@mapNotNull null
                val href = attr(m.value, "href") ?: return@mapNotNull null
                id to java.net.URI(null, null, base + java.net.URLDecoder.decode(href, "UTF-8"), null).normalize().rawPath.removePrefix("/")
            }.toMap()
            Regex("<itemref\\b[^>]*>").findAll(opf).mapNotNull { m -> attr(m.value, "idref")?.let(manifest::get) }.toList()
        }
    }.getOrDefault(emptyList())
}
