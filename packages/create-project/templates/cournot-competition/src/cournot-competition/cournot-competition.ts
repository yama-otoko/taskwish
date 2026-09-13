import { Actor, Anthropic } from "taskwish";
import { Model, Real } from "@taskwish/symbolic";

export const { actor } = Actor("CournotCompetition")
  .use(Anthropic)

  .scope(
    Real(
      "marketDemand",
      "producerACost",
      "producerBCost",
      "capacity",
      "outputA",
      "outputB",
      "marketPrice",
    ),

    Model(
      "cournotEquilibrium",

      ({ outputA }) => outputA >= 0,
      
      ({ outputB }) => outputB >= 0,

      ({ outputA, capacity }) => outputA <= capacity,

      ({ outputB, capacity }) => outputB <= capacity,

      ({ marketPrice, marketDemand, outputA, outputB }) =>
        marketPrice == marketDemand - outputA - outputB,

      // Each disjunction is a capacity-constrained best response: produce at
      // zero, at capacity, or where marginal profit is exactly zero.
      ({ outputA, outputB, marketDemand, producerACost, capacity }) =>
        (outputA == 0 &&
          marketDemand - producerACost - outputB <= 0) ||
        (outputA == capacity &&
          marketDemand - producerACost - 2 * outputA - outputB >= 0) ||
        (outputA > 0 &&
          outputA < capacity &&
          2 * outputA + outputB == marketDemand - producerACost),

      ({ outputA, outputB, marketDemand, producerBCost, capacity }) =>
        (outputB == 0 &&
          marketDemand - producerBCost - outputA <= 0) ||
        (outputB == capacity &&
          marketDemand - producerBCost - 2 * outputB - outputA >= 0) ||
        (outputB > 0 &&
          outputB < capacity &&
          outputA + 2 * outputB == marketDemand - producerBCost),
    ),
  );
