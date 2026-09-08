package com.ledgerlyattendance

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.view.View
import com.facebook.react.bridge.*

class KioskManagerModule(private val context:ReactApplicationContext):ReactContextBaseJavaModule(context){
  override fun getName()="KioskManager"
  private fun dpm()=context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
  @ReactMethod fun status(promise:Promise){promise.resolve(Arguments.createMap().apply{putBoolean("deviceOwner",dpm().isDeviceOwnerApp(context.packageName));putBoolean("lockTaskPermitted",dpm().isLockTaskPermitted(context.packageName))})}
  @ReactMethod fun enter(promise:Promise){val activity=context.currentActivity?:return promise.reject("NO_ACTIVITY","No active kiosk activity");try{if(dpm().isDeviceOwnerApp(context.packageName)){val admin=android.content.ComponentName(context,LedgerlyDeviceAdminReceiver::class.java);dpm().setLockTaskPackages(admin,arrayOf(context.packageName));dpm().setLockTaskFeatures(admin,DevicePolicyManager.LOCK_TASK_FEATURE_NONE)};activity.startLockTask();activity.window.decorView.systemUiVisibility=View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION;promise.resolve(true)}catch(e:Exception){promise.reject("KIOSK_ENTER_FAILED",e)}}
  @ReactMethod fun exit(promise:Promise){try{context.currentActivity?.stopLockTask();promise.resolve(true)}catch(e:Exception){promise.reject("KIOSK_EXIT_FAILED",e)}}
}
