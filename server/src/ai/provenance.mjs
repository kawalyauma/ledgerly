function requireAgent(agent){if(!agent?.agentId||!agent?.name||!agent?.role)throw new TypeError("agent_id, agent_name and agent_role are required for AI attribution");}
export function aiAttribution({agent,taskId=null,reason=null,timestamp=new Date().toISOString()}){requireAgent(agent);return Object.freeze({actor_type:"ai_agent",agent_id:agent.agentId,agent_name:agent.name,agent_role:agent.role,task_id:taskId,timestamp,reason});}

export function mergeProvenance(existing={},contribution){
  const original=existing.original_ai??(existing.actor_type==="ai_agent"?existing:null);
  const history=Array.isArray(existing.history)?[...existing.history]:[];history.push(contribution);
  return {...contribution,original_ai:original??contribution,history};
}

export function humanEditProvenance(existing,{userId,userName,reason=null,timestamp=new Date().toISOString()}){
  const human={actor_type:"human",actor_id:userId,actor_name:userName,timestamp,reason};
  const documentExisting=existing?.document??existing??{};
  const original=documentExisting.original_ai??(documentExisting.actor_type==="ai_agent"?documentExisting:null);
  return {...human,...(original?{original_ai:original}:{}),history:[...(documentExisting.history??[]),human]};
}

export function createFieldProvenance(content,attribution){
  const fields={};for(const path of leafPaths(content))fields[path]=attribution;return fields;
}

export function updateFieldProvenance({before,after,existing={},actor}){
  const fields={...existing};
  const beforeValues=flatten(before),afterValues=flatten(after);
  for(const [path,value] of Object.entries(afterValues)){
    if(Object.prototype.hasOwnProperty.call(beforeValues,path)&&same(beforeValues[path],value))continue;
    const prior=fields[path];
    if(actor.actor_type==="human"){
      fields[path]={...actor,...(prior?{original_ai:prior.original_ai??(prior.actor_type==="ai_agent"?prior:null)}:{})};
    }else{
      fields[path]=prior?mergeProvenance(prior,actor):actor;
    }
  }
  for(const path of Object.keys(beforeValues))if(!Object.prototype.hasOwnProperty.call(afterValues,path)){
    const prior=fields[path];fields[path]={...actor,deleted:true,...(prior?{original_ai:prior.original_ai??(prior.actor_type==="ai_agent"?prior:null)}:{})};
  }
  return fields;
}

function leafPaths(value,path="$"){
  if(value==null||typeof value!=="object")return [path];
  if(Array.isArray(value)){if(!value.length)return [path];return value.flatMap((item,index)=>leafPaths(item,`${path}[${index}]`));}
  const entries=Object.entries(value);if(!entries.length)return [path];return entries.flatMap(([key,item])=>leafPaths(item,`${path}.${escapeKey(key)}`));
}
function flatten(value){const out={};for(const path of leafPaths(value))out[path]=readPath(value,path);return out;}
function escapeKey(value){return String(value).replaceAll("\\","\\\\").replaceAll(".","\\.");}
function readPath(root,path){
  if(path==="$")return root;
  const tokens=[];let current="";
  for(let i=2;i<path.length;i++){const ch=path[i];if(ch==="\\"){current+=path[++i]??"";continue;}if(ch==="."){tokens.push(current);current="";continue;}if(ch==="["){if(current){tokens.push(current);current="";}const end=path.indexOf("]",i);tokens.push(Number(path.slice(i+1,end)));i=end;continue;}current+=ch;}if(current)tokens.push(current);
  let value=root;for(const token of tokens)value=value?.[token];return value;
}
function same(a,b){try{return JSON.stringify(a)===JSON.stringify(b);}catch{return Object.is(a,b);}}
