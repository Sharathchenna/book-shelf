# Readium reads its manifests and the reader's JavaScript bridge by reflection.
-keep class org.readium.** { *; }
-dontwarn org.readium.**
# PdfiumAndroid's native code calls back into these classes.
-keep class com.shockwave.** { *; }
-keep class io.legere.pdfiumandroid.** { *; }
-dontwarn com.shockwave.**
# Ktor and OkHttp mention optional classes that aren't on Android.
-dontwarn org.slf4j.**
-dontwarn java.lang.management.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
# The app's own JSON models.
-keep,includedescriptorclasses class com.sharathchenna.shelf.**$$serializer { *; }
-keepclassmembers class com.sharathchenna.shelf.** { *** Companion; }
-keepclasseswithmembers class com.sharathchenna.shelf.** { kotlinx.serialization.KSerializer serializer(...); }
