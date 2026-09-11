export class JobQueueRouter {
  constructor({ defaultQueue, routes = {} }) {
    if (!defaultQueue?.enqueue) throw new TypeError("JobQueueRouter requires a default queue");
    this.defaultQueue=defaultQueue;
    this.routes=new Map(Object.entries(routes));
  }
  queueFor(kind) { return this.routes.get(kind) ?? this.defaultQueue; }
  async enqueue(job) { return this.queueFor(job?.kind).enqueue(job); }
  async health() {
    const entries=[["default",this.defaultQueue],...this.routes.entries()];
    const unique=new Map();
    for (const [name,queue] of entries) if (!unique.has(queue)) unique.set(queue,name);
    const states={};
    for (const [queue,name] of unique.entries()) states[name]=await queue.health?.()??{ok:true};
    return {ok:Object.values(states).every((state)=>state.ok!==false),routes:Object.fromEntries([...this.routes.keys()].map((kind)=>[kind,this.routes.get(kind)?.name??kind])),queues:states};
  }
}
