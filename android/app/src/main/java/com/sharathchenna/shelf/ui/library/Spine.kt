package com.sharathchenna.shelf.ui.library

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import com.sharathchenna.shelf.ui.theme.hex

/*
 * A book seen end-on, as the site draws it (app/components/bookcase/book.tsx and bookcase.css):
 * cloth with a faint weave, the title running down it, the author across the foot, in one of
 * four styles. Sizes are the site's, in dp, times the shelf's scale.
 */

private val Foil = Color(0xFFECD391)
private val FoilOnLight = Color(0xFF5A3F12)
private val LabelPaper = Color(0xFFF4ECDA)
private val LabelInk = Color(0xFF2A2520)

/** A surname for the foot of a spine: the last word of the first author. */
fun lastName(author: String): String =
    author.removePrefix("@").split(Regex("&|,| and | et al\\.")).first().trim().split(Regex("\\s+")).lastOrNull()?.takeIf { it.isNotEmpty() } ?: author

/** Lays a composable out on its side: it's measured as if the box were turned, then turned to read top to bottom. */
private fun Modifier.downward() = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints.copy(minWidth = 0, minHeight = 0, maxWidth = constraints.maxHeight, maxHeight = constraints.maxWidth))
    layout(placeable.height, placeable.width) {
        placeable.place(-(placeable.width - placeable.height) / 2, -(placeable.height - placeable.width) / 2)
    }
}.rotate(90f)

@Composable
fun Spine(book: ShelfBook, scale: Float, modifier: Modifier = Modifier) {
    val look = book.look
    val w = look.w.toFloat()
    val h = look.h.toFloat()
    val style = look.style
    val cloth = hex(look.color)
    val fg = hex(look.fg)
    val wide = w >= 52
    val by = remember(book.author) { lastName(book.author) }
    // The site's sizing: the author as large as fits across the foot; on a spine too slim for the
    // whole name, it runs down after the title instead.
    val bySize = minOf(11f, w * 0.22f, (w - 12) / maxOf(1f, by.length * 0.56f))
    val narrow = w < 44 || bySize < 8
    val per = if (style == "sans") 0.54f else 0.5f
    val room = h - when (style) { "label" -> 92; "bands" -> 96; else -> 70 }
    val chars = book.title.length + if (narrow) by.length * 0.8f + 2 else 0f
    val base = maxOf(10.5f, minOf(15.5f, w * 0.36f)) * if (style == "sans") 0.86f else 1f
    val titleSize = maxOf(9f, minOf(base, (room * if (wide) 2 else 1) / (chars * per)))
    val titleColor = when {
        style == "label" -> LabelInk
        style == "foil" -> if (look.light) FoilOnLight else Foil
        else -> fg
    }
    val s = scale
    fun d(px: Float): Dp = (px * s).dp

    Box(modifier.size(d(w), d(h))) {
    if (book.pct > 0 && book.pct < 1) {
        // A ribbon marking a book partway through, standing out of the top.
        Box(Modifier.align(Alignment.TopEnd).offset(x = -d(w * 0.24f), y = -d(13f)).size(d(7f), d(15f)).background(LocalPaper.current.accent))
    }
    Box(Modifier.fillMaxSize().clip(RoundedCornerShape(topStart = d(2f), topEnd = d(2f), bottomStart = d(1f), bottomEnd = d(1f)))) {
        // Cloth, rounded at the edges, with a faint weave and a hairline edge.
        Canvas(Modifier.fillMaxSize()) {
            drawRect(cloth)
            drawRect(
                Brush.horizontalGradient(
                    0f to Color.Black.copy(alpha = 0.24f), 0.15f to Color.White.copy(alpha = 0.13f), 0.32f to Color.White.copy(alpha = 0.04f),
                    0.58f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.2f),
                ),
            )
            val step = 3 * s * density
            var y = 0f
            while (y < size.height) {
                drawRect(Color.White.copy(alpha = 0.035f), Offset(0f, y), Size(size.width, s * density))
                y += step
            }
            drawRoundRect(Color.Black.copy(alpha = 0.12f), style = Stroke(width = density), cornerRadius = CornerRadius(2 * density))
            if (style == "bands") {
                val line = fg.copy(alpha = 0.55f)
                for (top in listOf(13f, h - 37f)) {
                    drawRect(line, Offset(0f, top * s * density), Size(size.width, 1.5f * s * density))
                    drawRect(line, Offset(0f, (top + 5.5f) * s * density), Size(size.width, 1.5f * s * density))
                }
            }
        }
        if (style == "foil") {
            Text(
                if (book.favorite) "★" else "◆",
                color = if (look.light) FoilOnLight else Foil,
                fontSize = (10 * s).sp,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = d(9f)).alpha(0.85f),
            )
        }
        if (style == "sans") {
            Glyph(book.topic, size = d(15f), modifier = Modifier.align(Alignment.TopCenter).padding(top = d(8f)))
        }

        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            val titleTop = when (style) { "label" -> 36f; else -> 34f }
            val titleBottom = when {
                style == "label" -> 10f
                narrow && style == "bands" -> 40f
                narrow -> 14f
                style == "bands" -> 6f
                else -> 8f
            }
            val label = style == "label"
            Box(
                Modifier
                    .padding(top = d(titleTop), bottom = d(titleBottom))
                    .then(if (label) Modifier.fillMaxWidth().padding(horizontal = d(5f)) else Modifier.fillMaxWidth())
                    .weight(1f, fill = !label)
                    .then(
                        if (label) Modifier.background(LabelPaper, RoundedCornerShape(d(1f))).padding(vertical = d(12f), horizontal = d(2f))
                        else Modifier.padding(horizontal = d(3f)),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                val text = buildAnnotatedString {
                    append(book.title)
                    if (narrow) withStyle(SpanStyle(fontFamily = Sans, fontSize = (titleSize * 0.78f * s).sp, fontWeight = FontWeight(500), color = titleColor.copy(alpha = 0.76f))) { append("   $by") }
                }
                Text(
                    text,
                    color = titleColor,
                    fontFamily = if (style == "sans") Sans else Serif,
                    fontWeight = FontWeight(if (style == "sans") 500 else if (style == "foil") 480 else 460),
                    fontSize = (titleSize * s).sp,
                    lineHeight = 1.12.em,
                    letterSpacing = if (style == "sans") 0.01.em else 0.004.em,
                    maxLines = if (wide) 2 else 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                    style = androidx.compose.ui.text.TextStyle(lineBreak = LineBreak.Heading),
                    modifier = Modifier.downward(),
                )
            }
            if (!narrow) {
                Text(
                    by,
                    color = fg.copy(alpha = 0.8f),
                    fontFamily = Sans,
                    fontWeight = FontWeight(500),
                    fontSize = (bySize * s).sp,
                    maxLines = 1,
                    overflow = TextOverflow.Clip,
                    modifier = Modifier.padding(start = d(4f), end = d(4f), bottom = d(if (style == "bands") 42f else 10f)),
                )
            }
        }
    }
    }
}
