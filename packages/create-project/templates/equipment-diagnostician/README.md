# TaskWish neuro-symbolic equipment diagnostician

This starter demonstrates a complete neuro-symbolic loop over an unstructured
maintenance report:

1. A structured-output OpenAI Agent acts as the neural perception layer. It
   extracts only observable facts and marks each one `present`, `absent`,
   `unknown`, or `conflicted`.
2. `@taskwish/symbolic` maps those observations into Z3 constraints. The solver
   derives electrical-fault, mechanical-jam, airflow-obstruction, urgent-stop,
   inconsistent-evidence, and unresolved-diagnosis flags from explicit rules.
3. A second OpenAI Agent explains the verified result without changing it.

The key boundary is deliberate: the language model interprets messy language,
while deterministic symbolic rules own the diagnosis. Missing evidence does not
silently become negative evidence, and conflicting statements force inspection.

## Run

Install [Z3](https://github.com/Z3Prover/z3), then configure OpenAI:

```sh
cp .env.example .env
# Add OPENAI_API_KEY to .env
bun install
bun start
```

Open the Console URL and run `EquipmentDiagnostician.diagnoseReport` with a
technician note such as:

> The fan motor starts and hums, but the shaft does not turn. No burning smell
> was noticed.

```sh
bun test
bun run check
```

## Extend the example

Add observations to `src/shared/observations.ts`, declare their known/value/
conflict flags in the actor scope, then add a constraint to `diagnosisRules`.
Keep raw report interpretation in the perception Agent and safety-relevant
decisions in auditable symbolic rules.

This starter is a software demonstration, not a replacement for equipment
manuals, lockout/tagout procedures, or qualified maintenance personnel.
