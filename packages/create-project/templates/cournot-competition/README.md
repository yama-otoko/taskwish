# TaskWish Cournot competition

A game-theory starter for analyzing two producers that choose output
simultaneously under shared market demand and individual unit costs.

`@taskwish/symbolic` encodes both capacity-constrained best responses and asks
Z3 for their intersection: a Nash equilibrium. Claude then explains that
verified result without owning or changing the calculation.

## Run

Install [Z3](https://github.com/Z3Prover/z3), then configure Anthropic:

```sh
cp .env.example .env
# Add TW_ANTHROPIC_KEY to .env
bun install
bun start
```

Open the Console URL and run `CournotCompetition.analyzeCompetition`. The
default values represent a market with demand intercept 120, unit costs 18 and
24, and a capacity of 60 units per producer.

```sh
bun test
bun run check
```

## Assumptions

- Both producers choose output simultaneously and independently.
- Inverse demand is linear: `price = marketDemand - outputA - outputB`.
- Unit costs are constant and both producers share the same capacity limit.
- The example is a static educational model, not pricing advice. It must not be
  used to coordinate decisions between real competitors.
