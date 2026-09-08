package com.ledgerlyattendance

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AttendanceNativePackage:ReactPackage{
  override fun createNativeModules(context:ReactApplicationContext):List<NativeModule> = listOf(DeviceManagerModule(context),OfflineStoreModule(context),KioskManagerModule(context),NfcManagerModule(context),FaceEngineModule(context),FilePickerModule(context),CameraSpoolModule(context),CameraApplianceModule(context))
  override fun createViewManagers(context:ReactApplicationContext):List<ViewManager<*,*>> = emptyList()
}
