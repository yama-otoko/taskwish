import { Actor } from "taskwish";
import { Function, Model, Real } from "@taskwish/symbolic";

import { OpenBanking } from "../open-banking";
import { Slack } from "../slack";

export const { actor } = Actor("RevenueMonitor")
  .use(OpenBanking, Slack)

  .scope(
    Real("t", "y"),

    Function("sin", "Real", "Real"),

    Model(
      "growth",

      // Z3 functions are otherwise uninterpreted. This constraint gives sin
      // a deterministic seventh-order approximation at the requested point.
      ({ sin, t }) => sin(t) == t - t ** 3 / 6 + t ** 5 / 120 - t ** 7 / 5040,

      ({ y, t, sin }) => y == t / 2 + sin(t),
    ),
  );
