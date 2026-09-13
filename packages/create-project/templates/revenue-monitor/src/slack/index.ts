import { postMessage } from "./post-message";
import { actor } from "./slack";

export const { Slack } = actor().service({ postMessage });
