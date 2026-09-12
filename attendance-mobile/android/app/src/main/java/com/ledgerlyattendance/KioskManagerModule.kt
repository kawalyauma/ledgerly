package com.ledgerlyattendance

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.view.View
import com.facebook.react.bridge.*

class KioskManagerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "KioskManager"

  private fun dpm() = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
  private fun admin() = ComponentName(context, LedgerlyDeviceAdminReceiver::class.java)

  private fun releaseLockTask() {
    val activity = context.currentActivity
    try {
      activity?.stopLockTask()
    } catch (_: Exception) {
      // Not currently in lock task mode.
    }

    try {
      if (dpm().isDeviceOwnerApp(context.packageName)) {
        dpm().setLockTaskPackages(admin(), emptyArray())
      }
    } catch (_: Exception) {
      // Keep the UI usable even if a vendor policy rejects the policy change.
    }

    try {
      activity?.window?.decorView?.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
    } catch (_: Exception) {
    }
  }

  @ReactMethod
  fun status(promise: Promise) {
    promise.resolve(Arguments.createMap().apply {
      putBoolean("deviceOwner", dpm().isDeviceOwnerApp(context.packageName))
      putBoolean("lockTaskPermitted", dpm().isLockTaskPermitted(context.packageName))
    })
  }

  /**
   * Attendance kiosk presentation no longer locks the whole Android device.
   * The screen can still show the kiosk UI, but Home/Recents remain available.
   */
  @ReactMethod
  fun enter(promise: Promise) {
    try {
      releaseLockTask()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("KIOSK_ENTER_FAILED", e)
    }
  }

  @ReactMethod
  fun exit(promise: Promise) {
    try {
      releaseLockTask()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("KIOSK_EXIT_FAILED", e)
    }
  }
}
