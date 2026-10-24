package com.sharathchenna.shelf.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.sharathchenna.shelf.data.ExportedBook
import com.sharathchenna.shelf.data.Highlight
import com.sharathchenna.shelf.data.Vault
import com.sharathchenna.shelf.data.notesFileName
import com.sharathchenna.shelf.data.notesMarkdown
import com.sharathchenna.shelf.reader.HIGHLIGHT_ARGB
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.Reader
import com.sharathchenna.shelf.ui.library.KIND_LABEL
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import kotlinx.coroutines.launch

/** How many of a book's highlights show before "Show all". */
private const val FIRST = 3

/**
 * Notes: the day's review at the top, then every highlight, note and drawing, a book at a time,
 * the book most recently marked first and its highlights in reading order. A tap opens one in its
 * book; a book's notes go to the Obsidian vault from its heading.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NotesScreen(nav: NavHostController) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val library by shelf.library.collectAsState()
    var books by remember { mutableStateOf<List<ExportedBook>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var filter by rememberSaveable { mutableStateOf("all") }
    val expanded = remember { mutableStateListOf<String>() }
    var message by remember { mutableStateOf<String?>(null) }
    val vault = remember { Vault.name(context) }
    LaunchedEffect(Unit) {
        runCatching { shelf.api.export().books }
            .onSuccess { found -> books = found.sortedByDescending { b -> b.highlights.maxOfOrNull { it.changedAt } ?: "" } }
            .onFailure { error = it.message ?: "Couldn't reach the site." }
    }
    val keep: (Highlight) -> Boolean = { h ->
        when (filter) {
            "notes" -> !h.note.isNullOrBlank()
            "ink" -> h.ink != null
            else -> true
        }
    }
    val total = books?.sumOf { it.highlights.size } ?: 0

    Page { side ->
        LazyColumn(contentPadding = PaddingValues(start = side, end = side, bottom = 48.dp)) {
            item(key = "head") {
                Heading("Notes", subtitle = "Your highlights, notes and drawings from every book and article. A few come back each day to look at again.")
                Text("TODAY'S REVIEW", style = Eyebrow, color = paper.faint, modifier = Modifier.padding(bottom = 12.dp))
                ReviewDeck(nav)
                Row(Modifier.padding(top = 44.dp, bottom = 10.dp).widthIn(max = 860.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("EVERY HIGHLIGHT" + if (total > 0) " · $total" else "", style = Eyebrow, color = paper.faint, modifier = Modifier.weight(1f))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Choice("All", null, filter == "all") { filter = "all" }
                        Choice("With notes", null, filter == "notes") { filter = "notes" }
                        Choice("Drawings", null, filter == "ink") { filter = "ink" }
                    }
                }
                message?.let { Text(it, fontFamily = Sans, fontSize = 13.sp, color = paper.muted, modifier = Modifier.padding(bottom = 8.dp)) }
            }
            when {
                error != null -> item { Text(error!!, fontFamily = Sans, color = paper.muted) }
                books == null -> item { Text("Gathering your notes…", fontFamily = Sans, color = paper.muted) }
                books!!.isEmpty() -> item { Text("No highlights yet. Mark something as you read, with a finger or the pen, and it's kept here.", fontFamily = Serif, fontSize = 20.sp, color = paper.muted) }
            }
            books.orEmpty().forEach { book ->
                val title = book.meta.title
                val marks = book.highlights.filter(keep).sortedWith(compareBy({ it.sectionIndex }, { it.progression ?: 0.0 }))
                if (marks.isEmpty()) return@forEach
                // The export names files by title; the library knows their ids.
                val fileId = library?.files?.find { it.title == title }?.id
                val open = title in expanded
                item(key = "b-$title") {
                    Row(Modifier.padding(top = 26.dp, bottom = 4.dp).widthIn(max = 860.dp).fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                        Column(Modifier.weight(1f)) {
                            Text(title, fontFamily = Serif, fontWeight = FontWeight(450), fontSize = 22.sp, lineHeight = 27.sp, color = paper.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(
                                listOfNotNull(KIND_LABEL[book.meta.kind] ?: book.meta.kind.replaceFirstChar { it.uppercase() }, book.meta.author, "${marks.size} marked").joinToString("  ·  "),
                                fontFamily = Sans, fontSize = 13.sp, color = paper.muted,
                            )
                        }
                        if (vault != null) TextButton(onClick = {
                            scope.launch {
                                message = runCatching { Vault.write(context, notesFileName(title), notesMarkdown(book.meta, book.highlights)); "In your vault: Shelf/${notesFileName(title)}" }
                                    .getOrElse { it.message ?: "Couldn't write to the vault." }
                            }
                        }) { Text("To Obsidian") }
                    }
                }
                items(if (open) marks else marks.take(FIRST), key = { "h-${it.id}" }) { h ->
                    Mark(h, book.meta.sections.getOrNull(h.sectionIndex)?.takeIf { it != title }) { fileId?.let { nav.navigate(Reader(it, at = h.id)) } }
                }
                if (marks.size > FIRST) item(key = "more-$title") {
                    TextButton(onClick = { if (open) expanded.remove(title) else expanded.add(title) }) {
                        Text(if (open) "Show fewer" else "Show all ${marks.size}")
                    }
                }
                item(key = "rule-$title") { HorizontalDivider(Modifier.widthIn(max = 860.dp).padding(top = 6.dp), color = paper.rule) }
            }
        }
    }
}

/** One highlight: its colour down the side, the passage (or the drawing's words), the note, and where. */
@Composable
private fun Mark(h: Highlight, section: String?, onClick: () -> Unit) {
    val paper = LocalPaper.current
    Row(
        Modifier.widthIn(max = 860.dp).fillMaxWidth().height(IntrinsicSize.Min).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(vertical = 10.dp, horizontal = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(Modifier.width(4.dp).fillMaxHeight().clip(CircleShape).background(Color(HIGHLIGHT_ARGB[h.color] ?: HIGHLIGHT_ARGB.getValue("yellow"))))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (h.ink != null) {
                Text("✍  " + (h.ink.recognized?.takeIf { it.isNotBlank() } ?: "A drawing"), fontFamily = Serif, fontStyle = FontStyle.Italic, fontSize = 17.sp, lineHeight = 25.sp, color = paper.fg)
            } else {
                Text(h.text.trim(), fontFamily = Serif, fontSize = 17.sp, lineHeight = 25.sp, color = paper.fg, maxLines = 8, overflow = TextOverflow.Ellipsis)
            }
            h.note?.takeIf { it.isNotBlank() }?.let { Text(it, fontFamily = Sans, fontSize = 14.sp, lineHeight = 20.sp, color = paper.fg) }
            Text(listOfNotNull(section?.takeIf { it.isNotBlank() }, h.changedAt.take(10)).joinToString("  ·  "), fontFamily = Sans, fontSize = 12.5.sp, color = paper.faint)
        }
    }
}
