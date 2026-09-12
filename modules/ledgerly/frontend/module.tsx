import { BookOpen } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AccountsPage } from "../../../web/pages/AccountingPages";

const moduleDefinition: FrontendModuleDefinition = {
  key: "ledgerly-core",
  name: "Ledgerly Finance Core",
  version: "1.0.0",
  order: 10,
  routes: {
    accounts: { scope: "accounts:read", view: AccountsPage },
  },
  navigation: [
    {
      label: "Accounting",
      icon: BookOpen,
      order: 10,
      items: [
        { label: "Chart of accounts", path: "accounts", scope: "accounts:read" },
      ],
    },
  ],
};

export default moduleDefinition;
