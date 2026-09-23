import { buyPut } from "./buy-put";
import { actor } from "./paper-broker";

export const { PaperBroker } = actor().service({ buyPut });
