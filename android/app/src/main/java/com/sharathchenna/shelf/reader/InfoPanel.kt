package com.sharathchenna.shelf.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.sharathchenna.shelf.data.ShelfApi
import com.sharathchenna.shelf.data.TriageChange
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.library.KIND_LABEL
import com.sharathchenna.shelf.ui.library.Place
import com.sharathchenna.shelf.ui.library.faviconOf
import com.sharathchenna.shelf.ui.library.fmtMinutes
import com.sharathchenna.shelf.ui.library.hostOf
import com.sharathchenna.shelf.ui.library.savedOn
import com.sharathchenna.shelf.ui.openExternal
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * What's being read, as Readwise Reader's Info panel has it: its title and where it's from, what
 * it's about, when it was published and saved, how long it is, where it stands in the library,
 * the owner's note on the whole of it, and Edit metadata to put a wrong title or author right.
 */
@Composable
fun InfoPanel(fileId: String, onSummarize: (() -> Unit)?) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val library by shelf.library.collectAsState()
    val file = library?.files?.find { it.id == fileId }
    val book = library?.books?.find { it.fileId == fileId || it.id == fileId }
    val clip = book?.takeIf { it.kind != "book" }?.let { b -> library?.clips?.find { it.id == b.id } }
    var editing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // A Goodreads book is edited on Goodreads; anything else here.
    val editable = clip != null || (book != null && book.id == fileId)
    val savedNote = clip?.note ?: file?.note.orEmpty()
    var note by remember(savedNote) { mutableStateOf(savedNote) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp, vertical = 8.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(clip?.title ?: book?.title ?: file?.title.orEmpty(), fontFamily = Serif, fontWeight = FontWeight(500), fontSize = 24.sp, lineHeight = 30.sp, color = paper.fg)
            val url = book?.url
            Row(verticalAlignment = Alignment.CenterVertically) {
                faviconOf(url)?.takeIf { book?.kind != "book" }?.let { AsyncImage(it, null, Modifier.size(16.dp).clip(RoundedCornerShape(3.dp))); Spacer(Modifier.width(8.dp)) }
                Text(
                    listOfNotNull((clip?.author ?: book?.author ?: file?.author)?.takeIf { it.isNotBlank() }, clip?.source?.takeIf { it.isNotBlank() } ?: hostOf(url)).distinct().joinToString(" · "),
                    fontFamily = Sans, fontSize = 14.sp, color = paper.muted,
                )
            }
        }

        // Subscribe to where it's from, as Reader's Info offers: the site's feed, found for you.
        val host = hostOf(book?.url)?.takeIf { book?.kind != "book" && book?.kind != "tweet" }
        if (host != null) {
            val feeds by shelf.feed.collectAsState()
            val following = feeds?.feeds.orEmpty().any { f -> hostOf(f.site ?: f.url)?.removePrefix("www.") == host || hostOf(f.url) == host }
            var subscribing by remember { mutableStateOf(false) }
            var said by remember { mutableStateOf<String?>(null) }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedButton(enabled = !following && !subscribing, onClick = {
                    subscribing = true
                    scope.launch {
                        said = runCatching { shelf.subscribe(book!!.url!!) }.fold({ "Subscribed to ${it.title}: its new posts come to the Feed." }, { it.message ?: "Couldn't find its feed." })
                        subscribing = false
                    }
                }) { Text(if (following) "Subscribed to $host" else if (subscribing) "Finding its feed…" else "Subscribe to $host") }
                said?.let { Text(it, fontFamily = Sans, fontSize = 13.sp, color = paper.muted) }
            }
        }

        val about = book?.dek ?: clip?.excerpt ?: clip?.enriched?.summary
        if (about != null || onSummarize != null) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("SUMMARY", style = Eyebrow, color = paper.faint, modifier = Modifier.weight(1f))
                onSummarize?.let { Text("Brief", fontFamily = Sans, fontWeight = FontWeight(600), fontSize = 13.sp, color = paper.accent, modifier = Modifier.clip(CircleShape).clickable(onClick = it).padding(horizontal = 8.dp, vertical = 4.dp)) }
            }
            about?.let { Text(it.replace(Regex("<[^>]+>"), " ").replace(Regex("\\s+"), " ").trim(), style = MaterialTheme.typography.bodyMedium, color = paper.fg) }
        }

        Column {
            val words = file?.totalChars?.takeIf { it > 0 }?.let { Math.round(it / 6.0).toInt() }
            Fact("Kind", book?.let { KIND_LABEL[it.kind] ?: it.kind } ?: if (file?.isPdf == true) "PDF" else "Book")
            hostOf(book?.url)?.takeIf { book?.kind != "book" }?.let { host -> Fact("Site", host) { openExternal(context, book!!.url!!) } }
            clip?.published?.let { iso -> published(iso)?.let { Fact("Published", it) } }
            book?.year?.takeIf { clip == null }?.let { Fact("Published", it.toString()) }
            Fact("Length", listOfNotNull(book?.minutes?.let { fmtMinutes(it) }, words?.let { "%,d words".format(Locale.UK, it) }).joinToString(" · ").ifBlank { "—" })
            book?.added?.let { savedOn(it) }?.let { Fact("Saved", it) }
            book?.highlights?.takeIf { it > 0 }?.let { Fact("Highlights", "$it") }
            book?.tags?.takeIf { it.isNotEmpty() }?.let { Fact("Tags", it.joinToString(", ")) }
        }

        book?.let { b ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("IN THE LIBRARY", style = Eyebrow, color = paper.faint)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Place.entries.filter { it != Place.Trash }.forEach { p ->
                        val on = b.trashed == null && b.place == p.key
                        Text(
                            p.label, fontFamily = Sans, fontWeight = FontWeight(500), fontSize = 14.sp, color = if (on) paper.bg else paper.fg,
                            modifier = Modifier.clip(CircleShape).background(if (on) paper.fg else Color.Transparent).border(1.dp, if (on) paper.fg else paper.rule, CircleShape)
                                .clickable { scope.launch { runCatching { shelf.triage(TriageChange(listOf(b.id), place = p.key, trashed = false)) } } }
                                .padding(horizontal = 14.dp, vertical = 7.dp),
                        )
                    }
                }
            }
        }

        if (editable) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("YOUR NOTE ON IT", style = Eyebrow, color = paper.faint)
            OutlinedTextField(note, { note = it }, placeholder = { Text("What you make of the whole of it…") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
            if (note != savedNote) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    val id = book!!.id
                    scope.launch { runCatching { shelf.editDoc(id, ShelfApi.DocEdit(note = note)) }.onFailure { error = it.message } }
                }) { Text("Save the note") }
                TextButton(onClick = { note = savedNote }) { Text("Undo") }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
        if (editable) TextButton(onClick = { editing = true }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) { Text("Edit metadata") }
        Spacer(Modifier.height(24.dp))
    }

    if (editing && book != null) {
        var title by remember { mutableStateOf(clip?.title ?: book.title) }
        var author by remember { mutableStateOf(clip?.author ?: book.author) }
        AlertDialog(
            onDismissRequest = { editing = false },
            title = { Text("Edit metadata") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(title, { title = it }, label = { Text("Title") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(author, { author = it }, label = { Text("Author") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                TextButton(enabled = title.isNotBlank(), onClick = {
                    editing = false
                    scope.launch { runCatching { shelf.editDoc(book.id, ShelfApi.DocEdit(title = title.trim(), author = author.trim())) }.onFailure { error = it.message } }
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { editing = false }) { Text("Cancel") } },
        )
    }
}

/** One line of the facts: what, and its value (a tap opens it, for the site). */
@Composable
private fun Fact(label: String, value: String, onClick: (() -> Unit)? = null) {
    val paper = LocalPaper.current
    Column {
        Row(Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, fontFamily = Sans, fontSize = 14.sp, color = paper.muted, modifier = Modifier.width(110.dp))
            Text(value, fontFamily = Sans, fontSize = 15.sp, color = if (onClick != null) paper.accent else paper.fg, modifier = Modifier.weight(1f))
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(paper.rule))
    }
}

private fun published(iso: String): String? = runCatching {
    LocalDate.parse(iso.take(10)).format(DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.UK))
}.getOrNull()
