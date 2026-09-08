export type CameraRegistration={deviceId:string;credential:string;name:string;location?:string|null;serverId?:string|null;organizationId:string;status?:string};
export type CameraConfig={
 device:{id:string;name:string;location?:string|null;organizationId:string};
 capture:{preferredFacing:"front"|"back";width:number;height:number;fps:number;bitrateKbps:number;segmentSeconds:number};
 transport:{mode:string;server:{id:string;name:string;localBaseUrl?:string|null;status:string}|null;protocol:string;ingestUrl?:string|null};
 recording:{enabled:boolean};
};
export type CameraRuntimeState={recording:boolean;uploading:boolean;pendingSegments:number;lastUploadedAt?:string;lastError?:string};
