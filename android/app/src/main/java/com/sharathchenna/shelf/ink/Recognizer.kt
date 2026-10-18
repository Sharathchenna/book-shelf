package com.sharathchenna.shelf.ink

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognition
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModel
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModelIdentifier
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizerOptions
import com.sharathchenna.shelf.data.InkStroke
import kotlinx.coroutines.tasks.await
import com.google.mlkit.vision.digitalink.recognition.Ink as MlInk

/**
 * Reads handwriting on the device with ML Kit, so a drawing's words can be searched and exported
 * as text. The English model (about 20 MB) is downloaded the first time, then works offline.
 * Returns null for drawings that aren't writing, or when the model isn't there and can't be had.
 */
object Recognizer {
    private val model by lazy {
        DigitalInkRecognitionModel.builder(DigitalInkRecognitionModelIdentifier.fromLanguageTag("en-US")!!).build()
    }
    private val client by lazy { DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model).build()) }

    suspend fun read(strokes: List<InkStroke>): String? = runCatching {
        val manager = RemoteModelManager.getInstance()
        if (!manager.isModelDownloaded(model).await()) manager.download(model, DownloadConditions.Builder().build()).await()
        val ink = MlInk.builder()
        var t = 0L
        for (s in strokes) {
            val stroke = MlInk.Stroke.builder()
            var i = 0
            while (i + 1 < s.points.size) {
                stroke.addPoint(MlInk.Point.create(s.points[i].toFloat(), s.points[i + 1].toFloat(), t))
                t += 10
                i += 3
            }
            ink.addStroke(stroke.build())
        }
        client.recognize(ink.build()).await().candidates.firstOrNull()?.text?.trim()?.takeIf { it.isNotEmpty() }
    }.getOrNull()
}
