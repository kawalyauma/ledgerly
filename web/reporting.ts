import { get } from "./api";
import { printHtmlDocument, reservePrintWindow } from "./printing";

type ReportOrganization = {
  name?: string;
  legalName?: string;
  address?: Record<string, unknown>;
  taxRegistrationNumber?: string;
  branding?: { logoDataUrl?: string; email?: string; phone?: string; website?: string; footer?: string };
};

type SchoolReportProfile = {
  schoolName?: string; legalName?: string; registrationNumber?: string; logoUrl?: string; motto?: string;
  phoneNumbers?: string[]; emailAddresses?: string[]; website?: string; physicalAddress?: string; postalAddress?: string;
};

let organizationPromise: Promise<ReportOrganization> | null = null;
async function reportOrganization() {
  if (!organizationPromise) {
    organizationPromise = (async () => {
      const [organization, school] = await Promise.all([
        get<ReportOrganization>("/organizations/current").catch(() => ({} as ReportOrganization)),
        get<SchoolReportProfile | null>("/school/setup/profile").catch(() => null),
      ]);
      if (!school) return organization;
      const schoolBranding = school as SchoolReportProfile & { branding?: Record<string, unknown> };
      return {
        ...organization,
        name: school.schoolName || organization.name || school.legalName || "School",
        legalName: school.legalName || school.schoolName || organization.legalName || organization.name,
        taxRegistrationNumber: school.registrationNumber || organization.taxRegistrationNumber,
        address: { ...(organization.address || {}), formatted: school.physicalAddress || school.postalAddress || organization.address?.formatted || "" },
        branding: {
          ...(organization.branding || {}),
          logoDataUrl: school.logoUrl || organization.branding?.logoDataUrl,
          phone: Array.isArray(school.phoneNumbers) && school.phoneNumbers.length ? school.phoneNumbers.filter(Boolean).join(", ") : organization.branding?.phone,
          email: Array.isArray(school.emailAddresses) && school.emailAddresses.length ? school.emailAddresses.filter(Boolean).join(", ") : organization.branding?.email,
          website: school.website || organization.branding?.website,
          footer: school.motto || String(schoolBranding.branding?.footer || "") || organization.branding?.footer,
        },
      };
    })();
  }
  return organizationPromise;
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch] || ch));
}

function safeFilename(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
}

export function downloadTableCsv(elementId: string, title: string) {
  const root = document.getElementById(elementId);
  const table = root?.querySelector("table");
  if (!table) return;
  const rows = [...table.querySelectorAll("tr")].map(row => [...row.querySelectorAll("th,td")].map(cell => `"${String(cell.textContent || "").trim().replace(/"/g, '""')}"`).join(","));
  const blob = new Blob(["\ufeff", rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = `${safeFilename(title)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export function printReportElement(elementId: string, title: string, subtitle = "") {
  const root = document.getElementById(elementId);
  if (!root) return;

  // Reserve the tab synchronously from the user's click. This avoids popup blockers
  // on mobile browsers while branding/profile data is loaded asynchronously.
  const reserved = reservePrintWindow("Preparing report…");

  void reportOrganization().then(org => {
    const branding = org.branding || {}, address = String(org.address?.formatted || "");
    const contact = [branding.phone, branding.email, branding.website].filter(Boolean).join(" · ");
    const logo = branding.logoDataUrl ? `<img src="${escapeHtml(branding.logoDataUrl)}" alt="Logo">` : "";
    const html = `<!doctype html><html><head><title>${escapeHtml(title)}</title><style>
      @page{size:auto;margin:14mm}
      body{font-family:Arial,Helvetica,sans-serif;color:#17201d;margin:0;font-size:12px}
      .letterhead{display:flex;gap:18px;align-items:center;border-bottom:2px solid #2b5147;padding-bottom:12px;margin-bottom:18px}
      .letterhead img{width:76px;height:76px;object-fit:contain}
      .letterhead h1{font-size:20px;margin:0 0 4px}.letterhead p{margin:2px 0;color:#59635f}
      .report-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-end;margin-bottom:12px}
      .report-head h2{font-size:17px;margin:0}.report-head p{margin:3px 0;color:#59635f}.generated{white-space:nowrap;color:#59635f}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #d7ddda;padding:7px 8px;text-align:left;vertical-align:top}
      th{background:#f1f5f3;font-weight:700}td small{display:block;color:#68736e;margin-top:2px}
      .footer{border-top:1px solid #ccd5d1;margin-top:18px;padding-top:8px;color:#69736f;font-size:10px}
      button,.button,.badge__dot{display:none!important}.badge{border:0!important;padding:0!important;background:none!important;color:inherit!important}
      tr{break-inside:avoid}
      @media(max-width:680px){.letterhead,.report-head{align-items:flex-start;flex-direction:column}.generated{white-space:normal}body{font-size:11px}}
    </style></head><body>
      <header class="letterhead">${logo}<div><h1>${escapeHtml(org.legalName || org.name || "Organization")}</h1>${address ? `<p>${escapeHtml(address)}</p>` : ""}${contact ? `<p>${escapeHtml(contact)}</p>` : ""}${org.taxRegistrationNumber ? `<p>Tax ID: ${escapeHtml(org.taxRegistrationNumber)}</p>` : ""}</div></header>
      <section class="report-head"><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}</div><div class="generated">Generated ${escapeHtml(new Date().toLocaleString())}</div></section>
      ${root.innerHTML}
      ${branding.footer ? `<footer class="footer">${escapeHtml(branding.footer)}</footer>` : ""}
    </body></html>`;
    printHtmlDocument(html, { title, reservedWindow: reserved });
  }).catch(error => {
    try { reserved?.close(); } catch {}
    console.error("Unable to prepare report for printing", error);
  });
}
