package com.sharathchenna.shelf.data

import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Instant

/**
 * The app's one way to the library: the site when it can be reached, the device when it can't.
 * Reading changes (highlights, drawings, places) are written here first and sent by [sync], so
 * they're never lost to a dropped connection; the site merges them, newer winning.
 */
class Shelf(private val context: Context, val api: ShelfApi, val tokens: TokenStore, private val db: LocalDb) {
    private val libraryFile = File(context.filesDir, "library.json")
    private val _library = MutableStateFlow<Library?>(null)

    /** The library as last fetched (kept on the device), or null before the first fetch. */
    val library: StateFlow<Library?> = _library.asStateFlow()

    val signedIn: Flow<Boolean> = tokens.signedIn
    val downloads: Flow<Map<String, DownloadRow>> = db.downloads().all().map { rows -> rows.associateBy { it.bookId } }

    private val syncing = Mutex()

    // ---- signing in ------------------------------------------------------------------------

    suspend fun signIn(password: String) {
        val name = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
        tokens.save(api.signIn(password, name))
        refreshLibrary()
    }

    suspend fun signOut() {
        api.signOut()
        forget()
    }

    /** Signed out on the site, or here: nothing of the owner's stays on the device. */
    suspend fun forget() = withContext(Dispatchers.IO) {
        tokens.clear()
        db.clearAllTables()
        libraryFile.delete()
        File(context.filesDir, "books").deleteRecursively()
        _library.value = null
    }

    // ---- the library -----------------------------------------------------------------------

    /** Loads the copy on the device, so the shelf shows at once. */
    suspend fun loadCached() = withContext(Dispatchers.IO) {
        if (_library.value == null && libraryFile.exists()) {
            _library.value = runCatching { ShelfJson.decodeFromString<Library>(libraryFile.readText()) }.getOrNull()
        }
    }

    /** Fetches the library if it changed (the site answers 304 otherwise). */
    suspend fun refreshLibrary() = withContext(Dispatchers.IO) {
        loadCached()
        val etag = if (_library.value != null) tokens.libraryEtag() else null
        val fresh = api.library(etag) ?: return@withContext
        val (json, tag) = fresh
        _library.value = ShelfJson.decodeFromString<Library>(json)
        libraryFile.writeText(json)
        tokens.setLibraryEtag(tag)
    }

    fun book(id: String): ShelfBook? = _library.value?.books?.find { it.id == id }
    fun file(id: String): LibraryFile? = _library.value?.files?.find { it.id == id }
    fun item(id: String): Item? = _library.value?.items?.find { it.id == id }
    fun clip(id: String): Clip? = _library.value?.clips?.find { it.id == id }

    // ---- opening a book --------------------------------------------------------------------

    /** A book ready to read: its file on the device (downloaded if it isn't yet), its place and highlights. */
    data class Opened(val file: LibraryFile, val path: File, val progress: Progress?, val original: String?)

    suspend fun open(fileId: String, progress: (Float) -> Unit = {}): Opened = withContext(Dispatchers.IO) {
        val local = db.downloads().get(fileId)?.takeIf { File(it.path).exists() }
        val remote = runCatching { api.openBook(fileId) }
        val opened = remote.getOrNull()
        if (opened == null && local == null) throw remote.exceptionOrNull()!!
        val file = opened?.book ?: file(fileId) ?: throw ApiException(404, "This book isn't on the device.")
        val path = local?.let { File(it.path) } ?: run {
            val into = bookFile(file)
            api.download(opened!!.fileUrl, into, progress)
            db.downloads().upsert(DownloadRow(file.id, into.path, file.format ?: "epub", into.length(), file.title, System.currentTimeMillis()))
            into
        }
        // With the markers of removed ones, so a highlight removed on another device goes here too.
        if (opened != null) mergeRemoteNotes(fileId, runCatching { api.notes(fileId) }.getOrDefault(opened.notes))
        val place = newerProgress(fileId, opened?.progress)
        Opened(file, path, place, opened?.original)
    }

    private fun bookFile(file: LibraryFile) = File(File(context.filesDir, "books").apply { mkdirs() }, "${file.id}.${file.format ?: "epub"}")

    /** Keeps a book on the device to read offline. */
    suspend fun download(fileId: String, progress: (Float) -> Unit = {}) {
        open(fileId, progress)
    }

    suspend fun removeDownload(fileId: String) = withContext(Dispatchers.IO) {
        db.downloads().get(fileId)?.let { File(it.path).delete() }
        db.downloads().remove(fileId)
    }

    // ---- highlights ------------------------------------------------------------------------

    /** A book's highlights, drawings and notes as the device has them, removed ones left out. */
    fun notes(bookId: String): Flow<List<Highlight>> = db.notes().watch(bookId).map { rows ->
        rows.map { ShelfJson.decodeFromString<Highlight>(it.json) }.filterNot { it.isDeleted }.sortedWith(compareBy({ it.sectionIndex }, { it.progression ?: 0.0 }, { it.createdAt }))
    }

    /** Adds, changes or (with `deleted`) removes a highlight; it's sent to the site on the next sync. */
    suspend fun saveNote(bookId: String, note: Highlight) {
        val changed = note.copy(updatedAt = Instant.now().toString())
        db.notes().upsert(listOf(NoteRow(bookId, changed.id, ShelfJson.encodeToString(Highlight.serializer(), changed), changed.changedAt, dirty = true)))
        Sync.soon(context)
    }

    suspend fun removeNote(bookId: String, note: Highlight) = saveNote(bookId, note.copy(deleted = true))

    /** Takes the site's copies, keeping any newer change made here that hasn't been sent. */
    private suspend fun mergeRemoteNotes(bookId: String, remote: List<Highlight>) {
        val mine = db.notes().forBook(bookId).associateBy { it.id }
        val rows = remote.mapNotNull { note ->
            val kept = mine[note.id]
            if (kept != null && kept.dirty && kept.changedAt >= note.changedAt) null
            else NoteRow(bookId, note.id, ShelfJson.encodeToString(Highlight.serializer(), note), note.changedAt, dirty = false)
        }
        db.notes().upsert(rows)
    }

    // ---- where the owner is ----------------------------------------------------------------

    suspend fun saveProgress(bookId: String, progress: Progress) {
        val stamped = progress.copy(updatedAt = Instant.now().toString())
        db.progress().upsert(ProgressRow(bookId, ShelfJson.encodeToString(Progress.serializer(), stamped), stamped.updatedAt, dirty = true))
        Sync.soon(context)
    }

    /** The newer of the device's place and the site's. */
    private suspend fun newerProgress(bookId: String, remote: Progress?): Progress? {
        val local = db.progress().get(bookId)?.let { ShelfJson.decodeFromString<Progress>(it.json) }
        return listOfNotNull(local, remote).maxByOrNull { it.updatedAt }
    }

    // ---- sharing links ---------------------------------------------------------------------

    /** Saves a shared link; offline, it's kept and sent on the next sync. Returns what to tell the owner. */
    suspend fun capture(text: String): String = try {
        api.capture(text)
    } catch (error: ApiException) {
        if (error.status in 400..499) throw error
        db.shares().add(ShareRow(System.currentTimeMillis(), text))
        Sync.soon(context)
        "Saved for later: it'll go to the shelf when you're back online."
    } catch (_: Exception) {
        db.shares().add(ShareRow(System.currentTimeMillis(), text))
        Sync.soon(context)
        "Saved for later: it'll go to the shelf when you're back online."
    }

    // ---- syncing ---------------------------------------------------------------------------

    /**
     * A change the site turned down (a book since deleted, a malformed note) would be refused
     * again on every sync and hold up the rest; it's let go, and logged. Anything else (offline,
     * the site down, signed out) is thrown, so the sync is tried again later.
     */
    private suspend fun <T> rejectable(send: suspend () -> T): T? = try {
        send()
    } catch (error: ApiException) {
        if (error.status !in 400..499 || error.status == 401) throw error
        android.util.Log.w("Shelf", "The site refused a change: ${error.message}")
        null
    }

    /** Sends everything changed on the device, then fetches the library if it changed. */
    suspend fun sync() = syncing.withLock {
        if (tokens.token() == null) return@withLock
        withContext(Dispatchers.IO) {
            for (share in db.shares().all()) {
                runCatching { api.capture(share.text) }.onSuccess { db.shares().remove(share.at) }.onFailure { if (it is ApiException && it.status in 400..499) db.shares().remove(share.at) }
            }
            for ((bookId, rows) in db.notes().dirty().groupBy { it.bookId }) {
                val changes = rows.map { ShelfJson.decodeFromString<Highlight>(it.json) }
                val merged = rejectable { api.sendNotes(bookId, changes) }
                rows.forEach { db.notes().sent(it.bookId, it.id, it.changedAt) }
                merged?.let { mergeRemoteNotes(bookId, it) }
            }
            for (row in db.progress().dirty()) {
                rejectable { api.sendProgress(row.bookId, ShelfJson.decodeFromString(row.json)) }
                db.progress().sent(row.bookId, row.updatedAt)
            }
            refreshLibrary()
            com.sharathchenna.shelf.widget.ReadingWidget.refresh(context)
        }
    }
}
