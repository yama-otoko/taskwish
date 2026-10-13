import type { Viewport } from "next";
import { Landing } from "../src/landing";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
  ],
};

export default function HomePage() {
  return <Landing />;
}
