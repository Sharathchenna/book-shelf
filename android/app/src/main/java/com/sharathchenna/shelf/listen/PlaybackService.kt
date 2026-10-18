package com.sharathchenna.shelf.listen

import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.sharathchenna.shelf.ShelfApp
import kotlinx.coroutines.runBlocking
import java.io.File

/**
 * Plays a book's narrated chapters (made by the narrator, kept in R2) in the background, with the
 * lock screen's and the keyboard's media controls. Each chapter is a `shelf-audio://` item; its
 * short-lived R2 address is asked for only as it starts playing, and a chapter downloaded to the
 * device plays from there instead.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private val sleep = android.os.Handler(android.os.Looper.getMainLooper())

    override fun onCreate() {
        super.onCreate()
        val api = (application as ShelfApp).api
        val resolving = ResolvingDataSource.Factory(DefaultDataSource.Factory(this)) { spec: DataSpec ->
            val uri = spec.uri
            if (uri.scheme != SCHEME) return@Factory spec
            val (bookId, voice, section) = uri.pathSegments.let { Triple(uri.host!!, it[0], it[1].toInt()) }
            val local = chapterFile(this, bookId, voice, section)
            if (local.exists()) return@Factory spec.withUri(Uri.fromFile(local))
            // Relative in development (the local storage driver), absolute (R2) in production.
            val url = api.absolute(runBlocking { api.audio(bookId, section, voice).url })
            spec.withUri(Uri.parse(url))
        }
        val player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(resolving))
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .build()
        session = MediaSession.Builder(this, player).setCallback(object : MediaSession.Callback {
            override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
                val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(SessionCommand(SLEEP, Bundle.EMPTY)).build()
                return MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(commands).build()
            }

            override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo, customCommand: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
                if (customCommand.customAction == SLEEP) setSleep(session.player, args.getInt(MINUTES))
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
            }
        }).build()
    }

    /** Pauses after `minutes` (0 cancels; -1 at the end of the chapter). */
    private fun setSleep(player: androidx.media3.common.Player, minutes: Int) {
        sleep.removeCallbacksAndMessages(null)
        (player as? ExoPlayer)?.pauseAtEndOfMediaItems = minutes == -1
        if (minutes > 0) sleep.postDelayed({ player.pause() }, minutes * 60_000L)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: android.content.Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        sleep.removeCallbacksAndMessages(null)
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }

    companion object {
        const val SCHEME = "shelf-audio"
        const val SLEEP = "sleep"
        const val MINUTES = "minutes"

        fun item(bookId: String, voice: String, section: Int, book: String, chapter: String): MediaItem = MediaItem.Builder()
            .setMediaId("$bookId/$voice/$section")
            .setUri("$SCHEME://$bookId/$voice/$section")
            .setMediaMetadata(MediaMetadata.Builder().setTitle(chapter).setAlbumTitle(book).setArtist(book).build())
            .build()

        fun chapterFile(context: Context, bookId: String, voice: String, section: Int) = File(context.filesDir, "audio/$bookId/$voice/$section.mp3")
    }
}
