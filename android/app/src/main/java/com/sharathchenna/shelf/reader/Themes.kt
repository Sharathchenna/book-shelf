package com.sharathchenna.shelf.reader

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.navigator.epub.css.FontStyle
import org.readium.r2.navigator.preferences.Theme

/**
 * The page's colours, as Readwise Reader offers them: Crisp, Sepia, Soft and Ink on paper, Slate
 * and Night in the dark. `key` is what's kept in the settings ("light" and "dark" were Paper and
 * Night before there were more). For an article: its links' colour, its small print's, its rules'.
 */
data class ReaderTheme(
    val key: String,
    val label: String,
    val bg: Long,
    val fg: Long,
    val dark: Boolean,
    val rubric: String,
    val muted: String,
    val rule: String,
) {
    val background get() = Color(bg)
    val ink get() = Color(fg)
    /** Readium's own theme under the colours, which decides its defaults for what isn't set. */
    val readium get() = if (dark) Theme.DARK else if (key == "sepia") Theme.SEPIA else Theme.LIGHT
}

val READER_THEMES = listOf(
    ReaderTheme("light", "Crisp", 0xFFFFFFFF, 0xFF1C1B19, false, "#1e7a58", "#7a756a", "rgba(34,32,27,.14)"),
    ReaderTheme("sepia", "Sepia", 0xFFFAF4E8, 0xFF433422, false, "#8a5a1e", "#8a7558", "rgba(74,59,42,.18)"),
    ReaderTheme("soft", "Soft", 0xFFEDEBE6, 0xFF3A3936, false, "#3d6b57", "#7d7a73", "rgba(40,38,34,.14)"),
    // For an e-ink screen, or anyone who wants the most contrast: black on white, nothing grey.
    ReaderTheme("ink", "Ink", 0xFFFFFFFF, 0xFF000000, false, "#000000", "#333333", "rgba(0,0,0,.4)"),
    ReaderTheme("slate", "Slate", 0xFF252A31, 0xFFD3DAE3, true, "#8cc7ff", "#97a1ad", "rgba(255,255,255,.14)"),
    ReaderTheme("dark", "Night", 0xFF000000, 0xFFE2E2E2, true, "#6fd3a8", "#9aa29c", "rgba(255,255,255,.16)"),
)

fun themeOf(key: String): ReaderTheme = READER_THEMES.find { it.key == key } ?: READER_THEMES.first()

/**
 * The typefaces offered for a book's text: the site's own two (Fraunces, Geist) and four more
 * made for reading at length, all served into the pages from the app's assets (assets/fonts).
 */
data class ReaderFont(val key: String, val label: String, val family: org.readium.r2.navigator.preferences.FontFamily, val regular: String, val italic: String? = null)

val READER_FONTS = listOf(
    ReaderFont("fraunces", "Fraunces", FRAUNCES, "Fraunces.ttf", "Fraunces-Italic.ttf"),
    ReaderFont("literata", "Literata", org.readium.r2.navigator.preferences.FontFamily("Literata"), "Literata.ttf", "Literata-Italic.ttf"),
    ReaderFont("sourceserif", "Source Serif", org.readium.r2.navigator.preferences.FontFamily("Source Serif 4"), "SourceSerif4.ttf", "SourceSerif4-Italic.ttf"),
    ReaderFont("geist", "Geist", GEIST, "Geist.ttf"),
    ReaderFont("inter", "Inter", org.readium.r2.navigator.preferences.FontFamily("Inter"), "Inter.ttf"),
    ReaderFont("atkinson", "Atkinson Hyperlegible", org.readium.r2.navigator.preferences.FontFamily("Atkinson Hyperlegible Next"), "AtkinsonHyperlegibleNext.ttf"),
)

/** Declares every reading typeface to Readium, so a page can be set in any of them. */
fun EpubNavigatorFragment.Configuration.declareReaderFonts() {
    for (font in READER_FONTS) {
        addFontFamilyDeclaration(font.family) {
            addFontFace { addSource("fonts/${font.regular}"); setFontStyle(FontStyle.NORMAL); setFontWeight(100..900) }
            font.italic?.let { italic -> addFontFace { addSource("fonts/$italic"); setFontStyle(FontStyle.ITALIC); setFontWeight(100..900) } }
        }
    }
}

/** A typeface as Compose draws it, for its name in the settings. */
fun composeFamily(context: android.content.Context, key: String): FontFamily? =
    READER_FONTS.find { it.key == key }?.let { FontFamily(Font("fonts/${it.regular}", context.assets)) }
