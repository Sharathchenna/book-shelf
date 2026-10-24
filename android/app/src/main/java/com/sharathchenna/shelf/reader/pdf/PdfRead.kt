package com.sharathchenna.shelf.reader.pdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Size
import androidx.pdf.SandboxedPdfLoader
import com.sharathchenna.shelf.data.ShelfApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File

/** The cover's width, as the site makes it (app/components/reader/pdf.ts coverJpeg). */
private const val COVER_WIDTH = 600

/**
 * What the library needs from a PDF being added, read on the device as the site's upload reads it
 * in the browser: each page's text, titled "Page n", and the first page as a JPEG cover. By the
 * system's PDF engine where there is one; else by Android's renderer, whose text comes only from
 * Android 15 on (a scanned book's pages can be read later in the site's reader).
 */
suspend fun readPdfForLibrary(context: Context, file: File, onPage: (done: Int, total: Int) -> Unit): Pair<List<ShelfApi.PdfPage>, String?> {
    // The engine works in a process of its own; if that doesn't answer, Android's renderer reads it instead.
    if (pdfEngineAvailable()) runCatching { byEngine(context, file, onPage) }.getOrNull()?.let { return it }
    return byRenderer(file, onPage)
}

/** How long the engine's process has to open the document before the renderer is used. */
private const val OPEN_TIMEOUT_MS = 30_000L

private suspend fun byEngine(context: Context, file: File, onPage: (Int, Int) -> Unit): Pair<List<ShelfApi.PdfPage>, String?> {
    // Held while the pages are read, as the reader holds it (PdfReader.kt).
    val sandbox = SandboxedPdfLoader.startInitialization(context)
    try {
        return readByEngine(context, file, onPage)
    } finally {
        runCatching { sandbox.close() }
    }
}

private suspend fun readByEngine(context: Context, file: File, onPage: (Int, Int) -> Unit): Pair<List<ShelfApi.PdfPage>, String?> {
    val doc = withTimeoutOrNull(OPEN_TIMEOUT_MS) { SandboxedPdfLoader(context, Dispatchers.IO).openDocument(Uri.fromFile(file), null) }
        ?: throw IllegalStateException("The PDF engine didn't open the file.")
    try {
        val total = doc.pageCount
        val pages = (0 until total).map { n ->
            val text = runCatching { doc.getPageContent(n)?.textContents?.joinToString("\n") { it.text } }.getOrNull().orEmpty()
            onPage(n + 1, total)
            ShelfApi.PdfPage("Page ${n + 1}", text)
        }
        val cover = runCatching {
            val info = doc.getPageInfo(0)
            val height = (COVER_WIDTH * info.height.toFloat() / info.width).toInt()
            doc.getPageBitmapSource(0).use { it.getBitmap(Size(COVER_WIDTH, height), Rect(0, 0, COVER_WIDTH, height)) }
        }.getOrNull()?.let { onWhite(it) }?.let { jpegBase64(it) }
        return pages to cover
    } finally {
        runCatching { doc.close() }
    }
}

private suspend fun byRenderer(file: File, onPage: (Int, Int) -> Unit): Pair<List<ShelfApi.PdfPage>, String?> = withContext(Dispatchers.IO) {
    ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
        PdfRenderer(fd).use { renderer ->
            val total = renderer.pageCount
            var cover: Bitmap? = null
            val pages = (0 until total).map { n ->
                renderer.openPage(n).use { page ->
                    if (n == 0) {
                        val bitmap = Bitmap.createBitmap(COVER_WIDTH, (COVER_WIDTH * page.height.toFloat() / page.width).toInt(), Bitmap.Config.ARGB_8888)
                        bitmap.eraseColor(Color.WHITE)
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        cover = bitmap
                    }
                    val text = if (Build.VERSION.SDK_INT >= 35) runCatching { page.textContents.joinToString("\n") { it.text.orEmpty() } }.getOrDefault("") else ""
                    onPage(n + 1, total)
                    ShelfApi.PdfPage("Page ${n + 1}", text)
                }
            }
            pages to cover?.let { jpegBase64(it) }
        }
    }
}

/** A page drawn with a transparent background, laid on white for the JPEG. */
private fun onWhite(bitmap: Bitmap): Bitmap {
    val out = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
    android.graphics.Canvas(out).apply { drawColor(Color.WHITE); drawBitmap(bitmap, 0f, 0f, null) }
    return out
}
