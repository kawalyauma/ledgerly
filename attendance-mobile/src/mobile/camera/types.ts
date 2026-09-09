export type CameraRegistration={deviceId:string;credential:string;name:string;location?:string|null;serverId?:string|null;organizationId:string;status?:string};
export type CameraConfig={
 device:{id:string;name:string;location?:string|null;organizationId:string};
 capture:{preferredFacing:"front"|"back";width:number;height:number;fps:number;bitrateKbps:number;segmentSeconds:number};
 transport:{mode:string;server:{id:string;name:string;localBaseUrl?:string|null;status:string}|null;protocol:string;ingestUrl?:string|null};
 recording:{enabled:boolean};
};
export type CameraProfile={preferred_facing:"front"|"back";width:number;height:number;fps:number;bitrate_kbps:number;segment_seconds:number;retention_days:number;audio_enabled:number;motion_enabled:number;updated_at?:string|null};
export type CameraStreamConfig={enabled:boolean;cameraId:string;streamPath:string;whipUrl?:string|null;publishToken?:string|null;server?:{id:string;name:string;mediaStatus?:string;webrtcBaseUrl?:string|null}|null;iceServers:Array<{urls:string|string[];username?:string;credential?:string}>;fallbackIngestUrl?:string|null};
export type CameraRuntimeState={recording:boolean;uploading:boolean;pendingSegments:number;spoolBytes?:number;spoolFreeBytes?:number;bufferPressure?:boolean;lastUploadedAt?:string;lastError?:string};
export type CameraApplianceHealth={enabled?:boolean;running:boolean;wakeLock:boolean;deviceOwner?:boolean;batteryLevel?:number;temperatureC?:number;thermalStatus?:number;charging?:boolean};
export type CameraRemediationState={capturePaused:boolean;pauseReason?:"thermal"|"low-battery"|"storage"|null;remediationCount:number;lastRemediationAt?:string|null;nvrReachability:string};
