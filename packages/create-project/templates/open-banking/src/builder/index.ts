import { actor } from "./builder";
import { chat } from "./chat";

export const { Builder } = actor().service({ chat });

