# Shelf for Android

The library, the reader and listening, as a native app: Kotlin, Jetpack Compose and Material 3 adaptive layouts, Readium for EPUBs and PDFs, androidx.ink for the pen, Media3 for listening. Made for the Moto Pad 70 Pro (13", 144Hz, pen, keyboard cover) and fine on any Android 12+ tablet or phone. How it talks to the site is in the main README, under [The Android app](../README.md#the-android-app).

## Build and install

You need JDK 21 and the Android SDK (`brew install openjdk@21 && brew install --cask android-commandlinetools`, then `sdk.dir=…` in `android/local.properties`). Gradle fetches the rest.

```bash
cd android
./gradlew :app:assembleDebug                      # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest                  # unit tests
```

A debug build reads from read.sharathchenna.com unless told otherwise. To try it against `bun dev` on this machine: `adb reverse tcp:3000 tcp:3000`, then build with `-Pshelf.site=http://localhost:3000` (debug builds allow plain HTTP to `localhost` and `10.0.2.2` only). Use `adb reverse` rather than `10.0.2.2`: Next's dev server blocks its dev resources from other origins, and the article and paper openers need them.

The debug build is `com.sharathchenna.shelf.debug`, so it installs beside the release one.

## Releases

Release builds are signed, minified and arm64-only (about 27 MB). Make a keystore once and keep it safe: an update must be signed with the same key.

```bash
keytool -genkeypair -v -keystore release.keystore -alias shelf -keyalg RSA -keysize 4096 -validity 36500
```

Locally, put its details in `android/keystore.properties` (ignored by git):

```properties
storeFile=release.keystore
storePassword=…
keyAlias=shelf
keyPassword=…
```

and run `./gradlew :app:assembleRelease -Pshelf.version=0.2.0 -Pshelf.versionCode=2`.

On GitHub, add the secrets `SHELF_KEYSTORE_BASE64` (`base64 -i release.keystore`), `SHELF_KEYSTORE_PASSWORD`, `SHELF_KEY_ALIAS` and `SHELF_KEY_PASSWORD`, then push a tag:

```bash
git tag android-v0.2.0 && git push origin android-v0.2.0
```

`.github/workflows/android.yml` builds it and attaches `shelf-0.2.0.apk` to a release. The app finds it under Settings → Check for an update and hands it to Android's installer (allow Shelf to install apps the first time).

## Layout

| Path | What it is |
| --- | --- |
| `data/` | The site's API (Ktor), the models, the device token (Keystore), the Room database of highlights, places, downloads and queued shares, and syncing (WorkManager) |
| `ui/` | The tabs, sign-in, the web view for the site's own pages, the theme (the site's paper, Fraunces and Geist) |
| `ui/library/` | The bookcase (spines drawn from each book's look), the topics, the book's card |
| `ui/screens/` | Clippings, search, the daily review, books on the device, settings |
| `reader/` | Readium: opening books, the site's section numbers, highlights and drawings as decorations, the panels (contents, notes, Ask), drawing in the margin, a PDF page to draw on |
| `ink/` | The pen: wet ink from androidx.ink, saved strokes, SVG, handwriting with ML Kit |
| `listen/` | Narrated chapters in a Media3 service, and the listening screen |
| `share/`, `widget/`, `update/` | "Save to Shelf" in the share sheet, the reading widget, updates from GitHub releases |
