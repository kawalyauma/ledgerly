package com.ledgerlyattendance

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.facebook.react.bridge.*
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private class MobileSyncDb(context:Context):SQLiteOpenHelper(context,"ledgerly_mobile_sync.db",null,1){
  override fun onCreate(db:SQLiteDatabase){
    db.execSQL("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
    db.execSQL("INSERT INTO meta(key,value) VALUES('next_sequence','1')")
    db.execSQL("CREATE TABLE collection_state(module_key TEXT NOT NULL,collection_key TEXT NOT NULL,schema_version INTEGER NOT NULL DEFAULT 0,cursor INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,PRIMARY KEY(module_key,collection_key))")
    db.execSQL("CREATE TABLE records(module_key TEXT NOT NULL,collection_key TEXT NOT NULL,record_id TEXT NOT NULL,version INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,payload_cipher TEXT,server_updated_at TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(module_key,collection_key,record_id))")
    db.execSQL("CREATE INDEX idx_mobile_sync_records_collection ON records(module_key,collection_key,deleted,updated_at)")
    db.execSQL("CREATE TABLE operations(operation_id TEXT PRIMARY KEY,sequence INTEGER NOT NULL UNIQUE,module_key TEXT NOT NULL,collection_key TEXT NOT NULL,record_id TEXT NOT NULL,kind TEXT NOT NULL,schema_version INTEGER NOT NULL,base_version INTEGER NOT NULL,client_timestamp TEXT NOT NULL,payload_cipher TEXT,dependencies_cipher TEXT,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,result_cipher TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)")
    db.execSQL("CREATE INDEX idx_mobile_sync_operations_pending ON operations(state,sequence)")
    db.execSQL("CREATE TABLE pull_acks(delivery_id TEXT PRIMARY KEY,module_key TEXT NOT NULL,collection_key TEXT NOT NULL,cursor INTEGER NOT NULL,created_at INTEGER NOT NULL)")
    db.execSQL("CREATE TABLE bootstrap_acks(bootstrap_id TEXT PRIMARY KEY,created_at INTEGER NOT NULL)")
  }
  override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){}
}

class MobileSyncStoreModule(context:ReactApplicationContext):ReactContextBaseJavaModule(context){
  private val helper=MobileSyncDb(context)
  override fun getName()="MobileSyncStore"

  private fun now()=System.currentTimeMillis()
  private fun isoNow():String{val f=SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);f.timeZone=TimeZone.getTimeZone("UTC");return f.format(Date())}
  private fun optString(o:JSONObject,key:String):String?=if(o.has(key)&&!o.isNull(key))o.getString(key) else null
  private fun encryptedJson(value:Any?):String?=if(value==null||value===JSONObject.NULL)null else CryptoVault.encrypt(value.toString())
  private fun decryptedJson(value:String?):Any?{if(value.isNullOrBlank())return null;val raw=CryptoVault.decrypt(value);return try{JSONObject(raw)}catch(_:Exception){try{JSONArray(raw)}catch(_:Exception){raw}}}
  private fun nextSequence(db:SQLiteDatabase):Long{
    val current=db.rawQuery("SELECT value FROM meta WHERE key='next_sequence'",null).use{c->if(c.moveToFirst())c.getString(0).toLongOrNull()?:1L else 1L}
    db.execSQL("INSERT INTO meta(key,value) VALUES('next_sequence',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",arrayOf((current+1).toString()))
    return current
  }
  private fun upsertRecord(db:SQLiteDatabase,moduleKey:String,collectionKey:String,recordId:String,version:Long,deleted:Boolean,payload:Any?,serverUpdatedAt:String?){
    val existing=db.rawQuery("SELECT version FROM records WHERE module_key=? AND collection_key=? AND record_id=?",arrayOf(moduleKey,collectionKey,recordId)).use{c->if(c.moveToFirst())c.getLong(0) else -1L}
    if(existing>version)return
    db.execSQL("INSERT INTO records(module_key,collection_key,record_id,version,deleted,payload_cipher,server_updated_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(module_key,collection_key,record_id) DO UPDATE SET version=excluded.version,deleted=excluded.deleted,payload_cipher=excluded.payload_cipher,server_updated_at=excluded.server_updated_at,updated_at=excluded.updated_at",arrayOf(moduleKey,collectionKey,recordId,version,if(deleted)1 else 0,encryptedJson(payload),serverUpdatedAt,now()))
  }
  private fun setCollectionState(db:SQLiteDatabase,moduleKey:String,collectionKey:String,schemaVersion:Int,cursor:Long){
    db.execSQL("INSERT INTO collection_state(module_key,collection_key,schema_version,cursor,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(module_key,collection_key) DO UPDATE SET schema_version=excluded.schema_version,cursor=CASE WHEN excluded.cursor>collection_state.cursor THEN excluded.cursor ELSE collection_state.cursor END,updated_at=excluded.updated_at",arrayOf(moduleKey,collectionKey,schemaVersion,cursor,now()))
  }

  @ReactMethod fun setCollectionSchemas(schemasJson:String,promise:Promise){
    try{val schemas=JSONArray(schemasJson);val db=helper.writableDatabase;db.beginTransaction();for(i in 0 until schemas.length()){val s=schemas.getJSONObject(i);setCollectionState(db,s.getString("moduleKey"),s.getString("collectionKey"),s.getInt("schemaVersion"),db.rawQuery("SELECT cursor FROM collection_state WHERE module_key=? AND collection_key=?",arrayOf(s.getString("moduleKey"),s.getString("collectionKey"))).use{c->if(c.moveToFirst())c.getLong(0) else 0L})};db.setTransactionSuccessful();db.endTransaction();promise.resolve(schemas.length())}catch(e:Exception){promise.reject("SYNC_SCHEMA_STORE_FAILED",e)}
  }

  @ReactMethod fun enqueueOperation(operationJson:String,promise:Promise){
    try{
      val o=JSONObject(operationJson);val db=helper.writableDatabase;db.beginTransaction()
      val operationId=o.getString("operationId")
      val existing=db.rawQuery("SELECT sequence FROM operations WHERE operation_id=?",arrayOf(operationId)).use{c->if(c.moveToFirst())c.getLong(0) else null}
      val sequence=existing?:nextSequence(db)
      if(existing==null){
        val moduleKey=o.getString("moduleKey");val collectionKey=o.getString("collectionKey");val recordId=o.getString("recordId")
        val baseVersion=if(o.has("baseVersion"))o.getLong("baseVersion") else db.rawQuery("SELECT version FROM records WHERE module_key=? AND collection_key=? AND record_id=?",arrayOf(moduleKey,collectionKey,recordId)).use{c->if(c.moveToFirst())c.getLong(0) else 0L}
        db.execSQL("INSERT INTO operations(operation_id,sequence,module_key,collection_key,record_id,kind,schema_version,base_version,client_timestamp,payload_cipher,dependencies_cipher,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",arrayOf(operationId,sequence,moduleKey,collectionKey,recordId,o.optString("kind","upsert"),o.getInt("schemaVersion"),baseVersion,o.optString("clientTimestamp",isoNow()),encryptedJson(if(o.has("payload"))o.get("payload") else null),encryptedJson(if(o.has("dependencies"))o.get("dependencies") else JSONArray()),"pending",now(),now()))
      }
      db.setTransactionSuccessful();db.endTransaction();promise.resolve(sequence.toDouble())
    }catch(e:Exception){promise.reject("SYNC_OPERATION_ENQUEUE_FAILED",e)}
  }

  @ReactMethod fun pendingOperations(limit:Double,promise:Promise){
    try{val out=Arguments.createArray();helper.readableDatabase.rawQuery("SELECT operation_id,sequence,module_key,collection_key,record_id,kind,schema_version,base_version,client_timestamp,payload_cipher,dependencies_cipher,attempts,last_error FROM operations WHERE state IN('pending','blocked') ORDER BY sequence LIMIT ?",arrayOf(limit.toInt().coerceIn(1,250).toString())).use{c->while(c.moveToNext()){val row=Arguments.createMap();row.putString("operationId",c.getString(0));row.putDouble("sequence",c.getLong(1).toDouble());row.putString("moduleKey",c.getString(2));row.putString("collectionKey",c.getString(3));row.putString("recordId",c.getString(4));row.putString("kind",c.getString(5));row.putInt("schemaVersion",c.getInt(6));row.putDouble("baseVersion",c.getLong(7).toDouble());row.putString("clientTimestamp",c.getString(8));val p=decryptedJson(if(c.isNull(9))null else c.getString(9));if(p!=null)row.putString("payloadJson",p.toString());val d=decryptedJson(if(c.isNull(10))null else c.getString(10));row.putString("dependenciesJson",d?.toString()?:"[]");row.putInt("attempts",c.getInt(11));row.putString("lastError",if(c.isNull(12))null else c.getString(12));out.pushMap(row)}};promise.resolve(out)}catch(e:Exception){promise.reject("SYNC_OPERATION_READ_FAILED",e)}
  }

  @ReactMethod fun applyPushResults(resultsJson:String,promise:Promise){
    try{val results=JSONArray(resultsJson);val db=helper.writableDatabase;db.beginTransaction();for(i in 0 until results.length()){val r=results.getJSONObject(i);val id=r.getString("operationId");val status=r.optString("status","rejected");val terminal=status=="applied"||status=="duplicate"||status=="conflict"||status=="rejected";db.execSQL("UPDATE operations SET state=?,attempts=attempts+1,last_error=?,result_cipher=?,updated_at=? WHERE operation_id=?",arrayOf(if(terminal)"terminal" else "blocked",optString(r.optJSONObject("error")?:JSONObject(),"message"),CryptoVault.encrypt(r.toString()),now(),id));if((status=="applied"||status=="duplicate")&&r.has("serverVersion")){val op=db.rawQuery("SELECT module_key,collection_key,record_id FROM operations WHERE operation_id=?",arrayOf(id));op.use{c->if(c.moveToFirst()){val payload=if(r.has("serverPayload")&&!r.isNull("serverPayload"))r.get("serverPayload") else null;upsertRecord(db,c.getString(0),c.getString(1),c.getString(2),r.getLong("serverVersion"),false,payload,null)}}}};db.setTransactionSuccessful();db.endTransaction();promise.resolve(results.length())}catch(e:Exception){promise.reject("SYNC_PUSH_APPLY_FAILED",e)}
  }

  @ReactMethod fun applyBootstrap(bootstrapJson:String,promise:Promise){
    try{val root=JSONObject(bootstrapJson);val collections=root.getJSONArray("collections");val db=helper.writableDatabase;db.beginTransaction();for(i in 0 until collections.length()){val col=collections.getJSONObject(i);val moduleKey=col.getString("moduleKey");val collectionKey=col.getString("collectionKey");db.delete("records","module_key=? AND collection_key=?",arrayOf(moduleKey,collectionKey));val records=col.getJSONArray("records");for(j in 0 until records.length()){val r=records.getJSONObject(j);upsertRecord(db,moduleKey,collectionKey,r.getString("id"),r.optLong("version",1),false,if(r.has("payload"))r.get("payload") else JSONObject.NULL,optString(r,"updatedAt"))};setCollectionState(db,moduleKey,collectionKey,col.getInt("schemaVersion"),col.optLong("watermark",0))};db.execSQL("INSERT OR IGNORE INTO bootstrap_acks(bootstrap_id,created_at) VALUES(?,?)",arrayOf(root.getString("bootstrapId"),now()));db.setTransactionSuccessful();db.endTransaction();promise.resolve(root.getString("bootstrapId"))}catch(e:Exception){promise.reject("SYNC_BOOTSTRAP_APPLY_FAILED",e)}
  }

  @ReactMethod fun applyPull(pullJson:String,promise:Promise){
    try{val root=JSONObject(pullJson);val collections=root.getJSONArray("collections");val db=helper.writableDatabase;db.beginTransaction();for(i in 0 until collections.length()){val col=collections.getJSONObject(i);val moduleKey=col.getString("moduleKey");val collectionKey=col.getString("collectionKey");val changes=col.getJSONArray("changes");for(j in 0 until changes.length()){val ch=changes.getJSONObject(j);val deleted=ch.optString("operation")=="delete";upsertRecord(db,moduleKey,collectionKey,ch.getString("recordId"),ch.getLong("version"),deleted,if(!deleted&&ch.has("payload"))ch.get("payload") else null,optString(ch,"changedAt"))};setCollectionState(db,moduleKey,collectionKey,col.getInt("schemaVersion"),col.optLong("nextCursor",0));val deliveryId=optString(col,"deliveryId");if(!deliveryId.isNullOrBlank())db.execSQL("INSERT INTO pull_acks(delivery_id,module_key,collection_key,cursor,created_at) VALUES(?,?,?,?,?) ON CONFLICT(delivery_id) DO UPDATE SET cursor=excluded.cursor",arrayOf(deliveryId,moduleKey,collectionKey,col.optLong("nextCursor",0),now()))};db.setTransactionSuccessful();db.endTransaction();promise.resolve(root.optString("requestId"))}catch(e:Exception){promise.reject("SYNC_PULL_APPLY_FAILED",e)}
  }

  @ReactMethod fun pendingPullAcks(promise:Promise){try{val out=Arguments.createArray();helper.readableDatabase.rawQuery("SELECT delivery_id,cursor FROM pull_acks ORDER BY created_at",null).use{c->while(c.moveToNext()){val row=Arguments.createMap();row.putString("deliveryId",c.getString(0));row.putDouble("cursor",c.getLong(1).toDouble());out.pushMap(row)}};promise.resolve(out)}catch(e:Exception){promise.reject("SYNC_ACK_READ_FAILED",e)}}
  @ReactMethod fun clearPullAcks(ids:ReadableArray,promise:Promise){try{val db=helper.writableDatabase;db.beginTransaction();for(i in 0 until ids.size())db.delete("pull_acks","delivery_id=?",arrayOf(ids.getString(i)));db.setTransactionSuccessful();db.endTransaction();promise.resolve(ids.size())}catch(e:Exception){promise.reject("SYNC_ACK_CLEAR_FAILED",e)}}
  @ReactMethod fun pendingBootstrapAcks(promise:Promise){try{val out=Arguments.createArray();helper.readableDatabase.rawQuery("SELECT bootstrap_id FROM bootstrap_acks ORDER BY created_at",null).use{c->while(c.moveToNext())out.pushString(c.getString(0))};promise.resolve(out)}catch(e:Exception){promise.reject("SYNC_BOOTSTRAP_ACK_READ_FAILED",e)}}
  @ReactMethod fun clearBootstrapAck(id:String,promise:Promise){try{promise.resolve(helper.writableDatabase.delete("bootstrap_acks","bootstrap_id=?",arrayOf(id)))}catch(e:Exception){promise.reject("SYNC_BOOTSTRAP_ACK_CLEAR_FAILED",e)}}

  @ReactMethod fun getRecord(moduleKey:String,collectionKey:String,recordId:String,promise:Promise){
    try{helper.readableDatabase.rawQuery("SELECT version,deleted,payload_cipher,server_updated_at FROM records WHERE module_key=? AND collection_key=? AND record_id=?",arrayOf(moduleKey,collectionKey,recordId)).use{c->if(!c.moveToFirst()){promise.resolve(null);return@use};val row=Arguments.createMap();row.putString("id",recordId);row.putDouble("version",c.getLong(0).toDouble());row.putBoolean("deleted",c.getInt(1)!=0);val p=decryptedJson(if(c.isNull(2))null else c.getString(2));row.putString("payloadJson",p?.toString());row.putString("updatedAt",if(c.isNull(3))null else c.getString(3));promise.resolve(row)}}catch(e:Exception){promise.reject("SYNC_RECORD_READ_FAILED",e)}
  }

  @ReactMethod fun listRecords(moduleKey:String,collectionKey:String,limit:Double,offset:Double,promise:Promise){
    try{val out=Arguments.createArray();helper.readableDatabase.rawQuery("SELECT record_id,version,payload_cipher,server_updated_at FROM records WHERE module_key=? AND collection_key=? AND deleted=0 ORDER BY updated_at DESC LIMIT ? OFFSET ?",arrayOf(moduleKey,collectionKey,limit.toInt().coerceIn(1,1000).toString(),offset.toInt().coerceAtLeast(0).toString())).use{c->while(c.moveToNext()){val row=Arguments.createMap();row.putString("id",c.getString(0));row.putDouble("version",c.getLong(1).toDouble());val p=decryptedJson(if(c.isNull(2))null else c.getString(2));row.putString("payloadJson",p?.toString());row.putString("updatedAt",if(c.isNull(3))null else c.getString(3));out.pushMap(row)}};promise.resolve(out)}catch(e:Exception){promise.reject("SYNC_RECORD_LIST_FAILED",e)}
  }

  @ReactMethod fun collectionStates(promise:Promise){try{val out=Arguments.createArray();helper.readableDatabase.rawQuery("SELECT module_key,collection_key,schema_version,cursor FROM collection_state ORDER BY module_key,collection_key",null).use{c->while(c.moveToNext()){val row=Arguments.createMap();row.putString("moduleKey",c.getString(0));row.putString("collectionKey",c.getString(1));row.putInt("schemaVersion",c.getInt(2));row.putDouble("cursor",c.getLong(3).toDouble());out.pushMap(row)}};promise.resolve(out)}catch(e:Exception){promise.reject("SYNC_STATE_READ_FAILED",e)}}
  @ReactMethod fun pendingOperationCount(promise:Promise){try{helper.readableDatabase.rawQuery("SELECT COUNT(*) FROM operations WHERE state IN('pending','blocked')",null).use{c->c.moveToFirst();promise.resolve(c.getInt(0))}}catch(e:Exception){promise.reject("SYNC_COUNT_FAILED",e)}}
}
