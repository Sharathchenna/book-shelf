package com.sharathchenna.shelf.ui.library

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.sharathchenna.shelf.BuildConfig
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.data.Topic
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans

/*
 * The bookcase as the site lays it out (app/components/bookcase/shelf.tsx): left to right along
 * a plank, a gap between runs of a topic (or a month, or a length), a new shelf when one is full,
 * each run's name under the plank beneath it, a bookend at the end of every shelf and something
 * growing on the last. The site's measures, in dp, times the shelf's scale.
 */

private const val PAD = 28f
private const val GAP = 3f
private const val GROUP_GAP = 36f
private const val LABEL_GAP = 18f
/** The room a book stands in, the plank under it, and the room for the labels beneath. */
const val AREA = 268f
private const val PLANK = 16f
const val PITCH = AREA + PLANK + 52f

/** One of the bookcase's clay figures, for a topic or a tag (public/library/icons on the site). */
@Composable
fun Glyph(key: String, size: Dp, modifier: Modifier = Modifier) {
    AsyncImage("${BuildConfig.SITE_URL}/library/icons/$key.webp", contentDescription = null, modifier = modifier.size(size))
}

data class Placed(val book: ShelfBook, val x: Float, val y: Float)
data class ShelfLabel(val key: String, val label: String, val icon: String?, val x: Float, val count: Int)
data class ShelfRow(val books: List<Placed>, val labels: List<ShelfLabel>, val end: Float)

/**
 * Where every book stands, the site's way: runs of one group stay together where they can, a
 * new shelf when one is full, and each run's label centred under the part of it on its first
 * shelf, never closer than LABEL_GAP to the label before it.
 */
fun shelve(books: List<ShelfBook>, width: Float, sort: Sort, topics: Map<String, Topic>, labelWidth: (String, Boolean, Int) -> Float): List<ShelfRow> {
    val inner = maxOf(200f, width)
    val right = inner - PAD
    data class Run(val g: Group?, val books: MutableList<ShelfBook>)
    val runs = mutableListOf<Run>()
    for (b in books) {
        val g = groupOf(b, sort, topics)
        val last = runs.lastOrNull()
        if (last != null && last.g?.key == g?.key) last.books += b else runs += Run(g, mutableListOf(b))
    }

    val rows = mutableListOf<ShelfRow>()
    var placed = mutableListOf<Placed>()
    var labels = mutableListOf<ShelfLabel>()
    var edge = PAD
    var labelEdge = Float.NEGATIVE_INFINITY
    var used = false
    fun wrap() {
        rows += ShelfRow(placed, labels, edge)
        placed = mutableListOf(); labels = mutableListOf()
        edge = PAD; labelEdge = Float.NEGATIVE_INFINITY; used = false
    }

    for (run in runs) {
        val ws = run.books.map { it.look.w.toFloat() }
        val runW = ws.sum() + GAP * (ws.size - 1)
        val lw = run.g?.let { labelWidth(it.label, it.icon != null, run.books.size) } ?: 0f
        var x = PAD
        if (used) {
            x = edge + GROUP_GAP
            if (run.g != null) x = maxOf(x, labelEdge + LABEL_GAP + lw / 2 - minOf(runW, right - x) / 2)
            if (x + ws[0] > right) { wrap(); x = PAD }
        }
        val startRow = rows.size
        val segStart = x
        var segEnd = -1f
        run.books.forEachIndexed { i, b ->
            if (used && x + ws[i] > right) {
                if (segEnd < 0) segEnd = edge
                wrap()
                x = PAD
            }
            placed += Placed(b, x, AREA - b.look.h)
            edge = x + ws[i]
            x = edge + GAP
            used = true
        }
        if (segEnd < 0) segEnd = edge
        run.g?.let { g ->
            val target = if (rows.size == startRow) labels else rows[startRow].labels as MutableList<ShelfLabel>
            val before = target.lastOrNull()
            var left = (segStart + segEnd) / 2 - lw / 2
            if (before != null) left = maxOf(left, before.x + labelWidth(before.label, before.icon != null, before.count) + LABEL_GAP)
            left = maxOf(2f, minOf(inner - lw, left))
            target += ShelfLabel(g.key, g.label, g.icon, left, run.books.size)
            if (rows.size == startRow) labelEdge = left + lw
        }
    }
    rows += ShelfRow(placed, labels, edge)
    return rows
}

private val PlantLeaves by lazy { listOf(
    "M46 84C44 60 30 44 12 40c4 20 16 36 34 44z" to Color(0xFF5F8A55),
    "M46 84c2-26 14-46 34-52-2 24-14 42-34 52z" to Color(0xFF4B7444),
    "M46 86C40 56 44 26 58 6c8 26 2 56-12 80z" to Color(0xFF6F9B62),
    "M46 86C36 66 22 60 6 64c10 14 24 22 40 22z" to Color(0xFF55804C),
    "M46 86c10-16 26-22 42-18-8 14-24 20-42 18z" to Color(0xFF6A9560),
    "M22 84h48l-6 46H28z" to Color(0xFFC4704B),
    "M19 80h54v9H19z" to Color(0xFFD4825C),
).map { (d, c) -> PathParser().parsePathString(d).toPath() to c } }
private val BookendPath by lazy { PathParser().parsePathString("M3 64V24C3 12 11 3 23 3h3v61z").toPath() }

/** One shelf: its books standing on the plank, the labels under it, its bookend, and on the last, the plant and the pile. */
@Composable
fun ShelfRowView(
    row: ShelfRow,
    last: Boolean,
    width: Float,
    scale: Float,
    selected: String?,
    onOpen: (ShelfBook) -> Unit,
    onLabel: ((String) -> Unit)?,
) {
    val paper = LocalPaper.current
    fun d(px: Float): Dp = (px * scale).dp
    Box(Modifier.fillMaxWidth().height(d(PITCH - 20))) {
        // The plank, with the shade the books cast on the wall above it.
        Box(Modifier.offset(y = d(AREA - 26f)).fillMaxWidth().height(d(26f)).background(Brush.verticalGradient(listOf(Color.Transparent, paper.shelfShade))))
        Box(
            Modifier.offset(y = d(AREA)).fillMaxWidth().height(d(PLANK))
                .shadow(d(10f), RoundedCornerShape(bottomStart = d(4f), bottomEnd = d(4f)), ambientColor = Color(0xFF281E14), spotColor = Color(0xFF281E14))
                .background(Brush.verticalGradient(0f to paper.plankTop, 0.37f to paper.plankTop, 0.38f to paper.plankEdge, 0.44f to paper.plankFront, 1f to paper.plankFront)),
        )
        // The bookend.
        Canvas(Modifier.offset(x = d(row.end + 2f), y = d(AREA - 64f)).size(d(30f), d(64f))) {
            scale(size.width / 30f, size.height / 64f, pivot = Offset.Zero) {
                drawPath(BookendPath, paper.bookend)
                drawPath(BookendPath, Brush.horizontalGradient(0f to Color.White.copy(alpha = 0.22f), 0.5f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.18f), startX = 0f, endX = 30f))
            }
        }
        if (last) {
            val free = width - PAD - row.end
            if (free >= 330) {
                // A pile of books lying down.
                Box(Modifier.offset(x = d(width - PAD - 92f - 170f), y = d(AREA - 46f))) {
                    listOf(Triple(0xFF3B2F6E, 146f, 8f), Triple(0xFFE5C97A, 136f, 0f), Triple(0xFFA43848, 156f, 3f)).forEachIndexed { i, (c, w, ml) ->
                        Box(Modifier.offset(x = d(ml), y = d(i * 15f)).size(d(w), d(14f)).background(Color(c), RoundedCornerShape(d(2f)))
                            .background(Brush.verticalGradient(0f to Color.White.copy(alpha = 0.14f), 0.4f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.16f)), RoundedCornerShape(d(2f))))
                    }
                }
            }
            if (free >= 140) {
                Canvas(Modifier.offset(x = d(width - PAD - 92f), y = d(AREA - 132f)).size(d(92f), d(132f))) {
                    scale(size.width / 92f, size.height / 132f, pivot = Offset.Zero) {
                        PlantLeaves.forEach { (p, c) -> drawPath(p, c) }
                        drawLine(Color.Black.copy(alpha = 0.18f), Offset(28f, 130f), Offset(64f, 130f), strokeWidth = 2f)
                    }
                }
            }
        }
        // The books, a chosen one lifted a little off the shelf.
        row.books.forEach { p ->
            val lift by animateDpAsState(if (p.book.id == selected) d(-14f) else 0.dp, label = "lift")
            Spine(
                p.book,
                scale,
                Modifier.offset(x = d(p.x), y = d(p.y) + lift)
                    .shadow(d(3f), RoundedCornerShape(d(2f)), clip = false)
                    .semantics { contentDescription = "${p.book.title}, ${p.book.author}" }
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onOpen(p.book) },
            )
        }
        // Each run's name under the plank.
        row.labels.forEach { l ->
            Row(
                Modifier.offset(x = d(l.x), y = d(AREA + PLANK + 8f)).height(d(26f))
                    .then(if (onLabel != null) Modifier.clickable { onLabel(l.key) } else Modifier)
                    .padding(start = d(8f), end = d(9f)),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                l.icon?.let { Glyph(it, d(16f)); Spacer(Modifier.width(d(5f))) }
                Text(l.label, fontFamily = Sans, fontWeight = FontWeight(500), fontSize = (12.5f * scale).sp, color = paper.muted)
                Text("  ${l.count}", fontFamily = Sans, fontSize = (12.5f * scale).sp, color = paper.faint)
            }
        }
    }
}

/** A label's width as drawn, for keeping labels apart: its icon, its words, its count and its padding. */
@Composable
fun rememberLabelWidth(scale: Float): (String, Boolean, Int) -> Float {
    val measurer = rememberTextMeasurer()
    val density = androidx.compose.ui.platform.LocalDensity.current.density
    return remember(measurer, scale) {
        val cache = HashMap<String, Float>()
        val style = TextStyle(fontFamily = Sans, fontWeight = FontWeight(500), fontSize = 12.5.sp)
        fun text(s: String): Float = cache.getOrPut(s) { measurer.measure(s, style).size.width / density }
        val width: (String, Boolean, Int) -> Float = { label, icon, count -> (if (icon) 21f else 0f) + text(label) + 6f + text(count.toString()) + 17f }
        width
    }
}
