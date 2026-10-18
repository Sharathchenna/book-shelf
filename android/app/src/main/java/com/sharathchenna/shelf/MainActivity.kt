package com.sharathchenna.shelf

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import com.sharathchenna.shelf.ui.ShelfRoot
import com.sharathchenna.shelf.ui.theme.ShelfTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/**
 * The app's one window. A FragmentActivity, since Readium's navigators are fragments. Draws edge
 * to edge (Android 16 always does for apps targeting it) and follows any size or orientation:
 * on a 600dp-wide screen Android 16 ignores orientation locks anyway.
 */
class MainActivity : FragmentActivity() {
    /** Where an app shortcut or widget asked to go: "search", "add", "continue", or "reader:<fileId>". */
    val launchTarget = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        // Readium's fragments take their book in their constructor, so the system can't rebuild
        // them after the process is killed; the reader adds a fresh one when it opens again.
        savedInstanceState?.remove("android:support:fragments")
        super.onCreate(savedInstanceState)
        launchTarget.value = targetOf(intent)
        val shelf = (application as ShelfApp).shelf
        lifecycleScope.launch { shelf.loadCached() }
        setContent {
            ShelfTheme { ShelfRoot(shelf, launchTarget) }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        launchTarget.value = targetOf(intent)
    }

    private fun targetOf(intent: Intent?): String? = intent?.getStringExtra(EXTRA_TARGET)

    companion object {
        const val EXTRA_TARGET = "target"
    }
}
