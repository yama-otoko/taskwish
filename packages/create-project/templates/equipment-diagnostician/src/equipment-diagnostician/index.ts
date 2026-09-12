import { diagnoseReport } from "./diagnose-report";
import { actor } from "./equipment-diagnostician";

export const { EquipmentDiagnostician } = actor().service({ diagnoseReport });
