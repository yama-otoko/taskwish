import { actor } from "./beeper";
import { callBeeperApi } from "./call-beeper-api";
import { connectIntegration } from "./connect-integration";
import { continueIntegrationLogin } from "./continue-integration-login";
import { discoverIntegrations } from "./discover-integrations";
import { searchChats } from "./search-chats";
import { searchMessages } from "./search-messages";
import { sendMessage } from "./send-message";

export const { Beeper } = actor().service({
  discoverIntegrations,
  connectIntegration,
  continueIntegrationLogin,
  searchChats,
  searchMessages,
  sendMessage,
  callBeeperApi,
});
