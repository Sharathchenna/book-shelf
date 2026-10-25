package com.sharathchenna.shelf.ui.library

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.RestoreFromTrash
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.data.Topic
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import com.sharathchenna.shelf.ui.theme.hex
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * The library as Readwise Reader lists it: a row for each thing, where it's from, its title, when
 * it was saved and what it's about, who it's by and how long is left, a picture, and a line for how
 * far through. A dot marks what hasn't been opened. Swiped, a row moves on (to Later, to the
 * Archive); its menu moves it anywhere, or to the Trash.
 */

/** Where things stand: the three places, and the Trash. */
enum class Place(val key: String, val label: String, val icon: ImageVector) {
    Inbox("inbox", "Inbox", Icons.Outlined.Inbox),
    Later("later", "Later", Icons.Outlined.Schedule),
    Archive("archive", "Archive", Icons.Outlined.Archive),
    Trash("trash", "Trash", Icons.Outlined.Delete);

    fun holds(b: ShelfBook): Boolean = if (this == Trash) b.trashed != null else b.trashed == null && b.place == key
}

/** A small picture of a site's icon, by Google's favicon service. */
fun faviconOf(url: String?): String? = hostOf(url)?.let { "https://www.google.com/s2/favicons?domain=$it&sz=64" }

/** "BLOG.RAILWAY.COM", "BOOK", "PDF". */
fun sourceOf(b: ShelfBook, format: String?): String = when {
    b.kind == "tweet" -> "X"
    b.kind == "book" && b.url == null -> (format ?: "book").uppercase()
    b.kind == "book" -> "BOOK"
    else -> hostOf(b.url)?.uppercase() ?: (KIND_LABEL[b.kind] ?: b.kind).uppercase()
}

private val dayMonth = DateTimeFormatter.ofPattern("MMM d", Locale.UK)

/** "Oct 24th", or "Oct 24th 2025" in another year. */
fun savedOn(ms: Long): String? {
    if (ms <= 0) return null
    val day = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).toLocalDate()
    val n = day.dayOfMonth
    val suffix = if (n in 11..13) "th" else when (n % 10) { 1 -> "st"; 2 -> "nd"; 3 -> "rd"; else -> "th" }
    return dayMonth.format(day) + suffix + if (day.year != LocalDate.now().year) " ${day.year}" else ""
}

/** "8 min left", or the whole length when not started. */
fun timeLeft(b: ShelfBook): String =
    if (b.pct > 0 && b.pct < 1) "${fmtMinutes(Math.max(1, Math.round(b.minutes * (1 - b.pct)).toInt()))} left" else fmtMinutes(b.minutes)

/** What can be done to a row: where it can go, and the rest. */
data class RowActions(
    val onOpen: () -> Unit,
    val onDetails: () -> Unit,
    val onMove: (Place) -> Unit,
    val onSeen: (Boolean) -> Unit,
    val onShare: (() -> Unit)?,
    val onOriginal: (() -> Unit)?,
    val onSelect: () -> Unit,
    val onDelete: (() -> Unit)?,
)

/**
 * A row that can be swiped: towards the end it's saved for Later (back to the Inbox from Later),
 * towards the start it goes to the Archive (back to the Inbox from there).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SwipeRow(b: ShelfBook, onMove: (Place) -> Unit, content: @Composable () -> Unit) {
    val paper = LocalPaper.current
    val current = Place.entries.firstOrNull { it.holds(b) } ?: Place.Inbox
    if (current == Place.Trash) { content(); return }
    val right = if (current == Place.Later) Place.Inbox else Place.Later
    val left = if (current == Place.Archive) Place.Inbox else Place.Archive
    val state = rememberSwipeToDismissBoxState(positionalThreshold = { it * 0.3f })
    LaunchedEffect(state.currentValue) {
        when (state.currentValue) {
            SwipeToDismissBoxValue.StartToEnd -> onMove(right)
            SwipeToDismissBoxValue.EndToStart -> onMove(left)
            SwipeToDismissBoxValue.Settled -> return@LaunchedEffect
        }
        state.snapTo(SwipeToDismissBoxValue.Settled)
    }
    SwipeToDismissBox(
        state,
        backgroundContent = {
            val towards = state.dismissDirection
            val place = if (towards == SwipeToDismissBoxValue.StartToEnd) right else left
            val color = when (place) { Place.Archive -> Color(0xFF3F7D5C); Place.Later -> Color(0xFFB7791F); else -> Color(0xFF4A6FB3) }
            Row(
                Modifier.fillMaxSize().background(if (towards == SwipeToDismissBoxValue.Settled) Color.Transparent else color).padding(horizontal = 28.dp),
                horizontalArrangement = if (towards == SwipeToDismissBoxValue.StartToEnd) Arrangement.Start else Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (towards != SwipeToDismissBoxValue.Settled) {
                    Icon(place.icon, null, tint = Color.White, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(place.label, fontFamily = Sans, fontWeight = FontWeight(600), fontSize = 15.sp, color = Color.White)
                }
            }
        },
        modifier = Modifier.background(paper.bg),
    ) { Box(Modifier.background(paper.bg)) { content() } }
}

/** One thing in the library, as Reader lists it. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DocRow(b: ShelfBook, topic: Topic?, format: String?, selecting: Boolean, selected: Boolean, actions: RowActions) {
    val paper = LocalPaper.current
    Column(Modifier.background(if (selected) paper.accent.copy(alpha = 0.10f) else paper.bg)) {
        Row(
            Modifier.fillMaxWidth()
                .combinedClickable(onLongClick = actions.onSelect, onClick = if (selecting) actions.onSelect else actions.onOpen)
                .padding(start = 18.dp, end = 10.dp, top = 16.dp, bottom = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (selecting) {
                Icon(
                    if (selected) Icons.Outlined.CheckCircle else Icons.Outlined.Circle, null,
                    tint = if (selected) paper.accent else paper.faint, modifier = Modifier.padding(top = 2.dp).size(22.dp),
                )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val icon = faviconOf(b.url).takeIf { b.kind != "book" }
                    if (icon != null) AsyncImage(icon, null, Modifier.size(15.dp).clip(RoundedCornerShape(3.dp)))
                    else Glyph(if (b.kind == "book") "reading" else b.topic, 15.dp)
                    Spacer(Modifier.width(8.dp))
                    Text(sourceOf(b, format), style = Eyebrow, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                }
                Row(verticalAlignment = Alignment.Top) {
                    if (!b.seen) Box(Modifier.padding(top = 9.dp, end = 8.dp).size(8.dp).clip(CircleShape).background(paper.accent))
                    Text(b.title, fontFamily = Serif, fontWeight = FontWeight(550), fontSize = 19.sp, lineHeight = 24.sp, color = paper.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                val about = listOfNotNull(savedOn(b.added), b.dek?.replace(Regex("<[^>]+>"), " ")?.replace(Regex("\\s+"), " ")?.trim()).joinToString(" · ")
                if (about.isNotBlank()) Text(about, fontFamily = Sans, fontSize = 14.sp, lineHeight = 20.sp, color = paper.muted, maxLines = 3, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(b.author.takeIf { it.isNotBlank() }, timeLeft(b), b.highlights.takeIf { it > 0 }?.let { "$it highlight${if (it == 1) "" else "s"}" }).joinToString(" · "),
                    fontFamily = Sans, fontSize = 13.sp, color = paper.faint, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 3.dp),
                )
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (!selecting) RowMenu(b, actions)
                Thumbnail(b, topic)
            }
        }
        // How far through, as a line along the foot of the row.
        Box(Modifier.fillMaxWidth().height(2.dp).background(paper.rule)) {
            if (b.pct > 0) Box(Modifier.fillMaxWidth(b.pct.toFloat().coerceIn(0f, 1f)).fillMaxHeight().background(paper.accent))
        }
    }
}

/** A row's picture: the page's, a book's cover, or the topic's plate. */
@Composable
private fun Thumbnail(b: ShelfBook, topic: Topic?) {
    when {
        b.kind == "book" -> Cover(b, topic, Modifier.width(62.dp))
        else -> Box(Modifier.size(92.dp, 74.dp).clip(RoundedCornerShape(10.dp)).background(hex(b.look.color)), contentAlignment = Alignment.Center) {
            if (b.image != null) AsyncImage(b.image, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            else Text(b.title.take(1), fontFamily = Serif, fontSize = 26.sp, color = hex(b.look.fg))
        }
    }
}

/** A row's menu: where it can go, seen or not, details, share, the original, select, the Trash. */
@Composable
private fun RowMenu(b: ShelfBook, actions: RowActions) {
    val paper = LocalPaper.current
    var open by remember { mutableStateOf(false) }
    val current = Place.entries.firstOrNull { it.holds(b) }
    Box {
        Icon(Icons.Outlined.MoreHoriz, "More", tint = paper.muted, modifier = Modifier.size(34.dp).clip(CircleShape).clickable { open = true }.padding(6.dp))
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            val item = @Composable { label: String, icon: ImageVector, run: () -> Unit ->
                DropdownMenuItem(text = { Text(label) }, leadingIcon = { Icon(icon, null) }, onClick = { open = false; run() })
            }
            if (current == Place.Trash) {
                item("Restore", Icons.Outlined.RestoreFromTrash) { actions.onMove(Place.Inbox) }
                actions.onDelete?.let { item("Delete for good", Icons.Outlined.DeleteForever, it) }
                return@DropdownMenu
            }
            Place.entries.filter { it != Place.Trash && it != current }.forEach { p -> item("Move to ${p.label}", p.icon) { actions.onMove(p) } }
            HorizontalDivider()
            item(if (b.seen) "Mark as unseen" else "Mark as seen", if (b.seen) Icons.Outlined.Circle else Icons.Outlined.TaskAlt) { actions.onSeen(!b.seen) }
            item("Details", Icons.Outlined.Info, actions.onDetails)
            actions.onShare?.let { item("Share", Icons.Outlined.Share, it) }
            actions.onOriginal?.let { item("Open the original", Icons.AutoMirrored.Outlined.OpenInNew, it) }
            item("Select", Icons.Outlined.CheckCircle, actions.onSelect)
            HorizontalDivider()
            item("Move to Trash", Icons.Outlined.Delete) { actions.onMove(Place.Trash) }
        }
    }
}

/** Shares a thing's link through the system's sheet. */
fun shareLink(context: Context, title: String, url: String) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, title).putExtra(Intent.EXTRA_TEXT, url)
    context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** Inbox, Later and Archive as Reader has them: a pill floating at the foot of the list, each with its count. */
@Composable
fun PlaceBar(place: Place, counts: Map<Place, Int>, onPlace: (Place) -> Unit, modifier: Modifier = Modifier) {
    val paper = LocalPaper.current
    Row(
        modifier.clip(CircleShape).background(paper.raised).border(1.dp, paper.rule, CircleShape).padding(5.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Place.entries.filter { it != Place.Trash || place == Place.Trash }.forEach { p ->
            val on = p == place
            Row(
                Modifier.clip(CircleShape).background(if (on) paper.fg else Color.Transparent).clickable { onPlace(p) }.padding(horizontal = 18.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(p.label, fontFamily = Sans, fontWeight = FontWeight(if (on) 600 else 500), fontSize = 15.sp, color = if (on) paper.bg else paper.fg)
                counts[p]?.takeIf { it > 0 }?.let { Text("  $it", fontFamily = Sans, fontSize = 14.sp, color = if (on) paper.bg.copy(alpha = 0.65f) else paper.faint) }
            }
        }
    }
}

/** Over the list while things are selected: how many, and what to do with them all. */
@Composable
fun SelectionBar(count: Int, place: Place, onMove: (Place) -> Unit, onAll: () -> Unit, onDelete: (() -> Unit)?, onDone: () -> Unit, modifier: Modifier = Modifier) {
    val paper = LocalPaper.current
    Row(
        modifier.clip(RoundedCornerShape(20.dp)).background(paper.fg).padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("$count selected", fontFamily = Sans, fontWeight = FontWeight(600), fontSize = 15.sp, color = paper.bg, modifier = Modifier.padding(horizontal = 12.dp))
        val action = @Composable { label: String, icon: ImageVector, enabled: Boolean, run: () -> Unit ->
            Row(
                Modifier.clip(CircleShape).clickable(enabled = enabled, onClick = run).padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(icon, null, tint = paper.bg.copy(alpha = if (enabled) 1f else 0.4f), modifier = Modifier.size(19.dp))
                Spacer(Modifier.width(6.dp))
                Text(label, fontFamily = Sans, fontWeight = FontWeight(500), fontSize = 14.sp, color = paper.bg.copy(alpha = if (enabled) 1f else 0.4f))
            }
        }
        if (place == Place.Trash) {
            action("Restore", Icons.Outlined.RestoreFromTrash, count > 0) { onMove(Place.Inbox) }
            onDelete?.let { action("Delete", Icons.Outlined.DeleteForever, count > 0, it) }
        } else {
            Place.entries.filter { it != place && it != Place.Trash }.forEach { p -> action(p.label, p.icon, count > 0) { onMove(p) } }
            action("Trash", Icons.Outlined.Delete, count > 0) { onMove(Place.Trash) }
        }
        action("All", Icons.Outlined.CheckCircle, true, onAll)
        action("Done", Icons.Outlined.TaskAlt, true, onDone)
    }
}
