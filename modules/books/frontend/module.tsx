import { BookOpenCheck } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { BooksWorkspace } from "./BooksWorkspace";
import "./books.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "books",
  name: "Books",
  version: "1.0.0",
  order: 35,
  routes: {
    books: { scope: "school:read", view: BooksWorkspace },
  },
  navigation: [
    {
      label: "Books",
      icon: BookOpenCheck,
      order: 35,
      items: [{ label: "Writing Books", path: "books", scope: "school:read" }],
    },
  ],
};

export default moduleDefinition;
