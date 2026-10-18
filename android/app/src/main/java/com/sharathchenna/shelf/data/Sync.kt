package com.sharathchenna.shelf.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.sharathchenna.shelf.ShelfApp
import java.util.concurrent.TimeUnit

/**
 * Sends the device's changes to the site and fetches the library: soon after a change (once
 * there's a connection, retried with backoff), and every few hours.
 */
object Sync {
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun soon(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(online)
            .setInitialDelay(3, TimeUnit.SECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("sync", ExistingWorkPolicy.REPLACE, request)
    }

    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(3, TimeUnit.HOURS).setConstraints(online).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("sync-periodic", ExistingPeriodicWorkPolicy.KEEP, request)
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        (applicationContext as ShelfApp).shelf.sync()
        Result.success()
    } catch (error: ApiException) {
        if (error.status in 400..499) Result.failure() else Result.retry()
    } catch (_: Exception) {
        Result.retry()
    }
}
