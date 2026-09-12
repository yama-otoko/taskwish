import { Actor, Provider } from "taskwish";
import { Model, Real } from "@taskwish/symbolic";

export const openAIModel = process.env.OPENAI_MODEL || "gpt-6-astra";

const { OpenAI } = Provider("OpenAI", {
  baseURL: "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY,
  models: [openAIModel],
});

export const { actor } = Actor("OptionsAnalyst")
  .use(OpenAI)

  .scope(
    Real(
      "S",
      "K",
      "r",
      "sigma",
      "tau",
      "sqrtTau",
      "logMoneyness",
      "discount",
      "densityD1",
      "cdfD1",
      "cdfD2",
      "d1",
      "d2",
      "price",
      "delta",
      "gamma",
      "vega",
      "theta",
      "rho",
    ),

    Model(
      "dTermsFormula",
      ({ d1, logMoneyness, r, sigma, tau, sqrtTau }) =>
        d1 ==
        (logMoneyness + (r + (sigma * sigma) / 2) * tau) /
          (sigma * sqrtTau),
          
      ({ d1, d2, sigma, sqrtTau }) => d2 == d1 - sigma * sqrtTau,
    ),

    Model(
      "greeksFormula",
      ({ price, S, cdfD1, K, discount, cdfD2 }) =>
        price == S * cdfD1 - K * discount * cdfD2,

      ({ delta, cdfD1 }) => delta == cdfD1,

      ({ gamma, densityD1, S, sigma, sqrtTau }) =>
        gamma == densityD1 / (S * sigma * sqrtTau),

      ({ vega, S, densityD1, sqrtTau }) =>
        vega == S * densityD1 * sqrtTau,

      ({
        theta,
        S,
        densityD1,
        sigma,
        sqrtTau,
        r,
        K,
        discount,
        cdfD2,
      }) =>
        theta ==
        -(S * densityD1 * sigma) / (2 * sqrtTau) -
          r * K * discount * cdfD2,

      ({ rho, K, tau, discount, cdfD2 }) =>
        rho == K * tau * discount * cdfD2,
    ),
  );
