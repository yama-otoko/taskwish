import { Step } from "taskwish";

import { bankDataRequest } from "../shared/gocardless";
import { actor } from "./open-banking";

type Institution = {
  id: string;
  name: string;
  bic?: string;
  logo?: string;
  countries?: string[];
};

export const { listBanks } = actor()
  .on("Command", "listBanks")

  .input({ country: "string" })

  .run(
    Step("validateCountry", function () {
      const country = this.input.country.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) {
        throw new Error("country must be a two-letter ISO 3166 country code.");
      }
      return country;
    }),

    Step("loadInstitutions", async function () {
      return bankDataRequest<Institution[]>(
        `/institutions/?country=${encodeURIComponent(this.validateCountry)}`,
      );
    }),
  )

  .meta({
    description: "List banks available through GoCardless Bank Account Data",
    input: {
      country: {
        description: "Two-letter ISO 3166 country code",
        example: "DE",
      },
    },
  });
