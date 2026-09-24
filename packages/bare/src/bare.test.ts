import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { morph, morphDir, morphEntrypoint } from ".";

function expectParts(output: string, parts: string[]) {
  for (const part of parts) {
    expect(output).toContain(part);
  }
}

describe("morph", () => {
  test("inlines typed Terminal.elicit calls in bare entrypoints", () => {
    const output = morphEntrypoint(`
import { Terminal } from "@taskwish/terminal";
import { Scaffolder } from "./src/scaffolder";

Terminal.elicit(Scaffolder.createProject, {
  formatResult(result) {
    return result.directory;
  },
});
`, {
      actions: [
        {
          expression: "Scaffolder.createProject",
          inputType: "{ projectName: string }",
          outputType: "{ directory: string }",
          metadataText:
            '{ name: "Scaffolder::createProject", meta: { description: "Create project" }, inputSchema: { projectName: "string" } }',
        },
      ],
    });

    expect(output).toContain(
      'import { taskwishLogo } from "@taskwish/terminal";',
    );
    expect(output).toContain(
      'import { createInterface } from "node:readline";',
    );
    expect(output).toContain(
      "const __taskwishAction = Scaffolder.createProject;",
    );
    expect(output).toContain(
      'const __taskwishMetadata = { name: "Scaffolder::createProject"',
    );
    expect(output).toContain(
      "__TaskwishTerminalOptions<typeof __taskwishAction>",
    );
    expect(output).not.toContain("Terminal.elicit");
    expect(output).not.toContain("import { elicit }");
    expect(output).not.toContain("__taskwishElicit(");
    expect(output).not.toContain("function __taskwishFields");
    expect(output).toContain("const fields: __TaskwishTerminalField[] = [");
    expect(output).toContain(
      'const __TASKWISH_ACCENT = "38;2;0;223;163";',
    );
    expect(output).toContain('__taskwishPaint("30", "\\u250c")');
    expect(output).toContain('__taskwishPaint("30", "\\u2514")');
    expect(output).toContain('__taskwishPaint(__TASKWISH_ACCENT, first)');
    expect(output).toContain("function __taskwishArguments");
    expect(() =>
      new Bun.Transpiler({ loader: "ts" }).transformSync(output),
    ).not.toThrow();
  });

  test("leaves terminal imports alone when there is no elicit call to rewrite", () => {
    const source = `import { Terminal } from "@taskwish/terminal";\nconsole.log(Terminal);\n`;
    expect(morphEntrypoint(source)).toBe(source);
  });

  test("runs the emitted terminal flow without the Terminal framework API", async () => {
    const root = await mkdtemp(join(tmpdir(), "taskwish-bare-terminal-"));
    const terminalEntry = join(
      import.meta.dir,
      "..",
      "..",
      "terminal",
      "src",
      "index.ts",
    );
    const outputPath = join(root, "entrypoint.ts");
    const output = morphEntrypoint(`
import { Terminal } from "@taskwish/terminal";

const Scaffolder = {
  async createProject(input: Record<string, unknown>) {
    return { name: input.projectName };
  },
};

Terminal.elicit(Scaffolder.createProject, {
  command: "create-project",
  formatResult(result) { return "Created " + result.name; },
});
`, {
      actions: [
        {
          expression: "Scaffolder.createProject",
          inputType: "Record<string, unknown>",
          outputType: "{ name: unknown }",
          metadataText: `{
            name: "Scaffolder::createProject",
            meta: {
              description: "Create project",
              input: { projectName: { elicit: { default: "demo" } } },
            },
            inputSchema: { projectName: "string" },
          }`,
        },
      ],
    }).replace("@taskwish/terminal", terminalEntry);

    await writeFile(outputPath, output);
    const process = Bun.spawn(["bun", outputPath, "--yes"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("└  Created demo");
  });

  test("converts a TaskWish actor step chain to traced runners and service helpers", () => {
    const source = `import { Actor, Step } from "../../src";
import { Logger } from "@taskwish/wind";

const { actor } = Actor("MyActor");

export const { runSteps } = actor()
  .on("Command", "runSteps")

  .input({ message: "string" })

  .run(
    Step("firstStep", function () {
      return "step 1";
    }),

    Step("lastStep", function () {
      return this.firstStep.length;
    }),
  );

export const { MyActor } = actor().service({ runSteps });
`;
    expectParts(morph(source), [
      `import { Logger, Wind } from "@taskwish/wind";`,
      `interface RunStepsAction`,
      `type RunStepsScope = { wind: Wind };`,
      `type RunStepsScopePatch = { wind?: Wind };`,
      `export const runSteps = async function runSteps(input: { message: string; })`,
      `runSteps.run = runStepsCtx().run;`,
      `runSteps.stream = runStepsCtx().stream;`,
      `function runStepsCtx(ctx: RunStepsScopePatch = {})`,
      `const initialScope: RunStepsScope = { wind };
  const scope: RunStepsScope = initialScope;
  if (ctx.wind !== undefined) scope.wind = ctx.wind;`,
      `const firstStep = "step 1";`,
      `const lastStep = firstStep.length;`,
      `export const MyActor = {
  runSteps
};`,
    ]);
  });

  test("can omit action metadata when a CLI entrypoint owns it", () => {
    const output = morph(
      `import { Actor, Step } from "../../src";

const { actor } = Actor("Greeter");

export const { greet } = actor()
  .on("Command", "greet")
  .input({ name: "string" })
  .run(Step("message", function () { return "Hello " + this.input.name; }))
  .meta({ description: "Greet someone" });
`,
      { metadata: false },
    );

    expect(output).toContain("export const greet = async function greet");
    expect(output).not.toContain("greetMetadata");
    expect(output).not.toContain("__taskwish");
  });

  test("preserves action metadata and input schemas for runtime integrations", () => {
    const source = `import { Actor, Step } from "../../src";

const { actor } = Actor("Greeter");

export const { greet } = actor()
  .on("Command", "greet")

  .input({ name: "string", "excited?": "boolean" })

  .run(
    Step("message", function () {
      return \`Hello \${this.input.name}\`;
    }),
  )

  .meta({
    description: "Greet a person",
    input: {
      name: {
        elicit: { label: "Name" },
      },
    },
  });
`;

    expectParts(morph(source), [
      `export const greetMetadata = {`,
      `greet.__taskwish = greetMetadata`,
      `name: "Greeter::greet"`,
      `meta: {`,
      `description: "Greet a person"`,
      `elicit: { label: "Name" }`,
      `inputSchema: { name: "string", "excited?": "boolean" }`,
    ]);
  });

  test("keeps event listeners out of direct service exports", () => {
    const source = `import { Actor, Step } from "../../src";

const { actor } = Actor("Greeter");

export const { hello } = actor()
  .on("Command", "hello")

  .run(
    Step("greeting", function () {
      return "hello";
    }),
  );

export const { onNewEmail } = actor()
  .on("NewEmail")

  .run(
    Step("result", function () {
      return "email";
    }),
  );

export const { Greeter } = actor().service({
  hello,
  onNewEmail,
});
`;

    const output = morph(source);

    expectParts(output, [
      `import { Wind, addListener } from "@taskwish/wind";`,
      `interface HelloAction`,
      `export const hello = async function hello()`,
      `interface OnNewEmailAction`,
      `export const onNewEmail = async function onNewEmail()`,
      `scope.wind.trace("Greeter::hello", { input });`,
      `scope.wind.trace("Greeter::onNewEmail", { input });`,
      `addListener("Greeter::NewEmail", onNewEmail);`,
      `export const Greeter = {
  hello
};`,
    ]);
    expect(output).not.toContain(`onNewEmail: onNewEmail.run`);
    expect(output).not.toContain(`onNewEmail: onNewEmail.stream`);
  });

  test("preserves early returns by breaking out of the step block", () => {
    const source = `import { Actor, Step } from "../../src";

const { actor } = Actor("MyActor");

export const { runSteps } = actor()
  .on("Command", "runSteps")

  .input({ message: "string" })

  .run(
    Step("firstStep", function () {
      if (this.input.message.trim() === "") {
        return "empty";
      }

      return "filled";
    }),

    Step("lastStep", function () {
      return this.firstStep.length;
    }),
  );
`;

    expectParts(morph(source), [
      `firstStepBlock: {`,
      `firstStep = "empty";
        break firstStepBlock;`,
      `scope.wind.trace("MyActor::runSteps.firstStep", { result: firstStep });`,
      `const lastStep = firstStep.length;`,
    ]);
  });

  test("keeps blocks for multi-expression step handlers", () => {
    const source = `import { Actor, Step } from "../../src";

const { actor } = Actor("MyActor");

export const { runSteps } = actor()
  .on("Command", "runSteps")

  .input({ message: "string" })

  .run(
    Step("firstStep", function () {
      const normalized = this.input.message.trim();
      const upper = normalized.toUpperCase();

      return upper;
    }),

    Step("lastStep", function () {
      return this.firstStep.length;
    }),
  );
`;

    expectParts(morph(source), [
      `const normalized = input.message.trim();`,
      `const upper = normalized.toUpperCase();`,
      `firstStep = upper;`,
      `scope.wind.trace("MyActor::runSteps.firstStep", { result: firstStep });`,
    ]);
  });

  test("infers object types for multi-expression step handlers", () => {
    const source = `import { Actor, Step } from "../../src";

const { actor } = Actor("MyActor");

export const { runSteps } = actor()
  .on("Command", "runSteps")

  .run(
    Step("result", function () {
      const title = "Example";
      const url = "https://example.com";

      return { title, url };
    }),
  );
`;

    expectParts(morph(source), [
      `let result: { title: string; url: string; };`,
      `result = { title, url };`,
    ]);
  });

  test("leaves helper functions outside the actor untouched", () => {
    const source = `import { Actor, Step } from "../../src";

function normalizeMessage(message: string) {
  return message.trim().toUpperCase();
}

const { actor } = Actor("MyActor");

export const { runSteps } = actor()
  .on("Command", "runSteps")

  .input({ message: "string" })

  .run(
    Step("firstStep", function () {
      return normalizeMessage(this.input.message);
    }),

    Step("lastStep", function () {
      return this.firstStep.length;
    }),
  );
`;

    expectParts(morph(source), [
      `function normalizeMessage(message: string) {
  return message.trim().toUpperCase();
}`,
      `const firstStep = normalizeMessage(input.message);`,
      `const lastStep = firstStep.length;`,
    ]);
  });

  test("keeps declarations after the action in place", () => {
    const source = `import { Actor, Step } from "../../src";

function normalizeMessage(message: string) {
  return message.trim().toUpperCase();
}

const { actor } = Actor("MyActor");

export const { runSteps } = actor()
  .on("Command", "runSteps")

  .input({ message: "string" })

  .run(
    Step("firstStep", function () {
      return normalizeMessage(this.input.message);
    }),
  );

const main = async () => {
  const result = await runSteps({ message: "hello" });

  console.log(result);
};

main();
`;

    expectParts(morph(source), [
      `scope.wind.trace("MyActor::runSteps", { result: firstStep });`,
      `const main = async () => {
  const result = await runSteps({ message: "hello" });

  console.log(result);
};

main();`,
    ]);
  });

  test("exports a wrapper with the original action binding name", () => {
    const source = `import { Actor, Step } from "../../src";

const { actor } = Actor("MyActor");

export const { runSteps } = actor()
  .on("Command", "Run steps")

  .input({ name: "string" })

  .run(
    Step("firstStep", function () {
      return \`Hello \${this.input.name}\`;
    }),

    Step("lastStep", function () {
      return \`Hello \${this.input.name}\`;
    }),
  );
`;

    expectParts(morph(source), [
      `async function runSteps(input: { name: string; })`,
      `interface RunStepsAction`,
      `export const runSteps = async function runSteps(input: { name: string; })`,
      `async function runSteps(input: { name: string; })`,
      `function runStepsCtx(ctx: RunStepsScopePatch = {})`,
    ]);
  });

  test("generates context-bound run and stream wrappers", () => {
    const source = `import { Actor, Step } from "../../src";

const { actor } = Actor("MyActor");

export const { runSteps } = actor()
  .on("Command", "Run steps")

  .input({ name: "string" })

  .run(
    Step("result", function () {
      return this.abortSignal?.aborted ?? false;
    }),
  );
`;

    expectParts(morph(source), [
      `import { Wind } from "@taskwish/wind";`,
      `function runStepsCtx(ctx: RunStepsScopePatch = {})`,
      `const wind = new Wind();`,
      `const initialScope: RunStepsScope = { wind, abortSignal: undefined as AbortSignal | undefined };
  const scope: RunStepsScope = initialScope;
  if (ctx.wind !== undefined) scope.wind = ctx.wind;
  if (ctx.abortSignal !== undefined) scope.abortSignal = ctx.abortSignal;`,
      `async function run(input: { name: string; }) {
    return stream(input);
  }`,
      `async function stream(input: { name: string; })`,
      `const abortSignal = scope.abortSignal as AbortSignal | undefined;`,
      `const result = abortSignal?.aborted ?? false;`,
    ]);
  });

  test("rewrites injected action calls to scope actions", () => {
    const source = `import { Browser } from "./browser";
import { Actor, Step } from "../../src";

const { actor } = Actor("MyActor").use(Browser);

export const { runSteps } = actor()
  .on("Command", "runSteps")

  .run(
    Step("page", function () {
      return this.actions.browser.browse({
        url: "https://example.com",
      });
    }),
  );
`;

    expectParts(morph(source), [
      `import { Wind } from "@taskwish/wind";`,
      `import { Browser } from "./browser";`,
      `function runStepsCtx(ctx: RunStepsScopePatch = {})`,
      `const initialScope: RunStepsScope = { wind, actions: { browser: { browse: Browser.browse } } };
  const scope: RunStepsScope = initialScope;
  if (ctx.wind !== undefined) scope.wind = ctx.wind;
  if (ctx.actions !== undefined) {
    if (ctx.actions.browser !== undefined) {
      if (ctx.actions.browser.browse !== undefined) scope.actions.browser.browse = ctx.actions.browser.browse;
    }
  }`,
      `const page = await scope.actions.browser.browse({
      url: "https://example.com",
    });`,
    ]);
  });

  test("ctx accepts partial action scope patches in generated bare output", () => {
    const source = `import { Browser } from "./browser";
import { Actor, Step } from "../../src";

const { actor } = Actor("MyActor").use(Browser);

export const { runSteps } = actor()
  .on("Command", "runSteps")

  .run(
    Step("page", function () {
      return this.actions.browser.browse({
        url: "https://example.com",
      });
    }),

    Step("closed", function () {
      return this.actions.browser.close();
    }),
  );
`;

    expectParts(morph(source), [
      `function runStepsCtx(ctx: RunStepsScopePatch = {})`,
      `const initialScope: RunStepsScope = { wind, actions: { browser: { browse: Browser.browse, close: Browser.close } } };
  const scope: RunStepsScope = initialScope;
  if (ctx.wind !== undefined) scope.wind = ctx.wind;
  if (ctx.actions !== undefined) {
    if (ctx.actions.browser !== undefined) {
      if (ctx.actions.browser.browse !== undefined) scope.actions.browser.browse = ctx.actions.browser.browse;
      if (ctx.actions.browser.close !== undefined) scope.actions.browser.close = ctx.actions.browser.close;
    }
  }`,
      `const page = await scope.actions.browser.browse({`,
      `const closed = await scope.actions.browser.close();`,
    ]);
  });

  test("uses ArkType inference for input schemas", () => {
    const source = `import { Actor, Step } from "../../src";

const { actor } = Actor("MyActor");

export const { runSteps } = actor()
  .on("Command", "runSteps")

  .input({ name: "string", tags: "string[]", "age?": "number" })

  .run(
    Step("firstStep", function () {
      return this.input.tags.length;
    }),
  );
`;

    expectParts(morph(source), [
      `input: { name: string; tags: string[]; age?: number | undefined; }`,
      `const firstStep = input.tags.length;`,
      `scope.wind.trace("MyActor::runSteps.firstStep", { result: firstStep });`,
    ]);
  });

  test("rewrites signals to the wind event bus", () => {
    const source = `import { Actor, Step } from "../../src";

const { actor } = Actor("Greeter");

export const { hello } = actor()
  .on("Command", "hello")

  .input({ name: "string" })

  .run(
    Step("notify", function () {
      return this.signal("Greeter::Message", { name: this.input.name });
    }),
  );
`;

    const output = morph(source);

    expect(output).toContain(
      `const notify = scope.wind.signal("Greeter::Message", { name: input.name }) as Record<string, unknown>;`
    );
    expect(output).not.toContain(`const signal =`);
  });

  test("awaits async step handlers inline", () => {
    const source = `import { Actor, Step } from "../../src";

async function loadGreeting(name: string) {
  return \`Hello \${name}\`;
}

const { actor } = Actor("MyActor");

export const { runSteps } = actor()
  .on("Command", "runSteps")

  .input({ name: "string" })

  .run(
    Step("firstStep", async function () {
      return await loadGreeting(this.input.name);
    }),

    Step("lastStep", function () {
      return this.firstStep.length;
    }),
  );
`;

    expectParts(morph(source), [
      `async function loadGreeting(name: string)`,
      `const firstStep = await loadGreeting(input.name);`,
      `const lastStep = firstStep.length;`,
    ]);
  });

  test("does not await object literals returned from async step handlers", () => {
    const source = `import { Actor, Step } from "../../src";

async function loadTitle() {
  return "Hello";
}

const { actor } = Actor("MyActor");

export const { runSteps } = actor()
  .on("Command", "runSteps")

  .run(
    Step("result", async function () {
      const title = await loadTitle();
      const url = "https://example.com";

      return {
        title,
        url,
      };
    }),
  );
`;

    expectParts(morph(source), [
      `const title = await loadTitle();`,
      `result = {
        title,
        url,
      };`,
    ]);
  });

  test("awaits non-async step methods that return promises", () => {
    const source = `import { Actor, Step } from "../../src";

function loadGreeting(name: string) {
  return Promise.resolve(\`Hello \${name}\`);
}

const { actor } = Actor("MyActor");

export const { runSteps } = actor()
  .on("Command", "runSteps")

  .input({ name: "string" })

  .run(
    Step("firstStep", function () {
      return loadGreeting(this.input.name);
    }),

    Step("lastStep", function () {
      return this.firstStep.length;
    }),
  );
`;

    expectParts(morph(source), [
      `function loadGreeting(name: string)`,
      `const firstStep = await loadGreeting(input.name);`,
      `const lastStep = firstStep.length;`,
    ]);
  });

  test("morphDir preserves action directive prologues", async () => {
    const root = await mkdtemp(join(tmpdir(), "taskwish-bare-"));
    const sourceDir = join(root, "src", "greeter");

    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "greeter.ts"),
      `import { Actor } from "taskwish";

export const { actor } = Actor("Greeter");
`
    );
    await writeFile(
      join(sourceDir, "hello.ts"),
      `"use server";

import { actor } from "./greeter";

export const { hello } = actor()
  .on("Command", "hello")

  .run(function () {
    return "hello";
  });
`
    );
    await writeFile(
      join(sourceDir, "index.ts"),
      `import { actor } from "./greeter";
import { hello } from "./hello";

export const { Greeter } = actor().service({ hello });
`
    );

    const result = await morphDir("./greeter", {
      baseDir: join(root, "src"),
      metadata: false,
    });

    const output = await readFile(
      join(root, "bare", "greeter", "hello.ts"),
      "utf8"
    );
    const indexOutput = await readFile(
      join(root, "bare", "greeter", "index.ts"),
      "utf8"
    );

    expect(
      output.startsWith(
        `"use server";

import { Wind } from "@taskwish/wind";`
      )
    ).toBe(true);
    expect(indexOutput).toContain("export { hello };");
    expect(indexOutput).not.toContain("helloMetadata");
    expect(result.actions).toEqual([
      expect.objectContaining({
        expression: "Greeter.hello",
        metadataText: expect.stringContaining('name: "Greeter::hello"'),
      }),
    ]);
  });

  test("morphDir resolves listener input from imported service events", async () => {
    const root = await mkdtemp(join(tmpdir(), "taskwish-bare-"));
    const greeterDir = join(root, "src", "greeter");
    const billerDir = join(root, "src", "biller");

    await mkdir(greeterDir, { recursive: true });
    await mkdir(billerDir, { recursive: true });
    await writeFile(
      join(greeterDir, "greeter.ts"),
      `import { Actor, Event } from "taskwish";

export const { actor } = Actor("Greeter").scope(
  Event("Message", { name: "string" }),
);
`
    );
    await writeFile(
      join(greeterDir, "hello.ts"),
      `import { actor } from "./greeter";

export const { hello } = actor()
  .on("Command", "hello")
  .input({ name: "string" })
  .run(function () {
    return this.signal("Greeter::Message", { name: this.input.name });
  });
`
    );
    await writeFile(
      join(greeterDir, "index.ts"),
      `import { actor } from "./greeter";
import { hello } from "./hello";

export const { Greeter } = actor().service({ hello });
`
    );
    await writeFile(
      join(billerDir, "biller.ts"),
      `import { Actor } from "taskwish";
import { Greeter } from "../greeter";

export const { actor } = Actor("Biller").use(Greeter);
`
    );
    await writeFile(
      join(billerDir, "on-greeter-message.ts"),
      `import { actor } from "./biller";

export const { onGreeterMessage } = actor()
  .on("Greeter::Message")
  .run(function () {
    return {
      invoice: \`Invoice created from greeter message: \${this.input.name}\`,
    };
  });
`
    );
    await writeFile(
      join(billerDir, "index.ts"),
      `import { actor } from "./biller";
import { onGreeterMessage } from "./on-greeter-message";

export const { Biller } = actor().service({ onGreeterMessage });
`
    );

    await morphDir("./biller", { baseDir: join(root, "src") });

    const output = await readFile(
      join(root, "bare", "biller", "on-greeter-message.ts"),
      "utf8"
    );

    expect(output).toContain(
      `async function onGreeterMessage(input: { name: string; })`
    );
    expect(output).toContain(`input: { name: string; }`);
    expect(output).toContain(
      `import { Wind, addListener } from "@taskwish/wind";`
    );
    expect(output).toContain(
      `addListener("Greeter::Message", onGreeterMessage);`
    );
    expect(output).not.toContain(`input: any`);
  });
});
