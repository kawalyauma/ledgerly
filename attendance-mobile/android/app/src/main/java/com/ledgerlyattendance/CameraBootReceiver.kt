package com.ledgerlyattendance

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class CameraBootReceiver:BroadcastReceiver(){
  override fun onReceive(context:Context,intent:Intent){
    if(intent.action!=Intent.ACTION_BOOT_COMPLETED&&intent.action!="android.intent.action.LOCKED_BOOT_COMPLETED"&&intent.action!=Intent.ACTION_MY_PACKAGE_REPLACED)return
    if(!CameraKeepAliveService.isEnabled(context))return
    val dpm=context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    val managed=dpm.isDeviceOwnerApp(context.packageName)
    if(managed){
      runCatching{ContextCompat.startForegroundService(context,Intent(context,CameraKeepAliveService::class.java))}
      if(intent.action==Intent.ACTION_BOOT_COMPLETED||intent.action==Intent.ACTION_MY_PACKAGE_REPLACED){
        val launch=context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply{addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP);putExtra("ledgerly_camera_boot",true)}
        if(launch!=null)runCatching{context.startActivity(launch)}
      }
      return
    }
    if(intent.action==Intent.ACTION_BOOT_COMPLETED||intent.action==Intent.ACTION_MY_PACKAGE_REPLACED)showResumeNotification(context)
  }
  private fun showResumeNotification(context:Context){
    val channelId="ledgerly_security_camera_recovery"
    val nm=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.O)nm.createNotificationChannel(NotificationChannel(channelId,"Ledgerly Camera recovery",NotificationManager.IMPORTANCE_HIGH).apply{description="Restores a paired security camera after device restart"})
    val launch=context.packageManager.getLaunchIntentForPackage(context.packageName)?:Intent(context,MainActivity::class.java)
    launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP);launch.putExtra("ledgerly_camera_boot",true)
    val pending=PendingIntent.getActivity(context,4402,launch,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val n=NotificationCompat.Builder(context,channelId).setSmallIcon(android.R.drawable.presence_video_online).setContentTitle("Resume Ledgerly Camera").setContentText("Android restarted this phone. Tap to restore security-camera capture.").setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).setContentIntent(pending).setCategory(NotificationCompat.CATEGORY_SERVICE).build()
    nm.notify(4402,n)
  }
}
