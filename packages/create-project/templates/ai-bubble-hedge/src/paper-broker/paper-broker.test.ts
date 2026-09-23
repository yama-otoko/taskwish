import { expect, test } from "bun:test";

import { PaperBroker } from ".";

test("creates only a defined-risk paper put order with approval", async () => {
  const result = await PaperBroker.buyPut({
    ticker: "NVDA",
    strike: 150,
    expiration: "2027-01-15",
    limitPremium: 8,
    contracts: 2,
    approvalId: "approval-1042",
  });

  expect(result).toMatchObject({
    mode: "paper",
    status: "filled",
    side: "buy",
    optionType: "put",
    maxLoss: 1_600,
  });
});
