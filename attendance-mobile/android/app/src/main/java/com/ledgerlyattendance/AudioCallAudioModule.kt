package com.ledgerlyattendance

import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AudioCallAudioModule(private val reactContext: ReactApplicationContext): ReactContextBaseJavaModule(reactContext) {
  private val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var previousMode = AudioManager.MODE_NORMAL
  private var previousSpeaker = false
  private var previousMicrophoneMute = false
  private var active = false

  override fun getName() = "AudioCallAudio"

  @ReactMethod
  fun start(speaker: Boolean, peerName: String) {
    if (!active) {
      previousMode = audioManager.mode
      previousSpeaker = audioManager.isSpeakerphoneOn
      previousMicrophoneMute = audioManager.isMicrophoneMute
      active = true
    }
    val service = Intent(reactContext, AudioCallKeepAliveService::class.java).putExtra(AudioCallKeepAliveService.EXTRA_PEER_NAME, peerName)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) reactContext.startForegroundService(service) else reactContext.startService(service)
    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    audioManager.isMicrophoneMute = false
    route(speaker)
  }

  @ReactMethod
  fun setSpeaker(speaker: Boolean) {
    if (!active) start(speaker, "Ledgerly worker") else route(speaker)
  }

  @ReactMethod
  fun stop() {
    if (!active) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) audioManager.clearCommunicationDevice()
    @Suppress("DEPRECATION")
    audioManager.isSpeakerphoneOn = previousSpeaker
    audioManager.isMicrophoneMute = previousMicrophoneMute
    audioManager.mode = previousMode
    reactContext.stopService(Intent(reactContext, AudioCallKeepAliveService::class.java))
    active = false
  }

  override fun invalidate() {
    stop()
    super.invalidate()
  }

  private fun route(speaker: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val wanted = if (speaker) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
      val device = audioManager.availableCommunicationDevices.firstOrNull { it.type == wanted }
      if (device != null) audioManager.setCommunicationDevice(device)
      else if (!speaker) audioManager.clearCommunicationDevice()
    } else {
      @Suppress("DEPRECATION")
      audioManager.isSpeakerphoneOn = speaker
    }
  }
}
