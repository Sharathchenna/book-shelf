package com.sharathchenna.shelf.reader

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.view.WindowManager
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * How every reader behaves, whatever's open in it (a book's look is ReaderSettings, kept apart
 * for books and for articles): the screen, the keys and taps that turn pages, and the pen's mode
 * on opening. Set from a reader's Aa sheet or the app's Settings; both show the same.
 */
data class ReaderBehaviour(
    val keepAwake: Boolean = true,
    val fullScreen: Boolean = false,
    /** auto, portrait or landscape. */
    val orientation: String = "auto",
    /** The screen's brightness while reading, 0 to 1; below 0, the system's own. */
    val brightness: Float = -1f,
    val volumeKeys: Boolean = true,
    /** Taps at a page's left and right edges turn it. */
    val tapEdges: Boolean = true,
    val animate: Boolean = true,
    /** The pen's mode when a reader opens: read or mark. */
    val penStart: String = "read",
    /** For an e-ink screen, as Readwise Reader's E-ink mode: nothing animates, and taps move a screenful even in a scroll. */
    val eink: Boolean = false,
    /** Text is highlighted as soon as it's selected (the menu still shows for a single word's lookup). */
    val autoHighlight: Boolean = false,
    /** Something in the Inbox or Later goes to the Archive by itself when it's read to the end. */
    val archiveAtEnd: Boolean = true,
) {
    /** Page turns animate unless asked not to, or on an e-ink screen. */
    val animated: Boolean get() = animate && !eink

    companion object {
        private val state = MutableStateFlow<ReaderBehaviour?>(null)
        private fun prefs(context: Context) = context.getSharedPreferences("reader-behaviour", Context.MODE_PRIVATE)

        fun flow(context: Context): StateFlow<ReaderBehaviour?> {
            if (state.value == null) {
                val p = prefs(context)
                state.value = ReaderBehaviour(
                    keepAwake = p.getBoolean("keepAwake", true),
                    fullScreen = p.getBoolean("fullScreen", false),
                    orientation = p.getString("orientation", "auto")!!,
                    brightness = p.getFloat("brightness", -1f),
                    volumeKeys = p.getBoolean("volumeKeys", true),
                    tapEdges = p.getBoolean("tapEdges", true),
                    animate = p.getBoolean("animate", true),
                    penStart = p.getString("penStart", "read")!!,
                    eink = p.getBoolean("eink", false),
                    autoHighlight = p.getBoolean("autoHighlight", false),
                    archiveAtEnd = p.getBoolean("archiveAtEnd", true),
                )
            }
            return state
        }

        fun update(context: Context, b: ReaderBehaviour) {
            state.value = b
            prefs(context).edit()
                .putBoolean("keepAwake", b.keepAwake).putBoolean("fullScreen", b.fullScreen).putString("orientation", b.orientation)
                .putFloat("brightness", b.brightness).putBoolean("volumeKeys", b.volumeKeys).putBoolean("tapEdges", b.tapEdges)
                .putBoolean("animate", b.animate).putString("penStart", b.penStart)
                .putBoolean("eink", b.eink).putBoolean("autoHighlight", b.autoHighlight)
                .putBoolean("archiveAtEnd", b.archiveAtEnd)
                .apply()
        }
    }
}

/** The reading behaviour as it stands, kept up to date as it's changed anywhere. */
@Composable
fun rememberBehaviour(): ReaderBehaviour {
    val context = LocalContext.current
    val b by ReaderBehaviour.flow(context).collectAsState()
    return b ?: ReaderBehaviour()
}

/** The window as a reader wants it, put back as it was when the reader closes. */
@Composable
fun ApplyBehaviour(b: ReaderBehaviour) {
    val activity = LocalActivity.current ?: return
    val view = LocalView.current
    DisposableEffect(b.keepAwake) {
        view.keepScreenOn = b.keepAwake
        onDispose { view.keepScreenOn = false }
    }
    DisposableEffect(b.brightness) {
        setBrightness(activity, b.brightness)
        onDispose { setBrightness(activity, WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE) }
    }
    DisposableEffect(b.fullScreen) {
        val bars = WindowCompat.getInsetsController(activity.window, view)
        if (b.fullScreen) {
            bars.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            bars.hide(WindowInsetsCompat.Type.systemBars())
        } else bars.show(WindowInsetsCompat.Type.systemBars())
        onDispose { bars.show(WindowInsetsCompat.Type.systemBars()) }
    }
    DisposableEffect(b.orientation) {
        activity.requestedOrientation = when (b.orientation) {
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
        onDispose { activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
    }
}

/** The status bar's icons light on a night page and dark on paper, put back as the app has them when the reader closes. */
@Composable
fun StatusBarFor(theme: String) {
    val activity = LocalActivity.current ?: return
    val view = LocalView.current
    DisposableEffect(theme) {
        val bars = WindowCompat.getInsetsController(activity.window, view)
        val before = bars.isAppearanceLightStatusBars
        bars.isAppearanceLightStatusBars = !themeOf(theme).dark
        onDispose { bars.isAppearanceLightStatusBars = before }
    }
}

private fun setBrightness(activity: Activity, value: Float) {
    val attrs = activity.window.attributes
    attrs.screenBrightness = if (value < 0) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE else value.coerceIn(0.02f, 1f)
    activity.window.attributes = attrs
}

/** The behaviour's settings, as the reader's sheet and the app's Settings both show them. */
@Composable
fun BehaviourControls(b: ReaderBehaviour, onChange: (ReaderBehaviour) -> Unit) {
    val muted = LocalPaper.current.muted
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("SCREEN", style = Eyebrow, color = muted)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Brightness", Modifier.weight(1f))
            FilterChip(selected = b.brightness < 0, onClick = { onChange(b.copy(brightness = if (b.brightness < 0) 0.5f else -1f)) }, label = { Text("System's") })
        }
        if (b.brightness >= 0) Slider(value = b.brightness, onValueChange = { onChange(b.copy(brightness = it)) }, valueRange = 0.02f..1f)
        Toggle("Keep the screen on while reading", null, b.keepAwake) { onChange(b.copy(keepAwake = it)) }
        Toggle("Full screen", "Hides the status and navigation bars; swipe from an edge to see them.", b.fullScreen) { onChange(b.copy(fullScreen = it)) }
        Text("Orientation")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("auto" to "Turn with the device", "portrait" to "Portrait", "landscape" to "Landscape").forEach { (k, label) ->
                FilterChip(selected = b.orientation == k, onClick = { onChange(b.copy(orientation = k)) }, label = { Text(label) })
            }
        }
        Toggle("E-ink mode", "For an e-ink screen: nothing animates, and a tap near the top or bottom moves a screenful at a time, even in a scroll. Pair it with the Ink theme.", b.eink) { onChange(b.copy(eink = it)) }
        Text("TURNING PAGES", style = Eyebrow, color = muted)
        Toggle("Tap the left and right edges", "A tap in the middle still shows the bars.", b.tapEdges) { onChange(b.copy(tapEdges = it)) }
        Toggle("Volume keys turn pages", "Down for the next page, up for the one before.", b.volumeKeys) { onChange(b.copy(volumeKeys = it)) }
        if (!b.eink) Toggle("Animate page turns", null, b.animate) { onChange(b.copy(animate = it)) }
        Text("HIGHLIGHTING", style = Eyebrow, color = muted)
        Toggle("Highlight as soon as text is selected", "Selecting a passage highlights it, without the menu. Holding a single word still looks it up.", b.autoHighlight) { onChange(b.copy(autoHighlight = it)) }
        Text("AT THE END", style = Eyebrow, color = muted)
        Toggle("Archive what's read to the end", "Something in the Inbox or Later goes to the Archive when you reach its end, with Undo.", b.archiveAtEnd) { onChange(b.copy(archiveAtEnd = it)) }
        Text("THE PEN'S TOOL ON OPENING", style = Eyebrow, color = muted)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("read" to "Read (it scrolls)", "mark" to "Highlight").forEach { (k, label) ->
                FilterChip(selected = b.penStart == k, onClick = { onChange(b.copy(penStart = k)) }, label = { Text(label) })
            }
        }
    }
}

@Composable
internal fun Toggle(title: String, detail: String?, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title)
            detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = LocalPaper.current.muted) }
        }
        Switch(value, onChange)
    }
}

