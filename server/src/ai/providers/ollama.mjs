import { AiModelProvider, AiRuntimeError } from "../runtime-provider.mjs";

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal:controller.signal, clear:()=>clearTimeout(timer) };
}

export class OllamaProvider extends AiModelProvider {
  constructor(config = {}) { super({ id:"ollama", endpoint:"http://127.0.0.1:11434", ...config }); }

  async request(path, init = {}) {
    const guard = withTimeout(this.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.endpoint), { ...init, signal:guard.signal, headers:{ "content-type":"application/json", ...(init.headers ?? {}) } });
      if (response.status === 404) throw new AiRuntimeError("AI_MODEL_NOT_INSTALLED", `Ollama resource not found for model ${this.model ?? "(unset)"}`, { status:404 });
      if (response.status === 429 || response.status === 503) throw new AiRuntimeError("AI_RUNTIME_OVERLOADED", "Ollama runtime is overloaded", { status:response.status });
      if (!response.ok) throw new AiRuntimeError("AI_INFERENCE_ERROR", `Ollama request failed with HTTP ${response.status}`, { status:response.status });
      return await response.json();
    } catch (error) {
      if (error instanceof AiRuntimeError) throw error;
      if (error?.name === "AbortError") throw new AiRuntimeError("AI_RUNTIME_TIMEOUT", "Ollama request timed out");
      throw new AiRuntimeError("AI_RUNTIME_OFFLINE", "Ollama runtime is unreachable", { cause:error instanceof Error ? error.message : String(error) });
    } finally { guard.clear(); }
  }

  async listModels() {
    const data = await this.request("/api/tags", { method:"GET", headers:{} });
    return (data.models ?? []).map((item) => ({ name:item.name, size:item.size, modifiedAt:item.modified_at, digest:item.digest }));
  }

  async health() {
    const started = Date.now();
    try {
      const models = await this.listModels();
      const installed = !this.model || models.some((m) => m.name === this.model || m.name?.split(":")[0] === this.model);
      return { ok:installed, provider:this.id, online:true, model:this.model, modelInstalled:installed, latencyMs:Date.now()-started, models:models.map((m)=>m.name), state:installed?"ready":"model_missing" };
    } catch (error) {
      return { ok:false, provider:this.id, online:false, model:this.model, modelInstalled:false, latencyMs:Date.now()-started, state:error?.code === "AI_RUNTIME_OVERLOADED" ? "overloaded" : "offline", error:error instanceof Error ? error.message : String(error), code:error?.code };
    }
  }

  async generate({ messages, tools = [], temperature = this.temperature, maxTokens = null, format = null }) {
    if (!this.model) throw new AiRuntimeError("AI_MODEL_NOT_CONFIGURED", "No AI model configured");
    const body = { model:this.model, messages, stream:false, options:{ temperature, ...(maxTokens ? { num_predict:maxTokens } : {}) } };
    if (this.toolSupport && tools.length) body.tools = tools;
    if (format) body.format = format;
    const data = await this.request("/api/chat", { method:"POST", body:JSON.stringify(body) });
    return { provider:this.id, model:data.model ?? this.model, message:data.message ?? {}, done:data.done === true, promptEvalCount:data.prompt_eval_count ?? null, evalCount:data.eval_count ?? null, totalDurationNs:data.total_duration ?? null };
  }
}

export function createOllamaProvider(config) { return new OllamaProvider(config); }
