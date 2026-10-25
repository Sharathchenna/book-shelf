package com.sharathchenna.shelf.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sharathchenna.shelf.data.Highlight
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans

/**
 * A highlight tapped: Readwise Reader's little bar in the margin beside it, with a note, its tags,
 * a question about it, its colour and Remove; the full editor is a tap on Note away.
 */
@Composable
fun HighlightBar(
    note: Highlight,
    onNote: () -> Unit,
    onTags: () -> Unit,
    onAsk: () -> Unit,
    onColor: (String) -> Unit,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val paper = LocalPaper.current
    var colours by remember(note.id) { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = modifier) {
        if (colours) Column(
            Modifier.shadow(8.dp, CircleShape).background(paper.raised, CircleShape).padding(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            HIGHLIGHT_ARGB.forEach { (name, argb) ->
                Box(
                    Modifier.size(34.dp).clip(CircleShape).then(if (name == note.color) Modifier.border(2.dp, paper.fg, CircleShape) else Modifier)
                        .clickable { onColor(name); colours = false }.padding(6.dp).clip(CircleShape).background(Color(argb)),
                )
            }
        }
        Column(
            Modifier.shadow(8.dp, RoundedCornerShape(28.dp)).background(paper.raised, RoundedCornerShape(28.dp)).padding(vertical = 6.dp, horizontal = 4.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BarButton(Icons.Outlined.EditNote, if (note.note.isNullOrBlank()) "Add a note" else "Edit the note", onNote)
            BarButton(Icons.Outlined.Sell, if (note.tags.isEmpty()) "Tag" else "Tags: ${note.tags.joinToString()}", onTags, badge = note.tags.size.takeIf { it > 0 })
            BarButton(Icons.AutoMirrored.Outlined.Chat, "Ask about it", onAsk)
            if (note.ink == null) BarButton(Icons.Outlined.Palette, "Colour", { colours = !colours })
            BarButton(Icons.Outlined.Delete, "Remove", onRemove, tint = Color(0xFFC0392B))
        }
    }
}

@Composable
private fun BarButton(icon: ImageVector, label: String, onClick: () -> Unit, tint: Color? = null, badge: Int? = null) {
    val paper = LocalPaper.current
    Box {
        Icon(icon, label, tint = tint ?: paper.fg, modifier = Modifier.size(46.dp).clip(CircleShape).clickable(onClick = onClick).padding(11.dp))
        badge?.let {
            Text("$it", fontFamily = Sans, fontSize = 10.sp, color = paper.bg, modifier = Modifier.align(Alignment.TopEnd).padding(top = 4.dp, end = 4.dp).clip(CircleShape).background(paper.accent).padding(horizontal = 5.dp))
        }
    }
}

/** A highlight's tags: those it has (a tap removes one), a field for another, and the book's others to pick from. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TagEditor(note: Highlight, others: List<String>, onSave: (List<String>) -> Unit, onDismiss: () -> Unit) {
    val paper = LocalPaper.current
    var tags by remember(note.id) { mutableStateOf(note.tags) }
    var typed by remember(note.id) { mutableStateOf("") }
    val add = { t: String -> t.trim().takeIf { it.isNotEmpty() && it !in tags }?.let { tags = tags + it.take(40) }; typed = "" }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Tags") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (tags.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    tags.forEach { t ->
                        Row(
                            Modifier.clip(CircleShape).background(paper.fg).clickable { tags = tags - t }.padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(t, fontFamily = Sans, fontSize = 14.sp, color = paper.bg)
                            Spacer(Modifier.width(4.dp))
                            Icon(Icons.Outlined.Close, "Remove $t", Modifier.size(14.dp), tint = paper.bg)
                        }
                    }
                }
                OutlinedTextField(
                    typed, { v -> if (v.endsWith(",")) add(v.dropLast(1)) else typed = v },
                    label = { Text("Add a tag") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { add(typed) }),
                )
                val suggested = others.filter { it !in tags && (typed.isBlank() || it.contains(typed.trim(), ignoreCase = true)) }.take(12)
                if (suggested.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    suggested.forEach { t ->
                        Text(
                            t, fontFamily = Sans, fontSize = 14.sp, color = paper.fg,
                            modifier = Modifier.clip(CircleShape).border(1.dp, paper.rule, CircleShape).clickable { add(t) }.padding(horizontal = 12.dp, vertical = 6.dp),
                        )
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onSave((if (typed.isNotBlank()) tags + typed.trim() else tags).distinct()) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
