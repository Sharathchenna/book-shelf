package com.sharathchenna.shelf.reader

import android.content.Context
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mikepenz.markdown.m3.Markdown
import com.sharathchenna.shelf.data.ShelfJson
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A message in a book's chat, kept on the device as the site keeps it (app/components/reader/chat-panel.tsx). */
@Serializable
data class ChatMessage(val role: String, val content: String, val quote: String? = null, val error: Boolean = false)

/** A page or a section an answer cited: "(p. 12)", "(§ 3.2)". */
sealed interface Cite {
    data class Page(val page: Int) : Cite
    data class Section(val number: String) : Cite
}

private const val KEEP = 40

private val SUGGESTIONS = mapOf(
    true to listOf("Explain this paper in plain words", "What's the key idea of this section?", "What are the main results?", "Walk me through the method"),
    false to listOf("Recap what's happened so far", "Who's who so far?", "What's this chapter about?", "What should I keep an eye on?"),
)

/** Each book's conversation, kept on this device: the last forty messages, as the site keeps them. */
private object ChatStore {
    private fun prefs(context: Context) = context.getSharedPreferences("chat", Context.MODE_PRIVATE)
    private val serializer = ListSerializer(ChatMessage.serializer())

    fun load(context: Context, bookId: String): List<ChatMessage> =
        prefs(context).getString(bookId, null)?.let { runCatching { ShelfJson.decodeFromString(serializer, it) }.getOrNull() } ?: emptyList()

    fun save(context: Context, bookId: String, messages: List<ChatMessage>) {
        prefs(context).edit().apply { if (messages.isEmpty()) remove(bookId) else putString(bookId, ShelfJson.encodeToString(serializer, messages.takeLast(KEEP))) }.apply()
    }
}

private val CITE = Regex("""\((?:p|pp)\.\s?\d+(?:\s?[–-]\s?\d+)?\)|\(§\s?[\d.]+\)""")

/** The answer's citations as links the panel follows, the rest left as the model wrote it. */
private fun linkCites(text: String) = text.replace(CITE) { m ->
    val inner = m.value.removeSurrounding("(", ")")
    val section = Regex("""§\s?([\d.]+)""").find(inner)?.groupValues?.get(1)?.trimEnd('.')
    val target = section?.let { "shelf-cite:section/$it" } ?: "shelf-cite:page/${Regex("""\d+""").find(inner)!!.value}"
    "([$inner]($target))"
}

/**
 * The chat beside the reader. Claude sees the whole paper, or a book up to the reader's place,
 * plus their highlights; a passage chosen from the selection menu travels with the next question.
 */
@Composable
fun ChatPanel(bookId: String, paper: Boolean, initialQuote: String?, here: () -> Pair<Int, Double>, onCite: (Cite) -> Unit, onClose: () -> Unit, initialImage: String? = null) {
    val shelf = LocalShelf.current
    val context = LocalContext.current
    val ink = LocalPaper.current
    val scope = rememberCoroutineScope()
    val messages = remember(bookId) { mutableStateListOf<ChatMessage>().apply { addAll(ChatStore.load(context, bookId)) } }
    var quote by remember(initialQuote) { mutableStateOf(initialQuote) }
    // A PDF passage's picture (equations, a figure), sent once with the question about it.
    var image by remember(initialQuote, initialImage) { mutableStateOf(initialImage) }
    var input by remember { mutableStateOf("") }
    var streaming by remember { mutableStateOf<Job?>(null) }
    val list = rememberLazyListState()
    val field = remember { FocusRequester() }

    LaunchedEffect(initialQuote) { if (initialQuote != null) runCatching { field.requestFocus() } }
    LaunchedEffect(messages.size, messages.lastOrNull()?.content?.length) {
        if (messages.isNotEmpty()) list.scrollToItem(messages.size - 1, Int.MAX_VALUE / 2)
    }

    fun send(text: String) {
        val question = text.trim()
        if (question.isEmpty() || streaming != null) return
        val asked = ChatMessage("user", question, quote)
        val history = messages.filter { !it.error } + asked
        messages.clear(); messages.addAll(history); messages += ChatMessage("assistant", "")
        input = ""
        quote = null
        val sentImage = image
        image = null
        val (section, fraction) = here()
        streaming = scope.launch {
            val body = buildJsonObject {
                put("bookId", bookId); put("sectionIndex", section); put("sectionFraction", fraction)
                // Earlier quotes travel inside their questions; the newest goes on its own.
                put("messages", buildJsonArray {
                    history.forEachIndexed { i, m ->
                        add(buildJsonObject {
                            put("role", m.role)
                            put("content", if (m.quote != null && i < history.size - 1) "About this passage: \"${m.quote}\"\n\n${m.content}" else m.content)
                        })
                    }
                })
                asked.quote?.let { put("quote", it) }
                sentImage?.let { put("image", it) }
            }
            try {
                shelf.api.stream("/api/reader/chat", body).collect { messages[messages.lastIndex] = ChatMessage("assistant", it) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                messages[messages.lastIndex] = ChatMessage("assistant", e.message ?: "Couldn't reach the server.", error = true)
            } finally {
                streaming = null
                ChatStore.save(context, bookId, messages.toList())
            }
        }
    }

    fun clear() {
        streaming?.cancel()
        messages.clear()
        ChatStore.save(context, bookId, emptyList())
    }

    val cites = remember(onCite) {
        object : UriHandler {
            override fun openUri(uri: String) {
                val parts = uri.removePrefix("shelf-cite:").split("/")
                when (parts.firstOrNull()) {
                    "page" -> parts.getOrNull(1)?.toIntOrNull()?.let { onCite(Cite.Page(it)) }
                    "section" -> parts.getOrNull(1)?.let { onCite(Cite.Section(it)) }
                }
            }
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        // The header: what this chat knows, a fresh start, and the way out.
        Row(Modifier.fillMaxWidth().padding(start = 22.dp, end = 12.dp, top = 14.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Chat", fontFamily = Serif, fontSize = 26.sp, color = ink.fg)
                Text(if (paper) "Knows the whole paper and your highlights" else "Knows the book up to your page, no further", fontFamily = Sans, fontSize = 12.sp, color = ink.muted)
            }
            if (messages.isNotEmpty()) {
                Text(
                    "New chat",
                    fontFamily = Sans, fontSize = 12.5.sp, color = ink.muted,
                    modifier = Modifier.clip(RoundedCornerShape(50)).clickable { clear() }.padding(horizontal = 12.dp, vertical = 7.dp),
                )
            }
            Box(Modifier.padding(start = 4.dp).size(36.dp).clip(CircleShape).background(ink.chip).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Close, "Close the chat", tint = ink.fg, modifier = Modifier.size(18.dp))
            }
        }

        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, contentPadding = PaddingValues(horizontal = 22.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            if (messages.isEmpty()) {
                item {
                    Column(Modifier.padding(top = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            if (paper) "Ask anything about this paper." else "Ask anything about what you've read.",
                            fontFamily = Serif, fontSize = 21.sp, lineHeight = 27.sp, color = ink.fg,
                            modifier = Modifier.padding(bottom = 8.dp),
                        )
                        SUGGESTIONS.getValue(paper).forEach { s ->
                            Text(
                                s,
                                fontFamily = Sans, fontSize = 14.sp, color = ink.fg,
                                modifier = Modifier.clip(RoundedCornerShape(16.dp)).background(ink.chip).clickable { send(s) }.padding(horizontal = 14.dp, vertical = 9.dp),
                            )
                        }
                    }
                }
            }
            itemsIndexed(messages) { _, m ->
                if (m.role == "user") {
                    Column(Modifier.fillMaxWidth().padding(start = 36.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        m.quote?.let { q ->
                            Text(
                                q, fontFamily = Serif, fontStyle = FontStyle.Italic, fontSize = 13.5.sp, color = ink.muted, maxLines = 3, overflow = TextOverflow.Ellipsis,
                                textAlign = androidx.compose.ui.text.style.TextAlign.End,
                                modifier = Modifier.drawBehind { drawLine(ink.accent, Offset(size.width + 10.dp.toPx(), 0f), Offset(size.width + 10.dp.toPx(), size.height), strokeWidth = 2.dp.toPx()) }.padding(end = 2.dp),
                            )
                        }
                        Text(
                            m.content, fontFamily = Sans, fontSize = 15.sp, lineHeight = 20.sp, color = ink.bg,
                            modifier = Modifier.clip(RoundedCornerShape(18.dp, 18.dp, 6.dp, 18.dp)).background(ink.fg).padding(horizontal = 15.dp, vertical = 10.dp),
                        )
                    }
                } else when {
                    m.content.isEmpty() -> Thinking()
                    m.error -> Text(m.content, fontFamily = Sans, fontSize = 15.sp, color = MaterialTheme.colorScheme.error)
                    else -> CompositionLocalProvider(LocalUriHandler provides cites) { Markdown(linkCites(m.content)) }
                }
            }
        }

        // The question: Enter sends, Shift+Enter starts a new line, as on the site.
        Column(
            Modifier.fillMaxWidth().drawBehind { drawLine(ink.rule, Offset(0f, 0f), Offset(size.width, 0f), strokeWidth = 1f) }.navigationBarsPadding().padding(12.dp),
        ) {
            quote?.let { q ->
                Row(Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(RoundedCornerShape(16.dp)).background(ink.chip).padding(start = 12.dp, top = 8.dp, bottom = 8.dp, end = 4.dp), verticalAlignment = Alignment.Top) {
                    Text("“$q”", fontFamily = Serif, fontStyle = FontStyle.Italic, fontSize = 13.5.sp, color = ink.muted, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Icon(Icons.Outlined.Close, "Don't ask about this passage", tint = ink.muted, modifier = Modifier.size(28.dp).clip(CircleShape).clickable { quote = null; image = null }.padding(6.dp))
                }
            }
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(18.dp)).background(ink.chip).padding(horizontal = 16.dp, vertical = 11.dp)) {
                    if (input.isEmpty()) Text(if (quote != null) "Ask about this passage…" else "Ask a question…", fontFamily = Sans, fontSize = 15.sp, color = ink.faint)
                    BasicTextField(
                        value = input,
                        onValueChange = { input = it },
                        textStyle = TextStyle(fontFamily = Sans, fontSize = 15.sp, lineHeight = 20.sp, color = ink.fg),
                        cursorBrush = SolidColor(ink.accent),
                        maxLines = 6,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { send(input) }),
                        modifier = Modifier.fillMaxWidth().focusRequester(field).onPreviewKeyEvent { e ->
                            if (e.key == Key.Enter && !e.isShiftPressed) {
                                if (e.type == KeyEventType.KeyDown) send(input)
                                true
                            } else false
                        },
                    )
                }
                val ready = streaming == null && input.isNotBlank()
                Box(
                    Modifier.size(44.dp).clip(CircleShape).background(ink.fg).alpha(if (ready) 1f else 0.4f).clickable(enabled = ready) { send(input) },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowForward, "Send", tint = ink.bg, modifier = Modifier.size(20.dp))
                }
            }
            Text("Claude Haiku · check anything important against the text.", fontFamily = Sans, fontSize = 11.sp, color = ink.faint, modifier = Modifier.padding(start = 4.dp, top = 8.dp))
        }
    }
}

/** Three dots, pulsing in turn, while the answer is on its way. */
@Composable
fun Thinking() {
    val paper = LocalPaper.current
    val pulse = rememberInfiniteTransition(label = "thinking")
    Row(Modifier.padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        repeat(3) { i ->
            val a by pulse.animateFloat(0.25f, 1f, infiniteRepeatable(tween(600, delayMillis = i * 150), RepeatMode.Reverse), label = "dot$i")
            Box(Modifier.size(6.dp).alpha(a).clip(CircleShape).background(paper.muted))
        }
    }
}
