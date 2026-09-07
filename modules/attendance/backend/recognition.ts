/** Provider-neutral boundary. Attendance stores only provider references and metadata. */
export type EnrollmentInput={organizationId:string;personType:"student"|"staff";personId:string;samples:ArrayBuffer[]};
export type Match={personType:"student"|"staff";personId:string;confidence:number;livenessScore:number};
export interface AttendanceRecognitionProvider{
  enroll(input:EnrollmentInput):Promise<{profileRef:string;algorithmVersion:string;qualityScore:number}>;
  identify(organizationId:string,sample:ArrayBuffer):Promise<Match|null>;
  verify(profileRef:string,sample:ArrayBuffer):Promise<{matched:boolean;confidence:number;livenessScore:number}>;
  deleteProfile(profileRef:string):Promise<void>;
  healthCheck():Promise<{healthy:boolean;provider:string;version?:string}>;
}

/** Used until a school configures an external/on-device recognition provider. */
export class UnconfiguredRecognitionProvider implements AttendanceRecognitionProvider{
  private unavailable():never{throw new Error("Face recognition provider is not configured")}
  async enroll(_input:EnrollmentInput):Promise<never>{return this.unavailable()}
  async identify(_organizationId:string,_sample:ArrayBuffer):Promise<never>{return this.unavailable()}
  async verify(_profileRef:string,_sample:ArrayBuffer):Promise<never>{return this.unavailable()}
  async deleteProfile(_profileRef:string):Promise<never>{return this.unavailable()}
  async healthCheck(){return{healthy:false,provider:"unconfigured"}}
}
