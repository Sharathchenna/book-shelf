package com.sharathchenna.shelf.ui

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.sharathchenna.shelf.data.Shelf
import com.sharathchenna.shelf.data.ShelfBook
import com.sharathchenna.shelf.listen.ListenScreen
import com.sharathchenna.shelf.reader.ReaderScreen
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.Serializable

val LocalShelf = staticCompositionLocalOf<Shelf> { error("No shelf") }

/** The app's places. The tabs (home, library, notes, search, settings) live inside Main. */
@Serializable data class Main(val tab: String = "home")

@Serializable data class Reader(val fileId: String, val at: String? = null)

@Serializable data class Listen(val fileId: String, val section: Int = -1)

/**
 * A page of the site in the app's web view, signed in as this device. With `prepare`, it's an
 * article's or paper's opener (/reader/clip/…, /reader/paper/…), which builds the ebook in the
 * page; once the page moves on to the book (/reader/<id>), the app opens it in its own reader.
 */
@Serializable data class Web(val path: String, val title: String = "", val prepare: Boolean = false)

@Composable
fun ShelfRoot(shelf: Shelf, launchTarget: MutableStateFlow<String?>) {
    val signedIn by shelf.signedIn.collectAsState(initial = null)
    CompositionLocalProvider(LocalShelf provides shelf) {
        when (signedIn) {
            null -> Unit
            false -> SignInScreen()
            true -> SignedIn(launchTarget)
        }
    }
}

@Composable
private fun SignedIn(launchTarget: MutableStateFlow<String?>) {
    val nav = rememberNavController()
    val shelf = LocalShelf.current
    val target by launchTarget.collectAsState()
    LaunchedEffect(Unit) { runCatching { shelf.sync() } }
    LaunchedEffect(target) {
        val t = target ?: return@LaunchedEffect
        launchTarget.value = null
        when {
            t.startsWith("reader:") -> nav.navigate(Reader(t.removePrefix("reader:")))
            t == "continue" -> continueReading(shelf)?.let { nav.navigate(Reader(it)) }
            else -> nav.navigate(Main(tab = t)) { popUpTo(0) }
        }
    }
    NavHost(nav, startDestination = Main()) {
        composable<Main> { entry -> MainScreen(nav, initialTab = entry.toRoute<Main>().tab) }
        composable<Reader> { entry ->
            val route = entry.toRoute<Reader>()
            ReaderScreen(route.fileId, at = route.at, onBack = { nav.popBackStack() }, onListen = { section -> nav.navigate(Listen(route.fileId, section)) })
        }
        composable<Listen> { entry ->
            val route = entry.toRoute<Listen>()
            ListenScreen(route.fileId, startSection = route.section, onBack = { nav.popBackStack() })
        }
        composable<Web> { entry ->
            val route = entry.toRoute<Web>()
            WebScreen(
                path = route.path,
                title = route.title,
                onBack = { nav.popBackStack() },
                onBook = if (route.prepare) { fileId ->
                    nav.navigate(Reader(fileId)) { popUpTo<Web> { inclusive = true } }
                } else null,
            )
        }
    }
}

/** The book read most recently, for "Continue reading". */
fun continueReading(shelf: Shelf): String? =
    shelf.library.value?.files?.filter { it.progress != null && it.progress.fraction < 0.99 }?.maxByOrNull { it.progress!!.updatedAt }?.id

/** Opens a book or clipping the best way there is: its file in the reader, the site's opener, or its source. */
fun openBook(context: Context, nav: NavHostController, book: ShelfBook) {
    when {
        book.fileId != null -> nav.navigate(Reader(book.fileId))
        book.readable && book.kind == "paper" -> nav.navigate(Web("/reader/paper/${book.id}", book.title, prepare = true))
        book.readable -> nav.navigate(Web("/reader/clip/${book.id}", book.title, prepare = true))
        book.url != null -> openExternal(context, book.url)
    }
}

/** A page outside the site, in a Custom Tab. */
fun openExternal(context: Context, url: String) {
    CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, Uri.parse(url))
}
