package com.ledgerlyattendance

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.facebook.react.bridge.*

private class AttendanceDb(context:Context):SQLiteOpenHelper(context,"ledgerly_attendance.db",null,2){
  override fun onCreate(db:SQLiteDatabase){
    db.execSQL("CREATE TABLE queue(id TEXT PRIMARY KEY,payload_cipher TEXT NOT NULL,created_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,state TEXT NOT NULL DEFAULT 'pending')")
    db.execSQL("CREATE TABLE secure_values(key TEXT PRIMARY KEY,value_cipher TEXT NOT NULL,updated_at INTEGER NOT NULL)")
  }
  override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){
    if(oldVersion<2){
      try{db.execSQL("ALTER TABLE queue ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'")}catch(_:Exception){}
    }
  }
}

class OfflineStoreModule(context:ReactApplicationContext):ReactContextBaseJavaModule(context){
  private val helper=AttendanceDb(context)
  override fun getName()="OfflineStore"
  @ReactMethod fun enqueue(id:String,payload:String,promise:Promise){try{helper.writableDatabase.execSQL("INSERT OR IGNORE INTO queue(id,payload_cipher,created_at,state) VALUES (?,?,?,'pending')",arrayOf(id,CryptoVault.encrypt(payload),System.currentTimeMillis()));promise.resolve(id)}catch(e:Exception){promise.reject("QUEUE_WRITE_FAILED",e)}}
  @ReactMethod fun pending(limit:Double,promise:Promise){try{val out=Arguments.createArray();helper.readableDatabase.rawQuery("SELECT id,payload_cipher,attempts,last_error FROM queue WHERE state='pending' ORDER BY created_at LIMIT ?",arrayOf(limit.toInt().coerceIn(1,500).toString())).use{c->while(c.moveToNext()){val row=Arguments.createMap();row.putString("id",c.getString(0));row.putString("payload",CryptoVault.decrypt(c.getString(1)));row.putInt("attempts",c.getInt(2));row.putString("lastError",if(c.isNull(3)) null else c.getString(3));out.pushMap(row)}};promise.resolve(out)}catch(e:Exception){promise.reject("QUEUE_READ_FAILED",e)}}
  @ReactMethod fun failed(limit:Double,promise:Promise){try{val out=Arguments.createArray();helper.readableDatabase.rawQuery("SELECT id,payload_cipher,attempts,last_error FROM queue WHERE state='failed' ORDER BY created_at DESC LIMIT ?",arrayOf(limit.toInt().coerceIn(1,500).toString())).use{c->while(c.moveToNext()){val row=Arguments.createMap();row.putString("id",c.getString(0));row.putString("payload",CryptoVault.decrypt(c.getString(1)));row.putInt("attempts",c.getInt(2));row.putString("lastError",if(c.isNull(3)) null else c.getString(3));out.pushMap(row)}};promise.resolve(out)}catch(e:Exception){promise.reject("QUEUE_FAILED_READ_FAILED",e)}}
  @ReactMethod fun acknowledge(ids:ReadableArray,promise:Promise){try{val db=helper.writableDatabase;db.beginTransaction();for(i in 0 until ids.size())db.delete("queue","id=?",arrayOf(ids.getString(i)));db.setTransactionSuccessful();db.endTransaction();promise.resolve(ids.size())}catch(e:Exception){promise.reject("QUEUE_ACK_FAILED",e)}}
  @ReactMethod fun fail(ids:ReadableArray,message:String,promise:Promise){try{for(i in 0 until ids.size())helper.writableDatabase.execSQL("UPDATE queue SET attempts=attempts+1,last_error=? WHERE id=?",arrayOf(message.take(500),ids.getString(i)));promise.resolve(ids.size())}catch(e:Exception){promise.reject("QUEUE_UPDATE_FAILED",e)}}
  @ReactMethod fun reject(ids:ReadableArray,message:String,promise:Promise){try{for(i in 0 until ids.size())helper.writableDatabase.execSQL("UPDATE queue SET attempts=attempts+1,last_error=?,state='failed' WHERE id=?",arrayOf(message.take(500),ids.getString(i)));promise.resolve(ids.size())}catch(e:Exception){promise.reject("QUEUE_REJECT_FAILED",e)}}
  @ReactMethod fun retryFailed(promise:Promise){try{helper.writableDatabase.execSQL("UPDATE queue SET state='pending' WHERE state='failed'");promise.resolve(true)}catch(e:Exception){promise.reject("QUEUE_RETRY_FAILED",e)}}
  @ReactMethod fun count(promise:Promise){helper.readableDatabase.rawQuery("SELECT COUNT(*) FROM queue WHERE state='pending'",null).use{c->c.moveToFirst();promise.resolve(c.getInt(0))}}
  @ReactMethod fun failedCount(promise:Promise){helper.readableDatabase.rawQuery("SELECT COUNT(*) FROM queue WHERE state='failed'",null).use{c->c.moveToFirst();promise.resolve(c.getInt(0))}}
  @ReactMethod fun putSecure(key:String,value:String,promise:Promise){try{helper.writableDatabase.execSQL("INSERT INTO secure_values(key,value_cipher,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_cipher=excluded.value_cipher,updated_at=excluded.updated_at",arrayOf(key,CryptoVault.encrypt(value),System.currentTimeMillis()));promise.resolve(true)}catch(e:Exception){promise.reject("SECURE_WRITE_FAILED",e)}}
  @ReactMethod fun getSecure(key:String,promise:Promise){try{helper.readableDatabase.rawQuery("SELECT value_cipher FROM secure_values WHERE key=?",arrayOf(key)).use{c->promise.resolve(if(c.moveToFirst())CryptoVault.decrypt(c.getString(0)) else null)}}catch(e:Exception){promise.reject("SECURE_READ_FAILED",e)}}
  @ReactMethod fun removeSecure(key:String,promise:Promise){promise.resolve(helper.writableDatabase.delete("secure_values","key=?",arrayOf(key)))}
}
