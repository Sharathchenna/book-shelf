package com.sharathchenna.shelf.ui.library

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif
import com.sharathchenna.shelf.ui.theme.hex

/** How the site's spine sizes (CSS px) become the app's (dp). */
const val SPINE_SCALE = 0.82f

private val Foil = Color(0xFFD9BC72)
private val LabelPaper = Color(0xFFF3EBD8)

/**
 * A book's spine, drawn from its look (lib/bookcase.ts lookOf): its cloth, and one of four
 * styles of lettering, with the title running up the spine.
 */
@Composable
fun Spine(book: ShelfBook, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val look = book.look
    val measurer = rememberTextMeasurer()
    val cloth = hex(look.color)
    val fg = if (look.style == "foil") Foil else hex(look.fg)
    Canvas(
        modifier
            .size((look.w * SPINE_SCALE).dp, (look.h * SPINE_SCALE).dp)
            .semantics { contentDescription = "${book.title}, ${book.author}" }
            .clickable(onClick = onClick),
    ) {
        val lift = if (selected) 10.dp.toPx() else 0f
        val top = -lift
        // The cloth, a little lighter along one edge, as if lit from the left.
        val radius = CornerRadius(2.dp.toPx())
        drawRoundRect(color = cloth, topLeft = Offset(0f, top), size = size, cornerRadius = radius)
        drawRoundRect(
            brush = Brush.horizontalGradient(0f to Color.White.copy(alpha = 0.12f), 0.25f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.18f)),
            topLeft = Offset(0f, top), size = size, cornerRadius = radius,
        )
        val w = size.width
        val h = size.height
        when (look.style) {
            "bands" -> for (y in listOf(0.07f, 0.1f, 0.9f, 0.93f)) drawRect(fg.copy(alpha = 0.55f), Offset(0f, top + h * y), Size(w, 1.5.dp.toPx()))
            "label" -> drawRoundRect(LabelPaper, Offset(w * 0.14f, top + h * 0.2f), Size(w * 0.72f, h * 0.6f), CornerRadius(2.dp.toPx()))
            "foil" -> {
                drawRect(Foil.copy(alpha = 0.8f), Offset(0f, top + h * 0.05f), Size(w, 1.dp.toPx()))
                drawRect(Foil.copy(alpha = 0.8f), Offset(0f, top + h * 0.95f), Size(w, 1.dp.toPx()))
            }
        }
        // The title, running up the spine.
        val ink = if (look.style == "label") Color(0xFF2A2520) else fg
        val style = TextStyle(
            fontFamily = if (look.style == "sans") Sans else Serif,
            fontWeight = if (look.style == "sans") FontWeight(600) else FontWeight(500),
            fontSize = (minOf(w / density * 0.36f, 13f)).sp,
            color = ink,
            letterSpacing = if (look.style == "sans") 0.6.sp else 0.sp,
        )
        val length = (h * if (look.style == "label") 0.56f else 0.78f).toInt().coerceAtLeast(1)
        val laid = measurer.measure(book.title, style, maxLines = 1, overflow = TextOverflow.Ellipsis, constraints = Constraints(maxWidth = length))
        rotate(-90f, pivot = Offset(w / 2, top + h / 2)) {
            drawText(laid, topLeft = Offset(w / 2 - laid.size.width / 2f, top + h / 2 - laid.size.height / 2f))
        }
        if (book.pct > 0 && book.pct < 1) {
            // A ribbon: how far through it the owner is.
            drawRect(Color(0xFFB0382F), Offset(w * 0.62f, top + h - 2.dp.toPx()), Size(w * 0.16f, 10.dp.toPx() * book.pct.toFloat() + 6.dp.toPx()))
        }
    }
}
