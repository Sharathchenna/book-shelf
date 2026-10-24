package com.sharathchenna.shelf

import android.app.Application
import com.sharathchenna.shelf.data.LocalDb
import com.sharathchenna.shelf.data.Shelf
import com.sharathchenna.shelf.data.ShelfApi
import com.sharathchenna.shelf.data.Sync
import com.sharathchenna.shelf.data.TokenStore

/** The app's few long-lived pieces, made once. */
class ShelfApp : Application() {
    val tokens: TokenStore by lazy { TokenStore(this) }
    val api: ShelfApi by lazy { ShelfApi(BuildConfig.SITE_URL, token = { tokens.token() }, onSignedOut = { shelf.forget() }) }
    val shelf: Shelf by lazy { Shelf(this, api, tokens, LocalDb.open(this)) }

    override fun onCreate() {
        super.onCreate()
        // The system's PDF engine reads documents in a sandboxed process of the app's own, which
        // starts here too; WorkManager isn't there, and asking for it ended that process before any
        // PDF could open. Only the app's own process schedules the sync.
        if (getProcessName() != packageName) return
        Sync.schedule(this)
    }
}
