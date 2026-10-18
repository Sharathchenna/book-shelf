pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Readium's PDF adapter uses PdfiumAndroid and AndroidPdfViewer, published on JitPack only.
        maven("https://jitpack.io") { content { includeGroupByRegex("com\\.github\\..*") } }
    }
}
rootProject.name = "Shelf"
include(":app")
