import { handleAiRequest } from "../../ai/http-router.mjs";

export default {
  name: "ai-workforce",
  prefix: "/selfhost/ai",
  priority: 40,
  enabled(config) {
    return config.extensions?.["ai-workforce"]?.enabled !== false;
  },
  async handle({ request, url, runtime }) {
    const ai = runtime.extensions?.["ai-workforce"];
    if (!ai) {
      return {
        status: 503,
        body: { error: { code: "AI_WORKFORCE_DISABLED", message: "AI Workforce is not enabled on this Ledgerly server." } },
      };
    }
    return handleAiRequest({
      request,
      url,
      runtime: Object.freeze({ ...runtime, ai }),
    });
  },
};
