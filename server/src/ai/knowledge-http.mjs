const MAX_BODY_BYTES = 1_000_000;
const json = (status, body) => ({ status, body });

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function pathParts(pathname) {
  return pathname
    .replace(/^\/selfhost\/ai\/knowledge\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
}

async function principalFor(runtime, request, baseScope, knowledgeScope) {
  const authenticated = await runtime.auth.authenticateRequest({ headers: request.headers });
  const live = await runtime.authorization.resolveCurrentActorAccess({
    organizationId: authenticated.organizationId,
    actorId: authenticated.userId,
  });
  const principal = { ...authenticated, role: live.role, scopes: live.effectiveScopes };
  runtime.auth.requireScope(principal, baseScope);
  runtime.auth.requireScope(principal, knowledgeScope);
  return principal;
}

function context(principal) {
  return {
    organizationId: principal.organizationId,
    userId: principal.userId,
    userName: principal.userName ?? principal.userId,
    permissions: principal.scopes ?? [],
  };
}

export async function handleAiKnowledgeRequest({ request, url, runtime }) {
  if (!runtime.ai) {
    return json(503, { error: { code: "AI_WORKFORCE_DISABLED", message: "AI Workforce is disabled on this Ledgerly server." } });
  }

  const method = request.method ?? "GET";
  const parts = pathParts(url.pathname);
  const isRead = method === "GET" || (method === "POST" && parts[0] === "retrieve");
  const principal = await principalFor(
    runtime,
    request,
    isRead ? "ai:read" : "ai:write",
    isRead ? "ai:knowledge:read" : "ai:knowledge:write",
  );
  const ctx = context(principal);

  if (method === "GET" && parts[0] === "sources" && parts.length === 1) {
    return json(200, {
      items: await runtime.ai.knowledge.listSources({ context: ctx }),
      capabilities: runtime.ai.storeCapabilities,
    });
  }

  if (method === "POST" && parts[0] === "retrieve" && parts.length === 1) {
    const input = await readJson(request);
    return json(200, {
      items: await runtime.ai.knowledge.retrieve({
        context: ctx,
        query: input.query,
        sourceIds: input.sourceIds,
        limit: input.limit,
      }),
    });
  }

  if (method === "POST" && parts[0] === "ingest" && parts.length === 1) {
    const input = await readJson(request);
    return json(201, await runtime.ai.ingestion.ingestStored({
      context: ctx,
      name: input.name,
      sourceType: input.sourceType,
      storageRef: input.storageRef,
      contentType: input.contentType,
      metadata: input.metadata ?? {},
      requiredPermissions: input.requiredPermissions ?? [],
    }));
  }

  if (method === "POST" && parts[0] === "sources" && parts.length === 1) {
    const input = await readJson(request);
    return json(201, await runtime.ai.knowledge.createSource({
      context: ctx,
      name: input.name,
      sourceType: input.sourceType,
      storageRef: input.storageRef,
      metadata: input.metadata ?? {},
      requiredPermissions: input.requiredPermissions ?? [],
    }));
  }

  if (method === "POST" && parts[0] === "sources" && parts.length === 3 && parts[2] === "chunks") {
    const input = await readJson(request);
    return json(200, await runtime.ai.knowledge.indexChunks({
      context: ctx,
      sourceId: parts[1],
      chunks: input.chunks ?? [],
    }));
  }

  return json(404, { error: { code: "AI_KNOWLEDGE_ROUTE_NOT_FOUND", message: "AI knowledge route not found" } });
}
