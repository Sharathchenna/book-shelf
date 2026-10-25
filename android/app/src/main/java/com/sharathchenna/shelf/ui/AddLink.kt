package com.sharathchenna.shelf.ui

import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import com.sharathchenna.shelf.data.ShelfApi
import com.sharathchenna.shelf.reader.pdf.readPdfForLibrary
import com.sharathchenna.shelf.ui.theme.Eyebrow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
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
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
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
 * Adding to the library: a link (an article, a paper, a newsletter issue, a post, a video or an episode) clipped as the
 * share sheet does, the one on the clipboard offered first; or an EPUB or PDF from the tablet,
 * uploaded as the site's upload does. The new thing shows once the library is fetched again.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddLinkSheet(onDismiss: () -> Unit, onOpen: (fileId: String) -> Unit = {}) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val copied = remember { clipboardLink(context) }
    var link by remember { mutableStateOf(copied.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var answer by remember { mutableStateOf<String?>(null) }
    // A file on its way: what it's doing, and once it's in, its id to open.
    var sending by remember { mutableStateOf<String?>(null) }
    var added by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf<String?>(null) }

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

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        added = null; failed = null; sending = "Getting the file…"
        scope.launch {
            runCatching { addFile(context, shelf, uri) { sending = it } }
                .onSuccess { added = it }
                .onFailure { failed = it.message ?: "Couldn't add that file." }
            sending = null
        }
    }

    ModalBottomSheet(onDismissRequest = { if (sending == null) onDismiss() }) {
        Column(Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(horizontal = 28.dp).padding(bottom = 32.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Add to Shelf", fontFamily = Serif, fontSize = 30.sp, color = paper.fg)

            Text("A LINK", style = Eyebrow, color = paper.faint, modifier = Modifier.padding(top = 4.dp))
            Text(
                "An article, a paper, a newsletter issue, a post, a YouTube video or a podcast episode. Shelf reads its details and files it in your Inbox.",
                fontFamily = Sans, fontSize = 14.5.sp, lineHeight = 21.sp, color = paper.muted,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    link, { link = it },
                    placeholder = { Text("https://…") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { save() }),
                    modifier = Modifier.weight(1f),
                )
                Button(enabled = link.isNotBlank() && !busy, onClick = ::save) {
                    if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    else Text("Add")
                }
            }
            if (copied != null && link != copied && answer == null) {
                Text(
                    "Use the copied link",
                    fontFamily = Sans, fontSize = 13.sp, color = paper.accent,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { link = copied }.padding(vertical = 4.dp),
                )
            }
            answer?.let { Text(it, fontFamily = Sans, fontSize = 14.sp, color = paper.fg) }

            HorizontalDivider(Modifier.padding(vertical = 6.dp), color = paper.rule)
            Text("A FILE", style = Eyebrow, color = paper.faint)
            Text(
                "A PDF or EPUB from this tablet, up to 100 MB. It's added to your library, to read here and on the site.",
                fontFamily = Sans, fontSize = 14.5.sp, lineHeight = 21.sp, color = paper.muted,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(enabled = sending == null, onClick = { pick.launch(arrayOf("application/pdf", "application/epub+zip")) }) {
                    Icon(Icons.Outlined.UploadFile, null, Modifier.size(18.dp))
                    Text("  Choose a PDF or EPUB")
                }
                added?.let { id -> Button(onClick = { onDismiss(); onOpen(id) }) { Text("Open it") } }
            }
            sending?.let {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Text(it, fontFamily = Sans, fontSize = 14.sp, color = paper.fg)
                }
            }
            if (added != null && sending == null) Text("Added to your library.", fontFamily = Sans, fontSize = 14.sp, color = paper.fg)
            failed?.let { Text(it, fontFamily = Sans, fontSize = 14.sp, color = MaterialTheme.colorScheme.error) }

            Row {
                Spacer(Modifier.weight(1f))
                TextButton(enabled = sending == null, onClick = onDismiss) { Text("Done") }
            }
        }
    }
}

/**
 * An EPUB or PDF from the tablet into the library, as the site's upload does it: a URL to send it
 * to, the file sent straight to storage, then finished. The site reads an EPUB itself; a PDF's
 * pages and cover are read here and sent along. Answers with the new file's id.
 */
private suspend fun addFile(context: Context, shelf: com.sharathchenna.shelf.data.Shelf, uri: Uri, say: (String) -> Unit): String {
    val resolver = context.contentResolver
    val shown = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "Untitled"
    val type = resolver.getType(uri).orEmpty()
    val format = when {
        shown.endsWith(".pdf", ignoreCase = true) || type == "application/pdf" -> "pdf"
        shown.endsWith(".epub", ignoreCase = true) || type == "application/epub+zip" -> "epub"
        else -> throw IllegalArgumentException("Only EPUB and PDF files can be added.")
    }
    val name = if (shown.endsWith(".$format", ignoreCase = true)) shown else "$shown.$format"
    val file = File(context.cacheDir, "upload.$format")
    withContext(Dispatchers.IO) { resolver.openInputStream(uri)!!.use { input -> file.outputStream().use { input.copyTo(it) } } }
    try {
        val start = shelf.api.startUpload(file.length(), name)
        shelf.api.sendFile(start.uploadUrl, file, start.contentType) { say("Uploading… ${Math.round(it * 100)}%") }
        if (start.format == "pdf") {
            say("Reading the pages…")
            val (pages, cover) = readPdfForLibrary(context, file) { done, total -> say("Reading the pages… $done of $total") }
            say("Filing it…")
            val title = name.removeSuffix(".pdf").removeSuffix(".PDF").replace(Regex("[_-]+"), " ").trim()
            shelf.api.finishUpload(start.id, ShelfApi.Finish(format = "pdf", title = title, pages = pages, cover = cover))
        } else {
            say("Reading the book…")
            shelf.api.finishUpload(start.id, ShelfApi.Finish())
        }
        runCatching { shelf.refreshLibrary() }
        return start.id
    } finally {
        file.delete()
    }
}

private fun clipboardLink(context: Context): String? {
    val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip ?: return null
    if (clip.itemCount == 0) return null
    val text = clip.getItemAt(0).coerceToText(context)?.toString() ?: return null
    return Regex("""https?://\S+""").find(text)?.value
}
