export class KindRoutingQueue {
  constructor({ defaultQueue, routes = {} }) {
    if (typeof defaultQueue?.enqueue !== "function") throw new TypeError("KindRoutingQueue requires a default queue");
    this.defaultQueue = defaultQueue;
    this.routes = new Map();
    for (const [kind, queue] of Object.entries(routes)) {
      if (!kind.trim() || typeof queue?.enqueue !== "function") throw new TypeError(`Invalid queue route: ${kind}`);
      this.routes.set(kind, queue);
    }
  }

  enqueue(job) {
    const queue = this.routes.get(job?.kind) ?? this.defaultQueue;
    return queue.enqueue(job);
  }
}
