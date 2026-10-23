package com.sharathchenna.shelf.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.prepareGet
import io.ktor.client.request.preparePost
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File

/** A request the site turned down, with its own words for why. */
class ApiException(val status: Int, message: String) : Exception(message)

/** The stream marker the site ends an AI answer with when it failed (app/api/reader/stream.ts). */
const val AI_ERROR_MARKER = "\n[[ai-error]]"

val ShelfJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    // The site requires some fields even when empty (a highlight's or place's `cfi`).
    encodeDefaults = true
}

/**
 * The site's API, signed in as one of the owner's devices (app/api/auth/token). Every call
 * carries the device token; a 401 means it was signed out on the site, and the app forgets it.
 */
class ShelfApi(val siteUrl: String, private val token: suspend () -> String?, private val onSignedOut: suspend () -> Unit) {
    val http = HttpClient(OkHttp) {
        expectSuccess = false
        install(ContentNegotiation) { json(ShelfJson) }
        install(HttpTimeout) {
            connectTimeoutMillis = 15_000
            requestTimeoutMillis = 120_000
        }
        defaultRequest { url(siteUrl) }
    }

    private suspend fun HttpRequestBuilder.auth() {
        token()?.let { header(HttpHeaders.Authorization, "Bearer $it") }
    }

    private suspend fun check(res: HttpResponse): HttpResponse {
        if (res.status.isSuccess() || res.status == HttpStatusCode.NotModified) return res
        if (res.status == HttpStatusCode.Unauthorized) onSignedOut()
        val message = runCatching { ShelfJson.parseToJsonElement(res.bodyAsText()).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull()
        throw ApiException(res.status.value, message ?: "The site couldn't do that just now (error ${res.status.value}).")
    }

    // ---- signing in ------------------------------------------------------------------------

    suspend fun signIn(password: String, deviceName: String): SignIn =
        check(http.post("/api/auth/token") {
            contentType(ContentType.Application.Json)
            setBody(mapOf("password" to password, "name" to deviceName))
        }).body()

    suspend fun signOut() {
        runCatching { http.delete("/api/auth/token") { auth() } }
    }

    // ---- the library -----------------------------------------------------------------------

    /** The library, or null when it hasn't changed since the version tagged `etag`. */
    suspend fun library(etag: String?): Pair<String, String?>? {
        val res = check(http.get("/api/library") {
            auth()
            etag?.let { header(HttpHeaders.IfNoneMatch, it) }
        })
        if (res.status == HttpStatusCode.NotModified) return null
        return res.bodyAsText() to res.headers[HttpHeaders.ETag]
    }

    suspend fun openBook(id: String): BookOpen = check(http.get("/api/books/$id") { auth() }).body()

    /** Downloads a file (an R2 signed URL) to `into`, reporting progress from 0 to 1. */
    suspend fun download(url: String, into: File, progress: (Float) -> Unit = {}) {
        val part = File(into.path + ".part")
        http.prepareGet(url).execute { res ->
            if (!res.status.isSuccess()) throw ApiException(res.status.value, "Couldn't download the file.")
            val total = res.headers[HttpHeaders.ContentLength]?.toLongOrNull() ?: -1L
            val channel = res.bodyAsChannel()
            val buffer = ByteArray(64 * 1024)
            var read = 0L
            part.outputStream().use { out ->
                while (true) {
                    val n = channel.readAvailable(buffer)
                    if (n == -1) break
                    if (n == 0) continue
                    out.write(buffer, 0, n)
                    read += n
                    if (total > 0) progress((read.toFloat() / total).coerceIn(0f, 1f))
                }
            }
        }
        if (!part.renameTo(into)) throw ApiException(0, "Couldn't save the file.")
    }

    // ---- highlights and progress -----------------------------------------------------------

    @Serializable
    private data class Notes(val notes: List<Highlight>)

    @Serializable
    private data class Changes(val changes: List<Highlight>)

    @Serializable
    private data class SavedProgress(val progress: Progress)

    /** A book's highlights, with the markers of removed ones. */
    suspend fun notes(bookId: String): List<Highlight> = check(http.get("/api/books/$bookId/notes") { auth() }).body<Notes>().notes

    /** Sends changed highlights; the site merges them, newer winning, and answers with all of them. */
    suspend fun sendNotes(bookId: String, changes: List<Highlight>): List<Highlight> =
        check(http.post("/api/books/$bookId/notes") {
            auth()
            contentType(ContentType.Application.Json)
            setBody(Changes(changes))
        }).body<Notes>().notes

    suspend fun sendProgress(bookId: String, progress: Progress): Progress =
        check(http.put("/api/books/$bookId/progress") {
            auth()
            contentType(ContentType.Application.Json)
            setBody(progress)
        }).body<SavedProgress>().progress

    // ---- search, review, clippings ---------------------------------------------------------

    @Serializable
    private data class Results(val results: List<SearchResult> = emptyList())

    suspend fun search(query: String): List<SearchResult> =
        check(http.post("/api/search") {
            auth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("query" to query))
        }).body<Results>().results

    /** Every book with highlights, with what its Markdown needs (/api/export). */
    suspend fun export(): Export = check(http.get("/api/export") { auth() }).body()

    suspend fun review(today: Long): Review = check(http.get("/api/review") { auth(); parameter("today", today) }).body()

    @Serializable
    private data class Reviewed(val id: String, val fileId: String, val keep: Boolean, val today: Long)

    suspend fun reviewed(card: ReviewCard, keep: Boolean, today: Long) {
        check(http.post("/api/review") {
            auth()
            contentType(ContentType.Application.Json)
            setBody(Reviewed(card.id, card.fileId, keep, today))
        })
    }

    /** Saves a link as a clipping (/api/capture), answering in a sentence fit for a notification. */
    suspend fun capture(text: String): String {
        val res = http.post("/api/capture") {
            auth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("text" to text))
        }
        val reply = res.bodyAsText()
        if (!res.status.isSuccess()) throw ApiException(res.status.value, reply)
        return reply
    }

    // ---- the reader's AI -------------------------------------------------------------------

    /**
     * Streams an answer from one of the reader's AI routes (explain, recap, chat) as it's written.
     * Each emission is the whole answer so far. Throws when the site marks the answer as failed.
     */
    fun stream(path: String, body: JsonObject): Flow<String> = flow {
        http.preparePost(path) {
            auth()
            contentType(ContentType.Application.Json)
            setBody(body)
        }.execute { res ->
            check(res)
            val channel = res.bodyAsChannel()
            val text = StringBuilder()
            val buffer = ByteArray(4096)
            while (true) {
                val n = channel.readAvailable(buffer)
                if (n == -1) break
                if (n == 0) continue
                text.append(String(buffer, 0, n, Charsets.UTF_8))
                val sofar = text.toString()
                if (sofar.endsWith(AI_ERROR_MARKER.trim())) throw ApiException(0, "The answer didn't come through. Try again.")
                emit(sofar)
            }
        }
    }

    // ---- listening -------------------------------------------------------------------------

    suspend fun voices(bookId: String): List<VoiceCount> = check(http.get("/api/books/$bookId/audio") { auth() }).body<Voices>().voices

    suspend fun narrated(bookId: String, voice: String): List<NarratedSection> =
        check(http.get("/api/books/$bookId/audio") { auth(); parameter("voice", voice) }).body<NarratedSections>().sections

    suspend fun audio(bookId: String, section: Int, voice: String): AudioSection =
        check(http.get("/api/books/$bookId/audio/$section") { auth(); parameter("voice", voice) }).body()

    /** A URL on the site, absolute. */
    fun absolute(path: String): String = if (path.startsWith("http")) path else siteUrl.trimEnd('/') + path
}
