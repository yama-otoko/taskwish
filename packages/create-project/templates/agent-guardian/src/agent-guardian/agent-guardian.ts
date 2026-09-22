import { Actor } from "taskwish";

import { TypeSafe } from "../typesafe";

export const { actor } = Actor("AgentGuardian").use(TypeSafe);
