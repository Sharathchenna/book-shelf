package com.sharathchenna.shelf.share

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.sharathchenna.shelf.MainActivity
import com.sharathchenna.shelf.ShelfApp
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * "Save to Shelf" in the share sheet: a post from X, a page from Chrome, any text with a link.
 * Sent to /api/capture as this device (or kept and sent later when offline), and answered with a
 * toast, without opening the app; the site saves the first link it finds.
 */
class ShareActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = listOfNotNull(intent.getStringExtra(Intent.EXTRA_TEXT), intent.getStringExtra(Intent.EXTRA_SUBJECT)).joinToString(" ").trim()
        val shelf = (application as ShelfApp).shelf
        lifecycleScope.launch {
            when {
                text.isEmpty() -> toast("Nothing to save: there was no link in what was shared.")
                !shelf.signedIn.first() -> {
                    toast("Sign in to Shelf first, then share it again.")
                    startActivity(Intent(this@ShareActivity, MainActivity::class.java))
                }
                else -> toast(runCatching { shelf.capture(text) }.getOrElse { it.message ?: "Not saved." })
            }
            finish()
        }
    }

    private fun toast(message: String) = Toast.makeText(applicationContext, message.take(160), Toast.LENGTH_LONG).show()
}
