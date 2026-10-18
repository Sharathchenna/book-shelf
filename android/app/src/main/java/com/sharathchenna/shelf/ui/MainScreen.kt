package com.sharathchenna.shelf.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.DownloadForOffline
import androidx.compose.material.icons.outlined.Newspaper
import androidx.compose.material.icons.outlined.Replay
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavHostController
import com.sharathchenna.shelf.ui.library.LibraryPane
import com.sharathchenna.shelf.ui.screens.ClippingsScreen
import com.sharathchenna.shelf.ui.screens.DownloadsScreen
import com.sharathchenna.shelf.ui.screens.ReviewScreen
import com.sharathchenna.shelf.ui.screens.SearchScreen
import com.sharathchenna.shelf.ui.screens.SettingsScreen

private enum class Tab(val key: String, val label: String, val icon: ImageVector) {
    Library("library", "Library", Icons.Outlined.AutoStories),
    Clippings("clippings", "Clippings", Icons.Outlined.Newspaper),
    Search("search", "Search", Icons.Outlined.Search),
    Review("review", "Review", Icons.Outlined.Replay),
    Downloads("downloads", "Offline", Icons.Outlined.DownloadForOffline),
    Settings("settings", "Settings", Icons.Outlined.Settings),
}

/**
 * The tabs. NavigationSuiteScaffold picks the navigation for the window: a bar on a phone, a rail
 * on the tablet in either orientation, and follows split screen and freeform windows as they resize.
 */
@Composable
fun MainScreen(nav: NavHostController, initialTab: String) {
    var tab by rememberSaveable { mutableTabOf(initialTab) }
    NavigationSuiteScaffold(
        navigationSuiteItems = {
            Tab.entries.forEach { t ->
                item(selected = tab == t, onClick = { tab = t }, icon = { Icon(t.icon, contentDescription = null) }, label = { Text(t.label) })
            }
        },
    ) {
        when (tab) {
            Tab.Library -> LibraryPane(nav)
            Tab.Clippings -> ClippingsScreen(nav)
            Tab.Search -> SearchScreen(nav)
            Tab.Review -> ReviewScreen(nav)
            Tab.Downloads -> DownloadsScreen(nav)
            Tab.Settings -> SettingsScreen()
        }
    }
}

private fun mutableTabOf(key: String) = androidx.compose.runtime.mutableStateOf(Tab.entries.find { it.key == key } ?: Tab.Library)
