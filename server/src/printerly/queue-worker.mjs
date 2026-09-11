const OUTBOX_EVENTS=new Set(['printerly.dispatch','printerly.completed','printerly.failed','printerly.cancelled']);

export class PrinterlyQueueWorker{
  constructor({queue,handlers={},logger=console}){if(!queue?.take||!queue?.ack||!queue?.retry||!queue?.deadLetter)throw new TypeError('PrinterlyQueueWorker requires a durable queue');this.queue=queue;this.handlers=handlers;this.logger=logger;}
  async runOnce({limit=25}={}){
    let processed=0,acked=0,retried=0,dead=0;
    while(processed<limit){const item=await this.queue.take();if(!item)break;processed++;const job=item.job||{};const kind=String(job.kind||job.type||'');
      try{
        const handler=this.handlers[kind];
        if(handler)await handler(job);
        else if(!OUTBOX_EVENTS.has(kind)){await this.queue.deadLetter(item.receipt,{reason:`Unknown Printerly job kind: ${kind||'(missing)'}`});dead++;continue;}
        await this.queue.ack(item.receipt);acked++;
      }catch(error){const result=await this.queue.retry(item.receipt,{reason:error instanceof Error?error.message:String(error)});if(result?.deadLettered)dead++;else retried++;this.logger.error(JSON.stringify({level:'error',component:'printerly-worker',kind,jobId:job.jobId,message:error instanceof Error?error.message:String(error)}));}
    }
    return{processed,acked,retried,dead};
  }
}
