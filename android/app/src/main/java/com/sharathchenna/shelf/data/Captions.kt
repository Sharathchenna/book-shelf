package com.sharathchenna.shelf.data

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * A YouTube video's captions, fetched on the tablet: YouTube turns the site's server away ("confirm
 * you're not a bot") but not the owner's own connection. Asked as YouTube's Android app asks
 * (lib/media.ts does the same on the server), then sent to the site to keep (/api/media/[id]).
 */
@Serializable
data class Cue(val t: Double, val text: String)

@Serializable
data class VideoText(val transcript: List<Cue>, val description: String? = null, val seconds: Int? = null, val language: String? = null)

suspend fun youtubeCaptions(http: HttpClient, id: String): VideoText? {
    val res = http.post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false") {
        header("User-Agent", "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip")
        contentType(ContentType.Application.Json)
        setBody("""{"videoId":"$id","context":{"client":{"clientName":"ANDROID","clientVersion":"20.10.38","androidSdkVersion":34,"hl":"en"}}}""")
    }
    if (!res.status.isSuccess()) return null
    val player = ShelfJson.parseToJsonElement(res.bodyAsText()).jsonObject
    val details = player["videoDetails"]?.jsonObject
    val tracks = player["captions"]?.jsonObject?.get("playerCaptionsTracklistRenderer")?.jsonObject?.get("captionTracks")?.jsonArray?.map { it.jsonObject }.orEmpty()
    val english = { t: kotlinx.serialization.json.JsonObject -> t["languageCode"]?.jsonPrimitive?.contentOrNull?.let { it == "en" || it.startsWith("en-") } == true }
    val asr = { t: kotlinx.serialization.json.JsonObject -> t["kind"]?.jsonPrimitive?.contentOrNull == "asr" }
    // People's English captions first, then YouTube's own English, then anything.
    val track = tracks.find { english(it) && !asr(it) } ?: tracks.find(english) ?: tracks.find { !asr(it) } ?: tracks.firstOrNull()
    val cues = track?.get("baseUrl")?.jsonPrimitive?.contentOrNull?.let { url ->
        val xml = http.get(url).takeIf { it.status.isSuccess() }?.bodyAsText().orEmpty()
        Regex("""<p\b[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)</p>""").findAll(xml).mapNotNull { m ->
            val text = android.text.Html.fromHtml(m.groupValues[2].replace(Regex("<[^>]+>"), ""), android.text.Html.FROM_HTML_MODE_LEGACY).toString().replace(Regex("\\s+"), " ").trim()
            if (text.isEmpty() || Regex("^\\[[^\\]]+]$").matches(text)) null else Cue(m.groupValues[1].toLong() / 1000.0, text)
        }.toList()
    }.orEmpty()
    return VideoText(
        transcript = cues,
        description = details?.get("shortDescription")?.jsonPrimitive?.contentOrNull,
        seconds = details?.get("lengthSeconds")?.jsonPrimitive?.contentOrNull?.toIntOrNull(),
        language = track?.get("languageCode")?.jsonPrimitive?.contentOrNull,
    )
}
