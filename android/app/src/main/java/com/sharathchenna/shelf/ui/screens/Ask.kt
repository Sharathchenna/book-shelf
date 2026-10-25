package com.sharathchenna.shelf.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.mikepenz.markdown.m3.Markdown
import com.sharathchenna.shelf.data.LibrarySource
import com.sharathchenna.shelf.data.ShelfApi
import com.sharathchenna.shelf.reader.Thinking
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.Reader
import com.sharathchenna.shelf.ui.library.KIND_LABEL
import com.sharathchenna.shelf.ui.openBook
import com.sharathchenna.shelf.ui.openExternal
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import kotlinx.coroutines.launch

/** One turn of the conversation: the question or the answer, and what an answer cites. */
private data class Said(val role: String, val text: String, val sources: List<LibrarySource> = emptyList(), val failed: Boolean = false)

private val ASK_EXAMPLES = listOf(
    "What have I read about formal verification?",
    "Which of my highlights are about habits?",
    "What do my saved papers say about RL for agents?",
    "Summarise what I've saved this week",
)

/**
 * Ask your whole library, as Readwise Reader's Ghostreader chat does: a question answered from
 * the books and clippings it bears on and the owner's highlights in them, each cited, a tap away.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AskLibrary(nav: NavHostController, onSearch: () -> Unit) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val said = remember { mutableStateListOf<Said>() }
    var question by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val list = rememberLazyListState()
    LaunchedEffect(said.size, said.lastOrNull()?.text?.length) { if (said.isNotEmpty()) list.animateScrollToItem(said.size) }

    val ask: (String) -> Unit = ask@{ q ->
        val text = q.trim()
        if (text.isEmpty() || busy) return@ask
        question = ""
        said += Said("user", text)
        said += Said("assistant", "")
        val turns = said.dropLast(1).filter { !it.failed && it.text.isNotBlank() }.map { ShelfApi.Turn(it.role, it.text) }
        busy = true
        scope.launch {
            var sources = emptyList<LibrarySource>()
            runCatching {
                shelf.api.askLibrary(turns) { sources = it }.collect { answer -> said[said.lastIndex] = Said("assistant", answer, sources) }
            }.onFailure { said[said.lastIndex] = Said("assistant", it.message ?: "Couldn't reach the site.", failed = true) }
            busy = false
        }
    }
    val open: (LibrarySource) -> Unit = { s ->
        val book = shelf.book(s.id)
        when {
            book != null -> openBook(context, nav, book)
            s.fileId != null -> nav.navigate(Reader(s.fileId))
            s.url != null -> openExternal(context, shelf.api.absolute(s.url))
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        Page { side ->
            LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(start = side, end = side, bottom = 140.dp)) {
                item {
                    Row(Modifier.statusBarsPadding().padding(top = 36.dp, bottom = 10.dp), verticalAlignment = Alignment.Bottom) {
                        Column(Modifier.weight(1f)) {
                            Text("ASK YOUR LIBRARY", style = Eyebrow, color = paper.muted, modifier = Modifier.padding(bottom = 6.dp))
                            Text("What do I know about…", fontFamily = Serif, fontWeight = FontWeight(420), fontSize = 44.sp, lineHeight = 48.sp, color = paper.fg)
                        }
                        Pill("Search instead", Icons.Outlined.Search, onClick = onSearch)
                    }
                    Text(
                        "Answers come from your books, articles, papers, posts, videos and episodes, and your highlights in them, each cited.",
                        fontFamily = Sans, fontSize = 15.sp, color = paper.muted, modifier = Modifier.widthIn(max = 760.dp).padding(bottom = 18.dp),
                    )
                    if (said.isEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        ASK_EXAMPLES.forEach { e ->
                            Text(e, fontFamily = Sans, fontSize = 14.sp, color = paper.fg, modifier = Modifier.clip(CircleShape).background(paper.chip).clickable { ask(e) }.padding(horizontal = 14.dp, vertical = 8.dp))
                        }
                    }
                }
                itemsIndexed(said) { i, s ->
                    if (s.role == "user") {
                        Box(Modifier.widthIn(max = 760.dp).fillMaxWidth().padding(top = 18.dp), contentAlignment = Alignment.CenterEnd) {
                            Text(s.text, fontFamily = Sans, fontSize = 16.sp, color = paper.bg, modifier = Modifier.clip(RoundedCornerShape(18.dp)).background(paper.fg).padding(horizontal = 16.dp, vertical = 11.dp))
                        }
                    } else Column(Modifier.widthIn(max = 760.dp).padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        when {
                            s.failed -> Text(s.text, color = MaterialTheme.colorScheme.error, fontFamily = Sans)
                            s.text.isEmpty() -> Row(verticalAlignment = Alignment.CenterVertically) {
                                Thinking()
                                Text("  Looking through your library…", fontFamily = Sans, fontSize = 14.sp, color = paper.muted)
                            }
                            else -> Markdown(s.text)
                        }
                        // What it drew on, numbered as the answer cites them; those cited first.
                        val cited = s.sources.filter { src -> s.text.contains("[${src.n}]") }
                        val shown = cited.ifEmpty { if (i == said.lastIndex && busy) emptyList() else s.sources.take(4) }
                        if (shown.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(if (cited.isNotEmpty()) "SOURCES" else "LOOKED AT", style = Eyebrow, color = paper.faint)
                            shown.forEach { src -> SourceRow(src) { open(src) } }
                        }
                    }
                }
            }
        }
        Row(
            Modifier.navigationBarsPadding().padding(horizontal = 24.dp, vertical = 16.dp).align(Alignment.CenterHorizontally).widthIn(max = 760.dp).fillMaxWidth()
                .clip(RoundedCornerShape(24.dp)).background(paper.raised).border(1.dp, paper.rule, RoundedCornerShape(24.dp)).padding(start = 18.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.AutoAwesome, null, tint = paper.accent, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(12.dp))
            Box(Modifier.weight(1f)) {
                if (question.isEmpty()) Text(if (said.isEmpty()) "Ask anything about what you've read and saved…" else "Ask a follow-up…", fontFamily = Sans, fontSize = 16.sp, color = paper.faint)
                BasicTextField(
                    question, { question = it }, cursorBrush = SolidColor(paper.accent), maxLines = 5,
                    textStyle = TextStyle(fontFamily = Sans, fontSize = 16.sp, color = paper.fg),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { ask(question) }),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Box(
                Modifier.size(40.dp).clip(CircleShape).background(if (question.isBlank() || busy) paper.sunk else paper.fg).clickable(enabled = question.isNotBlank() && !busy) { ask(question) },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Outlined.ArrowUpward, "Ask", tint = if (question.isBlank() || busy) paper.faint else paper.bg, modifier = Modifier.size(20.dp)) }
        }
    }
}

@Composable
private fun SourceRow(src: LibrarySource, onOpen: () -> Unit) {
    val paper = LocalPaper.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, paper.rule, RoundedCornerShape(12.dp)).clickable(onClick = onOpen).padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("${src.n}", fontFamily = Sans, fontWeight = FontWeight(600), fontSize = 13.sp, color = paper.bg, modifier = Modifier.clip(CircleShape).background(paper.accent).padding(horizontal = 7.dp, vertical = 2.dp))
        Column(Modifier.weight(1f)) {
            Text(src.title, fontFamily = Serif, fontSize = 15.sp, color = paper.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(KIND_LABEL[src.kind] ?: src.kind, src.by?.takeIf { it.isNotBlank() }).joinToString(" · "), fontFamily = Sans, fontSize = 12.5.sp, color = paper.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
