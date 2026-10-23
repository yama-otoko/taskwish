"use client";

import dynamic from "next/dynamic";
import { consoleDemoConfig } from "./console-demo-config";

const Console = dynamic(
  () => import("@taskwish/console/react").then((module) => module.Console),
  { ssr: false },
);

export function ConsoleDemoApp() {
  return (
    <Console
      config={consoleDemoConfig}
      autoFocus={false}
      showMcpServer
    />
  );
}
