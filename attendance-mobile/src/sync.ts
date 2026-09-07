import {syncEvents} from "./api";
import {OfflineStore} from "./native";
import {pending} from "./storage";
import type {Registration} from "./types";

export async function flush(registration:Registration){
  const rows=await pending();
  if(!rows.length)return{remaining:0,failed:await OfflineStore.failedCount(),accepted:0,duplicates:0,rejected:0};
  let accepted=0,duplicates=0,rejected=0;
  for(let i=0;i<rows.length;i+=100){
    const chunk=rows.slice(i,i+100),batchId=`batch_${Date.now().toString(36)}_${chunk[0]!.id}`;
    try{
      const result=await syncEvents(registration,batchId,chunk.map(x=>x.event));
      accepted+=result.accepted;duplicates+=result.duplicates;rejected+=result.rejected;
      if(result.results?.length){
        const handled=result.results.filter(x=>x.status!=="rejected").map(x=>x.clientEventId);
        const failed=result.results.filter(x=>x.status==="rejected");
        if(handled.length)await OfflineStore.acknowledge(handled);
        for(const item of failed)await OfflineStore.reject([item.clientEventId],item.message||"Attendance event was rejected by the server");
      }else{
        // Older compatible servers handled the entire batch even though they did not
        // return item-level details. Keep the old acknowledgement behavior.
        await OfflineStore.acknowledge(chunk.map(x=>x.id));
      }
    }catch(error){
      await OfflineStore.fail(chunk.map(x=>x.id),error instanceof Error?error.message:String(error));
      throw error;
    }
  }
  return{remaining:await OfflineStore.count(),failed:await OfflineStore.failedCount(),accepted,duplicates,rejected};
}
