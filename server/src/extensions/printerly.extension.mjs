import {PrinterlyRuntimeService} from '../printerly/runtime-service.mjs';
import {PrinterlyCostingService} from '../printerly/costing-service.mjs';
import {PrinterlyNodeService} from '../printerly/node-service.mjs';
import {PrinterlyDispatchWorker} from '../printerly/dispatch-worker.mjs';
import {PrinterlyMaintenanceService} from '../printerly/maintenance-service.mjs';
import {PrinterlyBatchService} from '../printerly/batch-service.mjs';
import {PrinterlyJobService} from '../printerly/job-service.mjs';
import {PrinterlyApprovalService} from '../printerly/approval-service.mjs';
import {PrinterlyDocumentService} from '../printerly/document-service.mjs';
import {PrinterlyQueueWorker} from '../printerly/queue-worker.mjs';
import {PrinterlyScheduleRegistry} from '../printerly/schedule-registry.mjs';

const modes=new Set(['cloudflare','shadow','node']);
function mode(value,name='LEDGERLY_PRINTERLY_CUTOVER'){const v=String(value||'cloudflare').toLowerCase();if(!modes.has(v))throw new Error(`${name} must be cloudflare, shadow, or node`);return v;}

export default{
  name:'printerly',required:false,
  configure(env){const cutover=mode(env.LEDGERLY_PRINTERLY_CUTOVER),jobCutover=mode(env.LEDGERLY_PRINTERLY_JOB_CUTOVER,'LEDGERLY_PRINTERLY_JOB_CUTOVER');if(jobCutover==='node'&&cutover!=='node')throw new Error('LEDGERLY_PRINTERLY_JOB_CUTOVER=node requires LEDGERLY_PRINTERLY_CUTOVER=node so accepted jobs can be claimed by self-hosted Printerly Nodes');return{cutover,jobCutover,outboxPollMs:Math.max(500,Number(env.LEDGERLY_PRINTERLY_OUTBOX_POLL_MS)||2000),workerPollMs:Math.max(250,Number(env.LEDGERLY_PRINTERLY_WORKER_POLL_MS)||1000)};},
  enabled(){return true;},
  async create({services,createQueue,extensionConfig}){
    const queue=createQueue({name:'printerly',maxAttempts:8});
    const runtime=new PrinterlyRuntimeService({database:services.database});
    const costing=new PrinterlyCostingService({database:services.database});
    const node=new PrinterlyNodeService({database:services.database,storage:services.storage,runtime,costing});
    const jobs=new PrinterlyJobService({database:services.database,runtime});
    const approvals=new PrinterlyApprovalService({database:services.database});
    const documents=new PrinterlyDocumentService({database:services.database,storage:services.storage});
    const outbox=new PrinterlyDispatchWorker({database:services.database,queue,maxAttempts:8});
    const maintenance=new PrinterlyMaintenanceService({database:services.database,storage:services.storage,runtime});
    const batches=new PrinterlyBatchService({database:services.database});
    const schedules=new PrinterlyScheduleRegistry({database:services.database,scheduler:services.scheduler});
    const authoritative=extensionConfig.cutover==='node';
    const organization=job=>{const organizationId=String(job.organizationId||job.payload?.organizationId||'').trim();if(!organizationId)throw new Error('Printerly job is missing organizationId');return organizationId;};
    const run=method=>async job=>{if(!authoritative)return{skipped:true,reason:'cloudflare-authoritative'};return maintenance[method](organization(job));};
    const runBatch=async job=>{if(!authoritative)return{skipped:true,reason:'cloudflare-authoritative'};const organizationId=organization(job),result=await batches.dispatch(organizationId);await maintenance.batchStatus(organizationId);return result;};
    const worker=new PrinterlyQueueWorker({queue,handlers:{'printerly.health':run('health'),'printerly.batch-dispatch':runBatch,'printerly.batch-status':run('batchStatus'),'printerly.retention':run('retention'),'printerly.consumables':run('consumables'),'printerly.service-sla':run('serviceSla'),'printerly.routing':run('routing'),'printerly.release-cleanup':run('releaseCleanup'),'printerly.procurement':run('procurement')}});
    let outboxTimer=null,workerTimer=null,outboxBusy=false,workerBusy=false,scheduleState={enabled:false};
    const drainOutbox=async()=>{if(outboxBusy||extensionConfig.cutover==='cloudflare')return;outboxBusy=true;try{await outbox.drain({limit:100});}catch(error){console.error(JSON.stringify({level:'error',component:'printerly-outbox',message:error instanceof Error?error.message:String(error)}));}finally{outboxBusy=false;}};
    const drainQueue=async()=>{if(workerBusy||extensionConfig.cutover==='cloudflare')return;workerBusy=true;try{await worker.runOnce({limit:50});}catch(error){console.error(JSON.stringify({level:'error',component:'printerly-worker',message:error instanceof Error?error.message:String(error)}));}finally{workerBusy=false;}};
    try{scheduleState=await schedules.reconcile({enabled:authoritative});}catch(error){scheduleState={enabled:false,error:error instanceof Error?error.message:String(error)};console.error(JSON.stringify({level:'error',component:'printerly-schedules',message:scheduleState.error}));}
    if(extensionConfig.cutover!=='cloudflare'){outboxTimer=setInterval(()=>void drainOutbox(),extensionConfig.outboxPollMs);outboxTimer.unref?.();workerTimer=setInterval(()=>void drainQueue(),extensionConfig.workerPollMs);workerTimer.unref?.();void drainOutbox();void drainQueue();}
    return{
      value:Object.freeze({cutover:extensionConfig.cutover,jobCutover:extensionConfig.jobCutover,queue,runtime,costing,node,jobs,approvals,documents,outbox,maintenance,batches,worker,schedules}),
      schedulerQueues:Object.fromEntries(['printerly.health','printerly.batch-dispatch','printerly.batch-status','printerly.retention','printerly.consumables','printerly.service-sla','printerly.routing','printerly.release-cleanup','printerly.procurement'].map(kind=>[kind,queue])),
      async readiness(){if(extensionConfig.cutover==='cloudflare'&&extensionConfig.jobCutover==='cloudflare')return{ok:true,cutover:'cloudflare',jobCutover:'cloudflare',authoritative:false,schedules:scheduleState};const[deadOutbox,deadQueue]=await Promise.all([services.database.query(`SELECT COUNT(*)::int count FROM prn_dispatch_outbox WHERE status='dead'`),queue.deadLetterSize()]);return{ok:Number(deadOutbox.rows[0]?.count||0)===0&&Number(deadQueue||0)===0&&!scheduleState.error,cutover:extensionConfig.cutover,jobCutover:extensionConfig.jobCutover,authoritative,deadOutbox:Number(deadOutbox.rows[0]?.count||0),deadQueue:Number(deadQueue||0),schedules:scheduleState};},
      describe(){return{cutover:extensionConfig.cutover,jobCutover:extensionConfig.jobCutover,legacyNodeApi:authoritative,jobApi:extensionConfig.jobCutover==='node',outbox:'postgres-to-redis',worker:extensionConfig.cutover==='cloudflare'?'disabled':'redis-consumer',schedules:scheduleState};},
      async close(){if(outboxTimer)clearInterval(outboxTimer);if(workerTimer)clearInterval(workerTimer);},
    };
  },
};
