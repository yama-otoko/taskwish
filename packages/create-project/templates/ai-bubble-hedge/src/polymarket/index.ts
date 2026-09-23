import { getAiBubbleMarket } from "./get-ai-bubble-market";
import { actor } from "./polymarket";

export const { Polymarket } = actor().service({ getAiBubbleMarket });
