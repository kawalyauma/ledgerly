package com.ledgerlyattendance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Ledgerly must not take over the device UI after a reboot.
 *
 * Background boot work belongs in dedicated services/receivers. This receiver
 * intentionally does not launch MainActivity.
 */
class BootCompletedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
        intent.action != Intent.ACTION_LOCKED_BOOT_COMPLETED) return

    // Intentionally do not launch the Ledgerly activity on boot.
  }
}
