package com.ledgerlyattendance

import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AudioCallAudioModule(private val reactContext: ReactApplicationContext): ReactContextBaseJavaModule(reactContext) {
  private val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var previousMode = AudioManager.MODE_NORMAL
  private var previousSpeaker = false
  private var previousMicrophoneMute = false
  private var active = false
  private var ringtone: Ringtone? = null

  override fun getName() = "AudioCallAudio"

  @ReactMethod
  fun startRinging() {
    if (ringtone?.isPlaying == true) return
    try {
      val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      ringtone = RingtoneManager.getRingtone(reactContext, uri)?.also {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) it.isLooping = true
        it.play()
      }
    } catch (_: Throwable) {}
    try {
      val pattern = longArrayOf(0, 500, 450, 500, 1400)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vm = reactContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        vm.defaultVibrator.vibrate(VibrationEffect.createWaveform(pattern, 0))
      } else {
        @Suppress("DEPRECATION") val vibrator = reactContext.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0)) else @Suppress("DEPRECATION") vibrator.vibrate(pattern, 0)
      }
    } catch (_: Throwable) {}
  }

  @ReactMethod
  fun stopRinging() {
    try { ringtone?.stop() } catch (_: Throwable) {}
    ringtone = null
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vm = reactContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        vm.defaultVibrator.cancel()
      } else {
        @Suppress("DEPRECATION") val vibrator = reactContext.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        vibrator.cancel()
      }
    } catch (_: Throwable) {}
  }

  @ReactMethod
  fun start(speaker: Boolean, peerName: String) {
    stopRinging()
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
    stopRinging()
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
