package com.ledgerlyattendance

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class StoredFaceTemplate(val personType:String,val personId:String,val algorithmVersion:String,val embedding:FloatArray)

class FaceTemplateStore(context:Context):SQLiteOpenHelper(context,"ledgerly_faces.db",null,1){
  override fun onCreate(db:SQLiteDatabase){
    db.execSQL("CREATE TABLE templates(person_type TEXT NOT NULL,person_id TEXT NOT NULL,algorithm_version TEXT NOT NULL,embedding_secure TEXT NOT NULL,updated_at TEXT,PRIMARY KEY(person_type,person_id))")
  }
  override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){}
  fun replaceAll(rows:List<TemplateInput>){
    writableDatabase.beginTransaction()
    try{
      writableDatabase.delete("templates",null,null)
      val stmt=writableDatabase.compileStatement("INSERT INTO templates(person_type,person_id,algorithm_version,embedding_secure,updated_at) VALUES (?,?,?,?,?)")
      for(r in rows){
        stmt.clearBindings();stmt.bindString(1,r.personType);stmt.bindString(2,r.personId);stmt.bindString(3,r.algorithmVersion);stmt.bindString(4,CryptoVault.encrypt(r.embeddingBase64));stmt.bindString(5,r.updatedAt ?: "");stmt.executeInsert()
      }
      writableDatabase.setTransactionSuccessful()
    } finally { writableDatabase.endTransaction() }
  }
  fun all():List<StoredFaceTemplate>{
    val out=mutableListOf<StoredFaceTemplate>()
    readableDatabase.rawQuery("SELECT person_type,person_id,algorithm_version,embedding_secure FROM templates",null).use{c->
      while(c.moveToNext()){
        try{out+=StoredFaceTemplate(c.getString(0),c.getString(1),c.getString(2),FaceEncoding.decodeEmbedding(CryptoVault.decrypt(c.getString(3))))}catch(_:Throwable){}
      }
    }
    return out
  }
  fun count():Int=readableDatabase.rawQuery("SELECT COUNT(*) FROM templates",null).use{c->c.moveToFirst();c.getInt(0)}
}

data class TemplateInput(val personType:String,val personId:String,val algorithmVersion:String,val embeddingBase64:String,val updatedAt:String?)
