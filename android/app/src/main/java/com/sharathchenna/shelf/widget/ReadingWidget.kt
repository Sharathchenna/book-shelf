package com.sharathchenna.shelf.widget

import android.content.Context
import android.content.Intent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.sharathchenna.shelf.MainActivity
import com.sharathchenna.shelf.ShelfApp

private val Ink = ColorProvider(day = Color(0xFF18201C), night = Color(0xFFEEF1EC))
private val Muted = ColorProvider(day = Color(0xFF66706A), night = Color(0xFF95A099))
private val Paper = ColorProvider(day = Color(0xFFFBFAF5), night = Color(0xFF171B18))

/** The books in progress on the home screen, newest first; a tap opens one where it was left. */
class ReadingWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val shelf = (context.applicationContext as ShelfApp).shelf
        shelf.loadCached()
        val reading = shelf.library.value?.files.orEmpty()
            .filter { it.progress != null && it.progress.fraction in 0.005..0.99 }
            .sortedByDescending { it.progress!!.updatedAt }
            .take(3)
        provideContent {
            Column(GlanceModifier.fillMaxSize().background(Paper).cornerRadius(20.dp).padding(16.dp)) {
                Text("READING", style = TextStyle(color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Medium))
                Spacer(GlanceModifier.height(8.dp))
                if (reading.isEmpty()) Text("Nothing open. Pick a book off the shelf.", style = TextStyle(color = Muted, fontSize = 13.sp))
                reading.forEach { file ->
                    val open = Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_TARGET, "reader:${file.id}").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    Column(GlanceModifier.fillMaxWidth().padding(vertical = 6.dp).clickable(actionStartActivity(open))) {
                        Text(file.title, maxLines = 1, style = TextStyle(color = Ink, fontSize = 15.sp, fontWeight = FontWeight.Medium))
                        Text("${Math.round(file.progress!!.fraction * 100)}% · ${file.author}", maxLines = 1, style = TextStyle(color = Muted, fontSize = 12.sp))
                        Spacer(GlanceModifier.height(4.dp))
                        LinearProgressIndicator(progress = file.progress.fraction.toFloat(), modifier = GlanceModifier.fillMaxWidth(), color = ColorProvider(day = Color(0xFF1E7A58), night = Color(0xFF4CC493)), backgroundColor = ColorProvider(day = Color(0x14000000), night = Color(0x1AFFFFFF)))
                    }
                }
            }
        }
    }

    companion object {
        suspend fun refresh(context: Context) = runCatching { ReadingWidget().updateAll(context) }
    }
}

class ReadingWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ReadingWidget()
}
