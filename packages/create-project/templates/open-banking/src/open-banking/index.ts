import { listBanks } from "./list-banks";
import { actor } from "./open-banking";
import { startBankConnection } from "./start-bank-connection";
import { syncBankConnection } from "./sync-bank-connection";

export const { OpenBanking } = actor().service({
  listBanks,
  startBankConnection,
  syncBankConnection,
});
