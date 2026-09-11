const allow = (payload, keys) => Object.fromEntries(keys.filter((key) => Object.hasOwn(payload, key)).map((key) => [key, payload[key]]));
const omit = (payload, keys) => Object.fromEntries(Object.entries(payload).filter(([key]) => !keys.includes(key)));
const POLICY = new Map([
  ['contacts:contacts', (p) => allow(p, ['id','type','code','name','email','active'])],
  ['communications:recipients', (p) => omit(p, ['data_json'])],
  ['communications:deliveries', (p) => omit(p, ['provider_message_id','last_error'])],
  ['human-resources:employees', (p) => omit(p, ['metadata_json'])],
  ['tasks-work:tasks', (p) => allow(p, ['id','taskNumber','projectId','parentTaskId','title','description','status','priority','startAt','dueAt','completedAt','estimatedMinutes','actualMinutes','progress','updatedBy'])],
  ['tasks-work:projects', (p) => allow(p, ['id','code','name','status','priority','progress','dueDate'])],
  ['tasks-work:checklist-items', (p) => allow(p, ['id','taskId','title','isCompleted','position','completedBy','completedAt'])],
  ['tasks-work:comments', (p) => allow(p, ['id','taskId','authorUserId','body','mentions','createdAt'])],
  ['tasks-work:time-entries', (p) => allow(p, ['id','taskId','userId','description','startedAt','endedAt','minutes','billable'])],
]);
export function projectMobilePayload(moduleKey, collectionKey, payload){if(payload==null)return null;if(typeof payload!=='object'||Array.isArray(payload))throw new TypeError('mobile payload must be an object');const fn=POLICY.get(`${moduleKey}:${collectionKey}`);return fn?fn(payload):structuredClone(payload);}
export function createPrivacyProjector(overrides={}){return (moduleKey,collectionKey,payload)=>{const fn=overrides[`${moduleKey}:${collectionKey}`];return fn?fn(structuredClone(payload)):projectMobilePayload(moduleKey,collectionKey,payload);};}
