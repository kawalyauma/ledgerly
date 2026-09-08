package com.ledgerlyattendance

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.UUID

class CameraSpoolModule(private val context:ReactApplicationContext):ReactContextBaseJavaModule(context){
  private val dir:File get()=File(context.filesDir,"camera-spool").apply{mkdirs()}
  override fun getName()="CameraSpool"
  private fun source(value:String)=File(value.removePrefix("file://"))
  @ReactMethod fun stash(sourcePath:String,maxFiles:Int,promise:Promise){
    try{
      val src=source(sourcePath);if(!src.exists()){promise.reject("CAMERA_SPOOL_SOURCE_MISSING","Recorded camera segment no longer exists");return}
      val dest=File(dir,"${System.currentTimeMillis()}-${UUID.randomUUID()}.mp4")
      src.copyTo(dest,overwrite=false);runCatching{src.delete()}
      val evicted=Arguments.createArray();val keep=maxOf(20,minOf(500,maxFiles));val files=dir.listFiles{f->f.isFile&&f.name.endsWith(".mp4")}?.sortedBy{it.lastModified()}?.toMutableList()?:mutableListOf()
      while(files.size>keep){val old=files.removeAt(0);if(old.absolutePath!=dest.absolutePath&&old.delete())evicted.pushString(old.absolutePath)}
      val map=Arguments.createMap();map.putString("path",dest.absolutePath);map.putDouble("size",dest.length().toDouble());map.putArray("evicted",evicted);promise.resolve(map)
    }catch(e:Exception){promise.reject("CAMERA_SPOOL_FAILED",e.message,e)}
  }
  @ReactMethod fun remove(filePath:String,promise:Promise){try{val f=source(filePath);promise.resolve(!f.exists()||f.delete())}catch(e:Exception){promise.reject("CAMERA_SPOOL_REMOVE_FAILED",e.message,e)}}
  @ReactMethod fun exists(filePath:String,promise:Promise){promise.resolve(source(filePath).exists())}
  @ReactMethod fun list(promise:Promise){
    try{val rows=Arguments.createArray();dir.listFiles{f->f.isFile&&f.name.endsWith(".mp4")}?.sortedBy{it.lastModified()}?.forEach{f->val m=Arguments.createMap();m.putString("path",f.absolutePath);m.putDouble("size",f.length().toDouble());m.putDouble("modifiedAt",f.lastModified().toDouble());rows.pushMap(m)};promise.resolve(rows)}catch(e:Exception){promise.reject("CAMERA_SPOOL_LIST_FAILED",e.message,e)}
  }
}
