#!/usr/bin/env node

import { Terminal } from "@taskwish/terminal";

import { Scaffolder } from "./src/scaffolder";

Terminal.elicit(Scaffolder.createProject, {
  command: "bunx @taskwish/create-project",
  examples: [
    "bunx @taskwish/create-project",
    "npx @taskwish/create-project",
    "bunx @taskwish/create-project my-app --template todo",
    "bunx @taskwish/create-project my-agents --template agent-loops",
    "bunx @taskwish/create-project my-workflow --template agent-graphs",
    "bunx @taskwish/create-project my-factory --template software-factory",
    "bunx @taskwish/create-project my-documents --template document-extractor",
    "bunx @taskwish/create-project my-freight-app --template freight-operator",
    "bunx @taskwish/create-project my-options-app --template options-analyst",
    "bunx @taskwish/create-project my-bank-app --template open-banking",
    "bunx @taskwish/create-project my-app --yes",
  ],
  input: {
    projectName: { positional: true },
    template: { short: "t" },
  },
  formatResult(result) {
    const nextSteps = [`cd ${result.relativeDirectory}`];
    if (!result.installed) nextSteps.push(`${result.packageManager} install`);
    nextSteps.push(
      result.packageManager === "bun" ? "bun start" : "npm run start:node",
    );

    return [
      `Created a new TaskWish project in ${result.directory}`,
      "",
      "Next steps:",
      ...nextSteps.map((step) => `  ${step}`),
    ].join("\n");
  },
});
