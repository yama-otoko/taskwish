# TaskWish options analyst

An educational European call-option workflow that separates three jobs:

1. TypeScript evaluates the transcendental boundary functions that Z3 does not
   natively provide: `log`, `exp`, the normal density, and the normal CDF.
2. `@taskwish/symbolic` asks Z3 to solve `d1`, `d2`, theoretical price, and all
   five Greeks from the formula constraints.
3. An OpenAI-backed TaskWish Agent turns the verified snapshot into a concise
   risk memo and scenario explanation.

The Options Industry Council describes Greeks as theoretical guideposts rather
than guarantees, and Cboe's educational calculator similarly presents model
prices and Greeks as educational information. This starter therefore does not
fetch live prices, recommend trades, or let the model alter calculated values.

## Run

Install [Z3](https://github.com/Z3Prover/z3), then configure OpenAI:

```sh
cp .env.example .env
# Add TW_OPEN_AI_KEY to .env
bun install
bun start
```

Open the Console URL and run `OptionsAnalyst.analyzeCall`. The default example
is a one-year at-the-money European call with 20% annualized volatility.

```sh
bun test
bun run check
```

## Assumptions and units

- European call, no dividends, continuous compounding, and 365 days per year.
- `rate` and `volatility` are decimals (`0.05` means 5%).
- `vegaPerPoint` estimates the per-share change for a one percentage-point
  volatility move; `rhoPerPoint` does the same for rates.
- `thetaPerDay` is calendar-day decay. Contract exposure assumes 100 shares per
  contract.
- The scenario estimate uses delta-gamma approximation and is not a repricing.

Sources: [Options Industry Council: Understanding Options Greeks](https://www.optionseducation.org/advancedconcepts/understanding-options-greeks),
[Cboe Options Calculator](https://www.cboe.com/education/tools/options-calculator/),
and [OpenAI Responses API reference](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create).

This project is for software demonstration and education, not investment
advice. Options involve risk and are not suitable for every investor.
