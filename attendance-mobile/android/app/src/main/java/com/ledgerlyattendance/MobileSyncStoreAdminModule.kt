package com.ledgerlyattendance

import android.database.sqlite.SQLiteDatabase
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MobileSyncStoreAdminModule(private val context:ReactApplicationContext):ReactContextBaseJavaModule(context){
  override fun getName()="MobileSyncStoreAdmin"

  @ReactMethod fun reset(promise:Promise){
    try{
      val path=context.getDatabasePath("ledgerly_mobile_sync.db")
      if(!path.exists()){promise.resolve(true);return}
      val db=SQLiteDatabase.openDatabase(path.path,null,SQLiteDatabase.OPEN_READWRITE)
      db.beginTransaction()
      try{
        db.execSQL("DELETE FROM pull_acks")
        db.execSQL("DELETE FROM bootstrap_acks")
        db.execSQL("DELETE FROM operations")
        db.execSQL("DELETE FROM records")
        db.execSQL("DELETE FROM collection_state")
        db.execSQL("INSERT INTO meta(key,value) VALUES('next_sequence','1') ON CONFLICT(key) DO UPDATE SET value='1'")
        db.setTransactionSuccessful()
      }finally{db.endTransaction();db.close()}
      promise.resolve(true)
    }catch(e:Exception){promise.reject("SYNC_ACCOUNT_RESET_FAILED",e)}
  }
}
