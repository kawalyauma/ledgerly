package com.ledgerlyattendance

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat

class CameraKeepAliveService:Service(){
  companion object{
    private const val PREFS="ledgerly_camera_appliance"
    private const val KEY_ENABLED="enabled"
    private const val RESTORE_COOLDOWN_MS=15_000L
    @Volatile var running:Boolean=false
      private set
    @Volatile var wakeLockHeld:Boolean=false
      private set
    @Volatile private var lastRestoreAttemptElapsed:Long=0L
    private fun prefs(context:Context)=context.createDeviceProtectedStorageContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE)
    fun setEnabled(context:Context,enabled:Boolean){prefs(context).edit().putBoolean(KEY_ENABLED,enabled).apply()}
    fun isEnabled(context:Context)=prefs(context).getBoolean(KEY_ENABLED,false)
  }
  private var wakeLock:PowerManager.WakeLock?=null
  override fun onCreate(){
    super.onCreate()
    val pm=getSystemService(POWER_SERVICE) as PowerManager
    wakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Ledgerly:SecurityCamera").apply{setReferenceCounted(false);acquire()}
    running=true;wakeLockHeld=wakeLock?.isHeld==true
    startForeground(4401,notification())
  }
  private fun notification():android.app.Notification{
    val channelId="ledgerly_security_camera"
    if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.O){val manager=getSystemService(NOTIFICATION_SERVICE) as NotificationManager;manager.createNotificationChannel(NotificationChannel(channelId,"Ledgerly Security Camera",NotificationManager.IMPORTANCE_LOW).apply{description="Keeps the paired Ledgerly security camera online"})}
    val launch=packageManager.getLaunchIntentForPackage(packageName)?:Intent(this,MainActivity::class.java)
    launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP);launch.putExtra("ledgerly_camera_resume",true)
    val pending=PendingIntent.getActivity(this,4401,launch,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(this,channelId).setSmallIcon(android.R.drawable.presence_video_online).setContentTitle("Ledgerly Camera is running").setContentText("Recording and NVR connection are protected from normal background sleep.").setOngoing(true).setOnlyAlertOnce(true).setContentIntent(pending).setCategory(NotificationCompat.CATEGORY_SERVICE).build()
  }
  private fun restoreManagedCapture(reason:String){
    if(!isEnabled(this))return
    val dpm=getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    if(!dpm.isDeviceOwnerApp(packageName))return
    val now=SystemClock.elapsedRealtime()
    if(now-lastRestoreAttemptElapsed<RESTORE_COOLDOWN_MS)return
    lastRestoreAttemptElapsed=now
    val launch=packageManager.getLaunchIntentForPackage(packageName)?:Intent(this,MainActivity::class.java)
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    launch.putExtra("ledgerly_camera_resume",true);launch.putExtra("ledgerly_camera_resume_reason",reason)
    runCatching{startActivity(launch)}
  }
  override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int{
    running=true;wakeLockHeld=wakeLock?.isHeld==true
    if(intent==null||intent.getBooleanExtra("ledgerly_camera_restore",false))restoreManagedCapture(if(intent==null)"sticky_restart" else "service_restore")
    return START_STICKY
  }
  override fun onTaskRemoved(rootIntent:Intent?){
    restoreManagedCapture("task_removed")
    super.onTaskRemoved(rootIntent)
  }
  override fun onDestroy(){wakeLock?.let{if(it.isHeld)it.release()};wakeLock=null;wakeLockHeld=false;running=false;super.onDestroy()}
  override fun onBind(intent:Intent?):IBinder?=null
}
