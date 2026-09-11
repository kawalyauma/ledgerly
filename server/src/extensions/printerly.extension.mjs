import {PrinterlyRuntimeService} from '../printerly/runtime-service.mjs';
import {PrinterlyCostingService} from '../printerly/costing-service.mjs';
import {PrinterlyNodeService} from '../printerly/node-service.mjs';
import {PrinterlyDispatchWorker} from '../printerly/dispatch-worker.mjs';

const modes=new Set(['cloudflare','shadow','node']);
function mode(value){const v=String(value||'cloudflare').toLowerCase();if(!modes.has(v))throw new Error('LEDGERLY_PRINTERLY_CUTOVER must be cloudflare, shadow, or node');return v;}

export default{
  name:'printerly',
  required:false,
  configure(env){return{cutover:mode(env.LEDGERLY_PRINTERLY_CUTOVER),outboxPollMs:Math.max(500,Number(env.LEDGERLY_PRINTERLY_OUTBOX_POLL_MS)||2000)};},
  enabled(){return true;},
  async create({services,createQueue,extensionConfig}){
    const queue=createQueue({name:'printerly',maxAttempts:8});
    const runtime=new PrinterlyRuntimeService({database:services.database});
    const costing=new PrinterlyCostingService({database:services.database});
    const node=new PrinterlyNodeService({database:services.database,storage:services.storage,runtime,costing});
    const outbox=new PrinterlyDispatchWorker({database:services.database,queue,maxAttempts:8});
    let timer=null,busy=false;
    const drain=async()=>{if(busy||extensionConfig.cutover==='cloudflare')return;busy=true;try{await outbox.drain({limit:100});}catch(error){console.error(JSON.stringify({level:'error',component:'printerly-outbox',message:error instanceof Error?error.message:String(error)}));}finally{busy=false;}};
    if(extensionConfig.cutover!=='cloudflare'){timer=setInterval(()=>void drain(),extensionConfig.outboxPollMs);timer.unref?.();void drain();}
    return{
      value:Object.freeze({cutover:extensionConfig.cutover,queue,runtime,costing,node,outbox}),
      schedulerQueues:{'printerly.dispatch':queue,'printerly.batch-dispatch':queue,'printerly.retention':queue,'printerly.quota-maintenance':queue,'printerly.release-cleanup':queue,'printerly.procurement':queue,'printerly.service-sla':queue},
      async readiness(){
        if(extensionConfig.cutover==='cloudflare')return{ok:true,cutover:'cloudflare',authoritative:false};
        const dead=(await services.database.query(`SELECT COUNT(*)::int count FROM prn_dispatch_outbox WHERE status='dead'`)).rows[0];
        return{ok:Number(dead?.count||0)===0,cutover:extensionConfig.cutover,authoritative:extensionConfig.cutover==='node',deadOutbox:Number(dead?.count||0)};
      },
      describe(){return{cutover:extensionConfig.cutover,legacyNodeApi:extensionConfig.cutover==='node',outbox:'postgres-to-redis'};},
      async close(){if(timer)clearInterval(timer);},
    };
  },
};
