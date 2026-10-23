package com.sharathchenna.shelf.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.sharathchenna.shelf.R

/** The site's paper and ink (app/globals.css), light and dark. */
@Immutable
data class Paper(
    val bg: Color, val raised: Color, val sunk: Color, val fg: Color, val muted: Color, val line: Color, val chip: Color, val accent: Color, val wood: Color,
    /** The site's --ink-4: counts, hints, the quietest type. */
    val faint: Color,
    val rule: Color,
    /** The bookcase (bookcase.css): the plank's top and front, its lit edge, the shade above it, the bookends. */
    val plankTop: Color, val plankFront: Color, val plankEdge: Color, val shelfShade: Color, val bookend: Color,
)

private val LightPaper = Paper(
    bg = Color(0xFFF4F2EA), raised = Color(0xFFFBFAF5), sunk = Color(0xFFE8E5DA), fg = Color(0xFF18201C), muted = Color(0xFF66706A),
    line = Color(0x14000000), chip = Color(0x0D000000), accent = Color(0xFF1E7A58), wood = Color(0xFFC9B48E),
    faint = Color(0xFF9BA39D), rule = Color(0xFFE2DED1),
    plankTop = Color(0xFFE9E2D6), plankFront = Color(0xFFCEBFA8), plankEdge = Color(0xFFD9CDB9), shelfShade = Color(0x17281E14), bookend = Color(0xFF6F6A62),
)
private val DarkPaper = Paper(
    bg = Color(0xFF0D100E), raised = Color(0xFF171B18), sunk = Color(0xFF1E231F), fg = Color(0xFFEEF1EC), muted = Color(0xFF95A099),
    line = Color(0x1AFFFFFF), chip = Color(0x12FFFFFF), accent = Color(0xFF4CC493), wood = Color(0xFF3A3128),
    faint = Color(0xFF5D6862), rule = Color(0xFF262C28),
    plankTop = Color(0xFF2F2B21), plankFront = Color(0xFF483F2D), plankEdge = Color(0xFF574D3A), shelfShade = Color(0x4D000000), bookend = Color(0xFFA5A29B),
)

val LocalPaper = staticCompositionLocalOf { LightPaper }

private fun fraunces(weight: Int, italic: Boolean = false) = Font(
    if (italic) R.font.fraunces_italic else R.font.fraunces,
    weight = FontWeight(weight),
    style = if (italic) FontStyle.Italic else FontStyle.Normal,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight), FontVariation.Setting("SOFT", 50f), FontVariation.Setting("opsz", 72f)),
)

private fun geist(weight: Int) = Font(R.font.geist, weight = FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))

/** Fraunces for titles and reading, as on the site. */
val Serif = FontFamily(fraunces(400), fraunces(500), fraunces(600), fraunces(400, italic = true))

/** Geist for everything else. */
val Sans = FontFamily(geist(400), geist(500), geist(600))

private val base = Typography()
private val ShelfType = Typography(
    displayLarge = base.displayLarge.copy(fontFamily = Serif, fontWeight = FontWeight(500)),
    displayMedium = base.displayMedium.copy(fontFamily = Serif, fontWeight = FontWeight(500)),
    displaySmall = base.displaySmall.copy(fontFamily = Serif, fontWeight = FontWeight(500)),
    headlineLarge = base.headlineLarge.copy(fontFamily = Serif),
    headlineMedium = base.headlineMedium.copy(fontFamily = Serif),
    headlineSmall = base.headlineSmall.copy(fontFamily = Serif),
    titleLarge = base.titleLarge.copy(fontFamily = Serif),
    titleMedium = base.titleMedium.copy(fontFamily = Sans, fontWeight = FontWeight(500)),
    titleSmall = base.titleSmall.copy(fontFamily = Sans, fontWeight = FontWeight(500)),
    bodyLarge = base.bodyLarge.copy(fontFamily = Serif, fontSize = 17.sp, lineHeight = 26.sp),
    bodyMedium = base.bodyMedium.copy(fontFamily = Sans),
    bodySmall = base.bodySmall.copy(fontFamily = Sans),
    labelLarge = base.labelLarge.copy(fontFamily = Sans),
    labelMedium = base.labelMedium.copy(fontFamily = Sans),
    labelSmall = base.labelSmall.copy(fontFamily = Sans),
)

/** Small caps-like labels over sections, as the site sets them. */
val Eyebrow = TextStyle(fontFamily = Sans, fontSize = 11.sp, letterSpacing = 1.4.sp, fontWeight = FontWeight(500))

@Composable
fun ShelfTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val paper = if (dark) DarkPaper else LightPaper
    val colors = if (dark) {
        darkColorScheme(
            primary = paper.accent, onPrimary = Color(0xFF0D100E), background = paper.bg, onBackground = paper.fg,
            surface = paper.bg, onSurface = paper.fg, surfaceVariant = paper.sunk, onSurfaceVariant = paper.muted,
            surfaceContainer = paper.raised, surfaceContainerLow = paper.raised, surfaceContainerHigh = paper.sunk,
            surfaceContainerLowest = paper.bg, surfaceContainerHighest = paper.sunk, outline = paper.muted, outlineVariant = paper.line,
            secondaryContainer = paper.sunk, onSecondaryContainer = paper.fg,
        )
    } else {
        lightColorScheme(
            primary = paper.accent, onPrimary = Color.White, background = paper.bg, onBackground = paper.fg,
            surface = paper.bg, onSurface = paper.fg, surfaceVariant = paper.sunk, onSurfaceVariant = paper.muted,
            surfaceContainer = paper.raised, surfaceContainerLow = paper.raised, surfaceContainerHigh = paper.sunk,
            surfaceContainerLowest = paper.bg, surfaceContainerHighest = paper.sunk, outline = paper.muted, outlineVariant = Color(0x22000000),
            secondaryContainer = paper.sunk, onSecondaryContainer = paper.fg,
        )
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalPaper provides paper) {
        MaterialTheme(colorScheme = colors, typography = ShelfType, content = content)
    }
}

/** A colour from the site's "#rrggbb". */
fun hex(value: String?, fallback: Color = Color.Gray): Color = runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(fallback)

/**
 * The site's paper (bookcase.css .paper): a faint grain over the page, 4.5% in the light and
 * 3.5% in the dark. One tile of noise, made once, repeated.
 */
@Composable
fun PaperGrain(modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier) {
    val dark = LocalPaper.current.bg.luminance() < 0.5f
    val brush = androidx.compose.runtime.remember {
        val size = 160
        val random = java.util.Random(7)
        val pixels = IntArray(size * size) { (random.nextInt(256) shl 24) }
        val bitmap = android.graphics.Bitmap.createBitmap(pixels, size, size, android.graphics.Bitmap.Config.ARGB_8888).asImageBitmap()
        androidx.compose.ui.graphics.ShaderBrush(androidx.compose.ui.graphics.ImageShader(bitmap, androidx.compose.ui.graphics.TileMode.Repeated, androidx.compose.ui.graphics.TileMode.Repeated))
    }
    androidx.compose.foundation.Canvas(modifier.then(androidx.compose.ui.Modifier.fillMaxSize())) {
        drawRect(brush, alpha = if (dark) 0.035f else 0.045f)
    }
}
