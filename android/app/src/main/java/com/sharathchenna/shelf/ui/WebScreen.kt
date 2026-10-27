package com.sharathchenna.shelf.ui

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.viewinterop.AndroidView
import com.sharathchenna.shelf.BuildConfig
import com.sharathchenna.shelf.data.devicePicture
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive

/** A clipping's id in its opener's address, /reader/clip/<id>. */
private val CLIP_PATH = Regex("^/reader/clip/([\\w.:-]+)$")

/** A book's id in the site's reader address, /reader/<id>. */
private val BOOK_PATH = Regex("^/reader/([a-z0-9]{8,32})$")

/**
 * A page of the site, signed in as this device: the first request carries the device token to
 * /api/auth/session, which starts a browser session and goes on to the page. Pages of other sites
 * open in a Custom Tab. With `onBook`, it's an opener making an article's or paper's ebook; when
 * the page reaches the finished book, the app's own reader takes over.
 */
@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebScreen(path: String, title: String, onBack: () -> Unit, onBook: ((String) -> Unit)?) {
    val shelf = LocalShelf.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var web by remember { mutableStateOf<WebView?>(null) }
    var progress by remember { mutableStateOf(0f) }
    var pageTitle by remember { mutableStateOf(title) }
    var token by remember { mutableStateOf<String?>(null) }
    var pendingFiles by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    var preparing by remember { mutableStateOf<String?>(null) }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        pendingFiles?.onReceiveValue(uri?.let { arrayOf(it) } ?: emptyArray())
        pendingFiles = null
    }
    val site = Uri.parse(BuildConfig.SITE_URL)
    LaunchedEffect(Unit) {
        // A video's opener waits for its captions, fetched here if the site couldn't (Shelf.ensureCaptions).
        CLIP_PATH.find(path)?.groupValues?.get(1)?.takeIf { onBook != null && shelf.clip(it)?.media?.let { m -> m.kind == "youtube" && !m.transcript } == true }?.let { clipId ->
            preparing = "Fetching the video's captions…"
            shelf.ensureCaptions(clipId)
            preparing = null
        }
        token = shelf.tokens.token()
    }

    BackHandler { if (web?.canGoBack() == true && onBook == null) web?.goBack() else onBack() }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(if (onBook != null) "Opening “$title”…" else pageTitle, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") } },
        )
        if (progress < 1f) LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
        preparing?.let { Text(it, modifier = Modifier.fillMaxWidth().padding(24.dp), color = com.sharathchenna.shelf.ui.theme.LocalPaper.current.muted) }
        val t = token ?: return@Column
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.mediaPlaybackRequiresUserGesture = false
                    settings.userAgentString = settings.userAgentString + " ShelfApp/${BuildConfig.VERSION_NAME}"
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            if (request.url.host == site.host) return false
                            openExternal(context, request.url.toString())
                            return true
                        }

                        // An opener's pictures are fetched here, on the tablet's own connection, as some sites turn the
                        // site's server away (Google's); one that fails here is still asked of the site (/api/books/clips/asset).
                        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                            val url = request.url
                            if (onBook == null || request.method != "GET" || url.host != site.host || url.path != "/api/books/clips/asset") return null
                            val picture = url.getQueryParameter("url")?.let { runBlocking { runCatching { devicePicture(shelf.api.http, it) }.getOrNull() } } ?: return null
                            return WebResourceResponse(picture.first, null, picture.second.inputStream())
                        }

                        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                            val uri = Uri.parse(url)
                            val book = BOOK_PATH.find(uri.path ?: "")?.groupValues?.get(1)
                            if (onBook != null && uri.host == site.host && book != null) {
                                view.stopLoading()
                                onBook(book)
                            }
                        }
                    }
                    webChromeClient = object : WebChromeClient() {
                        override fun onProgressChanged(view: WebView, newProgress: Int) {
                            progress = newProgress / 100f
                        }

                        override fun onReceivedTitle(view: WebView, value: String?) {
                            value?.let { pageTitle = it }
                        }

                        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                            pendingFiles?.onReceiveValue(emptyArray())
                            pendingFiles = callback
                            pickFile.launch(arrayOf("application/epub+zip", "application/pdf"))
                            return true
                        }
                    }
                    // An opener's page from a site that turns the server away, fetched here (x-article-epub.ts's ShelfApp).
                    if (onBook != null) addJavascriptInterface(object {
                        @JavascriptInterface
                        fun sendPage(clipId: String, url: String) {
                            scope.launch {
                                val ours = Uri.parse(this@apply.url ?: "").host == site.host
                                val ok = ours && shelf.sendPage(clipId, url)
                                this@apply.evaluateJavascript("window.dispatchEvent(new CustomEvent('shelf-page', { detail: { clipId: ${JsonPrimitive(clipId)}, ok: $ok } }))", null)
                            }
                        }
                    }, "ShelfApp")
                    val start = "${BuildConfig.SITE_URL}/api/auth/session?next=${Uri.encode(path)}"
                    loadUrl(start, mapOf("Authorization" to "Bearer $t"))
                    web = this
                }
            },
            onRelease = { it.destroy() },
        )
    }
}
