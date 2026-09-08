package com.ledgerlyattendance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class CameraBootReceiver:BroadcastReceiver(){
  override fun onReceive(context:Context,intent:Intent){
    if(intent.action!=Intent.ACTION_BOOT_COMPLETED&&intent.action!="android.intent.action.LOCKED_BOOT_COMPLETED")return
    // On modern Android, a camera-type foreground service may not be started directly
    // from a boot receiver. Bring the dedicated appliance activity back instead; once
    // foregrounded, CameraModeScreen restarts CameraKeepAliveService and capture safely.
    val launch=context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply{
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      putExtra("ledgerly_camera_boot",true)
    }
    if(launch!=null)runCatching{context.startActivity(launch)}
  }
}
