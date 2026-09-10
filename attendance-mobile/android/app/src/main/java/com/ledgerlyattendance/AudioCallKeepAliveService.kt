package com.ledgerlyattendance

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder

class AudioCallKeepAliveService: Service() {
  companion object {
    const val CHANNEL_ID = "ledgerly_audio_calls"
    const val NOTIFICATION_ID = 7302
    const val EXTRA_PEER_NAME = "peer_name"
  }

  override fun onCreate() {
    super.onCreate()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Ledgerly audio calls", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Keeps an active Ledgerly audio call running when the app is in the background"
        setSound(null, null)
        enableVibration(false)
      }
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val peerName = intent?.getStringExtra(EXTRA_PEER_NAME)?.takeIf { it.isNotBlank() } ?: "Ledgerly worker"
    startForeground(NOTIFICATION_ID, buildNotification(peerName))
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun buildNotification(peerName: String): Notification {
    val openIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pending = PendingIntent.getActivity(this, 7302, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else @Suppress("DEPRECATION") Notification.Builder(this)
    return builder
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      .setContentTitle("Ledgerly audio call")
      .setContentText("In call with $peerName")
      .setContentIntent(pending)
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_CALL)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .build()
  }
}
