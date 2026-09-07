import { describe,expect,it } from "vitest";
import { camel,dayOf,methods,studentStatuses,staffStatuses } from "../modules/attendance/backend/service";

describe("attendance domain helpers",()=>{
  it("keeps supported capture methods explicit",()=>{
    expect(methods).toEqual(["FACE","QR","NFC","MANUAL","TEACHER_REGISTER","ADMIN_OVERRIDE","IMPORT","API"]);
  });
  it("keeps student and staff policy statuses separate",()=>{
    expect(studentStatuses).toContain("permission");
    expect(staffStatuses).toContain("official_duty");
    expect(studentStatuses).not.toContain("on_leave" as never);
  });
  it("normalizes D1 rows and capture dates",()=>{
    expect(camel({person_id:"stu_1",metadata_json:'{"offline":true}'})).toEqual({personId:"stu_1",metadata:{offline:true}});
    expect(dayOf("2026-09-06T07:43:00.000Z")).toBe("2026-09-06");
  });
});
