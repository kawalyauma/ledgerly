package com.ledgerlyattendance

import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.widget.FrameLayout
import android.widget.VideoView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.RCTEventEmitter
import kotlin.math.abs

class NvrPlaybackView(context:ThemedReactContext):FrameLayout(context){
  private val video=VideoView(context)
  private var source:String?=null
  private var prepared=false
  private var shouldPlay=false
  private var desiredPositionMs=0
  private var desiredRate=1f

  init{
    addView(video,LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.MATCH_PARENT))
    video.setOnPreparedListener{player->
      prepared=true
      applyRate(player)
      if(desiredPositionMs>0)video.seekTo(desiredPositionMs)
      if(shouldPlay)video.start()
      emit("ready")
      player.setOnInfoListener{_,what,_->
        when(what){
          MediaPlayer.MEDIA_INFO_BUFFERING_START->emit("buffering")
          MediaPlayer.MEDIA_INFO_BUFFERING_END->emit(if(video.isPlaying)"playing" else "paused")
        }
        false
      }
    }
    video.setOnCompletionListener{emit("ended")}
    video.setOnErrorListener{_,what,extra->emit("error","Media error $what/$extra");true}
  }

  fun setSource(next:String?){
    if(next==source)return
    source=next
    prepared=false
    emit("loading")
    video.stopPlayback()
    if(next.isNullOrBlank()){emit("idle");return}
    video.setVideoURI(Uri.parse(next))
    video.requestFocus()
  }
  fun setPlaying(next:Boolean){shouldPlay=next;if(!prepared)return;if(next){video.start();emit("playing")}else{video.pause();emit("paused")}}
  fun setPosition(next:Int){desiredPositionMs=next.coerceAtLeast(0);if(prepared&&abs(video.currentPosition-desiredPositionMs)>700)video.seekTo(desiredPositionMs)}
  fun setRate(next:Float){desiredRate=next.coerceIn(.25f,4f);if(prepared&&Build.VERSION.SDK_INT>=23)try{video.setPlaybackParams(video.playbackParams.setSpeed(desiredRate))}catch(_:Throwable){}}
  private fun applyRate(player:MediaPlayer){if(Build.VERSION.SDK_INT>=23)try{player.playbackParams=player.playbackParams.setSpeed(desiredRate)}catch(_:Throwable){}}
  private fun emit(state:String,message:String?=null){
    val event=Arguments.createMap().apply{putString("state",state);if(message!=null)putString("message",message)}
    (context as ThemedReactContext).getJSModule(RCTEventEmitter::class.java).receiveEvent(id,"topNvrPlaybackState",event)
  }
  override fun onDetachedFromWindow(){video.stopPlayback();super.onDetachedFromWindow()}
}

class NvrPlaybackViewManager:SimpleViewManager<NvrPlaybackView>(){
  override fun getName()="LedgerlyNvrPlaybackView"
  override fun createViewInstance(context:ThemedReactContext)=NvrPlaybackView(context)
  @ReactProp(name="source") fun source(view:NvrPlaybackView,value:String?){view.setSource(value)}
  @ReactProp(name="playing",defaultBoolean=false) fun playing(view:NvrPlaybackView,value:Boolean){view.setPlaying(value)}
  @ReactProp(name="positionMs",defaultInt=0) fun position(view:NvrPlaybackView,value:Int){view.setPosition(value)}
  @ReactProp(name="rate",defaultFloat=1f) fun rate(view:NvrPlaybackView,value:Float){view.setRate(value)}
  override fun getExportedCustomDirectEventTypeConstants():MutableMap<String,Any> = MapBuilder.of("topNvrPlaybackState",MapBuilder.of("registrationName","onNvrPlaybackState"))
  override fun onDropViewInstance(view:NvrPlaybackView){view.setSource(null);super.onDropViewInstance(view)}
}
