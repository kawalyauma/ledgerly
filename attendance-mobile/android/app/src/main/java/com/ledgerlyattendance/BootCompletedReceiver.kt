package com.ledgerlyattendance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootCompletedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_LOCKED_BOOT_COMPLETED) return
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    context.startActivity(launchIntent)
  }
}
