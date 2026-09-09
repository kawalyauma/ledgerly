package com.ledgerlyattendance

import android.os.StatFs
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.UUID

class CameraSpoolModule(private val context:ReactApplicationContext):ReactContextBaseJavaModule(context){
  companion object{
    private const val MAX_SPOOL_BYTES=2L*1024L*1024L*1024L
    private const val MIN_FREE_BYTES=512L*1024L*1024L
  }
  private val dir:File get()=File(context.filesDir,"camera-spool").apply{mkdirs()}
  override fun getName()="CameraSpool"
  private fun source(value:String)=File(value.removePrefix("file://"))
  private fun mp4s()=dir.listFiles{f->f.isFile&&f.name.endsWith(".mp4")}?.sortedBy{it.lastModified()}?.toMutableList()?:mutableListOf()
  private fun freeBytes():Long=runCatching{StatFs(dir.absolutePath).availableBytes}.getOrDefault(0L)
  private fun totalBytes():Long=runCatching{StatFs(dir.absolutePath).totalBytes}.getOrDefault(0L)
  private fun spoolBytes(files:List<File>)=files.sumOf{it.length()}
  @ReactMethod fun stash(sourcePath:String,maxFiles:Int,promise:Promise){
    try{
      val src=source(sourcePath);if(!src.exists()){promise.reject("CAMERA_SPOOL_SOURCE_MISSING","Recorded camera segment no longer exists");return}
      val dest=File(dir,"${System.currentTimeMillis()}-${UUID.randomUUID()}.mp4")
      src.copyTo(dest,overwrite=false);runCatching{src.delete()}
      val evicted=Arguments.createArray();val keep=maxOf(20,minOf(500,maxFiles));val files=mp4s()
      fun overLimit()=files.size>keep||spoolBytes(files)>MAX_SPOOL_BYTES||freeBytes()<MIN_FREE_BYTES
      while(overLimit()&&files.size>1){val old=files.firstOrNull{it.absolutePath!=dest.absolutePath}?:break;files.remove(old);if(old.delete())evicted.pushString(old.absolutePath)}
      val map=Arguments.createMap();map.putString("path",dest.absolutePath);map.putDouble("size",dest.length().toDouble());map.putArray("evicted",evicted);map.putBoolean("pressure",overLimit());promise.resolve(map)
    }catch(e:Exception){promise.reject("CAMERA_SPOOL_FAILED",e.message,e)}
  }
  @ReactMethod fun remove(filePath:String,promise:Promise){try{val f=source(filePath);promise.resolve(!f.exists()||f.delete())}catch(e:Exception){promise.reject("CAMERA_SPOOL_REMOVE_FAILED",e.message,e)}}
  @ReactMethod fun exists(filePath:String,promise:Promise){promise.resolve(source(filePath).exists())}
  @ReactMethod fun list(promise:Promise){
    try{val rows=Arguments.createArray();mp4s().forEach{f->val m=Arguments.createMap();m.putString("path",f.absolutePath);m.putDouble("size",f.length().toDouble());m.putDouble("modifiedAt",f.lastModified().toDouble());rows.pushMap(m)};promise.resolve(rows)}catch(e:Exception){promise.reject("CAMERA_SPOOL_LIST_FAILED",e.message,e)}
  }
  @ReactMethod fun stats(promise:Promise){try{val files=mp4s();val map=Arguments.createMap();map.putInt("count",files.size);map.putDouble("bytes",spoolBytes(files).toDouble());map.putDouble("freeBytes",freeBytes().toDouble());map.putDouble("totalBytes",totalBytes().toDouble());map.putBoolean("pressure",spoolBytes(files)>MAX_SPOOL_BYTES||freeBytes()<MIN_FREE_BYTES||files.size>=170);promise.resolve(map)}catch(e:Exception){promise.reject("CAMERA_SPOOL_STATS_FAILED",e.message,e)}}
}
