import { revenueMonitor } from "./monitor-revenue-on-schedule";
import { actor } from "./revenue-monitor";

export const { RevenueMonitor } = actor().service({ revenueMonitor });
