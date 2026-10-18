import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.parcelize)
}

android {
    namespace = "com.sharathchenna.shelf"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.sharathchenna.shelf"
        minSdk = 31
        targetSdk = 36
        versionCode = (project.findProperty("shelf.versionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("shelf.version") as String?) ?: "0.1.0"
        // The site the app reads from; a debug build can point at a dev server instead.
        buildConfigField("String", "SITE_URL", "\"https://read.sharathchenna.com\"")
    }

    // Release signing, from keystore.properties (kept out of git) or the CI's environment.
    val keys = Properties().apply { rootProject.file("keystore.properties").takeIf { it.exists() }?.inputStream()?.use(::load) }
    fun key(name: String, env: String) = keys.getProperty(name) ?: System.getenv(env)
    signingConfigs {
        create("release") {
            key("storeFile", "SHELF_KEYSTORE")?.let { storeFile = rootProject.file(it) }
            storePassword = key("storePassword", "SHELF_KEYSTORE_PASSWORD")
            keyAlias = key("keyAlias", "SHELF_KEY_ALIAS")
            keyPassword = key("keyPassword", "SHELF_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release").takeIf { it.storeFile?.exists() == true }
            // The Moto Pad (and every recent Android tablet and phone) is 64-bit ARM.
            ndk { abiFilters += "arm64-v8a" }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            applicationIdSuffix = ".debug"
            val site = (project.findProperty("shelf.site") as String?) ?: "https://read.sharathchenna.com"
            buildConfigField("String", "SITE_URL", "\"$site\"")
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Readium uses java.time and other newer Java APIs.
        isCoreLibraryDesugaringEnabled = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.fragment.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.adaptive)
    implementation(libs.adaptive.layout)
    implementation(libs.adaptive.navigation)
    implementation(libs.navigation.suite)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.compose.ui.tooling.preview)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.work.runtime)
    implementation(libs.datastore.preferences)

    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.json)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.coil.compose)
    implementation(libs.coil.network)
    implementation(libs.markdown.m3)
    implementation(libs.androidx.browser)

    implementation(libs.readium.shared)
    implementation(libs.readium.streamer)
    implementation(libs.readium.navigator)
    implementation(libs.readium.pdfium)
    implementation(libs.ink.authoring)
    implementation(libs.ink.brush)
    implementation(libs.ink.brush.compose)
    implementation(libs.ink.strokes)
    implementation(libs.ink.rendering)
    implementation(libs.mlkit.digital.ink)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.kotlinx.coroutines.guava)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.session)
    implementation(libs.glance.appwidget)
    implementation(libs.glance.material3)

    coreLibraryDesugaring(libs.desugar)
    testImplementation(libs.junit)
}
