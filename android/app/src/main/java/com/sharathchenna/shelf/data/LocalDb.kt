package com.sharathchenna.shelf.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/*
 * What the app keeps on the device: each book's highlights (so it reads offline), its place,
 * downloaded files, and links shared while offline. A `dirty` row is a change the site hasn't
 * had yet; SyncWorker sends it.
 */

@Entity(tableName = "notes", primaryKeys = ["bookId", "id"])
data class NoteRow(val bookId: String, val id: String, val json: String, val changedAt: String, val dirty: Boolean)

@Entity(tableName = "progress", primaryKeys = ["bookId"])
data class ProgressRow(val bookId: String, val json: String, val updatedAt: String, val dirty: Boolean)

@Entity(tableName = "downloads", primaryKeys = ["bookId"])
data class DownloadRow(val bookId: String, val path: String, val format: String, val bytes: Long, val title: String, val at: Long)

@Entity(tableName = "shares", primaryKeys = ["at"])
data class ShareRow(val at: Long, val text: String)

@Dao
interface NotesDao {
    @Query("SELECT * FROM notes WHERE bookId = :bookId")
    suspend fun forBook(bookId: String): List<NoteRow>

    @Query("SELECT * FROM notes WHERE bookId = :bookId")
    fun watch(bookId: String): Flow<List<NoteRow>>

    @Query("SELECT * FROM notes WHERE dirty = 1")
    suspend fun dirty(): List<NoteRow>

    @Upsert
    suspend fun upsert(rows: List<NoteRow>)

    @Query("UPDATE notes SET dirty = 0 WHERE bookId = :bookId AND id = :id AND changedAt = :changedAt")
    suspend fun sent(bookId: String, id: String, changedAt: String)
}

@Dao
interface ProgressDao {
    @Query("SELECT * FROM progress WHERE bookId = :bookId")
    suspend fun get(bookId: String): ProgressRow?

    @Query("SELECT * FROM progress WHERE dirty = 1")
    suspend fun dirty(): List<ProgressRow>

    @Upsert
    suspend fun upsert(row: ProgressRow)

    @Query("UPDATE progress SET dirty = 0 WHERE bookId = :bookId AND updatedAt = :updatedAt")
    suspend fun sent(bookId: String, updatedAt: String)
}

@Dao
interface DownloadsDao {
    @Query("SELECT * FROM downloads ORDER BY at DESC")
    fun all(): Flow<List<DownloadRow>>

    @Query("SELECT * FROM downloads WHERE bookId = :bookId")
    suspend fun get(bookId: String): DownloadRow?

    @Upsert
    suspend fun upsert(row: DownloadRow)

    @Query("DELETE FROM downloads WHERE bookId = :bookId")
    suspend fun remove(bookId: String)
}

@Dao
interface SharesDao {
    @Query("SELECT * FROM shares ORDER BY at")
    suspend fun all(): List<ShareRow>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun add(row: ShareRow)

    @Query("DELETE FROM shares WHERE at = :at")
    suspend fun remove(at: Long)
}

@Database(entities = [NoteRow::class, ProgressRow::class, DownloadRow::class, ShareRow::class], version = 1, exportSchema = false)
abstract class LocalDb : RoomDatabase() {
    abstract fun notes(): NotesDao
    abstract fun progress(): ProgressDao
    abstract fun downloads(): DownloadsDao
    abstract fun shares(): SharesDao

    companion object {
        fun open(context: Context): LocalDb = Room.databaseBuilder(context, LocalDb::class.java, "shelf.db").build()
    }
}
