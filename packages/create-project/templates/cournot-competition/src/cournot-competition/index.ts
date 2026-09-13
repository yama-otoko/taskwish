import { analyzeCompetition } from "./analyze-competition";
import { actor } from "./cournot-competition";

export const { CournotCompetition } = actor().service({ analyzeCompetition });
