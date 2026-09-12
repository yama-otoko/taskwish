import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TW } from "taskwish";

import { Scaffolder } from ".";

const temporaryDirectories: string[] = [];
const templateDirectory = join(import.meta.dir, "../../templates");
const skillPath = join(import.meta.dir, "../../../skill/SKILL.md");
const projectSkillPath = join(".agents", "skills", "taskwish", "SKILL.md");

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("Scaffolder.createProject", () => {
  test("uses the Scaffolder action namespace", () => {
    expect(Scaffolder.createProject[TW.Name]).toBe("Scaffolder::createProject");
  });

  test.each([
    [
      "empty",
      "src/greeter/greet.ts",
      "greet",
      ["Greeter"],
      "src/greeter/greeter.test.ts",
    ],
    [
      "todo",
      "src/todos/add-todo.ts",
      "addTodo",
      ["Todos"],
      "src/todos/todos.test.ts",
    ],
    [
      "agent-loops",
      "src/basic-agent-loop/run-basic-agent-loop.ts",
      "runBasicAgentLoop",
      [
        "BasicAgentLoop",
        "ReActLoop",
        "ToolCallingLoop",
        "PlanExecuteLoop",
        "PlanExecuteReplanLoop",
        "ReflectionLoop",
        "EvaluatorOptimizerLoop",
        "RetryErrorCorrectionLoop",
        "EnvironmentLoop",
        "GitHub",
        "EventDrivenLoop",
        "GoalDrivenLoop",
        "MultiAgentLoop",
        "SupervisorWorkerLoop",
        "DebateLoop",
        "SelfAskLoop",
        "TreeSearchLoop",
        "MemoryLoop",
        "HumanInTheLoop",
      ],
      "src/basic-agent-loop/basic-agent-loop.test.ts",
    ],
    [
      "agent-graphs",
      "src/sequential-graph/run-sequential-graph.ts",
      "runSequentialGraph",
      [
        "SequentialGraph",
        "RoutingGraph",
        "ParallelGraph",
        "MapReduceGraph",
        "HierarchicalGraph",
        "FallbackGraph",
      ],
      "src/sequential-graph/sequential-graph.test.ts",
    ],
    [
      "software-factory",
      "src/github/receive-issue-webhook.ts",
      "receiveIssueWebhook",
      ["GitHub", "Slack", "CodingAgent", "ReviewAgent"],
      "src/github/github.test.ts",
    ],
    [
      "document-extractor",
      "src/documents/read-documents.ts",
      "readDocuments",
      ["Documents"],
      "src/documents/documents.test.ts",
    ],
    [
      "freight-operator",
      "src/freight-operator/receive-load.ts",
      "receiveLoad",
      ["Documents", "Emails", "Gmail", "LoadExtractor", "FreightOperator"],
      "src/freight-operator/freight-operator.test.ts",
    ],
    [
      "options-analyst",
      "src/options-analyst/analyze-call.ts",
      "analyzeCall",
      ["OptionsAnalyst"],
      "src/options-analyst/options-analyst.test.ts",
    ],
    [
      "open-banking",
      "src/open-banking/start-bank-connection.ts",
      "startBankConnection",
      ["OpenBanking"],
      "src/open-banking/open-banking.test.ts",
    ],
  ] as const)(
    "creates the %s TypeScript template",
    async (template, actionPath, actorSource, actorNames, testPath) => {
      const parent = await temporaryDirectory();
      const destination = join(parent, `My ${template} App`);

      const result = await Scaffolder.createProject({
        projectName: destination,
        template,
        install: false,
        git: false,
        packageManager: "npm",
        templateDirectory,
        skillPath,
      });

      const packageJson = JSON.parse(
        await readFile(join(destination, "package.json"), "utf8")
      );
      const templatePackageJson = JSON.parse(
        await readFile(
          join(templateDirectory, template, "package.json"),
          "utf8"
        )
      );
      const templateVersions = JSON.parse(
        await readFile(join(templateDirectory, "versions.json"), "utf8")
      );
      const templateSource = await readFile(
        join(destination, actionPath),
        "utf8"
      );
      const entrypoint = await readFile(
        join(destination, "taskwish.ts"),
        "utf8"
      );
      const canonicalSkill = await readFile(skillPath, "utf8");
      const agentInstructions = await readFile(
        join(destination, "AGENTS.md"),
        "utf8"
      );

      expect(packageJson.name).toBe(`my-${template}-app`);
      expect(packageJson.scripts.start).toBe("bun taskwish.ts");
      expect(packageJson.scripts["start:node"]).toBe("tsx taskwish.ts");
      expect(packageJson.scripts.test).toBe(
        template === "agent-loops" ||
        template === "agent-graphs" ||
        template === "software-factory" ||
        template === "document-extractor" ||
        template === "freight-operator" ||
        template === "options-analyst" ||
        template === "open-banking"
          ? "bun test src"
          : "bun test"
      );
      expect(packageJson.devDependencies["@types/bun"]).toBeDefined();
      expect(packageJson.devDependencies["@types/node"]).toBeDefined();
      expect(packageJson.devDependencies.tsx).toBeDefined();
      expect(templatePackageJson.workspaces).toEqual(["../../../*"]);
      expect(packageJson.workspaces).toBeUndefined();
      expect(templatePackageJson.dependencies.taskwish).toBe("workspace:*");
      expect(templatePackageJson.dependencies["@taskwish/console"]).toBe(
        "workspace:*"
      );
      expect(templatePackageJson.dependencies["@taskwish/server"]).toBe(
        "workspace:*"
      );
      expect(packageJson.dependencies.taskwish).toBe(
        `^${templateVersions.taskwish}`
      );
      expect(packageJson.dependencies["@taskwish/console"]).toBe(
        `^${templateVersions["@taskwish/console"]}`
      );
      expect(packageJson.dependencies["@taskwish/server"]).toBe(
        `^${templateVersions["@taskwish/server"]}`
      );
      expect(templateSource).toContain(actorSource);
      expect(entrypoint).toContain(
        'import { Console } from "@taskwish/console"'
      );
      expect(entrypoint).toContain('import { Server } from "@taskwish/server"');
      expect(entrypoint).toContain("await Server(");
      expect(entrypoint).toContain("apps: [Console()]");
      expect(
        await readFile(
          join(templateDirectory, template, projectSkillPath),
          "utf8"
        )
      ).toBe(canonicalSkill);
      expect(await readFile(join(destination, projectSkillPath), "utf8")).toBe(
        canonicalSkill
      );
      await expect(
        readFile(join(destination, "SKILL.md"), "utf8")
      ).rejects.toThrow();
      expect(agentInstructions).toContain("This project uses TaskWish");
      expect(agentInstructions).toContain("`.agents/skills/taskwish/SKILL.md`");
      const normalizedEntrypoint = entrypoint
        .replace(/\s+/g, " ")
        .replace(/\[\s+/g, "[")
        .replace(/,\s+\]/g, "]");
      const expectedWorkspace = `workspace: [${actorNames.join(", ")}]`;
      expect(normalizedEntrypoint).toContain(expectedWorkspace);
      expect(normalizedEntrypoint).not.toContain(
        `workspace: [{ ${actorNames.join(", ")} }]`
      );
      if (template === "empty") {
        expect(entrypoint).not.toContain("Greeter.greet");
      }
      if (template === "todo") {
        const completeTodoSource = await readFile(
          join(destination, "src/todos/complete-todo.ts"),
          "utf8"
        );
        expect(completeTodoSource).toContain('.addStateCommand("item"');
        expect(completeTodoSource).toContain("suggestions: {");
        expect(completeTodoSource).toContain('$: "Todos::listTodos"');
        expect(completeTodoSource).toContain(
          'this.signal("Todos::TodoCompleted"'
        );
        expect(entrypoint).not.toContain("Reminders");
      }
      if (template === "agent-loops") {
        const toolCallingSource = await readFile(
          join(destination, "src/tool-calling-loop/run-tool-calling-loop.ts"),
          "utf8"
        );
        const multiAgentSource = await readFile(
          join(destination, "src/multi-agent-loop/run-multi-agent-loop.ts"),
          "utf8"
        );
        const humanLoopSource = await readFile(
          join(destination, "src/human-in-the-loop/run-human-in-the-loop.ts"),
          "utf8"
        );
        const githubWebhookSource = await readFile(
          join(destination, "src/github/receive-issue-webhook.ts"),
          "utf8"
        );
        const githubPullRequestSource = await readFile(
          join(
            destination,
            "src/github/push-branch-and-create-pull-request.ts"
          ),
          "utf8"
        );
        const eventLoopSource = await readFile(
          join(destination, "src/event-driven-loop/on-github-issue-opened.ts"),
          "utf8"
        );
        expect(toolCallingSource).toContain('Tool("calculate"');
        expect(toolCallingSource).toContain('tools: ["calculate"]');
        expect(toolCallingSource).not.toContain('runtime: "codex"');
        expect(toolCallingSource).toContain('model: "ollama/qwen3:4b"');
        expect(multiAgentSource).toContain('Agent("agentA"');
        expect(multiAgentSource).toContain('Agent("agentB"');
        expect(humanLoopSource).toContain('status: "approvalRequired"');
        expect(githubWebhookSource).toContain(
          '.on("POST", "/integrations/github/issues"'
        );
        expect(githubWebhookSource).toContain(
          'this.signal("GitHub::IssueOpened"'
        );
        expect(githubPullRequestSource).toContain(
          '.on("Command", "pushBranchAndCreatePullRequest")'
        );
        expect(githubPullRequestSource).toContain('execFileAsync("git", args');
        expect(githubPullRequestSource).toContain('"https://api.github.com"');
        expect(eventLoopSource).toContain('.on("GitHub::IssueOpened")');
        expect(entrypoint).toContain("GitHub,");
      }
      if (template === "agent-graphs") {
        const parallelSource = await readFile(
          join(destination, "src/parallel-graph/run-parallel-graph.ts"),
          "utf8"
        );
        const routingSource = await readFile(
          join(destination, "src/routing-graph/route-request.ts"),
          "utf8"
        );
        const fallbackSource = await readFile(
          join(destination, "src/fallback-graph/run-fallback-graph.ts"),
          "utf8"
        );
        expect(parallelSource).toContain("Promise.all");
        expect(routingSource).toContain("runSelectedBranch");
        expect(fallbackSource).toContain('path: "fallback"');
      }
      if (template === "options-analyst") {
        const optionsSource = await readFile(
          join(destination, "src/options-analyst/analyze-call.ts"),
          "utf8"
        );
        const formulaSource = await readFile(
          join(destination, "src/options-analyst/options-analyst.ts"),
          "utf8"
        );
        expect(packageJson.dependencies["@taskwish/symbolic"]).toBe(
          `^${templateVersions["@taskwish/symbolic"]}`
        );
        expect(formulaSource).toContain('"greeksFormula"');
        expect(optionsSource).toContain("this.greeksFormula.solve(");
        expect(optionsSource).toContain("this.agent.generate(");
      }
      if (template === "open-banking") {
        const listBanksSource = await readFile(
          join(destination, "src/open-banking/list-banks.ts"),
          "utf8"
        );
        const startConnectionSource = await readFile(
          join(destination, "src/open-banking/start-bank-connection.ts"),
          "utf8"
        );
        const syncConnectionSource = await readFile(
          join(destination, "src/open-banking/sync-bank-connection.ts"),
          "utf8"
        );
        expect(listBanksSource).toContain('.on("Command", "listBanks")');
        expect(startConnectionSource).toContain(
          '.on("Command", "startBankConnection")'
        );
        expect(syncConnectionSource).toContain(
          '.on("Command", "syncBankConnection")'
        );
        expect(startConnectionSource).not.toContain("secretId");
      }
      if (template === "software-factory") {
        const codingSource = await readFile(
          join(destination, "src/coding-agent/on-github-issue-opened.ts"),
          "utf8"
        );
        const reviewSource = await readFile(
          join(destination, "src/review-agent/on-change-proposed.ts"),
          "utf8"
        );
        const reviewActorSource = await readFile(
          join(destination, "src/review-agent/review-agent.ts"),
          "utf8"
        );
        const slackSource = await readFile(
          join(destination, "src/slack/post-message.ts"),
          "utf8"
        );
        expect(packageJson.dependencies["@taskwish/slack"]).toBeUndefined();
        expect(codingSource).toContain('.on("GitHub::IssueOpened")');
        expect(codingSource).toContain(
          'this.signal("CodingAgent::ChangeProposed"'
        );
        expect(reviewSource).toContain(
          '.on("CodingAgent::ChangeProposed")'
        );
        expect(reviewSource).toContain(
          "this.actions.slack.postMessage"
        );
        expect(reviewActorSource).toContain('from "../slack"');
        expect(slackSource).toContain(
          'fetch("https://slack.com/api/chat.postMessage"'
        );
      }
      for (const actorName of actorNames) {
        expect(entrypoint).toContain(actorName);
        expect(entrypoint).not.toContain(`await ${actorName}.`);
      }
      expect(entrypoint).not.toContain("console.log(");
      expect(result.template).toBe(template);
      expect(result.packageManager).toBe("npm");
      expect(result.installed).toBe(false);
      expect(result.gitInitialized).toBe(false);
      expect(result.files).toContain(actionPath);
      expect(result.files).toContain(testPath);
      expect(
        result.files.some((file) => file.startsWith("node_modules/"))
      ).toBe(false);
      expect(result.files).not.toContain("bun.lock");
      expect(result.files.some((file) => file.startsWith("state/"))).toBe(
        false
      );
      expect(result.files).toContain("taskwish.ts");
      expect(result.files).toContain("AGENTS.md");
      expect(result.files).toContain(projectSkillPath);
      expect(
        result.files.filter((file) => file === projectSkillPath)
      ).toHaveLength(1);
      const actionFiles = result.files.filter((file) => {
        const parts = file.split("/");
        const serviceName = parts.at(-2);
        const fileName = parts.at(-1);
        return (
          file.startsWith("src/") &&
          file.endsWith(".ts") &&
          !file.endsWith(".test.ts") &&
          !file.startsWith("src/shared/") &&
          fileName !== `${serviceName}.ts` &&
          fileName !== "index.ts"
        );
      });
      const actionStepCounts: number[] = [];
      for (const actionFile of actionFiles) {
        const actionSource = await readFile(
          join(destination, actionFile),
          "utf8"
        );
        const stepNames = Array.from(
          actionSource.matchAll(/Step\("([^"]+)"/g),
          (match) => match[1]!
        );
        const isHttpRouteAction = /\.on\("(?:GET|POST|PUT|DELETE|PATCH)"/.test(
          actionSource
        );
        if (!isHttpRouteAction) expect(stepNames.length).toBeGreaterThan(0);
        expect(actionSource).toContain(".meta({");
        expect(actionSource).toContain("description:");
        for (const stepName of stepNames) {
          expect(stepName).toMatch(/^[a-z][a-zA-Z0-9]*$/);
        }
        actionStepCounts.push(stepNames.length);
      }
      if (template !== "document-extractor") {
        expect(actionStepCounts.some((count) => count > 1)).toBe(true);
      }
      const actorFiles = result.files.filter((file) => {
        const parts = file.split("/");
        return file.startsWith("src/") && parts.at(-1) === `${parts.at(-2)}.ts`;
      });
      expect(actorFiles).toHaveLength(actorNames.length);
      for (const actorFile of actorFiles) {
        const parts = actorFile.split("/");
        const serviceName = parts.at(-2);
        expect(parts.at(-1)).toBe(`${serviceName}.ts`);
      }
      if (
        template === "agent-loops" ||
        template === "agent-graphs" ||
        template === "software-factory" ||
        template === "document-extractor" ||
        template === "freight-operator"
      ) {
        const serviceTests = result.files.filter(
          (file) => file.startsWith("src/") && file.endsWith(".test.ts")
        );
        expect(serviceTests).toHaveLength(actorNames.length);
        for (const serviceTest of serviceTests) {
          const parts = serviceTest.split("/");
          const serviceName = parts.at(-2);
          expect(parts.at(-1)).toBe(`${serviceName}.test.ts`);
        }
      }
    }
  );

  test("uses the empty template by default", async () => {
    const parent = await temporaryDirectory();
    const destination = join(parent, "defaults");

    const result = await Scaffolder.createProject({
      projectName: destination,
      install: false,
      git: false,
      templateDirectory,
      skillPath,
    });

    expect(result.template).toBe("empty");
  });

  test("refuses to write into a non-empty directory", async () => {
    const destination = await temporaryDirectory();
    await writeFile(join(destination, "keep.txt"), "do not overwrite");

    await expect(
      Scaffolder.createProject({
        projectName: destination,
        template: "empty",
        install: false,
        git: false,
        templateDirectory,
        skillPath,
      })
    ).rejects.toThrow("the directory is not empty");
    expect(await readFile(join(destination, "keep.txt"), "utf8")).toBe(
      "do not overwrite"
    );
  });

  test("rejects unknown templates", async () => {
    const parent = await temporaryDirectory();

    await expect(
      Scaffolder.createProject({
        projectName: join(parent, "invalid"),
        template: "not-a-template",
        install: false,
        git: false,
        templateDirectory,
        skillPath,
      })
    ).rejects.toThrow('Unknown template "not-a-template"');
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "taskwish-create-project-"));
  temporaryDirectories.push(directory);
  return directory;
}
