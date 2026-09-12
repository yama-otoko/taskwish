import { Step } from "taskwish";

import { bankDataRequest } from "../shared/gocardless";
import { actor } from "./open-banking";

type Requisition = {
  id: string;
  link: string;
  status: string | Record<string, unknown>;
  institution_id: string;
  reference: string;
  accounts: string[];
};

export const { startBankConnection } = actor()
  .on("Command", "startBankConnection")

  .input({
    institutionId: "string",
    redirectUrl: "string",
    "reference?": "string",
    "userLanguage?": "string",
  })

  .run(
    Step("validateConsentRequest", function () {
      const institutionId = this.input.institutionId.trim();
      if (!institutionId) throw new Error("institutionId is required.");

      let redirect: URL;
      try {
        redirect = new URL(this.input.redirectUrl);
      } catch {
        throw new Error("redirectUrl must be an absolute URL.");
      }
      const localHttp =
        redirect.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(redirect.hostname);
      if (redirect.protocol !== "https:" && !localHttp) {
        throw new Error("redirectUrl must use HTTPS (HTTP is allowed for localhost).");
      }

      const userLanguage = this.input.userLanguage?.trim().toUpperCase();
      if (userLanguage && !/^[A-Z]{2}$/.test(userLanguage)) {
        throw new Error("userLanguage must be a two-letter ISO 639-1 code.");
      }
      return {
        institutionId,
        redirect: redirect.toString(),
        reference: this.input.reference?.trim() || crypto.randomUUID(),
        userLanguage,
      };
    }),

    Step("createConsentLink", async function () {
      const request = this.validateConsentRequest;
      return bankDataRequest<Requisition>("/requisitions/", {
        method: "POST",
        body: JSON.stringify({
          redirect: request.redirect,
          institution_id: request.institutionId,
          reference: request.reference,
          ...(request.userLanguage
            ? { user_language: request.userLanguage }
            : {}),
        }),
      });
    }),
  )

  .meta({
    description:
      "Create a PSD2 consent link that redirects the user to their bank",
    input: {
      institutionId: {
        description: "Bank ID returned by listBanks",
        example: "SANDBOXFINANCE_SFIN0000",
      },
      redirectUrl: {
        description: "Application URL to receive the user after bank consent",
        example: "http://localhost:3000/banking/callback",
      },
      reference: {
        description: "Your opaque connection reference; a UUID is generated if omitted",
        example: "customer-42-bank-1",
      },
      userLanguage: {
        description: "Optional two-letter consent-flow language",
        example: "EN",
      },
    },
  });
