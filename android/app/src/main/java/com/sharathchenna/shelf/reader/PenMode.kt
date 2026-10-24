package com.sharathchenna.shelf.reader

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BorderColor
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans

/**
 * What the pen does on the page. Reading, it's a finger: it scrolls, zooms and turns pages, and
 * taps as ever. Marking, it highlights what it's drawn across, writes where there's no text, and
 * loops or brackets for the menu, and scrolling is left to the fingers. Every reader opens reading.
 */
enum class PenMode { Read, Mark }

/** How long after the pen a touching hand is taken as resting: long while marking, a moment while reading. */
val PenMode.graceMs: Long get() = if (this == PenMode.Mark) 1500L else 300L

/** The switch between the two, always on the page: a hand for reading, a highlighter for marking. */
@Composable
fun PenModeToggle(mode: PenMode, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    val paper = LocalPaper.current
    val marking = mode == PenMode.Mark
    val fill by animateColorAsState(if (marking) paper.accent else paper.raised, label = "pen-mode")
    val ink = if (marking) androidx.compose.ui.graphics.Color.White else paper.fg
    Row(
        modifier
            .shadow(6.dp, RoundedCornerShape(50))
            .clip(RoundedCornerShape(50))
            .background(fill)
            .clickable(role = Role.Switch, onClick = onToggle)
            .semantics { contentDescription = if (marking) "Pen marks: tap so the pen scrolls instead" else "Pen scrolls: tap so the pen marks" }
            .padding(start = 12.dp, end = 16.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (marking) Icons.Outlined.BorderColor else Icons.Outlined.PanTool, null, tint = ink, modifier = Modifier.size(18.dp))
        Text(if (marking) "  Mark" else "  Read", color = ink, fontFamily = Sans, fontSize = 14.sp)
    }
}
