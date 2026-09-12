import { createAttendanceService } from '../attendance/service.mjs';

function cutover(value){
  const mode=String(value??'cloudflare').trim().toLowerCase();
  if(!['cloudflare','shadow','node'].includes(mode))throw new Error('LEDGERLY_ATTENDANCE_CUTOVER must be cloudflare, shadow, or node');
  return mode;
}

export default {
  name:'attendance',
  required:false,
  configure(env){
    return {
      enabled:String(env.LEDGERLY_ATTENDANCE_SELFHOST_ENABLED??env.SELFHOST_ATTENDANCE_ENABLED??'').toLowerCase()==='true',
      cutover:cutover(env.LEDGERLY_ATTENDANCE_CUTOVER),
      biometricKey:String(env.BIOMETRIC_ENCRYPTION_KEY??''),
    };
  },
  enabled(config){return config.enabled===true;},
  async create({services,extensionConfig}){
    const api=createAttendanceService({database:services.database,audit:services.audit,biometricKey:extensionConfig.biometricKey});
    return {
      value:Object.freeze({api}),
      readiness:()=>api.readiness(),
      describe(){return{...api.describe(),cutover:extensionConfig.cutover,biometricEncryptionConfigured:extensionConfig.biometricKey.length>0};},
    };
  },
};
