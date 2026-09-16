import { expect, mock, test } from "bun:test";

import { Builder } from ".";

test("forwards chat messages to the project builder agent", async () => {
  const chat = mock(async function* () {
    return "Updated the project.";
  });

  await expect(
    Builder.chat.ctx({ agent: { chat } }).run({
      sessionId: "session-1",
      content: "Add a status page",
    }),
  ).resolves.toBe("Updated the project.");
  expect(chat).toHaveBeenCalledTimes(1);
});

