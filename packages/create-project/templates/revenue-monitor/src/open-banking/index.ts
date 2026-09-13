import { getAccountRevenue } from "./get-account-revenue";
import { actor } from "./open-banking";

export const { OpenBanking } = actor().service({ getAccountRevenue });
