package com.ledgerlyattendance

import android.provider.Settings
import com.facebook.react.bridge.*
import java.security.MessageDigest

class DeviceManagerModule(private val context:ReactApplicationContext):ReactContextBaseJavaModule(context){
  private val prefs=context.getSharedPreferences("ledgerly_device",0)
  override fun getName()="DeviceManager"
  @ReactMethod fun deviceFingerprint(promise:Promise){promise.resolve(Settings.Secure.getString(context.contentResolver,Settings.Secure.ANDROID_ID))}
  @ReactMethod fun saveRegistration(apiUrl:String,deviceId:String,credential:String,exitPin:String,promise:Promise){try{val pin=MessageDigest.getInstance("SHA-256").digest(exitPin.toByteArray()).joinToString(""){"%02x".format(it)};prefs.edit().putString("registration",CryptoVault.encrypt("$apiUrl\n$deviceId\n$credential")).putString("exit_pin_hash",pin).apply();promise.resolve(true)}catch(e:Exception){promise.reject("REGISTRATION_SAVE_FAILED",e)}}
  @ReactMethod fun getRegistration(promise:Promise){try{val raw=prefs.getString("registration",null);if(raw==null){promise.resolve(null);return};val p=CryptoVault.decrypt(raw).split('\n');if(p.size!=3){promise.resolve(null);return};promise.resolve(Arguments.createMap().apply{putString("apiUrl",p[0]);putString("deviceId",p[1]);putString("credential",p[2])})}catch(e:Exception){promise.reject("REGISTRATION_READ_FAILED",e)}}
  @ReactMethod fun verifyExitPin(pin:String,promise:Promise){val hash=MessageDigest.getInstance("SHA-256").digest(pin.toByteArray()).joinToString(""){"%02x".format(it)};promise.resolve(hash==prefs.getString("exit_pin_hash",""))}
  @ReactMethod fun clearRegistration(promise:Promise){prefs.edit().clear().apply();promise.resolve(true)}
}
