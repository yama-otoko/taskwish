import { ArrowRight, GitBranch, Network, Repeat2, Terminal } from "lucide-react";
import Image from "next/image";
import { ConsoleDemo } from "./console-demo";
import { CopyButton } from "./copy-button";

const installCommand = "curl -fsSL https://taskwish.ai/create-project.sh | bash";
const packageCommand = "bunx @taskwish/create-project";

export function Landing() {
  return (
    <main className="minimal-landing">
      <section className="console-hero minimal-shell">
        <div className="console-hero-copy">
          <span className="framework-label">Open-source TypeScript framework</span>
          <h1>TaskWish <span>—</span> The framework for building autonomous companies.</h1>
          <p>Build apps for the agentic era as typed actors with tools, state, and agents. Designed to be discovered, called, and composed by other agents.</p>
        </div>
        <ConsoleDemo />
      </section>

      <section className="workflow-examples" id="use-cases">
        <div className="minimal-shell">
          <div className="examples-heading">
            <span>Use Cases</span>
            <h2>Common agent patterns, expressed as code.</h2>
            <p>Start from a working workflow, then replace the actors, tools, and models with your own.</p>
          </div>
          <div className="diagram-grid">
            <WorkflowCard icon={<Repeat2 />} title="ReAct loop" command="agent-loops">
              <Node label="Observe" tone="green" /><Connector /><Node label="Think" /><Connector /><Node label="Act" tone="blue" /><LoopBack label="repeat" />
            </WorkflowCard>
            <WorkflowCard icon={<Network />} title="Supervisor + workers" command="agent-graphs">
              <Node label="Manager" tone="blue" /><Branch /><div className="worker-stack"><Node label="Research" /><Node label="Build" /><Node label="Review" /></div>
            </WorkflowCard>
            <WorkflowCard icon={<GitBranch />} title="Event-driven company" command="software-factory">
              <Node label="GitHub" /><Connector /><Node label="Coding agent" tone="green" /><Connector /><Node label="Review agent" tone="blue" />
            </WorkflowCard>
          </div>
        </div>
      </section>

      <section className="wizard-section" aria-labelledby="wizard-title">
        <div className="minimal-shell wizard-inner">
          <Image className="wizard-illustration" src="/wizard.svg" alt="TaskWish Wizard holding a blue-tipped magic wand" width={512} height={512} />
          <div className="wizard-copy">
            <span className="wizard-status">Coming soon</span>
            <h2 id="wizard-title">Access Wizard soon on <a href="https://cloud.taskwish.ai">cloud.taskwish.ai</a></h2>
          </div>
        </div>
      </section>

      <section className="install-section-final" id="install" aria-labelledby="install-title">
        <div className="minimal-shell install-final-inner">
          <div className="install-final-copy">
            <span>Start here</span>
            <h2 id="install-title">Create a TaskWish project.</h2>
            <p>The installer selects the right CLI for your platform, lets you choose a starter, installs its dependencies, and initializes Git.</p>
          </div>
          <div>
            <div className="install-command">
              <Terminal size={18} aria-hidden="true" />
              <code>{installCommand}</code>
              <CopyButton value={installCommand} />
            </div>
            <div className="install-alt">
              <span>Or use</span>
              <code>{packageCommand}</code>
              <CopyButton value={packageCommand} />
            </div>
            <a className="install-docs-link" href="/docs">Read the installation guide <ArrowRight size={15} /></a>
          </div>
        </div>
      </section>
    </main>
  );
}

function WorkflowCard({ icon, title, command, children }: { icon: React.ReactNode; title: string; command: string; children: React.ReactNode }) {
  const sourceUrl = `https://github.com/yama-otoko/taskwish/tree/main/packages/create-project/templates/${command}`;

  return <article className="workflow-card"><div className="workflow-card-head"><span>{icon}</span><h3>{title}</h3><code>{command}</code></div><div className="mini-diagram">{children}</div><a className="workflow-card-link" href={sourceUrl} target="_blank" rel="noreferrer">Explore this use case <ArrowRight size={13} /></a></article>;
}

function Node({ label, tone = "plain" }: { label: string; tone?: "plain" | "green" | "blue" }) {
  return <span className={`diagram-node ${tone}`}>{label}</span>;
}

function Connector() { return <span className="diagram-connector"><ArrowRight size={13} /></span>; }
function LoopBack({ label }: { label: string }) { return <span className="loop-back"><Repeat2 size={12} />{label}</span>; }
function Branch() { return <span className="diagram-branch" />; }
