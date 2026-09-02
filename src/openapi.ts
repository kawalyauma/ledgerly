export const openapiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Your Finance Pro API",
    version: "0.1.0",
    description: "Multi-tenant, double-entry accounting and financial reporting API. Monetary values use integer minor currency units.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" } } } } },
      JournalLine: { type: "object", required: ["accountId"], properties: { accountId: { type: "string" }, debitMinor: { type: "integer", minimum: 0 }, creditMinor: { type: "integer", minimum: 0 }, contactId: { type: "string" }, projectId: { type: "string" } } },
    },
  },
  paths: {
    "/accounts": {
      get: { summary: "List chart of accounts", responses: { "200": { description: "Accounts" } } },
      post: { summary: "Create an account", responses: { "201": { description: "Account created" } } },
    },
    "/journals": {
      get: { summary: "List journal entries", responses: { "200": { description: "Journal entries" } } },
      post: { summary: "Create a balanced draft journal", parameters: [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string" } }], responses: { "201": { description: "Draft created" }, "422": { description: "Invalid or unbalanced journal" } } },
    },
    "/journals/{id}/post": {
      post: { summary: "Post an immutable journal", parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Journal posted" } } },
    },
    "/contacts": {
      get: { summary: "List customers, suppliers and employees", responses: { "200": { description: "Contacts" } } },
      post: { summary: "Create a contact", responses: { "201": { description: "Contact created" } } },
    },
    "/products": {
      get: { summary: "List products and services", responses: { "200": { description: "Products" } } },
      post: { summary: "Create a product or service", responses: { "201": { description: "Product created" } } },
    },
    "/documents": {
      get: { summary: "List invoices, bills and credits", responses: { "200": { description: "Documents" } } },
      post: { summary: "Create a draft invoice, bill or credit", responses: { "201": { description: "Draft created" } } },
    },
    "/documents/{id}/post": { post: { summary: "Post a document and its accounting journal", responses: { "200": { description: "Document posted" } } } },
    "/payments": {
      get: { summary: "List customer receipts and supplier payments", responses: { "200": { description: "Payments" } } },
      post: { summary: "Create an idempotent draft payment", responses: { "201": { description: "Payment created" } } },
    },
    "/payments/{id}/post": { post: { summary: "Post and allocate a payment", responses: { "200": { description: "Payment posted" } } } },
    "/fiscal-periods": {
      get: { summary: "List fiscal periods and lock states", responses: { "200": { description: "Fiscal periods" } } },
      post: { summary: "Create a non-overlapping fiscal period", responses: { "201": { description: "Fiscal period created" } } },
    },
    "/journals/{id}/reverse": { post: { summary: "Create an equal-and-opposite journal reversal", responses: { "200": { description: "Journal reversed" } } } },
    "/documents/{id}/reverse": { post: { summary: "Reverse an unallocated posted document", responses: { "200": { description: "Document reversed" } } } },
    "/payments/{id}/reverse": { post: { summary: "Reverse a payment, its allocations and journal", responses: { "200": { description: "Payment reversed" } } } },
    "/reports": { get: { summary: "List available reports", responses: { "200": { description: "Report catalog" } } } },
    "/reports/{type}": { get: { summary: "Generate a synchronous JSON report", parameters: [{ in: "path", name: "type", required: true, schema: { type: "string" } }, { in: "query", name: "from", schema: { type: "string", format: "date" } }, { in: "query", name: "to", schema: { type: "string", format: "date" } }], responses: { "200": { description: "Report" } } } },
    "/reports/{type}/exports": { post: { summary: "Queue a JSON or CSV report export", responses: { "202": { description: "Export queued" } } } },
    "/organizations": { get: { summary: "List organizations for the current user", responses: { "200": { description: "Organizations" } } }, post: { summary: "Create another organization", responses: { "201": { description: "Organization created" } } } },
    "/organizations/current": { get: { summary: "Get organization settings", responses: { "200": { description: "Settings" } } }, put: { summary: "Update company, tax, address and numbering settings", responses: { "200": { description: "Settings updated" } } } },
    "/dimensions": { get: { summary: "List accounting dimensions", responses: { "200": { description: "Dimensions" } } }, post: { summary: "Create a class, department or location", responses: { "201": { description: "Dimension created" } } } },
    "/tax/codes": { get: { summary: "List tax codes", responses: { "200": { description: "Tax codes" } } }, post: { summary: "Create a tax code", responses: { "201": { description: "Tax code created" } } } },
    "/tax/returns/prepare": { post: { summary: "Prepare a tax return", responses: { "201": { description: "Tax return prepared" } } } },
    "/banking/accounts": { get: { summary: "List bank accounts", responses: { "200": { description: "Bank accounts" } } }, post: { summary: "Create a bank account", responses: { "201": { description: "Bank account created" } } } },
    "/banking/transfers": { post: { summary: "Post a bank transfer", responses: { "201": { description: "Transfer posted" } } } },
    "/operations/recurring": { get: { summary: "List recurring templates", responses: { "200": { description: "Templates" } } }, post: { summary: "Create recurring invoice, bill or journal", responses: { "201": { description: "Template created" } } } },
    "/operations/delivery-notes": { post: { summary: "Create a sales delivery note", responses: { "201": { description: "Delivery note created" } } } },
    "/operations/goods-receipts": { post: { summary: "Create a purchase goods receipt", responses: { "201": { description: "Goods receipt created" } } } },
    "/operations/expenses": { post: { summary: "Create an employee expense claim", responses: { "201": { description: "Expense claim created" } } } },
    "/operations/inventory/reorder": { get: { summary: "Get stock reorder recommendations", responses: { "200": { description: "Recommendations" } } } },
    "/operations/receivables/customers/{id}/statement": { get: { summary: "Generate a customer account statement", responses: { "200": { description: "Customer statement" } } } },
    "/document-rendering/{id}/pdf": { get: { summary: "Generate a customer-facing document PDF", responses: { "200": { description: "PDF document" } } } },
  },
} as const;
