import type { Metadata } from "next";
import { Console } from "@taskwish/console/react";
import "@taskwish/console/styles.css";
import { consoleDemoConfig } from "../../src/console-demo-config";

export const metadata: Metadata = {
  title: "TaskWish Console preview",
  robots: { index: false, follow: false },
};

export default function ConsoleDemoPage() {
  return (
    <div className="console-demo-page">
      <style>{`
        body:has(.console-demo-page) > header,
        body:has(.console-demo-page) > footer { display: none; }
        .console-demo-page > main { padding-top: 6rem; }
        body:has(.console-demo-page) { --primary-foreground: 0 0% 100%; color-scheme: light; }
        body:has(.console-demo-page) button.bg-primary,
        body:has(.console-demo-page) button.bg-black,
        body:has(.console-demo-page) button[type="submit"],
        body:has(.console-demo-page) button[data-state="on"] { color: #fff !important; }
        body:has(.console-demo-page) .is-user .text-primary-foreground { color: #fff !important; }
        body:has(.console-demo-page) pre { color: #111 !important; }
        body:has(.console-demo-page) select,
        body:has(.console-demo-page) select option { background: #fff !important; color: #111 !important; }
        body:has(.console-demo-page) input[type="checkbox"] { accent-color: #111; background: #fff; }
        html[data-theme="dark"] body:has(.console-demo-page) {
            --neutral-background: 0 0% 40%;
            --background: 220 10% 8%;
            --foreground: 210 10% 94%;
            --card: 220 9% 11%;
            --card-foreground: 210 10% 94%;
            --popover: 220 9% 11%;
            --popover-foreground: 210 10% 94%;
            --primary: 160 100% 45%;
            --primary-foreground: 160 40% 4%;
            --secondary: 220 8% 16%;
            --secondary-foreground: 210 10% 92%;
            --muted: 220 8% 14%;
            --muted-foreground: 215 8% 64%;
            --accent: 220 8% 16%;
            --accent-foreground: 210 10% 94%;
            --border: 220 8% 23%;
            --input: 220 8% 20%;
            --ring: 160 100% 45%;
            --panelbg: 220 9% 10%;
            --neutral-400: 215 7% 55%;
            --neutral-200: 220 8% 22%;
            --action: 220 8% 14%;
            --shadow: 0 1px 3px rgb(0, 0, 0, .3);
            color-scheme: dark;
        }
        html[data-theme="dark"] body:has(.console-demo-page) button.bg-primary,
        html[data-theme="dark"] body:has(.console-demo-page) button.bg-black,
        html[data-theme="dark"] body:has(.console-demo-page) button[type="submit"],
        html[data-theme="dark"] body:has(.console-demo-page) button[data-state="on"],
        html[data-theme="dark"] body:has(.console-demo-page) .is-user .text-primary-foreground { color: #07110e !important; }
        html[data-theme="dark"] body:has(.console-demo-page) pre { color: #f0f2f4 !important; }
        html[data-theme="dark"] body:has(.console-demo-page) select,
        html[data-theme="dark"] body:has(.console-demo-page) select option { background: #14171b !important; color: #f0f2f4 !important; }
        html[data-theme="dark"] body:has(.console-demo-page) input[type="checkbox"] { accent-color: #00e6a8; background: #14171b; }
        html[data-theme="dark"] body:has(.console-demo-page) .mo-bob > g:first-child {
          fill: transparent !important;
          stroke: hsl(var(--neutral-background)) !important;
          stroke-width: 2px;
          stroke-opacity: 1 !important;
          opacity: 1 !important;
          filter: drop-shadow(0 0 1px #fff);
        }
        html[data-theme="dark"] body:has(.console-demo-page) .mo-eyes path {
          fill: hsl(var(--neutral-background)) !important;
          fill-opacity: 1 !important;
          opacity: 1 !important;
        }
      `}</style>
      <Console
        config={consoleDemoConfig}
        autoFocus={false}
        showMcpServer
      />
    </div>
  );
}
