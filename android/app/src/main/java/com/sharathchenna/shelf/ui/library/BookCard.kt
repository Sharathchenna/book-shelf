package com.sharathchenna.shelf.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.DownloadForOffline
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.material.icons.outlined.OfflinePin
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import coil3.compose.AsyncImage
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.ui.Listen
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.openBook
import com.sharathchenna.shelf.ui.openExternal
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Serif
import com.sharathchenna.shelf.ui.theme.hex
import kotlinx.coroutines.launch

/** A book or clipping off the shelf: what it is, where the owner is in it, and what can be done with it. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BookCard(id: String, nav: NavHostController) {
    val shelf = LocalShelf.current
    val library by shelf.library.collectAsState()
    val book = library?.books?.find { it.id == id } ?: return
    val item = book.takeIf { it.kind == "book" }?.let { shelf.item(it.id) }
    val clip = book.takeIf { it.kind != "book" }?.let { shelf.clip(it.id) }
    val topic = library?.topics?.find { it.key == book.topic }
    val paper = LocalPaper.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val downloads by shelf.downloads.collectAsState(initial = emptyMap())
    val downloaded = book.fileId != null && downloads.containsKey(book.fileId)
    var downloading by remember(id) { mutableStateOf<Float?>(null) }
    var narrated by remember(id) { mutableStateOf(false) }
    var error by remember(id) { mutableStateOf<String?>(null) }

    LaunchedEffect(book.fileId) {
        narrated = book.fileId?.let { f -> runCatching { shelf.api.voices(f).any { it.sections > 0 } }.getOrDefault(false) } ?: false
    }

    Column(
        Modifier.fillMaxSize().background(paper.raised).verticalScroll(rememberScrollState()).statusBarsPadding().padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Cover beside the details when there's room; above them in a narrow pane.
        val stacked = LocalConfiguration.current.screenWidthDp < 1000 && LocalConfiguration.current.screenWidthDp < LocalConfiguration.current.screenHeightDp
        FlowRow(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Cover(book)
            Column(if (stacked) Modifier.fillMaxWidth() else Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(listOfNotNull(KIND_LABEL[book.kind], topic?.name, book.year?.toString()).joinToString(" · ").uppercase(), style = Eyebrow, color = paper.muted)
                Text(
                    item?.title ?: clip?.title ?: book.title,
                    style = MaterialTheme.typography.headlineMedium.copy(hyphens = androidx.compose.ui.text.style.Hyphens.Auto, lineBreak = androidx.compose.ui.text.style.LineBreak.Heading),
                )
                Text(book.author, style = MaterialTheme.typography.titleMedium, color = paper.muted)
                item?.series?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = paper.muted) }
                book.rating?.let { Text("★".repeat(it) + "☆".repeat(5 - it), color = paper.accent, style = MaterialTheme.typography.titleMedium) }
                Text(fmtMinutes(book.minutes) + if (book.highlights > 0) " · ${book.highlights} highlight${if (book.highlights == 1) "" else "s"}" else "", style = MaterialTheme.typography.labelMedium, color = paper.muted)
            }
        }

        if (book.pct > 0) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                LinearProgressIndicator(progress = { book.pct.toFloat() }, modifier = Modifier.fillMaxWidth())
                Text(if (book.pct >= 1) "Finished" else "${Math.round(book.pct * 100)}% read", style = MaterialTheme.typography.labelMedium, color = paper.muted)
            }
        }

        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val canRead = book.fileId != null || book.readable
            if (canRead) Button(onClick = { openBook(context, nav, book) }) {
                Icon(Icons.AutoMirrored.Outlined.MenuBook, null, Modifier.size(18.dp))
                Text(if (book.pct > 0 && book.pct < 1) "  Continue" else "  Read")
            }
            if (narrated) OutlinedButton(onClick = { nav.navigate(Listen(book.fileId!!)) }) {
                Icon(Icons.Outlined.Headphones, null, Modifier.size(18.dp))
                Text("  Listen")
            }
            book.fileId?.let { fileId ->
                OutlinedButton(
                    enabled = downloading == null,
                    onClick = {
                        scope.launch {
                            error = null
                            if (downloaded) shelf.removeDownload(fileId)
                            else {
                                downloading = 0f
                                runCatching { shelf.download(fileId) { downloading = it } }.onFailure { error = it.message }
                                downloading = null
                            }
                        }
                    },
                ) {
                    Icon(if (downloaded) Icons.Outlined.OfflinePin else Icons.Outlined.DownloadForOffline, null, Modifier.size(18.dp))
                    Text(if (downloaded) "  On this device" else downloading?.let { "  ${Math.round(it * 100)}%" } ?: "  Keep offline")
                }
            }
            (clip?.url ?: book.url)?.let { url ->
                OutlinedButton(onClick = { openExternal(context, url) }) {
                    Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.size(18.dp))
                    Text(if (book.kind == "book") "  Goodreads" else "  Original")
                }
            }
        }
        if (!(book.fileId != null || book.readable) && book.kind == "book") {
            Text("No EPUB or PDF yet. Add one from this book's card on the site.", style = MaterialTheme.typography.bodySmall, color = paper.muted)
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }

        val about = item?.review?.let { "Review" to it } ?: book.dek?.let { (if (book.kind == "paper") "In short" else "About") to it } ?: item?.description?.let { "About" to it }
        about?.let { (label, text) ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(label.uppercase(), style = Eyebrow, color = paper.muted)
                Text(text.replace(Regex("<[^>]+>"), " ").replace(Regex("\\s+"), " ").trim(), style = MaterialTheme.typography.bodyLarge)
            }
        }
        clip?.note?.let {
            Text(it, style = MaterialTheme.typography.bodyLarge.copy(fontStyle = FontStyle.Italic), color = paper.muted)
        }
        clip?.tweet?.let { tweet ->
            Column(Modifier.clip(RoundedCornerShape(16.dp)).background(paper.sunk).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${tweet.name} @${tweet.handle}", style = MaterialTheme.typography.titleSmall)
                Text(tweet.text, style = MaterialTheme.typography.bodyLarge)
                tweet.media.firstOrNull()?.let { AsyncImage(it, null, Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)), contentScale = ContentScale.FillWidth) }
            }
        }
        val tags = (book.tags + (item?.subjects.orEmpty().take(4))).distinct()
        if (tags.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { tags.forEach { AssistChip(onClick = {}, label = { Text(it) }) } }
    }
}

/** The book's own cover, the clipping's picture, or a cloth cover in its spine's colour. */
@Composable
private fun Cover(book: ShelfBook) {
    val shape = RoundedCornerShape(topEnd = 6.dp, bottomEnd = 6.dp, topStart = 2.dp, bottomStart = 2.dp)
    val modifier = Modifier.width(150.dp).height(225.dp).shadow(10.dp, shape).clip(shape).background(hex(book.look.color))
    val picture = book.photo ?: book.image
    if (picture != null) {
        AsyncImage(model = picture, contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier)
    } else {
        Box(modifier.padding(14.dp), contentAlignment = Alignment.BottomStart) {
            Text(book.title, color = hex(book.look.fg), style = MaterialTheme.typography.titleMedium.copy(fontFamily = Serif, hyphens = androidx.compose.ui.text.style.Hyphens.Auto, lineBreak = androidx.compose.ui.text.style.LineBreak.Paragraph), maxLines = 7)
        }
    }
}
