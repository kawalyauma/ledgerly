package com.ledgerlyattendance

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "LedgerlyAttendance"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    releaseLegacyKioskLock()

    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
  }

  private fun releaseLegacyKioskLock() {
    try {
      stopLockTask()
    } catch (_: Exception) {
      // The activity may not currently be locked.
    }

    try {
      val manager = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
      if (manager.isDeviceOwnerApp(packageName)) {
        val admin = ComponentName(this, LedgerlyDeviceAdminReceiver::class.java)
        manager.setLockTaskPackages(admin, emptyArray())
      }
    } catch (_: Exception) {
      // Do not block normal app startup if a vendor-specific policy rejects this.
    }
  }

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
