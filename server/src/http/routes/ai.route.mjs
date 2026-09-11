import { handleAiRequest } from "../../ai/http-router.mjs";
import { handleAiKnowledgeRequest } from "../../ai/knowledge-http.mjs";
import { handleAiTaskRequest } from "../../ai/task-http.mjs";

async function requireLiveScope(runtime,request,scope){
  const authenticated=await runtime.auth.authenticateRequest({headers:request.headers});
  const live=await runtime.authorization.resolveCurrentActorAccess({organizationId:authenticated.organizationId,actorId:authenticated.userId});
  const principal={...authenticated,role:live.role,scopes:live.effectiveScopes};
  runtime.auth.requireScope(principal,scope);
  return principal;
}

export default {
  name:"ai",
  prefix:"/selfhost/ai",
  priority:100,
  enabled(config){return config.extensions?.ai?.enabled===true;},
  async handle({request,url,runtime}){
    const ai=runtime.extensions?.ai;
    if(!ai)return {status:503,body:{error:{code:"AI_WORKFORCE_DISABLED",message:"AI Workforce is not enabled on this Ledgerly server."}}};
    const scopedRuntime={...runtime,ai},method=request.method??"GET",path=url.pathname;

    if(path==="/selfhost/ai/knowledge"||path.startsWith("/selfhost/ai/knowledge/")){
      return handleAiKnowledgeRequest({request,url,runtime:scopedRuntime});
    }
    if(path==="/selfhost/ai/tasks"||path.startsWith("/selfhost/ai/tasks/")){
      return handleAiTaskRequest({request,url,runtime:scopedRuntime});
    }

    if(path==="/selfhost/ai/employees"||path.startsWith("/selfhost/ai/employees/")){
      if(method!=="GET")await requireLiveScope(runtime,request,"ai:approve");
    }
    if(path==="/selfhost/ai/approvals"||path.startsWith("/selfhost/ai/approvals/")){
      await requireLiveScope(runtime,request,"ai:approve");
    }
    if(path==="/selfhost/ai/documents"||path.startsWith("/selfhost/ai/documents/")){
      await requireLiveScope(runtime,request,method==="GET"?"documents:read":"documents:write");
    }
    if(path==="/selfhost/ai/academics"||path.startsWith("/selfhost/ai/academics/")){
      await requireLiveScope(runtime,request,method==="GET"?"academics:read":"academics:write");
    }
    if(path==="/selfhost/ai/memory"||path.startsWith("/selfhost/ai/memory/")){
      await requireLiveScope(runtime,request,"ai:approve");
    }
    if(path==="/selfhost/ai/schedules"||path.startsWith("/selfhost/ai/schedules/")){
      if(method!=="GET")await requireLiveScope(runtime,request,"ai:approve");
    }
    if(path==="/selfhost/ai/activity"||path.startsWith("/selfhost/ai/activity/")||path==="/selfhost/ai/audit"||path.startsWith("/selfhost/ai/audit/")||path==="/selfhost/ai/settings"||path.startsWith("/selfhost/ai/settings/")){
      await requireLiveScope(runtime,request,"ai:approve");
    }

    return handleAiRequest({request,url,runtime:scopedRuntime});
  },
};