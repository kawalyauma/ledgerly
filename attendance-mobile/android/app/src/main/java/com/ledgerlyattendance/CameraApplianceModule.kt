package com.ledgerlyattendance

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class CameraApplianceModule(private val context:ReactApplicationContext):ReactContextBaseJavaModule(context){
  override fun getName()="CameraAppliance"
  @ReactMethod fun start(promise:Promise){try{ContextCompat.startForegroundService(context,Intent(context,CameraKeepAliveService::class.java));promise.resolve(true)}catch(e:Exception){promise.reject("CAMERA_APPLIANCE_START_FAILED",e.message,e)}}
  @ReactMethod fun stop(promise:Promise){try{promise.resolve(context.stopService(Intent(context,CameraKeepAliveService::class.java)))}catch(e:Exception){promise.reject("CAMERA_APPLIANCE_STOP_FAILED",e.message,e)}}
  @ReactMethod fun health(promise:Promise){try{
    val battery=context.registerReceiver(null,IntentFilter(Intent.ACTION_BATTERY_CHANGED));val level=battery?.getIntExtra(BatteryManager.EXTRA_LEVEL,-1)?:-1;val scale=battery?.getIntExtra(BatteryManager.EXTRA_SCALE,100)?:100;val temp=battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE,-1)?:-1;val status=battery?.getIntExtra(BatteryManager.EXTRA_STATUS,-1)?:-1;val pm=context.getSystemService(Context.POWER_SERVICE) as PowerManager
    val map=Arguments.createMap();map.putBoolean("running",true);map.putBoolean("wakeLock",pm.isInteractive);if(level>=0)map.putDouble("batteryLevel",level*100.0/scale);if(temp>=0)map.putDouble("temperatureC",temp/10.0);map.putBoolean("charging",status==BatteryManager.BATTERY_STATUS_CHARGING||status==BatteryManager.BATTERY_STATUS_FULL);if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q)map.putInt("thermalStatus",pm.currentThermalStatus);promise.resolve(map)
  }catch(e:Exception){promise.reject("CAMERA_APPLIANCE_HEALTH_FAILED",e.message,e)}}
}
