import { AppError } from "../lib/errors";

export async function assertPostingDateOpen(db: D1Database, organizationId: string, postingDate: string): Promise<void> {
  const period = await db.prepare(`SELECT id,name,status FROM fiscal_periods
    WHERE organization_id=? AND ? BETWEEN starts_on AND ends_on ORDER BY starts_on DESC LIMIT 1`)
    .bind(organizationId, postingDate).first<{ id: string; name: string; status: string }>();
  if (period && period.status !== "open") {
    throw new AppError(409, "FISCAL_PERIOD_CLOSED", `Fiscal period ${period.name} is ${period.status.replace("_", " ")}`);
  }
}
