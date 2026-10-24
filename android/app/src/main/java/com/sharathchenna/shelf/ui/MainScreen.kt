package com.sharathchenna.shelf.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoStories
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.sharathchenna.shelf.R
import com.sharathchenna.shelf.ui.library.LibraryPane
import com.sharathchenna.shelf.ui.screens.HomeScreen
import com.sharathchenna.shelf.ui.screens.NotesScreen
import com.sharathchenna.shelf.ui.screens.SearchScreen
import com.sharathchenna.shelf.ui.screens.SettingsScreen
import com.sharathchenna.shelf.ui.theme.LocalPaper
import com.sharathchenna.shelf.ui.theme.PaperGrain
import com.sharathchenna.shelf.ui.theme.Sans
import com.sharathchenna.shelf.ui.theme.Serif

/**
 * The app's places: Home (what you're reading, and what's saved to read), the Library (every book
 * and clipping, on the shelves), Notes (the day's review and every highlight), Search, and
 * Settings. `aliases` are the older tabs' keys, still sent by the launcher's shortcuts.
 */
private enum class Tab(val key: String, val label: String, val icon: ImageVector, val selectedIcon: ImageVector, val aliases: Set<String> = emptySet()) {
    Home("home", "Home", Icons.Outlined.Home, Icons.Filled.Home, setOf("clippings")),
    Library("library", "Library", Icons.Outlined.AutoStories, Icons.Filled.AutoStories),
    Notes("notes", "Notes", Icons.Outlined.EditNote, Icons.Filled.EditNote, setOf("review")),
    Search("search", "Search", Icons.Outlined.Search, Icons.Filled.Search),
    Settings("settings", "Settings", Icons.Outlined.Settings, Icons.Filled.Settings, setOf("downloads")),
}

/**
 * The tabs: a rail down the left on the tablet (in either orientation, and in a wide split-screen
 * window), a bar along the bottom on a phone. One sheet of paper under the rail and the page alike,
 * as the site's bar sits on its page.
 */
@Composable
fun MainScreen(nav: NavHostController, initialTab: String) {
    var tab by rememberSaveable { mutableStateOf(Tab.entries.find { it.key == initialTab || initialTab in it.aliases } ?: Tab.Home) }
    val paper = LocalPaper.current
    var adding by remember { mutableStateOf(false) }
    if (adding) AddLinkSheet(onDismiss = { adding = false }, onOpen = { nav.navigate(Reader(it)) })
    BoxWithConstraints(Modifier.fillMaxSize().background(paper.bg)) {
        PaperGrain()
        val content: @Composable (Modifier) -> Unit = { modifier ->
            Box(modifier) {
                when (tab) {
                    Tab.Home -> HomeScreen(nav, onAdd = { adding = true }, onNotes = { tab = Tab.Notes })
                    Tab.Library -> LibraryPane(nav)
                    Tab.Notes -> NotesScreen(nav)
                    Tab.Search -> SearchScreen(nav)
                    Tab.Settings -> SettingsScreen(nav)
                }
                if (tab == Tab.Library) {
                    AddButton(onClick = { adding = true }, modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(24.dp))
                }
            }
        }
        if (maxWidth >= 600.dp) {
            Row(Modifier.fillMaxSize()) {
                Rail(tab, onTab = { tab = it })
                content(Modifier.weight(1f).fillMaxHeight())
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                content(Modifier.weight(1f).fillMaxWidth())
                BottomBar(tab, onTab = { tab = it })
            }
        }
    }
}

/** The site's mark: three books on a shelf on an emerald tile (app/components/logo.tsx). */
@Composable
fun Logo(size: androidx.compose.ui.unit.Dp) {
    Box(Modifier.size(size).clip(RoundedCornerShape(28)), contentAlignment = Alignment.Center) {
        Image(painterResource(R.drawable.ic_launcher_background), contentDescription = null, modifier = Modifier.fillMaxSize())
        // The launcher's foreground keeps to the middle two thirds of its tile, for the launcher's mask.
        Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = null, modifier = Modifier.size(size * 1.5f))
    }
}

@Composable
private fun Rail(selected: Tab, onTab: (Tab) -> Unit) {
    val paper = LocalPaper.current
    Column(
        Modifier
            .width(92.dp)
            .fillMaxHeight()
            .drawBehind { drawLine(paper.rule, Offset(size.width - 0.5f, 0f), Offset(size.width - 0.5f, size.height), strokeWidth = 1f) }
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Logo(40.dp)
        Text("Shelf", fontFamily = Serif, fontWeight = FontWeight(500), fontSize = 15.sp, color = paper.fg, modifier = Modifier.padding(top = 8.dp))
        Spacer(Modifier.height(36.dp))
        Column(verticalArrangement = Arrangement.spacedBy(6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Tab.entries.filter { it != Tab.Settings }.forEach { t -> RailItem(t, t == selected) { onTab(t) } }
        }
        Spacer(Modifier.weight(1f))
        RailItem(Tab.Settings, selected == Tab.Settings) { onTab(Tab.Settings) }
    }
}

@Composable
private fun RailItem(tab: Tab, selected: Boolean, modifier: Modifier = Modifier.width(80.dp), onClick: () -> Unit) {
    val paper = LocalPaper.current
    Column(
        modifier
            .clip(RoundedCornerShape(16.dp))
            .clickable(remember { MutableInteractionSource() }, ripple(), role = Role.Tab, onClick = onClick)
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        // Selected as the site marks it: a pill of ink, as the chosen chip and the dark buttons are.
        Box(
            Modifier.size(52.dp, 32.dp).clip(RoundedCornerShape(50)).background(if (selected) paper.fg else androidx.compose.ui.graphics.Color.Transparent),
            contentAlignment = Alignment.Center,
        ) {
            Icon(if (selected) tab.selectedIcon else tab.icon, contentDescription = null, tint = if (selected) paper.bg else paper.muted, modifier = Modifier.size(22.dp))
        }
        Text(
            tab.label,
            fontFamily = Sans,
            fontSize = 12.sp,
            fontWeight = FontWeight(if (selected) 600 else 500),
            color = if (selected) paper.fg else paper.muted,
            maxLines = 1,
        )
    }
}

@Composable
private fun BottomBar(selected: Tab, onTab: (Tab) -> Unit) {
    val paper = LocalPaper.current
    Row(
        Modifier
            .fillMaxWidth()
            .background(paper.raised)
            .drawBehind { drawLine(paper.rule, Offset(0f, 0f), Offset(size.width, 0f), strokeWidth = 1f) }
            .navigationBarsPadding()
            .padding(horizontal = 4.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        Tab.entries.forEach { t ->
            RailItem(t, t == selected, Modifier.weight(1f)) { onTab(t) }
        }
    }
}
