package com.sharathchenna.shelf.reader

import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.FragmentManager

/**
 * An article's videos, audio and players (YouTube, Vimeo, Spotify…) play from the web, where the
 * page had them (x-article-epub.ts). Readium serves every request its pages make from the book,
 * an address on the web included, so they never loaded: each page's web view passes those to the
 * web instead, lets a player's frame find its way, and plays a video full screen when asked.
 *
 * Readium makes a web view for each of its pages, in fragments of its own; they're caught as
 * their views are made, until [close].
 */
class WebMedia(private val activity: FragmentActivity) {
    private val callbacks = object : FragmentManager.FragmentLifecycleCallbacks() {
        override fun onFragmentViewCreated(fm: FragmentManager, f: Fragment, v: View, savedInstanceState: android.os.Bundle?) {
            webViewsIn(v).forEach { open(it) }
        }
    }

    init {
        activity.supportFragmentManager.registerFragmentLifecycleCallbacks(callbacks, true)
    }

    private val fullScreens = mutableListOf<FullScreen>()

    fun close() {
        activity.supportFragmentManager.unregisterFragmentLifecycleCallbacks(callbacks)
        fullScreens.forEach { it.leave() }
    }

    private fun open(webView: WebView) {
        val inner = webView.webViewClient
        if (inner is ToTheWeb) return
        webView.webViewClient = ToTheWeb(inner)
        webView.webChromeClient = FullScreen(activity, webView).also { fullScreens += it }
        // A clip that plays by itself (silent, on a loop, as a GIF would) does so here too.
        webView.settings.mediaPlaybackRequiresUserGesture = false
    }
}

private fun webViewsIn(view: View): List<WebView> = when (view) {
    is WebView -> listOf(view)
    is ViewGroup -> (0 until view.childCount).flatMap { webViewsIn(view.getChildAt(it)) }
    else -> emptyList()
}

/** Readium's own addresses: the book's files and its assets. */
private val READIUM_HOSTS = setOf("readium_package", "readium_assets")

private fun Uri.onTheWeb() = (scheme == "http" || scheme == "https") && host !in READIUM_HOSTS

/**
 * Readium's client, but what's on the web loads from the web, and a player's frame goes where it
 * goes (Readium would take any navigation as a link the reader followed).
 */
private class ToTheWeb(private val inner: WebViewClient) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
        if (request.url.onTheWeb()) null else inner.shouldInterceptRequest(view, request)

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
        if (!request.isForMainFrame) false else inner.shouldOverrideUrlLoading(view, request)

    override fun shouldOverrideKeyEvent(view: WebView, event: KeyEvent): Boolean = inner.shouldOverrideKeyEvent(view, event)

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) = inner.onPageStarted(view, url, favicon)

    override fun onPageFinished(view: WebView, url: String?) = inner.onPageFinished(view, url)
}

/**
 * A video full screen, over everything, black around it; Back (or the player's own button) brings
 * it back to the page, where it was (the page scrolls to its top as the video leaves it).
 */
private class FullScreen(private val activity: FragmentActivity, private val webView: WebView) : WebChromeClient() {
    private var shown: View? = null
    private var scrollY = 0
    private var done: CustomViewCallback? = null
    private val back = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() = leave()
    }

    private val bars get() = WindowCompat.getInsetsController(activity.window, activity.window.decorView)

    override fun onShowCustomView(view: View, callback: CustomViewCallback) {
        if (shown != null) {
            callback.onCustomViewHidden()
            return
        }
        view.setBackgroundColor(Color.BLACK)
        (activity.window.decorView as ViewGroup).addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        shown = view
        done = callback
        scrollY = webView.scrollY
        webView.evaluateJavascript("window.scrollY") { y -> y?.toDoubleOrNull()?.let { scrollY = it.toInt() } }
        bars.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        bars.hide(WindowInsetsCompat.Type.systemBars())
        // Over the reader's own Back, which would close the book: the latest added is asked first.
        back.remove()
        back.isEnabled = true
        activity.onBackPressedDispatcher.addCallback(back)
    }

    override fun onHideCustomView() = leave()

    fun leave() {
        val view = shown ?: return
        shown = null
        back.isEnabled = false
        back.remove()
        (activity.window.decorView as ViewGroup).removeView(view)
        bars.show(WindowInsetsCompat.Type.systemBars())
        done?.onCustomViewHidden()
        done = null
        val y = scrollY
        webView.postDelayed({ webView.evaluateJavascript("window.scrollTo(0, $y)", null) }, 250)
    }
}
