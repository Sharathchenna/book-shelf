package com.sharathchenna.shelf.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DownloadForOffline
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.material.icons.outlined.OfflinePin
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.Hyphens
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import coil3.compose.AsyncImage
import com.sharathchenna.shelf.BuildConfig
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.data.Topic
import com.sharathchenna.shelf.ui.Listen
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.openBook
import com.sharathchenna.shelf.ui.openExternal
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import com.sharathchenna.shelf.ui.theme.hex
import kotlinx.coroutines.launch
import java.net.URI

/** A link's site, as the shelf names it: "paulgraham.com", not "https://www.paulgraham.com/…". */
fun hostOf(url: String?): String? = runCatching { URI(url).host?.removePrefix("www.") }.getOrNull()

/** What the card offers first, in the site's words (app/components/bookcase/library.tsx actionsFor). */
private fun primaryLabel(b: ShelfBook): String? {
    val started = when {
        b.pct >= 1 -> "Read again"
        b.pct > 0 && b.measured -> "Continue reading"
        else -> "Start reading"
    }
    return when {
        b.kind == "book" -> if (b.fileId != null) started else null
        b.kind == "tweet" && !b.readable && b.fileId == null -> "Open on X"
        b.readable || b.fileId != null -> started
        else -> if (b.kind == "paper") "Read the paper" else "Read it"
    }
}

private fun sourceLabel(b: ShelfBook): String? = b.url?.let {
    when (b.kind) {
        "book" -> "Goodreads"
        "tweet" -> "X"
        else -> hostOf(it) ?: "Source"
    }
}

/** A book or clipping off the shelf: its cover, what it is, where you are in it, and what you can do with it. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BookCard(id: String, nav: NavHostController, onClose: () -> Unit) {
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

    Box(Modifier.fillMaxSize().background(paper.raised)) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 28.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Spacer(Modifier.height(28.dp))
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Cover(book, topic, Modifier.width(190.dp)) }

            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                topic?.let { t ->
                    Mark(color = hex(t.shades[0])) { Glyph(t.key, 16.dp); Spacer(Modifier.width(6.dp)); Text(t.name, fontFamily = Sans, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = paper.fg) }
                }
                Tag.entries.filter { it.icon != null && it != Tag.Agent && it != Tag.Quick && it.test(book) }.forEach { t ->
                    Mark { Glyph(t.icon!!, 16.dp); Spacer(Modifier.width(6.dp)); Text(t.label, fontFamily = Sans, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = paper.fg) }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    item?.title ?: clip?.title ?: book.title,
                    style = MaterialTheme.typography.headlineMedium.copy(hyphens = Hyphens.Auto, lineBreak = LineBreak.Heading),
                )
                Text(book.author, fontFamily = Sans, fontSize = 15.sp, color = paper.muted)
                item?.series?.let { Text(it, fontFamily = Sans, fontSize = 13.sp, color = paper.faint) }
                Text(
                    listOfNotNull(KIND_LABEL[book.kind], book.year?.toString(), fmtMinutes(book.minutes), book.highlights.takeIf { it > 0 }?.let { "$it highlight${if (it == 1) "" else "s"}" })
                        .joinToString("  ·  "),
                    fontFamily = Sans, fontSize = 13.sp, color = paper.faint,
                )
                book.rating?.let { Text("★".repeat(it) + "☆".repeat(5 - it), color = Color(0xFFC9962E), fontSize = 16.sp) }
            }

            if (book.pct > 0) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    LinearProgressIndicator(progress = { book.pct.toFloat() }, modifier = Modifier.fillMaxWidth(), color = paper.accent, trackColor = paper.sunk, drawStopIndicator = {})
                    Text(
                        when {
                            book.pct >= 1 -> "Finished"
                            book.measured -> "${Math.round(book.pct * 100)}% read"
                            else -> "Reading"
                        },
                        fontFamily = Sans, fontSize = 12.5.sp, color = paper.muted,
                    )
                }
            }

            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                primaryLabel(book)?.let { label ->
                    Button(onClick = { openBook(context, nav, book) }) {
                        Icon(if (book.kind == "tweet" && !book.readable) Icons.AutoMirrored.Outlined.OpenInNew else Icons.AutoMirrored.Outlined.MenuBook, null, Modifier.size(18.dp))
                        Text("  $label")
                    }
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
                        Text(if (downloaded) "  Kept offline" else downloading?.let { "  Downloading… ${Math.round(it * 100)}%" } ?: "  Keep offline")
                    }
                }
                if (book.kind != "tweet" || book.readable) sourceLabel(book)?.let { label ->
                    OutlinedButton(onClick = { openExternal(context, book.url!!) }) {
                        Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.size(18.dp))
                        Text("  $label")
                    }
                }
            }
            // A file can be taken out of the library. One on no shelf is a book of its own (its id is the
            // file's) and goes entirely; otherwise the EPUB or PDF goes and the book or clipping stays.
            book.fileId?.let { fileId ->
                var asking by remember(id) { mutableStateOf(false) }
                TextButton(onClick = { asking = true }) { Text(if (book.id == fileId) "Remove from the library" else "Remove the file", color = MaterialTheme.colorScheme.error) }
                if (asking) androidx.compose.material3.AlertDialog(
                    onDismissRequest = { asking = false },
                    title = { Text("Remove “${book.title}”?") },
                    text = { Text("Its file goes from the library on the site and every device, with its highlights, notes, drawings and your place. This can't be undone.") },
                    confirmButton = {
                        TextButton(onClick = {
                            asking = false
                            scope.launch {
                                runCatching { shelf.api.removeBook(fileId); shelf.removeDownload(fileId); shelf.refreshLibrary() }
                                    .onSuccess { onClose() }
                                    .onFailure { error = it.message ?: "Couldn't remove it." }
                            }
                        }) { Text("Remove", color = MaterialTheme.colorScheme.error) }
                    },
                    dismissButton = { TextButton(onClick = { asking = false }) { Text("Cancel") } },
                )
            }
            if (book.kind == "book" && book.fileId == null) {
                Text("No EPUB or PDF of this one yet. Add a file from its card on the site, and it opens here.", fontFamily = Sans, fontSize = 13.sp, color = paper.muted)
            }
            error?.let { Text(it, fontFamily = Sans, fontSize = 13.sp, color = MaterialTheme.colorScheme.error) }

            clip?.tweet?.let { tweet ->
                Column(Modifier.clip(RoundedCornerShape(16.dp)).background(paper.bg).border(1.dp, paper.rule, RoundedCornerShape(16.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${tweet.name}  @${tweet.handle}", fontFamily = Sans, fontWeight = FontWeight(500), fontSize = 13.sp, color = paper.muted)
                    Text(tweet.text, style = MaterialTheme.typography.bodyLarge)
                    tweet.media.firstOrNull()?.let { AsyncImage(it, null, Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)), contentScale = ContentScale.FillWidth) }
                }
            }
            val about = item?.review?.let { "Your review" to it }
                ?: book.dek?.takeIf { clip?.tweet == null }?.let { (if (book.kind == "paper") "In short" else "About") to it }
                ?: item?.description?.let { "About" to it }
            about?.let { (label, text) ->
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(label.uppercase(), style = Eyebrow, color = paper.faint)
                    Text(text.replace(Regex("<[^>]+>"), " ").replace(Regex("\\s+"), " ").trim(), style = MaterialTheme.typography.bodyLarge)
                }
            }
            clip?.note?.let { Text(it, style = MaterialTheme.typography.bodyLarge.copy(fontStyle = FontStyle.Italic), color = paper.muted) }
            val tags = (book.tags + item?.subjects.orEmpty().take(4)).distinct()
            if (tags.isNotEmpty()) {
                Text(tags.joinToString("  ·  "), fontFamily = Sans, fontSize = 12.5.sp, color = paper.faint)
            }
            Spacer(Modifier.height(24.dp))
        }
        IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(8.dp)) {
            Icon(Icons.Outlined.Close, "Put it back")
        }
    }
}

@Composable
private fun Mark(color: Color? = null, content: @Composable () -> Unit) {
    val paper = LocalPaper.current
    Row(
        Modifier.height(30.dp).clip(CircleShape).background(color?.copy(alpha = 0.12f) ?: paper.bg).border(1.dp, color?.copy(alpha = 0.35f) ?: paper.rule, CircleShape).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) { content() }
}

/**
 * The front of a book, as the site draws it (book.tsx Cover): a Goodreads book's own cover;
 * anything else a cover in its topic's cloth, with the page's picture (or the topic's plate)
 * above its topic, title and author.
 */
@Composable
fun Cover(book: ShelfBook, topic: Topic?, modifier: Modifier = Modifier) {
    val look = book.look
    val shape = RoundedCornerShape(topStart = 3.dp, bottomStart = 3.dp, topEnd = 8.dp, bottomEnd = 8.dp)
    val frame = modifier.aspectRatio(2f / 3f).shadow(18.dp, shape).clip(shape).background(hex(look.color))
    // A cover that won't load falls back to one in the topic's cloth, as on the site.
    var broken by remember(book.photo) { mutableStateOf(false) }
    if (book.photo != null && !broken) {
        Box(frame) {
            AsyncImage(book.photo, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(), onError = { broken = true })
            Hinge()
        }
        return
    }
    val fg = hex(look.fg)
    Box(frame) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxWidth().weight(1f).padding(10.dp).clip(RoundedCornerShape(3.dp))) {
                AsyncImage(
                    book.image ?: "${BuildConfig.SITE_URL}/library/topics/${book.topic}.webp", null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize().alpha(if (book.image != null) 0.85f else 1f),
                )
            }
            Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Glyph(book.topic, 13.dp); Spacer(Modifier.width(5.dp))
                    Text(listOfNotNull(topic?.name, book.year?.toString()).joinToString("  "), fontFamily = Sans, fontSize = 9.5.sp, color = fg.copy(alpha = 0.75f), maxLines = 1)
                }
                Text(book.title, fontFamily = Serif, fontWeight = FontWeight(500), fontSize = 17.sp, lineHeight = 20.sp, color = fg, maxLines = 4, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.titleMedium.copy(hyphens = Hyphens.Auto, lineBreak = LineBreak.Heading))
                Text(book.author, fontFamily = Sans, fontSize = 10.5.sp, color = fg.copy(alpha = 0.8f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Hinge()
    }
}

/** The fold near a cover's spine. */
@Composable
private fun Hinge() {
    Box(
        Modifier.fillMaxSize().background(
            Brush.horizontalGradient(0f to Color.Black.copy(alpha = 0.22f), 0.035f to Color.White.copy(alpha = 0.12f), 0.07f to Color.Black.copy(alpha = 0.08f), 0.12f to Color.Transparent),
        ),
    )
}
