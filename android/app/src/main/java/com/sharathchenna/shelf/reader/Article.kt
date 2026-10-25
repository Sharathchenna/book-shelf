package com.sharathchenna.shelf.reader

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.PointF
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.json.JSONArray
import org.json.JSONObject
import org.readium.r2.shared.publication.Locator

/*
 * Articles read as the best read-later apps set them (Readwise Reader, Matter, Instapaper): one
 * long column at a comfortable measure, the site's masthead coloured for the theme, a hairline of
 * progress along the top and the minutes left at the foot, and a picture a tap from full screen.
 */

/** The measures an article can be set to, in ems of its own type: about 60, 70 and 85 characters a line. */
private val MEASURES = mapOf("narrow" to 30, "medium" to 34, "wide" to 41)

/** The page's gutter beside an article's column, in CSS px; the measure, not the gutter, keeps the line readable. */
const val ARTICLE_GUTTER = 28.0

/**
 * The article's own stylesheet (x-article-epub.ts) asks for the theme's colours, which the site's
 * reader gives it (bookCss in foliate.ts); here they're given for Readium's themes. The column is
 * held to its measure, with room above for the bar and below for the buttons.
 */
fun articleCss(look: ReaderSettings): String {
    val theme = themeOf(look.theme)
    val (rubric, muted, rule) = Triple(theme.rubric, theme.muted, theme.rule)
    val measure = MEASURES[look.lineWidth] ?: 34
    return """
        :root { --rubric: $rubric; --muted: $muted; --rule: $rule; }
        ${if (look.scroll) ":root[style] body.xarticle { max-width: calc(${measure}em + ${(ARTICLE_GUTTER * 2).toInt()}px) !important; padding-top: 72px !important; padding-bottom: 180px !important; }" else ""}
        .xarticle a:link, .xarticle a:visited { color: $rubric !important; text-decoration-color: $rule; }
        .xarticle .byline a.original { color: inherit !important; }
        /* The masthead's small print in the site's sans, at its own sizes, whatever type the text is set in. */
        :root[style] .xarticle .kicker, :root[style] .xarticle .byline, :root[style] .xarticle .byline *, :root[style] .xarticle table, :root[style] .xarticle table * { font-family: Geist, system-ui, sans-serif !important; font-style: normal !important; }
        :root[style] .xarticle .kicker { font-size: .68em !important; }
        :root[style] .xarticle .byline p.name { font-size: .78em !important; line-height: 1.4 !important; }
        :root[style] .xarticle .byline p.length { font-size: .7em !important; line-height: 1.4 !important; }
        :root[style] .xarticle .byline a.original { font-size: .7em !important; }
        .xarticle figure img, .xarticle .cover img { cursor: zoom-in; }
        ${if (theme.dark) ".xarticle img { filter: brightness(.86) contrast(1.05); }" else ""}
        ::selection { background: ${if (theme.dark) "rgba(111,211,168,.35)" else "rgba(30,122,88,.22)"}; }
    """.trimIndent()
}

/** Puts a stylesheet of the reader's own into the page showing, or brings it up to date. */
suspend fun ReaderController.style(id: String, css: String) {
    val epub = epub ?: return
    runCatching {
        epub.evaluateJavascript(
            "(function(id,css){var s=document.getElementById(id);if(!s){s=document.createElement('style');s.id=id;(document.head||document.documentElement).appendChild(s);}if(s.textContent!==css)s.textContent=css;return true;})(${JSONObject.quote(id)},${JSONObject.quote(css)})",
        )
    }
}

/**
 * The picture under a tap, if there's one big enough to be worth a closer look: drawn by the page
 * onto a canvas (it's the page's own, so it can be read back) and handed over as a JPEG.
 */
suspend fun ReaderController.pictureAt(point: PointF, density: Float): Bitmap? {
    val epub = epub ?: return null
    val answer = runCatching { epub.evaluateJavascript("$PICTURE_AT(${point.x / density},${point.y / density})") }.getOrNull() ?: return null
    if (!answer.startsWith("\"")) return null
    val data = runCatching { JSONArray("[$answer]").getString(0) }.getOrNull() ?: return null
    val bytes = runCatching { Base64.decode(data.substringAfter("base64,"), Base64.DEFAULT) }.getOrNull() ?: return null
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
}

private const val PICTURE_AT = """(function(x,y){
  var e = document.elementFromPoint(x, y);
  if (!e) return null;
  var i = e.tagName === 'IMG' ? e : (e.closest && e.closest('figure') ? e.closest('figure').querySelector('img') : null);
  if (!i || !i.complete || !i.naturalWidth) return null;
  var r = i.getBoundingClientRect();
  if (r.width < 64 || r.height < 64) return null;
  var k = Math.min(1, 2400 / Math.max(i.naturalWidth, i.naturalHeight));
  var c = document.createElement('canvas');
  c.width = Math.round(i.naturalWidth * k); c.height = Math.round(i.naturalHeight * k);
  var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(i, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/jpeg', 0.92); } catch (err) { return null; }
})"""

/** "12 min left" in the article: what's left of Readium's positions, at about 45 seconds each. */
fun minutesLeft(positions: List<List<Locator>>, progress: Float): String {
    val all = positions.sumOf { it.size }
    if (all == 0) return ""
    val left = all * 0.75 * (1 - progress.coerceIn(0f, 1f))
    return if (left < 1) "Nearly done" else "${Math.round(left)} min left"
}

/**
 * Back to a saved place in a scrolled article, once its pictures are in: they have no sizes of
 * their own, so until they load the page is shorter, and a place found then would be too early.
 */
suspend fun ReaderController.settle(progression: Double) {
    val epub = epub ?: return
    // The article's page itself (not the blank one before it), with every picture in; at most ten seconds.
    val loaded = "document.readyState==='complete'&&!!document.body&&document.body.classList.contains('xarticle')&&Array.from(document.images).every(function(i){return i.complete})"
    for (i in 0 until 50) {
        if (runCatching { epub.evaluateJavascript(loaded) }.getOrNull() == "true") break
        kotlinx.coroutines.delay(200)
    }
    // After Readium's own move to where it thinks the place is.
    kotlinx.coroutines.delay(400)
    runCatching { epub.evaluateJavascript("(function(p){var e=document.scrollingElement;window.scrollTo(0,p*(e.scrollHeight-innerHeight));})($progression)") }
}

/** How far down the page showing is scrolled, 0 to 1, as the page measures it (as settle() moves it). */
suspend fun ReaderController.pageProgression(): Double? {
    val epub = epub ?: return null
    return runCatching { epub.evaluateJavascript("(function(){var e=document.scrollingElement,t=e.scrollHeight-innerHeight;return t>0?scrollY/t:-1})()") }
        .getOrNull()?.toDoubleOrNull()?.takeIf { it >= 0 }?.coerceAtMost(1.0)
}

/** How far through the article, as a hairline along the top of the screen. */
@Composable
fun ArticleProgress(progress: Float, ink: Color, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().statusBarsPadding().height(3.dp).background(ink.copy(alpha = 0.06f))) {
        Box(Modifier.fillMaxWidth(progress.coerceIn(0f, 1f)).height(3.dp).background(ink.copy(alpha = 0.55f)))
    }
}

/** A picture on its own, on black: pinched or double-tapped closer, dragged about, and closed. */
@Composable
fun PictureViewer(picture: Bitmap, onDismiss: () -> Unit) {
    val image = remember(picture) { picture.asImageBitmap() }
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(
            Modifier.fillMaxSize().background(Color.Black)
                .pointerInput(Unit) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        scale = (scale * zoom).coerceIn(1f, 6f)
                        offset = if (scale == 1f) Offset.Zero else offset + pan
                    }
                }
                .pointerInput(Unit) {
                    detectTapGestures(
                        onDoubleTap = { if (scale > 1f) { scale = 1f; offset = Offset.Zero } else scale = 2.5f },
                        onTap = { if (scale == 1f) onDismiss() },
                    )
                },
        ) {
            Image(
                image, null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y },
            )
            IconButton(onClick = onDismiss, modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(12.dp)) {
                Icon(Icons.Outlined.Close, "Close the picture", tint = Color.White)
            }
        }
    }
}
