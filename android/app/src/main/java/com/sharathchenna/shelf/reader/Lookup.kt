package com.sharathchenna.shelf.reader

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.mikepenz.markdown.m3.Markdown
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.openExternal
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.encodeURLPathPart
import io.ktor.http.encodeURLQueryComponent
import io.ktor.http.isSuccess
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import com.sharathchenna.shelf.data.ShelfJson

/*
 * A word held down, looked up as Readwise Reader does: what it means here (Claude, from the text
 * around it), what an encyclopedia says (Wikipedia), and in another language; with Highlight and
 * Copy beside. A card over the foot of the page, not a sheet: the selection stays, its handles can
 * still be dragged, and once it's more than a word the card goes and the menu is left.
 */

/** A single word selected, where it is in the book, and whether it's low on the screen (the card goes above it then). */
data class Lookup(val word: String, val sectionIndex: Int, val fraction: Double, val low: Boolean = true)

/** Whether a selection is a single word (or a hyphenated one), to look up rather than highlight. */
fun isSingleWord(text: String): Boolean {
    val t = text.trim()
    return t.isNotEmpty() && t.length <= 40 && !t.any { it.isWhitespace() }
}

private enum class LookupTab(val label: String) { Define("Define"), Wikipedia("Lookup"), Translate("Translate") }

/** The languages offered for Translate; the last chosen is kept. */
private val LANGUAGES = listOf("English", "Hindi", "Telugu", "Spanish", "French", "German", "Japanese")

@Composable
fun LookupCard(lookup: Lookup, bookId: String, onHighlight: () -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val paper = LocalPaper.current
    val context = LocalContext.current
    var tab by rememberSaveable { mutableStateOf(LookupTab.Define) }
    val prefs = remember { context.getSharedPreferences("lookup", Context.MODE_PRIVATE) }
    var language by remember { mutableStateOf(prefs.getString("language", "English")!!) }
    Column(
        modifier.widthIn(max = 620.dp).fillMaxWidth().shadow(14.dp, RoundedCornerShape(22.dp)).background(paper.raised, RoundedCornerShape(22.dp)).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).clip(CircleShape).background(paper.sunk.copy(alpha = 0.7f)).padding(4.dp)) {
                LookupTab.entries.forEach { t ->
                    val on = t == tab
                    Box(
                        Modifier.weight(1f).clip(CircleShape).background(if (on) paper.bg else Color.Transparent).clickable { tab = t }.padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(t.label, fontFamily = Sans, fontWeight = FontWeight(if (on) 600 else 500), fontSize = 14.sp, color = if (on) paper.fg else paper.muted) }
                }
            }
            Spacer(Modifier.width(10.dp))
            Icon(Icons.Outlined.Close, "Close", tint = paper.muted, modifier = Modifier.size(34.dp).clip(CircleShape).clickable(onClick = onClose).padding(7.dp))
        }
        Column(Modifier.heightIn(min = 70.dp, max = 260.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when (tab) {
                LookupTab.Define -> {
                    Text(lookup.word, fontFamily = Serif, fontWeight = FontWeight(550), fontSize = 20.sp, color = paper.fg)
                    Answer(bookId, lookup, "define", null)
                }
                LookupTab.Wikipedia -> Encyclopedia(lookup.word)
                LookupTab.Translate -> {
                    androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        LANGUAGES.forEach { l ->
                            val on = l == language
                            Text(
                                l, fontFamily = Sans, fontSize = 13.sp, color = if (on) paper.bg else paper.fg,
                                modifier = Modifier.clip(CircleShape).background(if (on) paper.fg else Color.Transparent).border(1.dp, if (on) paper.fg else paper.rule, CircleShape)
                                    .clickable { language = l; prefs.edit().putString("language", l).apply() }.padding(horizontal = 12.dp, vertical = 6.dp),
                            )
                        }
                    }
                    Answer(bookId, lookup, "translate", language)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CardButton("Highlight", Icons.Outlined.Edit, onHighlight)
            CardButton("Copy", Icons.Outlined.ContentCopy) {
                (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(lookup.word, lookup.word))
                onClose()
            }
        }
    }
}

@Composable
private fun CardButton(label: String, icon: ImageVector, onClick: () -> Unit) {
    val paper = LocalPaper.current
    Row(
        Modifier.clip(CircleShape).border(1.dp, paper.rule, CircleShape).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, Modifier.size(16.dp), tint = paper.fg)
        Spacer(Modifier.width(6.dp))
        Text(label, fontFamily = Sans, fontWeight = FontWeight(500), fontSize = 14.sp, color = paper.fg)
    }
}

/** Claude's answer for Define or Translate, streamed from the reader's explain route with the text around the word. */
@Composable
private fun Answer(bookId: String, lookup: Lookup, action: String, language: String?) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    var answer by remember(lookup, action, language) { mutableStateOf("") }
    var error by remember(lookup, action, language) { mutableStateOf<String?>(null) }
    LaunchedEffect(lookup, action, language) {
        val body = buildJsonObject {
            put("bookId", bookId); put("sectionIndex", lookup.sectionIndex); put("sectionFraction", lookup.fraction); put("selection", lookup.word); put("action", action)
            language?.let { put("language", it) }
        }
        runCatching { shelf.api.stream("/api/reader/explain", body).collect { answer = it } }.onFailure { error = it.message ?: "Couldn't reach the server." }
    }
    when {
        error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, fontSize = 14.sp)
        answer.isEmpty() -> Thinking()
        else -> Markdown(answer)
    }
    if (answer.isEmpty() && error == null) Text("Reading the text around it…", fontFamily = Sans, fontSize = 13.sp, color = paper.faint)
}

/** What Wikipedia says about a word: its article's summary (the first found by search when the word itself isn't a title). */
@Composable
private fun Encyclopedia(word: String) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val context = LocalContext.current
    var found by remember(word) { mutableStateOf<WikiSummary?>(null) }
    var state by remember(word) { mutableStateOf("loading") }
    LaunchedEffect(word) {
        val summary = runCatching { wikiSummary(shelf.api.http, word) }.getOrNull()
        found = summary
        state = if (summary == null) "none" else "found"
    }
    when (state) {
        "loading" -> Thinking()
        "none" -> Text("Wikipedia has nothing on “$word”.", fontFamily = Sans, fontSize = 14.sp, color = paper.muted)
        else -> found?.let { w ->
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(w.title, fontFamily = Serif, fontWeight = FontWeight(550), fontSize = 20.sp, color = paper.fg)
                    w.description?.let { Text(it, fontFamily = Sans, fontSize = 13.sp, color = paper.muted) }
                    Text(w.extract, style = MaterialTheme.typography.bodyMedium, color = paper.fg)
                    w.url?.let { url ->
                        Row(Modifier.clip(CircleShape).clickable { openExternal(context, url) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Read on Wikipedia", fontFamily = Sans, fontWeight = FontWeight(500), fontSize = 13.sp, color = paper.accent)
                            Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.padding(start = 4.dp).size(14.dp), tint = paper.accent)
                        }
                    }
                }
                w.thumbnail?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.size(84.dp).clip(RoundedCornerShape(10.dp))) }
            }
        }
    }
}

private data class WikiSummary(val title: String, val description: String?, val extract: String, val thumbnail: String?, val url: String?)

private const val WIKI = "https://en.wikipedia.org"
/** Wikipedia asks API callers to say who they are. */
private const val AGENT = "Shelf/1.0 (personal reading app)"

private suspend fun wikiSummary(http: io.ktor.client.HttpClient, word: String): WikiSummary? {
    suspend fun summary(title: String): WikiSummary? {
        val res = http.get("$WIKI/api/rest_v1/page/summary/${title.replace(' ', '_').encodeURLPathPart()}") { header("User-Agent", AGENT) }
        if (!res.status.isSuccess()) return null
        val o = ShelfJson.parseToJsonElement(res.bodyAsText()).jsonObject
        val url = o["content_urls"]?.jsonObject?.get("desktop")?.jsonObject?.get("page")?.jsonPrimitive?.contentOrNull
        // A word with many meanings has a page listing them: said so, with the way there.
        if (o["type"]?.jsonPrimitive?.contentOrNull == "disambiguation") {
            val name = o["title"]?.jsonPrimitive?.contentOrNull ?: title
            return WikiSummary(name, "Several meanings", "Wikipedia lists a number of things called “$name”; open the list to find the one meant here.", null, url)
        }
        val extract = o["extract"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return null
        return WikiSummary(
            title = o["title"]?.jsonPrimitive?.contentOrNull ?: title,
            description = o["description"]?.jsonPrimitive?.contentOrNull,
            extract = extract,
            thumbnail = o["thumbnail"]?.jsonObject?.get("source")?.jsonPrimitive?.contentOrNull,
            url = url,
        )
    }
    val clean = word.trim().trim('“', '”', '"', '\'', '‘', '’', '.', ',', ';', ':', '!', '?', '(', ')')
    summary(clean)?.let { return it }
    val search = http.get("$WIKI/w/rest.php/v1/search/title?q=${clean.encodeURLQueryComponent()}&limit=1") { header("User-Agent", AGENT) }
    if (!search.status.isSuccess()) return null
    val first = ShelfJson.parseToJsonElement(search.bodyAsText()).jsonObject["pages"]?.jsonArray?.firstOrNull()?.jsonObject ?: return null
    return first["key"]?.jsonPrimitive?.contentOrNull?.let { summary(it) }
}
