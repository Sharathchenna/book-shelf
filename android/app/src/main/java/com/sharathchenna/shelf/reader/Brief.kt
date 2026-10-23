package com.sharathchenna.shelf.reader

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sharathchenna.shelf.data.BriefPoint
import com.sharathchenna.shelf.data.StoredBrief
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import kotlinx.coroutines.launch

/**
 * A paper's or article's brief, as the site's reader shows it: the gist, what it claims and what
 * to keep in mind, each point taking the reader to the section that says it. Written once (by the
 * site's AI, on asking) and kept with the file.
 */
@Composable
fun BriefPanel(bookId: String, onSection: (Int) -> Unit) {
    val shelf = LocalShelf.current
    val paper = LocalPaper.current
    val scope = rememberCoroutineScope()
    var brief by remember { mutableStateOf<StoredBrief?>(null) }
    var state by remember { mutableStateOf("loading") }
    LaunchedEffect(bookId) {
        state = runCatching { shelf.api.brief(bookId) }.fold({ brief = it; if (it == null) "none" else "ready" }, { it.message ?: "Couldn't fetch the brief." })
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        when (state) {
            "loading" -> Thinking()
            "writing" -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Writing the brief… it takes a few seconds.", fontFamily = Sans, fontSize = 14.sp, color = paper.muted)
                Thinking()
            }
            "none" -> {
                Text("The gist, the claims and the caveats, each a tap from where it's said.", fontFamily = Serif, fontSize = 19.sp, lineHeight = 26.sp, color = paper.fg)
                Button(onClick = {
                    state = "writing"
                    scope.launch { state = runCatching { shelf.api.writeBrief(bookId) }.fold({ brief = it; "ready" }, { it.message ?: "Couldn't write the brief." }) }
                }) { Text("Write the brief") }
            }
            "ready" -> brief?.brief?.let { b ->
                Text(b.gist, fontFamily = Serif, fontSize = 19.sp, lineHeight = 27.sp, color = paper.fg)
                if (b.claims.isNotEmpty()) Points("WHAT IT CLAIMS", b.claims, onSection)
                if (b.caveats.isNotEmpty()) Points("KEEP IN MIND", b.caveats, onSection)
            }
            else -> {
                Text(state, color = MaterialTheme.colorScheme.error, fontFamily = Sans, fontSize = 14.sp)
                TextButton(onClick = { state = "none" }) { Text("Try again") }
            }
        }
    }
}

@Composable
private fun Points(title: String, points: List<BriefPoint>, onSection: (Int) -> Unit) {
    val paper = LocalPaper.current
    Text(title, style = Eyebrow, color = paper.muted, modifier = Modifier.padding(top = 6.dp))
    points.forEach { p ->
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).then(if (p.section != null) Modifier.clickable { onSection(p.section) } else Modifier).padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("•", color = paper.accent, fontSize = 16.sp)
            Column(Modifier.weight(1f)) {
                Text(p.text, fontFamily = Sans, fontSize = 15.sp, lineHeight = 21.sp, color = paper.fg)
                p.section?.let { Text("Go to where it's said", fontFamily = Sans, fontSize = 12.sp, color = paper.accent) }
            }
        }
    }
}
