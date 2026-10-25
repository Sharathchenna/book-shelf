package com.sharathchenna.shelf.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.sharathchenna.shelf.ink.inkSvg
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/** What the Markdown needs about a book besides its notes (lib/export.ts NotesMeta). */
@Serializable
data class NotesMeta(
    val title: String,
    val author: String? = null,
    /** book, paper, article or post. */
    val kind: String = "book",
    /** Where it came from: the paper, the article, or the book's Goodreads page. */
    val url: String? = null,
    /** Chapter (or page) titles, by section index. */
    val sections: List<String> = emptyList(),
)

@Serializable
data class ExportedBook(val meta: NotesMeta, val highlights: List<Highlight>)

@Serializable
data class Export(val books: List<ExportedBook>)

private fun yaml(s: String) = Json.encodeToString(String.serializer(), s)
private fun day(iso: String) = iso.take(10)
private fun pageOf(h: Highlight) = Regex("^page:(\\d+)").find(h.cfi)?.groupValues?.get(1)?.toIntOrNull() ?: 0

/**
 * Highlights and notes as Markdown, as the site writes them (lib/export.ts): one book's, in
 * reading order, with YAML front matter, ready for an Obsidian vault. A drawing goes in as SVG,
 * which Obsidian shows as it is, with its handwriting read as text beneath.
 */
fun notesMarkdown(meta: NotesMeta, highlights: List<Highlight>): String {
    val sorted = highlights.filter { !it.isDeleted }.sortedWith(compareBy<Highlight>({ it.sectionIndex }, { pageOf(it) }, { it.createdAt }))
    val out = mutableListOf<String>()
    out += "---"
    out += "title: ${yaml(meta.title)}"
    meta.author?.takeIf { it.isNotBlank() }?.let { out += "author: ${yaml(it)}" }
    out += "type: ${meta.kind}"
    meta.url?.let { out += "source: ${yaml(it)}" }
    out += "highlights: ${sorted.size}"
    if (sorted.isNotEmpty()) out += "updated: ${day(sorted.maxOf { it.createdAt })}"
    out += "tags: [reading]"
    out += "---"
    out += ""
    out += "# ${meta.title}"
    out += ""
    meta.author?.takeIf { it.isNotBlank() }?.let { out += "*$it*"; out += "" }
    var section = -1
    for (h in sorted) {
        if (h.sectionIndex != section) {
            section = h.sectionIndex
            meta.sections.getOrNull(section)?.takeIf { it.isNotBlank() }?.let { out += "## $it"; out += "" }
        }
        h.text.trim().split(Regex("\n+")).filter { it.isNotEmpty() }.forEach { out += "> $it" }
        out += ""
        h.ink?.let { ink ->
            out += inkSvg(ink, scale = if (ink.place == "page") 800.0 else 1.0)
            out += ""
            ink.recognized?.trim()?.takeIf { it.isNotEmpty() }?.let { out += "*Ink:* ${it.replace(Regex("\\s+"), " ")}"; out += "" }
        }
        h.note?.trim()?.takeIf { it.isNotEmpty() }?.let { out += it; out += "" }
        // Tags as Obsidian's own, so the vault finds them: #word, spaces made hyphens.
        if (h.tags.isNotEmpty()) { out += h.tags.joinToString(" ") { "#" + it.trim().replace(Regex("\\s+"), "-") }; out += "" }
        out += "<small>${h.color} · ${day(h.createdAt)}</small>"
        out += ""
    }
    if (sorted.isEmpty()) { out += "No highlights yet."; out += "" }
    return out.joinToString("\n")
}

/** A file name Obsidian (and every OS) accepts, from a title. */
fun notesFileName(title: String): String {
    val name = title.replace(Regex("""[\\/:*?"<>|#^\[\]]+"""), " ").replace(Regex("\\s+"), " ").take(120).trim()
    return "${name.ifEmpty { "Untitled" }}.md"
}

/**
 * The owner's Obsidian vault on this device: a folder they choose once (Android's folder picker,
 * the permission kept), and a "Shelf" folder in it with a Markdown file a book, written over each
 * time so the vault always has the latest.
 */
object Vault {
    private const val FOLDER = "Shelf"
    private fun prefs(context: Context) = context.getSharedPreferences("obsidian", Context.MODE_PRIVATE)

    fun folder(context: Context): Uri? = prefs(context).getString("tree", null)?.let(Uri::parse)
        ?.takeIf { uri -> context.contentResolver.persistedUriPermissions.any { it.uri == uri && it.isWritePermission } }

    fun choose(context: Context, tree: Uri) {
        context.contentResolver.takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        prefs(context).edit().putString("tree", tree.toString()).apply()
    }

    fun forget(context: Context) {
        folder(context)?.let { runCatching { context.contentResolver.releasePersistableUriPermission(it, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) } }
        prefs(context).edit().remove("tree").apply()
    }

    /** The vault's name as the picker showed it. */
    fun name(context: Context): String? = folder(context)?.let { DocumentsContract.getTreeDocumentId(it).substringAfterLast(':').substringAfterLast('/').ifEmpty { "Vault" } }

    /** Writes (or rewrites) `Shelf/<file>` in the vault. */
    suspend fun write(context: Context, file: String, markdown: String) = withContext(Dispatchers.IO) {
        val tree = folder(context) ?: error("Choose your Obsidian vault in Settings first.")
        val root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        val dir = child(context, tree, root, FOLDER) ?: DocumentsContract.createDocument(context.contentResolver, root, DocumentsContract.Document.MIME_TYPE_DIR, FOLDER)
            ?: error("Couldn't make the Shelf folder in the vault.")
        val doc = child(context, tree, dir, file) ?: DocumentsContract.createDocument(context.contentResolver, dir, "text/markdown", file)
            ?: error("Couldn't write $file in the vault.")
        context.contentResolver.openOutputStream(doc, "wt")!!.use { it.write(markdown.toByteArray()) }
    }

    /** A document in a folder of the tree, found by its name. */
    private fun child(context: Context, tree: Uri, parent: Uri, name: String): Uri? {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(parent))
        context.contentResolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
            while (c.moveToNext()) {
                // Some providers add ".md" to a file made as text/markdown, others don't.
                val shown = c.getString(1)
                if (shown == name || shown == name.removeSuffix(".md")) return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0))
            }
        }
        return null
    }
}
