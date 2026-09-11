function queryObject(url, organizationId) {
  return {
    organizationId,
    academicYearId: url.searchParams.get("academicYearId"),
    termId: url.searchParams.get("termId"),
    classId: url.searchParams.get("classId"),
    streamId: url.searchParams.get("streamId"),
    subjectId: url.searchParams.get("subjectId"),
    studentId: url.searchParams.get("studentId"),
    staffId: url.searchParams.get("staffId"),
    status: url.searchParams.get("status"),
    limit: url.searchParams.get("limit"),
    offset: url.searchParams.get("offset"),
  };
}

export default {
  name: "school-platform",
  prefix: "/selfhost/school",
  enabled: (config) => config.extensions?.["school-platform"]?.enabled === true,
  async handle({ request, url, runtime }) {
    const principal = await runtime.auth.authenticateRequest({ headers: request.headers });
    runtime.auth.requireScope(principal, "school:read");
    const service = runtime.extensions?.["school-platform"];
    if (!service) {
      const error = new Error("School self-hosted runtime extension is unavailable");
      error.status = 503;
      error.code = "SCHOOL_SELFHOST_UNAVAILABLE";
      throw error;
    }

    if (request.method !== "GET") {
      return {
        status: 405,
        headers: { allow: "GET" },
        body: {
          error: {
            code: "SCHOOL_SELFHOST_READ_ONLY",
            message: "Self-hosted School APIs are read-only until final cutover validation. Cloudflare remains the write authority.",
          },
        },
      };
    }

    const suffix = url.pathname.slice("/selfhost/school".length).replace(/^\/+|\/+$/g, "");
    if (!suffix || suffix === "overview") {
      return { status: 200, body: { data: await service.overview(principal.organizationId), mode: "read-only-until-cutover" } };
    }
    if (suffix === "references") {
      return {
        status: 200,
        body: {
          data: await service.references(principal.organizationId, {
            academicYearId: url.searchParams.get("academicYearId"),
            classId: url.searchParams.get("classId"),
          }),
          mode: "read-only-until-cutover",
        },
      };
    }
    if (!suffix.includes("/")) {
      return { status: 200, body: { data: await service.list(suffix, queryObject(url, principal.organizationId)), mode: "read-only-until-cutover" } };
    }

    const error = new Error("School self-hosted route not found");
    error.status = 404;
    error.code = "SCHOOL_SELFHOST_ROUTE_NOT_FOUND";
    throw error;
  },
};
