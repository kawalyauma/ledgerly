export type ForensicHold={id:string;camera_id:string;camera_name:string;incident_id?:string|null;incident_title?:string|null;from_at:string;to_at:string;reason:string;status:"active"|"released";created_at:string};
export type CustodyEntry={id:string;evidence_type:string;evidence_id:string;action:string;actor_user_id?:string|null;details:any;created_at:string};
export type ForensicManifest={exportId:string;cameraId:string;cameraName:string;manifest:any;manifestSha256:string;hmacSha256?:string|null;signingStatus:"signed"|"unsigned";exportContentSha256?:string|null;verificationStatus:"pending"|"verified"|"mismatch";exportStatus:string};
export type ForensicCamera={id:string;name:string;location?:string;status?:string};
