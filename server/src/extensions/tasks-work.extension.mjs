import { TasksWorkApiService } from "../tasks-work/api-service.mjs";
import { TasksWorkWorker } from "../tasks-work/worker.mjs";

function cutover(value){const mode=String(value??"cloudflare").trim().toLowerCase();if(!["cloudflare","shadow","node"].includes(mode))throw new Error("LEDGERLY_TASKS_WORK_CUTOVER must be cloudflare, shadow, or node");return mode;}
function positive(value,fallback,max){const n=Number(value);return Number.isInteger(n)&&n>0?Math.min(n,max):fallback;}

export default {
  name:"tasks-work",
  required:false,
  configure(env){return{
    enabled:String(env.LEDGERLY_TASKS_WORK_SELFHOST_ENABLED??"").toLowerCase()==="true",
    cutover:cutover(env.LEDGERLY_TASKS_WORK_CUTOVER),
    webhookCutover:cutover(env.LEDGERLY_TASKS_WORK_WEBHOOK_CUTOVER),
    reminderCron:String(env.SELFHOST_TASKS_WORK_REMINDER_CRON??"*/5 * * * *").trim()||"*/5 * * * *",
    pollMs:positive(env.SELFHOST_TASKS_WORK_POLL_MS,750,60000),
    maxAttempts:positive(env.SELFHOST_TASKS_WORK_MAX_ATTEMPTS,5,25),
  };},
  enabled(c){return c.enabled===true;},
  async create({services,tenantStorage,createQueue,extensionConfig}){
    const api=new TasksWorkApiService({database:services.database,audit:services.audit,events:services.events,tenantStorage});
    const queue=createQueue({name:"tasks-work",maxAttempts:extensionConfig.maxAttempts});
    const worker=new TasksWorkWorker({queue,database:services.database,notifications:services.notifications,maxAttempts:extensionConfig.maxAttempts});
    const orgs=await services.database.query("SELECT id,COALESCE(NULLIF(timezone,''),'UTC') AS timezone FROM organizations WHERE status='active' ORDER BY id");
    for(const org of orgs.rows){
      await services.scheduler.register({id:`tasks-work-reminders:${org.id}`,name:"Tasks & Work reminder sweep",organizationId:org.id,kind:"tasks-work.reminders.scan",cron:extensionConfig.reminderCron,timezone:org.timezone||"UTC",payload:{},enabled:true});
    }
    let stopped=false,running=false;
    async function tick(){if(stopped||running)return;running=true;try{for(let i=0;i<25&&!stopped;i+=1){const result=await worker.runOnce();if(!result?.processed&&!result?.retried&&!result?.deadLettered&&!result?.unsupported)break;}}catch(error){console.error(JSON.stringify({level:"error",component:"tasks-work-worker",message:error instanceof Error?error.message:String(error)}));}finally{running=false;}}
    void tick();const timer=setInterval(()=>void tick(),extensionConfig.pollMs);timer.unref?.();
    return {
      value:Object.freeze({api,queue,runWorkerOnce:()=>worker.runOnce()}),
      schedulerQueues:{"tasks-work.reminders.scan":queue},
      async readiness(){const [core,queueHealth]=await Promise.all([api.readiness(),queue.health()]);return{...core,ok:core.ok===true&&queueHealth.ok===true,queue:queueHealth,durableScheduler:true};},
      describe(){return{...api.describe(),cutover:extensionConfig.cutover,webhookCutover:extensionConfig.webhookCutover,durableQueue:true,persistentScheduler:true,reminderCron:extensionConfig.reminderCron,maxAttempts:extensionConfig.maxAttempts};},
      async close(){stopped=true;clearInterval(timer);while(running)await new Promise(resolve=>setTimeout(resolve,10));},
    };
  },
};
