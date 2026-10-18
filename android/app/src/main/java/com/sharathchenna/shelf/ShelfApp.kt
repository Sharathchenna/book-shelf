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
        Sync.schedule(this)
    }
}
