package com.sharathchenna.shelf.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.sharathchenna.shelf.BuildConfig
import com.sharathchenna.shelf.ui.theme.LocalPaper
import kotlinx.coroutines.launch

/** The owner's password, once per device: the site gives back a token this device keeps. */
@Composable
fun SignInScreen() {
    val shelf = LocalShelf.current
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val submit = {
        if (!busy && password.isNotBlank()) {
            busy = true
            error = null
            scope.launch {
                runCatching { shelf.signIn(password) }.onFailure { error = it.message ?: "Couldn't sign in." }
                busy = false
            }
        }
    }
    Box(Modifier.fillMaxSize().imePadding(), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 420.dp).padding(32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Shelf", style = MaterialTheme.typography.displayMedium)
            Text(
                "Sign in to ${BuildConfig.SITE_URL.removePrefix("https://").removePrefix("http://")} with your password. This device stays signed in until you sign it out, here or on the site.",
                style = MaterialTheme.typography.bodyMedium,
                color = LocalPaper.current.muted,
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { submit() }),
                isError = error != null,
                supportingText = error?.let { { Text(it) } },
                modifier = Modifier.fillMaxWidth(),
            )
            Button(onClick = { submit() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Signing in…" else "Sign in") }
        }
    }
}
