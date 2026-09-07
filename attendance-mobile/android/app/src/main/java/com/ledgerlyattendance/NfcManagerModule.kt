package com.ledgerlyattendance

import android.nfc.NfcAdapter
import android.os.Bundle
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class NfcManagerModule(private val context:ReactApplicationContext):ReactContextBaseJavaModule(context){
  override fun getName()="LedgerlyNfc"
  @ReactMethod fun isSupported(promise:Promise){promise.resolve(NfcAdapter.getDefaultAdapter(context)!=null)}
  @ReactMethod fun enable(promise:Promise){val activity=context.currentActivity?:return promise.reject("NO_ACTIVITY","No active activity");val adapter=NfcAdapter.getDefaultAdapter(context)?:return promise.reject("NFC_UNAVAILABLE","NFC is unavailable");adapter.enableReaderMode(activity,{tag->val id=tag.id.joinToString(""){"%02X".format(it)};context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("LedgerlyNfcTag",id)},NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V or NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,Bundle());promise.resolve(true)}
  @ReactMethod fun disable(promise:Promise){context.currentActivity?.let{NfcAdapter.getDefaultAdapter(context)?.disableReaderMode(it)};promise.resolve(true)}
  @ReactMethod fun addListener(eventName:String){}
  @ReactMethod fun removeListeners(count:Double){}
}
