package com.sharathchenna.shelf.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private val Context.store by preferencesDataStore("shelf")

/**
 * The device token and a few small settings. The token is encrypted with a key that never leaves
 * the Android Keystore, so a copy of the app's files is no use without the device.
 */
class TokenStore(private val context: Context) {
    private val tokenKey = stringPreferencesKey("token")
    private val deviceKey = stringPreferencesKey("device")
    private val etagKey = stringPreferencesKey("library_etag")

    val signedIn: Flow<Boolean> = context.store.data.map { it[tokenKey] != null }

    suspend fun token(): String? = context.store.data.first()[tokenKey]?.let(::decrypt)

    suspend fun deviceId(): String? = context.store.data.first()[deviceKey]

    suspend fun save(signIn: SignIn) {
        context.store.edit {
            it[tokenKey] = encrypt(signIn.token)
            it[deviceKey] = signIn.device.id
        }
    }

    suspend fun clear() {
        context.store.edit { it.clear() }
    }

    suspend fun libraryEtag(): String? = context.store.data.first()[etagKey]

    suspend fun setLibraryEtag(etag: String?) {
        context.store.edit { if (etag == null) it.remove(etagKey) else it[etagKey] = etag }
    }

    // ---- the Keystore ----------------------------------------------------------------------

    private val alias = "shelf-token"

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encrypt(text: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.iv + cipher.doFinal(text.toByteArray())
        return Base64.encodeToString(sealed, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String? = runCatching {
        val sealed = Base64.decode(stored, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, 12))
        String(cipher.doFinal(sealed, 12, sealed.size - 12))
    }.getOrNull()
}
