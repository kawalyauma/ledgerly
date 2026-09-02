import { describe, expect, it } from "vitest";
import { reportTypes, toCsv } from "../src/services/reports";

describe("report catalog", () => {
  it("contains all first-party financial reports", () => {
    expect(reportTypes).toContain("profit-loss");
    expect(reportTypes).toContain("balance-sheet");
    expect(reportTypes).toContain("cash-flow");
    expect(reportTypes).toContain("trial-balance");
    expect(reportTypes).toContain("general-ledger");
    expect(reportTypes).toContain("receivables-ageing");
    expect(reportTypes).toContain("payables-ageing");
    expect(reportTypes).toContain("inventory-valuation");
    expect(reportTypes).toContain("project-profitability");
    expect(reportTypes).toContain("budget-vs-actual");
    expect(reportTypes).toContain("tax-summary");
    expect(reportTypes).toContain("payroll-summary");
  });
});

describe("CSV export", () => {
  it("escapes commas, quotes and newlines", () => {
    const csv = toCsv({
      reportType: "trial-balance",
      generatedAt: "2026-08-30T00:00:00.000Z",
      filters: {},
      columns: ["code", "name", "amountMinor"],
      rows: [{ code: "1000", name: "Cash, \"Main\"\nAccount", amountMinor: 12500 }],
    });
    expect(csv).toBe('code,name,amountMinor\n1000,"Cash, ""Main""\nAccount",12500');
  });
});
