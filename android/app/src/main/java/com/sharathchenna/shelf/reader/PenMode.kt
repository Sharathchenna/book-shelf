package com.sharathchenna.shelf.reader

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.BorderColor
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.material.icons.outlined.ModeEdit
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans

/**
 * What the pen does on the page. Reading, it's a finger: it scrolls, zooms and turns pages, and
 * taps as ever. Marking, it highlights, writes or rubs out, and scrolling is left to the fingers.
 */
enum class PenMode { Read, Mark }

/** How long after the pen a touching hand is taken as resting: long while marking, a moment while reading. */
val PenMode.graceMs: Long get() = if (this == PenMode.Mark) 1500L else 300L

/**
 * The pen's tool, chosen from the palette down the page's left side, as in the PDF apps made for a
 * pen. Read scrolls; Highlight marks text it's drawn across; Write inks (on a PDF's page, or a note
 * beside an EPUB's paragraph), where a loop or bracket round a passage offers the menu; Erase rubs
 * out. Holding the pen's button selects for the menu whatever the tool, and its eraser end rubs out.
 */
enum class Nib(val label: String) { Read("Read"), Highlight("Highlight"), Write("Write"), Erase("Erase") }

val Nib.mode: PenMode get() = if (this == Nib.Read) PenMode.Read else PenMode.Mark

/** The tool a reader opens with: Read, or Highlight when the settings say the pen opens marking. */
fun ReaderBehaviour.startNib(): Nib = if (penStart == "mark") Nib.Highlight else Nib.Read

/** The width the palette takes at the page's left, so a page laid out beside it isn't covered. */
val PaletteWidth = 88.dp

/** Material Symbols' ink eraser, which Material's icon set lacks. */
private val Eraser: ImageVector by lazy {
    ImageVector.Builder("Eraser", 24.dp, 24.dp, 960f, 960f)
        .addGroup(translationY = 960f)
        .addPath(
            PathParser().parsePathString("M690-240h190v80H610l80-80Zm-500 80-85-85q-23-23-23.5-57t22.5-58l440-456q23-24 56.5-24t56.5 23l199 199q23 23 23 57t-23 57L520-160H190Zm296-80 314-322-198-198-442 456 64 64h262Zm-6-240Z").toNodes(),
            fill = SolidColor(Color.Black),
        )
        .clearGroup()
        .build()
}

/**
 * The palette: the pen's tools, then Ask and Listen, in a column at the page's left. Choosing the
 * highlighter again offers its colours; the pen's colours and widths, where there are any. It
 * folds away to a single button showing the tool in hand.
 */
@Composable
fun PenPalette(
    nib: Nib,
    onNib: (Nib) -> Unit,
    color: String,
    onColor: (String) -> Unit,
    onAsk: () -> Unit,
    onListen: () -> Unit,
    folded: Boolean,
    onFold: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    /** The pen's own options (colour and width), shown beside it when Write is chosen again. */
    penOptions: (@Composable () -> Unit)? = null,
) {
    val paper = LocalPaper.current
    var options by remember { mutableStateOf<Nib?>(null) }
    var hint by remember { mutableStateOf<Nib?>(null) }
    LaunchedEffect(hint) { if (hint != null) { kotlinx.coroutines.delay(1400); hint = null } }
    // The colours step away again if none is chosen.
    LaunchedEffect(options, color) { if (options != null) { kotlinx.coroutines.delay(5000); options = null } }
    val choose: (Nib) -> Unit = { n ->
        if (n == nib && (n == Nib.Highlight || (n == Nib.Write && penOptions != null))) options = if (options == n) null else n
        else { options = null; hint = n; onNib(n) }
    }
    val shape = RoundedCornerShape(26.dp)
    if (folded) {
        Box(
            modifier.padding(start = 12.dp).size(48.dp).shadow(8.dp, CircleShape).clip(CircleShape).background(if (nib == Nib.Read) paper.raised else paper.fg)
                .clickable { onFold(false) }.semantics { contentDescription = "Show the pen tools (${nib.label})" },
            contentAlignment = Alignment.Center,
        ) { Icon(iconOf(nib), null, tint = if (nib == Nib.Read) paper.fg else paper.bg, modifier = Modifier.size(22.dp)) }
        return
    }
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Column(
            Modifier.padding(start = 14.dp).shadow(10.dp, shape).clip(shape).background(paper.raised).border(1.dp, paper.rule, shape).padding(7.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Nib.entries.forEach { n ->
                Tool(iconOf(n), n.label, selected = n == nib, dot = if (n == Nib.Highlight) Color(HIGHLIGHT_ARGB[color] ?: HIGHLIGHT_ARGB.getValue("yellow")) else null) { choose(n) }
            }
            Box(Modifier.padding(vertical = 3.dp).width(30.dp).height(1.dp).background(paper.rule))
            Tool(Icons.Outlined.AutoAwesome, "Ask", selected = false, onClick = onAsk)
            Tool(Icons.Outlined.Headphones, "Listen", selected = false, onClick = onListen)
            Box(Modifier.size(52.dp, 30.dp).clip(RoundedCornerShape(12.dp)).clickable { options = null; onFold(true) }.semantics { contentDescription = "Fold the pen tools away" }, contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.ChevronLeft, null, tint = paper.faint, modifier = Modifier.size(20.dp))
            }
        }
        // Beside the palette: the highlighter's colours, the pen's options, or the tool just chosen, named.
        when {
            options == Nib.Highlight -> Popover {
                HIGHLIGHT_ARGB.forEach { (name, argb) ->
                    Box(
                        Modifier.size(36.dp).clip(CircleShape).then(if (name == color) Modifier.border(2.dp, paper.fg, CircleShape) else Modifier)
                            .clickable { onColor(name); options = null }.padding(6.dp).clip(CircleShape).background(Color(argb))
                            .semantics { contentDescription = "Highlight in $name" },
                    )
                }
            }
            options == Nib.Write && penOptions != null -> Popover { penOptions() }
            else -> AnimatedVisibility(hint != null, enter = fadeIn(), exit = fadeOut()) {
                Text(
                    when (hint) { Nib.Read -> "The pen scrolls"; Nib.Highlight -> "The pen highlights"; Nib.Write -> "The pen writes"; Nib.Erase -> "The pen rubs out"; null -> "" },
                    fontFamily = Sans, fontSize = 14.sp, color = paper.bg,
                    modifier = Modifier.padding(start = 10.dp).clip(RoundedCornerShape(10.dp)).background(paper.fg).padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
        }
    }
}

private fun iconOf(n: Nib): ImageVector = when (n) {
    Nib.Read -> Icons.Outlined.PanTool
    Nib.Highlight -> Icons.Outlined.BorderColor
    Nib.Write -> Icons.Outlined.ModeEdit
    Nib.Erase -> Eraser
}

@Composable
private fun Popover(content: @Composable () -> Unit) {
    val paper = LocalPaper.current
    Row(
        Modifier.padding(start = 10.dp).shadow(8.dp, RoundedCornerShape(18.dp)).clip(RoundedCornerShape(18.dp)).background(paper.raised).padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) { content() }
}

@Composable
private fun Tool(icon: ImageVector, label: String, selected: Boolean, dot: Color? = null, onClick: () -> Unit) {
    val paper = LocalPaper.current
    Box(
        Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(if (selected) paper.fg else Color.Transparent)
            .clickable(role = Role.RadioButton, onClick = onClick).semantics { contentDescription = label; this.selected = selected },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, tint = if (selected) paper.bg else paper.fg, modifier = Modifier.size(23.dp))
        dot?.let { Box(Modifier.align(Alignment.BottomEnd).padding(8.dp).size(11.dp).clip(CircleShape).background(it).border(1.5.dp, if (selected) paper.fg else paper.raised, CircleShape)) }
    }
}

/** Whether the palette is folded away, kept for every reader. */
@Composable
fun rememberPaletteFolded(): androidx.compose.runtime.MutableState<Boolean> = rememberSaveable { mutableStateOf(false) }
