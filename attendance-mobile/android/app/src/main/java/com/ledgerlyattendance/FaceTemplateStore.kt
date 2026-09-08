package com.ledgerlyattendance

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class StoredFaceTemplate(val personType:String,val personId:String,val algorithmVersion:String,val embedding:FloatArray,val sampleId:String="primary")

class FaceTemplateStore(context:Context):SQLiteOpenHelper(context,"ledgerly_faces.db",null,2){
  override fun onCreate(db:SQLiteDatabase){
    db.execSQL("CREATE TABLE templates(person_type TEXT NOT NULL,person_id TEXT NOT NULL,sample_id TEXT NOT NULL DEFAULT 'primary',algorithm_version TEXT NOT NULL,embedding_secure TEXT NOT NULL,updated_at TEXT,PRIMARY KEY(person_type,person_id,sample_id))")
  }
  override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){
    if(oldVersion<2){
      db.execSQL("ALTER TABLE templates RENAME TO templates_v1")
      onCreate(db)
      db.execSQL("INSERT INTO templates(person_type,person_id,sample_id,algorithm_version,embedding_secure,updated_at) SELECT person_type,person_id,'primary',algorithm_version,embedding_secure,updated_at FROM templates_v1")
      db.execSQL("DROP TABLE templates_v1")
    }
  }
  fun replaceAll(rows:List<TemplateInput>){
    writableDatabase.beginTransaction()
    try{
      writableDatabase.delete("templates",null,null)
      val stmt=writableDatabase.compileStatement("INSERT INTO templates(person_type,person_id,sample_id,algorithm_version,embedding_secure,updated_at) VALUES (?,?,?,?,?,?)")
      for(r in rows){
        stmt.clearBindings();stmt.bindString(1,r.personType);stmt.bindString(2,r.personId);stmt.bindString(3,r.sampleId);stmt.bindString(4,r.algorithmVersion);stmt.bindString(5,CryptoVault.encrypt(r.embeddingBase64));stmt.bindString(6,r.updatedAt ?: "");stmt.executeInsert()
      }
      writableDatabase.setTransactionSuccessful()
    } finally { writableDatabase.endTransaction() }
  }
  fun all():List<StoredFaceTemplate>{
    val out=mutableListOf<StoredFaceTemplate>()
    readableDatabase.rawQuery("SELECT person_type,person_id,algorithm_version,embedding_secure,sample_id FROM templates",null).use{c->
      while(c.moveToNext()){
        try{out+=StoredFaceTemplate(c.getString(0),c.getString(1),c.getString(2),FaceEncoding.decodeEmbedding(CryptoVault.decrypt(c.getString(3))),c.getString(4))}catch(_:Throwable){}
      }
    }
    return out
  }
  fun count():Int=readableDatabase.rawQuery("SELECT COUNT(*) FROM templates",null).use{c->c.moveToFirst();c.getInt(0)}
}

data class TemplateInput(val personType:String,val personId:String,val algorithmVersion:String,val embeddingBase64:String,val updatedAt:String?,val sampleId:String="primary")
