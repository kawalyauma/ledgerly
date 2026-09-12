import { TasksWorkApiService } from "../tasks-work/api-service.mjs";

function cutover(value){const mode=String(value??"cloudflare").trim().toLowerCase();if(!["cloudflare","shadow","node"].includes(mode))throw new Error("LEDGERLY_TASKS_WORK_CUTOVER must be cloudflare, shadow, or node");return mode;}

export default {
  name:"tasks-work",
  required:false,
  configure(env){return{enabled:String(env.LEDGERLY_TASKS_WORK_SELFHOST_ENABLED??"").toLowerCase()==="true",cutover:cutover(env.LEDGERLY_TASKS_WORK_CUTOVER),webhookCutover:cutover(env.LEDGERLY_TASKS_WORK_WEBHOOK_CUTOVER)};},
  enabled(c){return c.enabled===true;},
  async create({services,tenantStorage,extensionConfig}){
    const api=new TasksWorkApiService({database:services.database,audit:services.audit,events:services.events,tenantStorage});
    return {
      value:Object.freeze({api}),
      readiness:()=>api.readiness(),
      describe(){return{...api.describe(),cutover:extensionConfig.cutover,webhookCutover:extensionConfig.webhookCutover};},
    };
  },
};
