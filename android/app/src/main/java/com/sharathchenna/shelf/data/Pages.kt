package com.sharathchenna.shelf.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.request
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable

/**
 * A web page fetched on the tablet: Google's sites (and others behind bot checks) turn the site's
 * server away but not the owner's own connection. Asked as the tablet's browser asks, then sent
 * to the site, which reads it as if it had fetched it (/api/capture, /api/books/clips/source).
 */
@Serializable
data class SentPage(val html: String, val url: String)

/** The most of a page sent (lib/clip.ts's MAX_PAGE_CHARS). */
private const val MAX_PAGE_CHARS = 6_000_000

private const val BROWSER = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

suspend fun devicePage(http: HttpClient, url: String): SentPage? {
    val res = http.get(url) {
        header(HttpHeaders.UserAgent, BROWSER)
        header(HttpHeaders.Accept, "text/html,application/xhtml+xml")
        header(HttpHeaders.AcceptLanguage, "en")
    }
    if (!res.status.isSuccess() || res.headers[HttpHeaders.ContentType]?.contains("html") != true) return null
    val html = res.bodyAsText()
    if (html.isBlank() || html.length > MAX_PAGE_CHARS) return null
    return SentPage(html, res.request.url.toString())
}

/** The most of a picture fetched (app/api/books/clips/asset's MAX_BYTES). */
private const val MAX_PICTURE_BYTES = 20 * 1024 * 1024

/** A picture of an article, fetched on the tablet for its ebook (WebScreen.kt): its type and bytes. */
suspend fun devicePicture(http: HttpClient, url: String): Pair<String, ByteArray>? {
    if (!url.startsWith("https://")) return null
    val res = http.get(url) {
        header(HttpHeaders.UserAgent, BROWSER)
        header(HttpHeaders.Accept, "image/webp,image/png,image/jpeg,image/*;q=0.8")
    }
    val type = res.headers[HttpHeaders.ContentType]?.substringBefore(';')?.trim()
    if (!res.status.isSuccess() || type?.startsWith("image/") != true) return null
    val bytes = res.body<ByteArray>()
    return if (bytes.size > MAX_PICTURE_BYTES) null else type to bytes
}
