package com.sharathchenna.shelf.listen

import android.Manifest
import android.content.ComponentName
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import android.os.Bundle
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Forward30
import androidx.compose.material.icons.outlined.Replay10
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.SkipPrevious
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.media3.common.PlaybackParameters
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import com.sharathchenna.shelf.data.AudioLine
import com.sharathchenna.shelf.data.NarratedSection
import com.sharathchenna.shelf.ui.LocalShelf
import com.sharathchenna.shelf.ui.theme.Eyebrow
import com.sharathchenna.shelf.ui.theme.LocalPaper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * A book read aloud: the chapters the narrator has made, played by [PlaybackService] so they go
 * on with the screen off, with the sentence being read shown large, as the web reader does.
 * Making a narration happens in the web reader, which reads the chapter's sentences itself.
 */
@Composable
fun ListenScreen(fileId: String, startSection: Int, onBack: () -> Unit) {
    val shelf = LocalShelf.current
    val context = LocalContext.current
    val paper = LocalPaper.current
    val scope = rememberCoroutineScope()
    val file = shelf.file(fileId)
    var controller by remember { mutableStateOf<MediaController?>(null) }
    var voice by remember { mutableStateOf<String?>(null) }
    var voices by remember { mutableStateOf<List<String>>(emptyList()) }
    var chapters by remember { mutableStateOf<List<NarratedSection>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var playing by remember { mutableStateOf(false) }
    var index by remember { mutableStateOf(0) }
    var position by remember { mutableStateOf(0L) }
    var duration by remember { mutableStateOf(0L) }
    var speed by remember { mutableStateOf(1f) }
    var lines by remember { mutableStateOf<List<AudioLine>>(emptyList()) }
    var downloading by remember { mutableStateOf<String?>(null) }
    var sleep by remember { mutableStateOf(0) }

    // The player's controls live in a notification (and on the lock screen): asked for the first time here.
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    DisposableEffect(Unit) {
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        val future = MediaController.Builder(context, token).buildAsync()
        scope.launch { controller = runCatching { future.await() }.getOrNull() }
        onDispose { MediaController.releaseFuture(future) }
    }

    LaunchedEffect(fileId) {
        runCatching { shelf.api.voices(fileId).filter { it.sections > 0 }.map { it.voice } }
            .onSuccess { voices = it; voice = it.firstOrNull(); if (it.isEmpty()) error = "Nothing narrated yet. Start a narration from Listen in the web reader, and its chapters play here as they're ready." }
            .onFailure { error = it.message }
    }
    LaunchedEffect(voice) {
        val v = voice ?: return@LaunchedEffect
        chapters = runCatching { shelf.api.narrated(fileId, v).sortedBy { it.section } }.getOrElse { error = it.message; emptyList() }
    }

    val titleOf = { s: Int -> file?.sections?.getOrNull(s)?.title?.takeIf { it.isNotBlank() } ?: "Section ${s + 1}" }

    // A new book or voice: its chapters become the queue, from the chapter asked for.
    LaunchedEffect(controller, chapters) {
        val c = controller ?: return@LaunchedEffect
        val v = voice ?: return@LaunchedEffect
        if (chapters.isEmpty()) return@LaunchedEffect
        val alreadyThis = c.currentMediaItem?.mediaId?.startsWith("$fileId/$v/") == true
        if (!alreadyThis) {
            val items = chapters.map { PlaybackService.item(fileId, v, it.section, file?.title ?: "", titleOf(it.section)) }
            val start = chapters.indexOfFirst { it.section >= startSection }.coerceAtLeast(0)
            c.setMediaItems(items, start, 0L)
            c.prepare()
            c.play()
        }
    }

    // Following the player, a few times a second.
    LaunchedEffect(controller) {
        val c = controller ?: return@LaunchedEffect
        while (true) {
            playing = c.isPlaying
            index = c.currentMediaItemIndex
            position = c.currentPosition
            duration = c.duration.coerceAtLeast(0)
            speed = c.playbackParameters.speed
            delay(250)
        }
    }

    // The current chapter's sentences and their timings, for reading along.
    val section = chapters.getOrNull(index)?.section
    LaunchedEffect(section, voice) {
        lines = if (section == null || voice == null) emptyList() else runCatching { shelf.api.audio(fileId, section, voice!!).lines }.getOrDefault(emptyList())
    }
    val now = position / 1000.0
    val sentence = lines.lastOrNull { it.t0 <= now }?.takeIf { now <= it.t1 + 1.5 }

    Column(Modifier.fillMaxSize().background(paper.bg).statusBarsPadding().navigationBarsPadding()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(8.dp)) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") }
            Column {
                Text(file?.title ?: "Listening", style = MaterialTheme.typography.titleLarge)
                section?.let { Text(titleOf(it), style = MaterialTheme.typography.labelMedium, color = paper.muted) }
            }
        }
        if (error != null && chapters.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(error!!, color = paper.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(32.dp)) }
            return@Column
        }
        Row(Modifier.weight(1f).fillMaxWidth()) {
            Box(Modifier.weight(1f).fillMaxSize().padding(40.dp), contentAlignment = Alignment.Center) {
                Text(
                    sentence?.text ?: if (playing) "" else "Paused",
                    style = MaterialTheme.typography.headlineMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.widthIn(max = 720.dp),
                )
            }
            LazyColumn(Modifier.widthIn(max = 320.dp).fillMaxSize(), contentPadding = PaddingValues(16.dp)) {
                item { Text("CHAPTERS", style = Eyebrow, color = paper.muted, modifier = Modifier.padding(bottom = 8.dp)) }
                items(chapters.withIndex().toList()) { (i, ch) ->
                    Text(
                        titleOf(ch.section) + "  ·  ${Math.round(ch.duration / 60)} min",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (i == index) paper.accent else paper.fg,
                        modifier = Modifier.fillMaxWidth().clickable { controller?.seekTo(i, 0L); controller?.play() }.padding(vertical = 10.dp),
                    )
                }
            }
        }
        Column(Modifier.padding(horizontal = 32.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Slider(
                value = if (duration > 0) position.toFloat() / duration else 0f,
                onValueChange = { f -> controller?.seekTo((f * duration).toLong()) },
            )
            Text("${clock(position)} / ${clock(duration)}", style = MaterialTheme.typography.labelMedium, color = paper.muted)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.align(Alignment.CenterHorizontally)) {
                IconButton(onClick = { controller?.seekToPreviousMediaItem() }) { Icon(Icons.Outlined.SkipPrevious, "Previous chapter") }
                IconButton(onClick = { controller?.seekTo((position - 10_000).coerceAtLeast(0)) }) { Icon(Icons.Outlined.Replay10, "Back 10 seconds") }
                FilledIconButton(onClick = { controller?.let { if (it.isPlaying) it.pause() else it.play() } }, modifier = Modifier.size(64.dp)) {
                    Icon(if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (playing) "Pause" else "Play", Modifier.size(36.dp))
                }
                IconButton(onClick = { controller?.seekTo(position + 30_000) }) { Icon(Icons.Outlined.Forward30, "Forward 30 seconds") }
                IconButton(onClick = { controller?.seekToNextMediaItem() }) { Icon(Icons.Outlined.SkipNext, "Next chapter") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                listOf(0.8f, 1f, 1.2f, 1.5f, 2f).forEach { s ->
                    FilterChip(selected = kotlin.math.abs(speed - s) < 0.01, onClick = { controller?.playbackParameters = PlaybackParameters(s) }, label = { Text("${s}×") })
                }
                Text("  Sleep", color = paper.muted)
                listOf(0 to "Off", 15 to "15m", 30 to "30m", -1 to "Chapter end").forEach { (m, label) ->
                    FilterChip(selected = sleep == m, onClick = {
                        sleep = m
                        controller?.sendCustomCommand(SessionCommand(PlaybackService.SLEEP, Bundle.EMPTY), Bundle().apply { putInt(PlaybackService.MINUTES, m) })
                    }, label = { Text(label) })
                }
            }
            if (voices.size > 1) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                voices.forEach { v -> FilterChip(selected = v == voice, onClick = { voice = v; controller?.clearMediaItems() }, label = { Text(v) }) }
            }
            OutlinedButton(enabled = downloading == null && voice != null, onClick = {
                val v = voice ?: return@OutlinedButton
                scope.launch {
                    for ((i, ch) in chapters.withIndex()) {
                        downloading = "Downloading ${i + 1} of ${chapters.size}…"
                        val into = PlaybackService.chapterFile(context, fileId, v, ch.section)
                        if (into.exists()) continue
                        into.parentFile?.mkdirs()
                        runCatching { withContext(Dispatchers.IO) { shelf.api.download(shelf.api.audio(fileId, ch.section, v).url, into) } }
                    }
                    downloading = "All chapters are on this device."
                }
            }) { Text(downloading ?: "Keep chapters offline") }
        }
    }
}

private fun clock(ms: Long): String {
    val s = ms / 1000
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}
