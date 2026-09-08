package com.ledgerlyattendance

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class FilePickerModule(private val context:ReactApplicationContext):ReactContextBaseJavaModule(context){
  private var pending:Promise?=null
  private val requestCode=49371
  private val listener:ActivityEventListener=object:BaseActivityEventListener(){
    override fun onActivityResult(activity:Activity?,code:Int,resultCode:Int,data:Intent?){
      if(code!=requestCode)return
      val promise=pending?:return
      pending=null
      if(resultCode!=Activity.RESULT_OK){promise.resolve(null);return}
      val uri=data?.data
      if(uri==null){promise.reject("FILE_PICK_FAILED","No file was selected");return}
      try{
        runCatching{context.contentResolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION)}
        val map=Arguments.createMap();map.putString("uri",uri.toString());map.putString("mimeType",context.contentResolver.getType(uri)?:"application/octet-stream")
        var name="file",size=0L
        context.contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE),null,null,null)?.use{cursor->if(cursor.moveToFirst()){val ni=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);if(ni>=0)name=cursor.getString(ni)?:name;val si=cursor.getColumnIndex(OpenableColumns.SIZE);if(si>=0&&!cursor.isNull(si))size=cursor.getLong(si)}}
        map.putString("name",name);map.putDouble("size",size.toDouble());promise.resolve(map)
      }catch(e:Exception){promise.reject("FILE_PICK_FAILED",e.message,e)}
    }
  }
  init{context.addActivityEventListener(listener)}
  override fun getName()="FilePicker"
  @ReactMethod fun pick(promise:Promise){
    if(pending!=null){promise.reject("FILE_PICK_BUSY","Another file picker is already open");return}
    val activity=currentActivity;if(activity==null){promise.reject("NO_ACTIVITY","Ledgerly is not attached to an Android activity");return}
    pending=promise
    try{val intent=Intent(Intent.ACTION_OPEN_DOCUMENT).apply{addCategory(Intent.CATEGORY_OPENABLE);type="*/*";addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)};activity.startActivityForResult(intent,requestCode)}catch(e:Exception){pending=null;promise.reject("FILE_PICK_FAILED",e.message,e)}
  }
}
