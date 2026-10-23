package com.sharathchenna.shelf.ui

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import kotlinx.coroutines.launch

/** "+ Add", the site's Add in the top bar: in the corner of the library and the clippings. */
@Composable
fun AddButton(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val paper = LocalPaper.current
    Row(
        modifier.shadow(8.dp, RoundedCornerShape(50)).clip(RoundedCornerShape(50)).background(paper.fg).clickable(onClick = onClick)
            .padding(start = 16.dp, end = 20.dp, top = 13.dp, bottom = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Add, null, tint = paper.bg, modifier = Modifier.size(20.dp))
        Text("  Add", color = paper.bg, fontFamily = Sans, fontSize = 15.sp)
    }
}

/**
 * Clip a link (an article, a paper, a newsletter issue or a tweet) into the site, as the share
 * sheet does: the server reads the link's details, and the new clipping shows once the library
 * is fetched again. A link on the clipboard is offered first.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddLinkSheet(onDismiss: () -> Unit) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val copied = remember { clipboardLink(context) }
    var link by remember { mutableStateOf(copied.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var answer by remember { mutableStateOf<String?>(null) }
    val field = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { field.requestFocus() } }

    fun save() {
        val text = link.trim()
        if (text.isEmpty() || busy) return
        busy = true; answer = null
        scope.launch {
            answer = runCatching { shelf.capture(text) }.getOrElse { it.message ?: "Not saved." }
            busy = false
            runCatching { shelf.refreshLibrary() }
            link = ""
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(horizontal = 28.dp).padding(bottom = 32.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Add a link", fontFamily = Serif, fontSize = 30.sp, color = paper.fg)
            Text(
                "An article, a paper, a newsletter issue or a tweet. Shelf reads its details and files it with the clippings.",
                fontFamily = Sans, fontSize = 14.5.sp, lineHeight = 21.sp, color = paper.muted,
            )
            OutlinedTextField(
                link, { link = it },
                placeholder = { Text("https://…") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { save() }),
                modifier = Modifier.fillMaxWidth().focusRequester(field),
            )
            if (copied != null && link != copied && answer == null) {
                Text(
                    "Use the copied link",
                    fontFamily = Sans, fontSize = 13.sp, color = paper.accent,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { link = copied }.padding(vertical = 4.dp),
                )
            }
            answer?.let { Text(it, fontFamily = Sans, fontSize = 14.sp, color = paper.fg) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text(if (answer != null) "Done" else "Cancel") }
                Button(enabled = link.isNotBlank() && !busy, onClick = ::save) {
                    if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    else Text("Add")
                }
            }
        }
    }
}

private fun clipboardLink(context: Context): String? {
    val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip ?: return null
    if (clip.itemCount == 0) return null
    val text = clip.getItemAt(0).coerceToText(context)?.toString() ?: return null
    return Regex("""https?://\S+""").find(text)?.value
}
