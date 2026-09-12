# TaskWish

TaskWish is a TypeScript framework for building agentic applications and autonomous companies from typed actors, actions, state, events, tools, and AI workflows.

Actors keep domain behavior together. Actions expose typed commands and HTTP endpoints. Events connect actors without coupling them, while the built-in Console makes the complete system visible and interactive.

[Website](https://taskwish.ai) · [Documentation](https://taskwish.ai/docs) · [Use cases](https://taskwish.ai/#use-cases)

## Create a project

TaskWish projects use [Bun](https://bun.sh) by default and can also run on Node.js 20+.

Use the platform-aware installer:

```sh
curl -fsSL https://taskwish.ai/create-project.sh | bash
```

The installer detects the current platform and downloads the matching native create-project CLI.

To compile and stage the installer binaries for a website deployment, run:

```sh
bun run stage:create-project
```

This compiles the bare CLI with `scriptc` inside `packages/create-project/platforms`, then copies the macOS, Linux, and Windows binaries to `apps/web/public/cli`. Commit the copied public binaries before pushing the website deployment. Linux ARM64 with musl is not yet supported by `scriptc`.

Platform compilation currently runs from macOS ARM64 and requires Xcode Command Line Tools plus [Zig](https://ziglang.org/).

Alternatively, run the JavaScript CLI through Bun or Node.js:

```sh
bunx @taskwish/create-project
# or
npx @taskwish/create-project
```

Create a project without interactive prompts:

```sh
bunx @taskwish/create-project my-app --template todo --yes
cd my-app
bun start
```

The generated service prints its local Console URL and API key at startup.

## Starter projects

| Template | What it demonstrates |
| --- | --- |
| [`empty`](packages/create-project/templates/empty) | A minimal Greeter actor, server, and Console |
| [`todo`](packages/create-project/templates/todo) | Stateful actions and typed completion events |
| [`agent-loops`](packages/create-project/templates/agent-loops) | ReAct, reflection, planning, tool use, memory, human approval, and other common agent loops |
| [`agent-graphs`](packages/create-project/templates/agent-graphs) | Sequential, parallel, routing, map-reduce, hierarchical, and fallback graphs |
| [`software-factory`](packages/create-project/templates/software-factory) | GitHub events coordinating coding and review agents with Slack notifications |
| [`document-extractor`](packages/create-project/templates/document-extractor) | Document uploads and text extraction with the Documents actor |
| [`freight-operator`](packages/create-project/templates/freight-operator) | Email/documents → Anydoc and OpenAI extraction → validation → human approval → McLeod PowerBroker order |
| [`options-analyst`](packages/create-project/templates/options-analyst) | Black–Scholes Greeks → symbolic verification → OpenAI risk memo |
| [`open-banking`](packages/create-project/templates/open-banking) | PSD2 bank selection → user consent → accounts, balances, and transactions |

Choose a starter directly with `--template`:

```sh
bunx @taskwish/create-project my-agents --template agent-graphs
```

## The TaskWish model

- **Actors** own a domain and group its state, events, and public behavior.
- **Actions** are typed entrypoints composed from named, observable steps.
- **State** stays scoped to its owning actor and can be inspected in Console.
- **Events** connect actors through typed messages.
- **Agents and tools** add model reasoning where judgment is useful while ordinary TypeScript controls the workflow.
- **Console** discovers actors, renders input controls, runs actions, and streams their execution.
- **MCP** exposes selected actions as tools for compatible clients.

A small action looks like this:

```ts
import { Actor, Step } from "taskwish";

const { actor } = Actor("Greeter");

const { greet } = actor()
  .on("Command", "greet")
  
  .input({ name: "string" })

  .run(
    Step("createGreeting", function () {
      return `Hello, ${this.input.name.trim()}!`;
    }),
  )
  
  .meta({
    description: "Greet a person by name",
    input: { name: { example: "Ada" } },
  });

export const { Greeter } = actor().service({ greet });
```

Action metadata powers generated help, Console controls, and agent-facing descriptions without requiring a separate schema.

## Repository

This repository is a Bun workspace managed with Turborepo.

| Package | Purpose |
| --- | --- |
| [`taskwish`](packages/taskwish) | Public framework entrypoint |
| [`@taskwish/core`](packages/core) | Actors, actions, steps, state, and events |
| [`@taskwish/ai`](packages/ai) | Agent and model-provider integrations |
| [`@taskwish/server`](packages/server) | HTTP server, routes, streaming, and MCP |
| [`@taskwish/console`](packages/console) | Interactive web Console |
| [`@taskwish/create-project`](packages/create-project) | Project scaffolder and starter templates |
| [`@taskwish/terminal`](packages/terminal) | Metadata-driven terminal interface |
| [`@taskwish/wire`](packages/wire) | Runtime messages, tracing, and logging |

Install dependencies and build every workspace:

```sh
bun install
bun run build
```

Run the website locally:

```sh
bun run dev:web
```

Packages keep their tests beside the implementation. Run a focused suite with:

```sh
bun test packages/core
bun test packages/server
bun --cwd packages/server run test:node
```

## License

TaskWish is licensed under the [Elastic License 2.0](LICENSE.md).
