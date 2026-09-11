import { handleAiRequest } from "../../ai/http-router.mjs";
import { handleAiKnowledgeRequest } from "../../ai/knowledge-http.mjs";

export default {
  name:"ai",
  prefix:"/selfhost/ai",
  priority:100,
  enabled(config){return config.extensions?.ai?.enabled===true;},
  async handle({request,url,runtime}){
    const ai=runtime.extensions?.ai;
    if(!ai)return {status:503,body:{error:{code:"AI_WORKFORCE_DISABLED",message:"AI Workforce is not enabled on this Ledgerly server."}}};
    const scopedRuntime={...runtime,ai};
    if(url.pathname==="/selfhost/ai/knowledge"||url.pathname.startsWith("/selfhost/ai/knowledge/")){
      return handleAiKnowledgeRequest({request,url,runtime:scopedRuntime});
    }
    return handleAiRequest({request,url,runtime:scopedRuntime});
  },
};