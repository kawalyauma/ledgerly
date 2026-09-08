// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { requireModuleEnabled } from "../../../src/lib/modules";
import { AppError } from "../../../src/lib/errors";
import { schoolPermission } from "../../school/backend/common";
import * as S from "./service";

export const academicsRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();
academicsRoutes.use("*", requireModuleEnabled("school-management"));
academicsRoutes.use("*", requireModuleEnabled("academics"));
academicsRoutes.use("*", requireScope("school:read"));
const body = async (c: any) =>
  c.req.json<Record<string, any>>().catch(() => ({}));
const req = (v: any, n: string) => {
  const x = String(v ?? "").trim();
  if (!x) throw new AppError(422, "VALIDATION_ERROR", `${n} is required`);
  return x;
};
const write = [
  requireScope("school:write"),
  schoolPermission("school.academics:write"),
];
const read = schoolPermission("school.academics:read");
const approve = schoolPermission("school.academics:approve");
const supervise = schoolPermission("school.academics:supervise");

academicsRoutes.get("/manifest", (c) =>
  c.json({
    data: {
      key: "academics",
      name: "Academics",
      version: "1.0.0",
      requiresModules: ["school-management"],
      features: [
        "timetables",
        "schemes",
        "lesson-plans",
        "lesson-delivery",
        "supervision",
        "record-inspection",
      ],
    },
  }),
);
academicsRoutes.get("/setup", read, async (c) =>
  c.json({
    data: await S.setup(c.env.FINANCE_DB, c.get("principal").organizationId),
  }),
);
academicsRoutes.get("/overview", read, async (c) =>
  c.json({
    data: await S.overview(c.env.FINANCE_DB, c.get("principal").organizationId),
  }),
);
academicsRoutes.get("/teacher-allocations", read, async (c) =>
  c.json({
    data: await S.listTeacherAllocations(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
    ),
  }),
);
academicsRoutes.post("/teacher-allocations", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  ["staffId", "academicYearId", "classId", "subjectId"].forEach((k) =>
    req(d[k], k),
  );
  return c.json(
    {
      data: await S.createTeacherAllocation(
        c.env.FINANCE_DB,
        p.organizationId,
        p.userId,
        d,
      ),
    },
    201,
  );
});
academicsRoutes.delete("/teacher-allocations/:id", ...write, async (c) => {
  await S.deleteTeacherAllocation(
    c.env.FINANCE_DB,
    c.get("principal").organizationId,
    c.req.param("id"),
  );
  return c.body(null, 204);
});

academicsRoutes.get("/rooms", read, async (c) =>
  c.json({
    data: await S.listRooms(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
    ),
  }),
);
academicsRoutes.post("/rooms", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  req(d.code, "Room code");
  req(d.name, "Room name");
  return c.json(
    {
      data: await S.createRoom(c.env.FINANCE_DB, p.organizationId, p.userId, d),
    },
    201,
  );
});
academicsRoutes.patch("/rooms/:id", ...write, async (c) => {
  const p = c.get("principal");
  return c.json({
    data: await S.updateRoom(
      c.env.FINANCE_DB,
      p.organizationId,
      c.req.param("id"),
      await body(c),
    ),
  });
});
academicsRoutes.get("/teacher-availability", read, async (c) =>
  c.json({
    data: await S.listAvailability(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
      c.req.query("teacherUserId"),
    ),
  }),
);
academicsRoutes.post("/teacher-availability", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  req(d.teacherUserId, "Teacher");
  req(d.startsAt, "Start time");
  req(d.endsAt, "End time");
  return c.json(
    {
      data: await S.createAvailability(
        c.env.FINANCE_DB,
        p.organizationId,
        p.userId,
        d,
      ),
    },
    201,
  );
});
academicsRoutes.delete("/teacher-availability/:id", ...write, async (c) => {
  await S.deleteAvailability(
    c.env.FINANCE_DB,
    c.get("principal").organizationId,
    c.req.param("id"),
  );
  return c.body(null, 204);
});

academicsRoutes.get("/timetables", read, async (c) =>
  c.json({
    data: await S.listTimetables(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
    ),
  }),
);
academicsRoutes.post("/timetables", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  req(d.academicYearId, "Academic year");
  req(d.termId, "Term");
  req(d.name, "Timetable name");
  return c.json(
    {
      data: await S.createTimetable(
        c.env.FINANCE_DB,
        p.organizationId,
        p.userId,
        d,
      ),
    },
    201,
  );
});
academicsRoutes.get("/timetables/:id/entries", read, async (c) =>
  c.json({
    data: await S.timetableEntries(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
      c.req.param("id"),
    ),
  }),
);
academicsRoutes.post("/timetables/:id/conflicts", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  return c.json({
    data: {
      conflicts: await S.detectConflicts(
        c.env.FINANCE_DB,
        p.organizationId,
        c.req.param("id"),
        d,
      ),
    },
  });
});
academicsRoutes.post("/timetables/:id/entries", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  [
    "classId",
    "subjectId",
    "teacherUserId",
    "weekday",
    "startsAt",
    "endsAt",
  ].forEach((k) => req(d[k], k));
  return c.json(
    {
      data: await S.createTimetableEntry(
        c.env.FINANCE_DB,
        p.organizationId,
        p.userId,
        c.req.param("id"),
        d,
      ),
    },
    201,
  );
});
academicsRoutes.delete("/timetable-entries/:id", ...write, async (c) =>
  c.json({
    data: await S.deleteTimetableEntry(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
      c.req.param("id"),
    ),
  }),
);
academicsRoutes.post(
  "/timetables/:id/workflow",
  requireScope("school:write"),
  approve,
  async (c) => {
    const p = c.get("principal"),
      d = await body(c);
    return c.json({
      data: await S.timetableWorkflow(
        c.env.FINANCE_DB,
        p.organizationId,
        c.req.param("id"),
        p.userId,
        req(d.action, "Action"),
      ),
    });
  },
);
academicsRoutes.get("/timetables/:id/changes", read, async (c) =>
  c.json({
    data: await S.timetableChanges(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
      c.req.param("id"),
    ),
  }),
);
academicsRoutes.post(
  "/timetable-entries/:id/temporary-change",
  ...write,
  async (c) => {
    const p = c.get("principal"),
      d = await body(c);
    req(d.changeDate, "Change date");
    req(d.reason, "Reason");
    return c.json(
      {
        data: await S.createTemporaryChange(
          c.env.FINANCE_DB,
          p.organizationId,
          p.userId,
          c.req.param("id"),
          d,
        ),
      },
      201,
    );
  },
);
academicsRoutes.post("/substitutes", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  req(d.timetableEntryId, "Timetable lesson");
  req(d.lessonDate, "Lesson date");
  req(d.substituteTeacherUserId, "Substitute teacher");
  req(d.reason, "Reason");
  return c.json(
    {
      data: await S.createSubstitute(
        c.env.FINANCE_DB,
        p.organizationId,
        p.userId,
        d,
      ),
    },
    201,
  );
});
academicsRoutes.get("/timetables/:id/workload", read, async (c) =>
  c.json({
    data: await S.workload(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
      c.req.param("id"),
    ),
  }),
);

academicsRoutes.get("/schemes", read, async (c) =>
  c.json({
    data: await S.listSchemes(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
    ),
  }),
);
academicsRoutes.post("/schemes", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  [
    "academicYearId",
    "termId",
    "classId",
    "subjectId",
    "teacherUserId",
    "title",
  ].forEach((k) => req(d[k], k));
  return c.json(
    {
      data: await S.createScheme(
        c.env.FINANCE_DB,
        p.organizationId,
        p.userId,
        d,
      ),
    },
    201,
  );
});
academicsRoutes.get("/schemes/:id", read, async (c) =>
  c.json({
    data: await S.schemeDetail(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
      c.req.param("id"),
    ),
  }),
);
academicsRoutes.post("/schemes/:id/items", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  req(d.weekNo, "Week");
  req(d.topic, "Topic");
  return c.json(
    {
      data: await S.addSchemeItem(
        c.env.FINANCE_DB,
        p.organizationId,
        c.req.param("id"),
        d,
      ),
    },
    201,
  );
});
academicsRoutes.patch("/scheme-items/:id", ...write, async (c) => {
  const p = c.get("principal");
  return c.json({
    data: await S.updateSchemeItem(
      c.env.FINANCE_DB,
      p.organizationId,
      c.req.param("id"),
      await body(c),
    ),
  });
});
academicsRoutes.post(
  "/schemes/:id/workflow",
  requireScope("school:write"),
  approve,
  async (c) => {
    const p = c.get("principal"),
      d = await body(c);
    return c.json({
      data: await S.schemeWorkflow(
        c.env.FINANCE_DB,
        p.organizationId,
        c.req.param("id"),
        p.userId,
        req(d.action, "Action"),
        d.feedback,
      ),
    });
  },
);

academicsRoutes.get("/lesson-plan-templates", read, async (c) =>
  c.json({
    data: await S.listTemplates(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
    ),
  }),
);
academicsRoutes.post("/lesson-plan-templates", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  req(d.name, "Template name");
  return c.json(
    {
      data: await S.createTemplate(
        c.env.FINANCE_DB,
        p.organizationId,
        p.userId,
        d,
      ),
    },
    201,
  );
});
academicsRoutes.get("/lesson-plans", read, async (c) =>
  c.json({
    data: await S.listLessonPlans(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
    ),
  }),
);
academicsRoutes.post("/lesson-plans", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  [
    "academicYearId",
    "termId",
    "classId",
    "subjectId",
    "teacherUserId",
    "lessonDate",
    "topic",
  ].forEach((k) => req(d[k], k));
  return c.json(
    {
      data: await S.createLessonPlan(
        c.env.FINANCE_DB,
        p.organizationId,
        p.userId,
        d,
      ),
    },
    201,
  );
});
academicsRoutes.get("/lesson-plans/:id", read, async (c) =>
  c.json({
    data: await S.lessonPlanDetail(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
      c.req.param("id"),
    ),
  }),
);
academicsRoutes.patch("/lesson-plans/:id", ...write, async (c) => {
  const p = c.get("principal");
  return c.json({
    data: await S.updateLessonPlan(
      c.env.FINANCE_DB,
      p.organizationId,
      c.req.param("id"),
      await body(c),
    ),
  });
});
academicsRoutes.post(
  "/lesson-plans/:id/workflow",
  requireScope("school:write"),
  approve,
  async (c) => {
    const p = c.get("principal"),
      d = await body(c);
    return c.json({
      data: await S.lessonWorkflow(
        c.env.FINANCE_DB,
        p.organizationId,
        c.req.param("id"),
        p.userId,
        req(d.action, "Action"),
        d.feedback,
      ),
    });
  },
);

academicsRoutes.get("/deliveries", read, async (c) =>
  c.json({
    data: await S.listDeliveries(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
      c.req.query("date"),
    ),
  }),
);
academicsRoutes.post("/deliveries/sync-timetable", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  return c.json({
    data: await S.syncDeliveriesFromTimetable(
      c.env.FINANCE_DB,
      p.organizationId,
      p.userId,
      req(d.timetableId, "Timetable"),
      req(d.date, "Date"),
    ),
  });
});
academicsRoutes.patch("/deliveries/:id", ...write, async (c) => {
  const p = c.get("principal");
  return c.json({
    data: await S.updateDelivery(
      c.env.FINANCE_DB,
      p.organizationId,
      c.req.param("id"),
      await body(c),
    ),
  });
});
academicsRoutes.post("/deliveries/:id/attachments", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  return c.json(
    {
      data: await S.attachFile(
        c.env.FINANCE_DB,
        p.organizationId,
        p.userId,
        "delivery",
        c.req.param("id"),
        req(d.fileId, "File"),
        d.caption,
      ),
    },
    201,
  );
});

academicsRoutes.get("/observations", read, async (c) =>
  c.json({
    data: await S.listObservations(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
    ),
  }),
);
academicsRoutes.post(
  "/observations",
  requireScope("school:write"),
  supervise,
  async (c) => {
    const p = c.get("principal"),
      d = await body(c);
    req(d.teacherUserId, "Teacher");
    return c.json(
      {
        data: await S.createObservation(
          c.env.FINANCE_DB,
          p.organizationId,
          p.userId,
          d,
        ),
      },
      201,
    );
  },
);
academicsRoutes.patch(
  "/observations/:id",
  requireScope("school:write"),
  supervise,
  async (c) => {
    const p = c.get("principal");
    return c.json({
      data: await S.updateObservation(
        c.env.FINANCE_DB,
        p.organizationId,
        c.req.param("id"),
        await body(c),
      ),
    });
  },
);
academicsRoutes.post("/observations/:id/acknowledge", ...write, async (c) => {
  const p = c.get("principal"),
    d = await body(c);
  return c.json({
    data: await S.acknowledgeObservation(
      c.env.FINANCE_DB,
      p.organizationId,
      c.req.param("id"),
      p.userId,
      d.response,
    ),
  });
});
academicsRoutes.post(
  "/observations/:id/attachments",
  requireScope("school:write"),
  supervise,
  async (c) => {
    const p = c.get("principal"),
      d = await body(c);
    return c.json(
      {
        data: await S.attachFile(
          c.env.FINANCE_DB,
          p.organizationId,
          p.userId,
          "observation",
          c.req.param("id"),
          req(d.fileId, "File"),
          d.caption,
        ),
      },
      201,
    );
  },
);

academicsRoutes.get("/inspections", read, async (c) =>
  c.json({
    data: await S.listInspections(
      c.env.FINANCE_DB,
      c.get("principal").organizationId,
    ),
  }),
);
academicsRoutes.post(
  "/inspections",
  requireScope("school:write"),
  supervise,
  async (c) => {
    const p = c.get("principal"),
      d = await body(c);
    req(d.inspectionType, "Inspection type");
    req(d.inspectedOn, "Inspection date");
    req(d.findings, "Findings");
    return c.json(
      {
        data: await S.createInspection(
          c.env.FINANCE_DB,
          p.organizationId,
          p.userId,
          d,
        ),
      },
      201,
    );
  },
);
academicsRoutes.patch(
  "/inspections/:id",
  requireScope("school:write"),
  supervise,
  async (c) => {
    const p = c.get("principal");
    return c.json({
      data: await S.updateInspection(
        c.env.FINANCE_DB,
        p.organizationId,
        c.req.param("id"),
        await body(c),
      ),
    });
  },
);
academicsRoutes.post(
  "/inspections/:id/attachments",
  requireScope("school:write"),
  supervise,
  async (c) => {
    const p = c.get("principal"),
      d = await body(c);
    return c.json(
      {
        data: await S.attachFile(
          c.env.FINANCE_DB,
          p.organizationId,
          p.userId,
          "inspection",
          c.req.param("id"),
          req(d.fileId, "File"),
          d.caption,
        ),
      },
      201,
    );
  },
);
