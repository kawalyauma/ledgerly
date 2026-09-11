export class AiRuntimeError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = "AiRuntimeError"; this.code = code; this.details = details; }
}

export class AiModelProvider {
  constructor(config = {}) {
    this.id = config.id ?? "unknown";
    this.endpoint = config.endpoint ?? null;
    this.model = config.model ?? null;
    this.timeoutMs = Number(config.timeoutMs ?? 60000);
    this.contextLimit = Number(config.contextLimit ?? 8192);
    this.temperature = Number(config.temperature ?? 0.2);
    this.toolSupport = config.toolSupport !== false;
  }
  async health() { throw new Error("health() not implemented"); }
  async listModels() { throw new Error("listModels() not implemented"); }
  async generate() { throw new Error("generate() not implemented"); }
  async embed() { throw new AiRuntimeError("AI_EMBEDDINGS_UNSUPPORTED", `Provider ${this.id} does not support embeddings`); }
  describe() { return { id:this.id, endpoint:this.endpoint, model:this.model, timeoutMs:this.timeoutMs, contextLimit:this.contextLimit, temperature:this.temperature, toolSupport:this.toolSupport }; }
}

export class AiProviderRegistry {
  constructor() { this.factories = new Map(); }
  register(id, factory) { if (!id || typeof factory !== "function") throw new TypeError("provider id and factory are required"); this.factories.set(id, factory); return this; }
  create(id, config) { const factory = this.factories.get(id); if (!factory) throw new AiRuntimeError("AI_PROVIDER_UNKNOWN", `Unknown AI provider: ${id}`); return factory(config); }
  list() { return [...this.factories.keys()]; }
}
