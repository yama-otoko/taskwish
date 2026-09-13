import { Actor, OpenAI } from "taskwish";

export const { actor } = Actor("LoadExtractor").use(OpenAI);
