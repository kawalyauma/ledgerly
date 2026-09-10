import type { BackendModuleDefinition } from "../../backend-types";
import { audioCallRoutes } from "./routes";

export const moduleDefinition:BackendModuleDefinition={
  key:"audio-calls",
  name:"Audio Calls",
  version:"1.0.0",
  order:18,
  routes:[{basePath:"/api/v1/audio-calls",router:audioCallRoutes}],
  scheduled:async(env)=>{
    // A ringing call that was never answered becomes a missed call. This also clears
    // stale busy state after browser/mobile crashes without persisting any audio.
    const stale=await env.FINANCE_DB.prepare(`SELECT id,organization_id FROM audio_calls WHERE status='ringing' AND started_at<datetime('now','-45 seconds') LIMIT 250`).all<{id:string;organization_id:string}>();
    for(const call of stale.results){
      await env.FINANCE_DB.batch([
        env.FINANCE_DB.prepare(`UPDATE audio_calls SET status='missed',ended_at=CURRENT_TIMESTAMP,end_reason='ring_timeout',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='ringing'`).bind(call.id,call.organization_id),
        env.FINANCE_DB.prepare(`UPDATE audio_call_presence SET active_call_id=NULL,availability='available',updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND active_call_id=?`).bind(call.organization_id,call.id),
      ]);
    }
    await env.FINANCE_DB.prepare(`DELETE FROM audio_call_signals WHERE created_at<datetime('now','-1 day')`).run();
  }
};
