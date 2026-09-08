package com.ledgerlyattendance

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.Rect
import androidx.exifinterface.media.ExifInterface
import android.util.Base64
import com.facebook.react.bridge.*
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import org.json.JSONArray
import org.tensorflow.lite.Interpreter
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.util.concurrent.Executors
import kotlin.math.*

object FaceEncoding{
  fun encodeEmbedding(values:FloatArray):String{
    val b=ByteBuffer.allocate(values.size*4).order(ByteOrder.LITTLE_ENDIAN);values.forEach{b.putFloat(it)}
    return Base64.encodeToString(b.array(),Base64.NO_WRAP)
  }
  fun decodeEmbedding(value:String):FloatArray{
    val raw=Base64.decode(value,Base64.NO_WRAP);val b=ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);return FloatArray(raw.size/4){b.float}
  }
}

data class FaceSample(val bitmap:Bitmap,val face:Face,val quality:Double)

class FaceEngineModule(private val context:ReactApplicationContext):ReactContextBaseJavaModule(context){
  private val executor=Executors.newSingleThreadExecutor()
  private val store=FaceTemplateStore(context)
  private val detector=FaceDetection.getClient(FaceDetectorOptions.Builder()
    .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
    .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
    .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
    .setMinFaceSize(0.18f).build())
  @Volatile private var interpreter:Interpreter?=null
  @Volatile private var modelError:String?=null
  @Volatile private var matchThreshold=0.78
  @Volatile private var ambiguityMargin=0.05
  @Volatile private var livenessThreshold=0.70
  @Volatile private var qualityThreshold=0.55
  @Volatile private var templateIndex:List<StoredFaceTemplate>?=null
  override fun getName()="FaceEngine"

  private fun modelFile():File{
    val f=File(context.filesDir,"facenet.tflite")
    if(!f.exists()){
      try{context.assets.open("facenet.tflite").use{input->f.outputStream().use{input.copyTo(it)}}}
      catch(e:Throwable){throw IllegalStateException("facenet.tflite is not installed. Run the Ledgerly face-model installer before building the kiosk.")}
    }
    return f
  }
  private fun engine():Interpreter{
    interpreter?.let{return it}
    synchronized(this){
      interpreter?.let{return it}
      try{
        val file=modelFile();val mapped=FileInputStream(file).channel.use{it.map(FileChannel.MapMode.READ_ONLY,0,file.length())}
        val candidate=Interpreter(mapped,Interpreter.Options().setNumThreads(4))
        val inputShape=candidate.getInputTensor(0).shape();val outputShape=candidate.getOutputTensor(0).shape()
        if(!inputShape.contentEquals(intArrayOf(1,160,160,3))||!outputShape.contentEquals(intArrayOf(1,128))){
          candidate.close();throw IllegalStateException("Unsupported face model shape. Expected [1,160,160,3] -> [1,128].")
        }
        return candidate.also{interpreter=it;modelError=null}
      }catch(e:Throwable){modelError=e.message;throw e}
    }
  }
  private fun oriented(path:String):Bitmap{
    val p=path.removePrefix("file://");val src=BitmapFactory.decodeFile(p)?:throw IllegalArgumentException("Unable to read camera image")
    val exif=try{ExifInterface(p)}catch(_:Throwable){null}
    val orientation=exif?.getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL)?:ExifInterface.ORIENTATION_NORMAL
    val matrix=Matrix()
    when(orientation){
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL->matrix.setScale(-1f,1f)
      ExifInterface.ORIENTATION_ROTATE_180->matrix.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL->{matrix.setRotate(180f);matrix.postScale(-1f,1f)}
      ExifInterface.ORIENTATION_TRANSPOSE->{matrix.setRotate(90f);matrix.postScale(-1f,1f)}
      ExifInterface.ORIENTATION_ROTATE_90->matrix.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE->{matrix.setRotate(-90f);matrix.postScale(-1f,1f)}
      ExifInterface.ORIENTATION_ROTATE_270->matrix.setRotate(-90f)
    }
    if(matrix.isIdentity)return src
    return Bitmap.createBitmap(src,0,0,src.width,src.height,matrix,true).also{if(it!==src)src.recycle()}
  }
  private fun sample(path:String):FaceSample{
    val bmp=oriented(path);val faces=Tasks.await(detector.process(InputImage.fromBitmap(bmp,0)))
    if(faces.size!=1){bmp.recycle();throw IllegalStateException(if(faces.isEmpty())"No face detected" else "Only one face may be visible")}
    val face=faces[0];val area=face.boundingBox.width().toDouble()*face.boundingBox.height()/max(1.0,bmp.width.toDouble()*bmp.height)
    val centred=1.0-(abs(face.boundingBox.centerX()-bmp.width/2.0)/bmp.width+abs(face.boundingBox.centerY()-bmp.height/2.0)/bmp.height).coerceAtMost(1.0)
    val frontal=(1.0-(abs(face.headEulerAngleY)/45.0+abs(face.headEulerAngleZ)/45.0)/2.0).coerceIn(0.0,1.0)
    val sizeScore=(area/0.18).coerceIn(0.0,1.0)
    val quality=(.45*sizeScore+.30*frontal+.25*centred).coerceIn(0.0,1.0)
    return FaceSample(bmp,face,quality)
  }
  private fun lightAndSharpness(bmp:Bitmap):Pair<Double,Double>{
    val thumb=Bitmap.createScaledBitmap(bmp,64,64,true);val pixels=IntArray(64*64);thumb.getPixels(pixels,0,64,0,0,64,64);if(thumb!==bmp)thumb.recycle()
    var sum=0.0;val gray=DoubleArray(pixels.size);for(i in pixels.indices){val p=pixels[i];val g=.299*(p shr 16 and 255)+.587*(p shr 8 and 255)+.114*(p and 255);gray[i]=g;sum+=g}
    var edges=0.0;for(y in 1 until 63)for(x in 1 until 63){val i=y*64+x;edges+=abs(4*gray[i]-gray[i-1]-gray[i+1]-gray[i-64]-gray[i+64])}
    return Pair((sum/pixels.size/255.0).coerceIn(0.0,1.0),(edges/(62*62)/45.0).coerceIn(0.0,1.0))
  }
  private fun crop(sample:FaceSample):Bitmap{
    val original=sample.bitmap;val leftEye=sample.face.getLandmark(FaceLandmark.LEFT_EYE)?.position;val rightEye=sample.face.getLandmark(FaceLandmark.RIGHT_EYE)?.position
    val angle=if(leftEye!=null&&rightEye!=null) Math.toDegrees(atan2((rightEye.y-leftEye.y).toDouble(),(rightEye.x-leftEye.x).toDouble())).toFloat() else 0f
    val bmp=original;val b=sample.face.boundingBox;val margin=(max(b.width(),b.height())*.20).toInt();val size=max(b.width(),b.height())+2*margin
    val cx=b.centerX();val cy=b.centerY();var left=(cx-size/2).coerceAtLeast(0);var top=(cy-size/2).coerceAtLeast(0);var right=(left+size).coerceAtMost(bmp.width);var bottom=(top+size).coerceAtMost(bmp.height)
    left=(right-size).coerceAtLeast(0);top=(bottom-size).coerceAtLeast(0)
    val rawFace=Bitmap.createBitmap(bmp,left,top,(right-left).coerceAtLeast(1),(bottom-top).coerceAtLeast(1))
    val faceBmp=if(abs(angle)>1f){val m=Matrix().apply{postRotate(-angle)};Bitmap.createBitmap(rawFace,0,0,rawFace.width,rawFace.height,m,true).also{if(it!==rawFace)rawFace.recycle()}}else rawFace
    return Bitmap.createScaledBitmap(faceBmp,160,160,true).also{if(it!==faceBmp)faceBmp.recycle()}
  }
  private fun embedding(sample:FaceSample):FloatArray{
    val face=crop(sample);val pixels=IntArray(160*160);face.getPixels(pixels,0,160,0,0,160,160)
    val values=FloatArray(160*160*3);var pos=0
    for(px in pixels){values[pos++]=(px shr 16 and 0xff).toFloat();values[pos++]=(px shr 8 and 0xff).toFloat();values[pos++]=(px and 0xff).toFloat()}
    val mean=values.average().toFloat();var variance=0.0
    for(v in values){val d=(v-mean).toDouble();variance+=d*d}
    var std=sqrt(variance/values.size).toFloat();std=max(std,1f/sqrt(values.size.toFloat()))
    val input=ByteBuffer.allocateDirect(values.size*4).order(ByteOrder.nativeOrder());for(v in values)input.putFloat((v-mean)/std)
    input.rewind();val out=Array(1){FloatArray(128)};engine().run(input,out);face.recycle()
    val v=out[0];val norm=sqrt(v.sumOf{(it*it).toDouble()}).toFloat().coerceAtLeast(1e-8f);for(i in v.indices)v[i]/=norm;return v
  }
  private fun average(samples:List<FaceSample>):FloatArray{
    val all=samples.map{embedding(it)};val out=FloatArray(128);for(v in all)for(i in out.indices)out[i]+=v[i]/all.size
    val norm=sqrt(out.sumOf{(it*it).toDouble()}).toFloat().coerceAtLeast(1e-8f);for(i in out.indices)out[i]/=norm;return out
  }
  private fun cosine(a:FloatArray,b:FloatArray):Double{if(a.size!=b.size)return -1.0;var s=0.0;for(i in a.indices)s+=a[i]*b[i];return s.coerceIn(-1.0,1.0)}
  private fun liveness(samples:List<FaceSample>,challenge:String):Double{
    if(challenge=="DISABLED")return 1.0
    if(samples.size<3)return 0.0
    val a=samples.first().face;val m=samples[1].face;val z=samples.last().face
    val openStart=min(a.leftEyeOpenProbability?:1f,a.rightEyeOpenProbability?:1f)
    val openMid=min(m.leftEyeOpenProbability?:1f,m.rightEyeOpenProbability?:1f)
    val openEnd=min(z.leftEyeOpenProbability?:1f,z.rightEyeOpenProbability?:1f)
    val eyesClosed=openStart>.50f&&openMid<.35f&&openEnd>.50f
    val yawDelta=max(abs(m.headEulerAngleY-a.headEulerAngleY),abs(m.headEulerAngleY-z.headEulerAngleY))
    val turned=yawDelta>=14f
    return when(challenge){
      "EYES_CLOSED"->if(eyesClosed)1.0 else .20
      "TURN_HEAD"->if(turned)1.0 else .20
      "DISABLED"->1.0
      else->.20
    }
  }
  private fun paths(arr:ReadableArray)=List(arr.size()){i->arr.getString(i)?:""}.filter{it.isNotBlank()}
  private fun clean(samples:List<FaceSample>){samples.forEach{try{it.bitmap.recycle()}catch(_:Throwable){}}}

  @ReactMethod fun configure(match:Double,margin:Double,liveness:Double,quality:Double,promise:Promise){matchThreshold=match.coerceIn(.5,.99);ambiguityMargin=margin.coerceIn(.01,.30);livenessThreshold=liveness.coerceIn(.5,.99);qualityThreshold=quality.coerceIn(.3,.99);promise.resolve(true)}
  @ReactMethod fun healthCheck(promise:Promise){executor.execute{try{engine();val cached=templateIndex?:store.all().also{templateIndex=it};promise.resolve(Arguments.createMap().apply{putBoolean("healthy",true);putString("provider","facenet-128-v1");putBoolean("livenessRequired",true);putInt("templateCount",cached.size);putString("modelError",null)})}catch(e:Throwable){promise.resolve(Arguments.createMap().apply{putBoolean("healthy",false);putString("provider","facenet-128-v1");putBoolean("livenessRequired",true);putInt("templateCount",store.count());putString("modelError",modelError?:e.message)})}}}
  @ReactMethod fun replaceTemplates(json:String,promise:Promise){executor.execute{try{val a=JSONArray(json);val rows=mutableListOf<TemplateInput>();for(i in 0 until a.length()){val x=a.getJSONObject(i);rows+=TemplateInput(x.getString("personType"),x.getString("personId"),x.getString("algorithmVersion"),x.getString("embeddingBase64"),x.optString("updatedAt",null),x.optString("sampleId","primary"))};store.replaceAll(rows);templateIndex=store.all();promise.resolve(rows.size)}catch(e:Throwable){promise.reject("FACE_TEMPLATE_SYNC_FAILED",e.message,e)}}}
  @ReactMethod fun inspect(imagePath:String,promise:Promise){executor.execute{var s:FaceSample?=null;val started=android.os.SystemClock.elapsedRealtime();try{s=sample(imagePath);val (brightness,sharpness)=lightAndSharpness(s!!.bitmap);val b=s!!.face.boundingBox;val area=b.width().toDouble()*b.height()/max(1.0,s!!.bitmap.width.toDouble()*s!!.bitmap.height);val offset=max(abs(b.centerX()-s!!.bitmap.width/2.0)/s!!.bitmap.width,abs(b.centerY()-s!!.bitmap.height/2.0)/s!!.bitmap.height);val guidance=when{area<.08->"Move closer";offset>.22->"Center your face";brightness<.22->"Improve lighting";sharpness<.18->"Hold still";abs(s!!.face.headEulerAngleY)>12->"Look straight";else->"ready"};promise.resolve(Arguments.createMap().apply{putDouble("quality",s!!.quality);putDouble("yaw",s!!.face.headEulerAngleY.toDouble());putDouble("roll",s!!.face.headEulerAngleZ.toDouble());putDouble("leftEyeOpen",(s!!.face.leftEyeOpenProbability?:-1f).toDouble());putDouble("rightEyeOpen",(s!!.face.rightEyeOpenProbability?:-1f).toDouble());putDouble("brightness",brightness);putDouble("sharpness",sharpness);putDouble("faceArea",area);putString("guidance",guidance);putBoolean("ready",guidance=="ready");putDouble("detectionMs",(android.os.SystemClock.elapsedRealtime()-started).toDouble())})}catch(e:Throwable){promise.reject("FACE_INSPECTION_FAILED",e.message,e)}finally{s?.let{clean(listOf(it))}}}}
  @ReactMethod fun enroll(imagePaths:ReadableArray,challenge:String,promise:Promise){executor.execute{val totalStart=android.os.SystemClock.elapsedRealtime();val ss=mutableListOf<FaceSample>();try{val detectStart=android.os.SystemClock.elapsedRealtime();for(p in paths(imagePaths))ss+=sample(p);val detectionMs=android.os.SystemClock.elapsedRealtime()-detectStart;if(ss.size<3)throw IllegalStateException("Enrollment requires at least three live camera samples");val quality=ss.map{it.quality}.average();if(quality<qualityThreshold)throw IllegalStateException("Face quality is too low. Improve lighting and move closer to the camera.");val live=liveness(ss.take(3),challenge);if(live<livenessThreshold)throw IllegalStateException("Liveness challenge failed. Follow the on-screen instruction and hold the requested pose until capture.");val inferStart=android.os.SystemClock.elapsedRealtime();val individual=ss.map{embedding(it)};val avg=FloatArray(128);for(v in individual)for(i in avg.indices)avg[i]+=v[i]/individual.size;val norm=sqrt(avg.sumOf{(it*it).toDouble()}).toFloat().coerceAtLeast(1e-8f);for(i in avg.indices)avg[i]/=norm;val inferenceMs=android.os.SystemClock.elapsedRealtime()-inferStart;promise.resolve(Arguments.createMap().apply{putString("algorithmVersion","facenet-128-v1");putString("embeddingBase64",FaceEncoding.encodeEmbedding(avg));putArray("embeddingsBase64",Arguments.fromList(individual.map{FaceEncoding.encodeEmbedding(it)}));putDouble("qualityScore",quality);putDouble("livenessScore",live);putInt("poseCount",ss.size);putMap("timings",Arguments.createMap().apply{putDouble("detectionMs",detectionMs.toDouble());putDouble("inferenceMs",inferenceMs.toDouble());putDouble("totalMs",(android.os.SystemClock.elapsedRealtime()-totalStart).toDouble())})})}catch(e:Throwable){promise.reject("FACE_ENROLLMENT_FAILED",e.message,e)}finally{clean(ss)}}}
  @ReactMethod fun identify(imagePaths:ReadableArray,testMode:Boolean,allowScreenImage:Boolean,allowPrintedImage:Boolean,challenge:String,promise:Promise){executor.execute{val totalStart=android.os.SystemClock.elapsedRealtime();val ss=mutableListOf<FaceSample>();try{val detectStart=android.os.SystemClock.elapsedRealtime();for(p in paths(imagePaths))ss+=sample(p);val detectionMs=android.os.SystemClock.elapsedRealtime()-detectStart;if(ss.isEmpty())throw IllegalStateException("No usable face sample");val quality=ss.map{it.quality}.average();if(quality<qualityThreshold)throw IllegalStateException("Face quality is too low. Move closer and improve lighting.");val bypass=testMode&&(allowScreenImage||allowPrintedImage);val live=if(bypass)0.0 else liveness(ss,challenge);if(!bypass&&live<livenessThreshold)throw IllegalStateException("Liveness challenge failed");val inferStart=android.os.SystemClock.elapsedRealtime();val emb=average(ss);val inferenceMs=android.os.SystemClock.elapsedRealtime()-inferStart;val searchStart=android.os.SystemClock.elapsedRealtime();val bestByPerson=HashMap<String,Pair<StoredFaceTemplate,Double>>();for(t in(templateIndex?:store.all().also{templateIndex=it})){if(t.algorithmVersion!="facenet-128-v1")continue;val score=cosine(emb,t.embedding);val key="${t.personType}:${t.personId}";if(score>(bestByPerson[key]?.second?:-1.0))bestByPerson[key]=Pair(t,score)};val ranked=bestByPerson.values.sortedByDescending{it.second};val best=ranked.firstOrNull()?.first;val bestScore=ranked.firstOrNull()?.second?:-1.0;val secondScore=ranked.getOrNull(1)?.second?:-1.0;val searchMs=android.os.SystemClock.elapsedRealtime()-searchStart;if(best==null)throw IllegalStateException("No enrolled face templates are available on this kiosk");if(bestScore<matchThreshold)throw IllegalStateException("Face not recognized with enough confidence");val margin=if(secondScore<0)1.0 else bestScore-secondScore;if(margin<ambiguityMargin)throw IllegalStateException("Face match is ambiguous. Use QR, NFC or supervised lookup.");promise.resolve(Arguments.createMap().apply{putString("personId",best.personId);putString("personType",best.personType);putDouble("confidence",bestScore);putDouble("secondBestConfidence",secondScore.coerceAtLeast(0.0));putDouble("matchMargin",margin);putDouble("livenessScore",live);putBoolean("testMode",testMode);putMap("timings",Arguments.createMap().apply{putDouble("detectionMs",detectionMs.toDouble());putDouble("inferenceMs",inferenceMs.toDouble());putDouble("searchMs",searchMs.toDouble());putDouble("totalMs",(android.os.SystemClock.elapsedRealtime()-totalStart).toDouble());putInt("templates",templateIndex?.size?:0)})})}catch(e:Throwable){promise.reject("FACE_NOT_RECOGNIZED",e.message,e)}finally{clean(ss)}}}
  @ReactMethod fun verify(personType:String,personId:String,imagePaths:ReadableArray,testMode:Boolean,allowScreenImage:Boolean,allowPrintedImage:Boolean,challenge:String,promise:Promise){executor.execute{val ss=mutableListOf<FaceSample>();try{for(p in paths(imagePaths))ss+=sample(p);if(ss.isEmpty())throw IllegalStateException("No usable face sample");val quality=ss.map{it.quality}.average();if(quality<qualityThreshold)throw IllegalStateException("Face quality is too low");val bypass=testMode&&(allowScreenImage||allowPrintedImage);val live=if(bypass)0.0 else liveness(ss,challenge);if(!bypass&&live<livenessThreshold)throw IllegalStateException("Liveness challenge failed");val targets=(templateIndex?:store.all().also{templateIndex=it}).filter{it.personType==personType&&it.personId==personId&&it.algorithmVersion=="facenet-128-v1"};if(targets.isEmpty())throw IllegalStateException("This person has no face template on this kiosk");val probe=average(ss);val score=targets.maxOf{cosine(probe,it.embedding)};promise.resolve(Arguments.createMap().apply{putBoolean("matched",score>=matchThreshold);putDouble("confidence",score);putDouble("livenessScore",live);putBoolean("testMode",testMode)})}catch(e:Throwable){promise.reject("FACE_VERIFY_FAILED",e.message,e)}finally{clean(ss)}}}
}
