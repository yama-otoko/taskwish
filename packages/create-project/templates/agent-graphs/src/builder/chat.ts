import { Agent, Step } from "taskwish";

import { actor } from "./builder";

export const { chat } = actor()
  .on("Message")

  .run(
    Agent({
      runtime: "codex",
      cwd: process.cwd(),
      initialAgentMode: "agent",
      permission: "allow_always",
      instructions:
        "You are the builder for this TaskWish project. Inspect and modify the project in response to the user's requests. Follow AGENTS.md and the TaskWish skill, preserve unrelated work, and run relevant checks before reporting completion.",
    }),

    Step("modifyProject", function () {
      return this.agent.chat(this.input);
    }),
  )

  .meta({
    description: "Chat with an agent that can inspect and modify this project",
  });

