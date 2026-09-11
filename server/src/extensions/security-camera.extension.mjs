import {SecurityCameraNodeService} from '../security-camera/node-service.mjs';

const MODES=new Set(['cloudflare','shadow','node']);
function mode(value,name){const normalized=String(value||'cloudflare').trim().toLowerCase();if(!MODES.has(normalized))throw new Error(`${name} must be cloudflare, shadow, or node`);return normalized;}
export default{
  name:'security-camera',required:false,
  configure(env){
    const base=mode(env.LEDGERLY_SECURITY_CAMERA_CUTOVER,'LEDGERLY_SECURITY_CAMERA_CUTOVER');
    return{
      applianceCutover:mode(env.LEDGERLY_SECURITY_CAMERA_APPLIANCE_CUTOVER||base,'LEDGERLY_SECURITY_CAMERA_APPLIANCE_CUTOVER'),
      deviceCutover:mode(env.LEDGERLY_SECURITY_CAMERA_DEVICE_CUTOVER||base,'LEDGERLY_SECURITY_CAMERA_DEVICE_CUTOVER'),
      viewerCutover:mode(env.LEDGERLY_SECURITY_CAMERA_VIEWER_CUTOVER||base,'LEDGERLY_SECURITY_CAMERA_VIEWER_CUTOVER'),
      managementCutover:mode(env.LEDGERLY_SECURITY_CAMERA_MANAGEMENT_CUTOVER||base,'LEDGERLY_SECURITY_CAMERA_MANAGEMENT_CUTOVER'),
    };
  },
  enabled(){return true;},
  async create({services,extensionConfig}){
    const node=new SecurityCameraNodeService({database:services.database});
    const cuts={appliance:extensionConfig.applianceCutover,device:extensionConfig.deviceCutover,viewer:extensionConfig.viewerCutover,management:extensionConfig.managementCutover};
    return{
      value:Object.freeze({node,...cuts}),
      async readiness(){
        const active=Object.values(cuts).some(value=>value!=='cloudflare');if(!active)return{ok:true,authoritative:false,...cuts};
        const result=await services.database.query(`SELECT to_regclass('public.security_cameras') IS NOT NULL AS cameras,to_regclass('public.security_camera_servers') IS NOT NULL AS servers,to_regclass('public.security_camera_recordings') IS NOT NULL AS recordings`);
        const row=result.rows[0]||{};return{ok:Boolean(row.cameras&&row.servers&&row.recordings),authoritative:Object.values(cuts).some(value=>value==='node'),...cuts};
      },
      describe(){return{...cuts,videoTransport:'direct-camera-to-mediamtx',controlPlaneOnly:true,cloudflareFallback:Object.values(cuts).some(value=>value!=='node')};},
    };
  },
};