import { evaluateAiBubbleHedge } from "./evaluate-ai-bubble-hedge";
import { actor } from "./ai-bubble-hedge";

export const { AiBubbleHedge } = actor().service({ evaluateAiBubbleHedge });
