package com.sharathchenna.shelf.update

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.sharathchenna.shelf.BuildConfig
import com.sharathchenna.shelf.ShelfApp
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.header
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.File

/**
 * Updates for a sideloaded app: the newest GitHub release tagged `android-v…` with an APK, from
 * the repo's public releases (.github/workflows/android.yml makes them). Android asks before installing.
 */
object Updates {
    private const val RELEASES = "https://api.github.com/repos/Sharathchenna/book-shelf/releases?per_page=20"

    @Serializable
    private data class Release(@SerialName("tag_name") val tag: String, val draft: Boolean = false, val prerelease: Boolean = false, val assets: List<Asset> = emptyList())

    @Serializable
    private data class Asset(val name: String, @SerialName("browser_download_url") val url: String)

    /** Says whether there's a newer version; with `install`, downloads it and hands it to the installer. */
    suspend fun check(context: Context, install: Boolean): String = withContext(Dispatchers.IO) {
        val api = (context.applicationContext as ShelfApp).api
        val releases = runCatching { api.http.get(RELEASES) { header("Accept", "application/vnd.github+json") }.body<List<Release>>() }
            .getOrElse { return@withContext "Couldn't reach GitHub." }
        val latest = releases.filter { !it.draft && !it.prerelease && it.tag.startsWith("android-v") }
            .maxByOrNull { version(it.tag.removePrefix("android-v")) }
            ?: return@withContext "No releases yet."
        val name = latest.tag.removePrefix("android-v")
        if (version(name) <= version(BuildConfig.VERSION_NAME)) return@withContext "Up to date."
        val apk = latest.assets.find { it.name.endsWith(".apk") } ?: return@withContext "Version $name has no APK."
        if (!install) return@withContext "Version $name is available."
        val file = File(context.cacheDir, "updates/${apk.name}").apply { parentFile?.mkdirs() }
        runCatching { api.download(apk.url, file) }.getOrElse { return@withContext "Couldn't download version $name." }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        context.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        "Installing version $name…"
    }

    /** "1.2.3" as a number that orders versions: 1_002_003. */
    private fun version(name: String): Long = name.split('.').take(3).map { it.takeWhile(Char::isDigit).toLongOrNull() ?: 0 }
        .let { parts -> (parts + listOf(0L, 0L, 0L)).take(3) }.fold(0L) { acc, n -> acc * 1000 + n }
}
