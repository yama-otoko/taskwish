import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";

const packageDirectory = join(import.meta.dir, "..");
const templatesDirectory = join(packageDirectory, "templates");
const PROJECT_SKILL_PATH = ".agents/skills/taskwish/SKILL.md";
const templatesPlaceholder =
  /((?:const|var) EMBEDDED_TEMPLATE_FILES(?:\s*:\s*Readonly<Record<string, string>>)?\s*=\s*)\{\}/;
const skillPlaceholder =
  /((?:const|var) EMBEDDED_SKILL(?:\s*:\s*string)?\s*=\s*)["']{2}/;
const bareAction = join(
  packageDirectory,
  ".bare",
  "scaffolder",
  "create-project.ts"
);
const standaloneEntry = join(
  packageDirectory,
  ".bare",
  "create-taskwish-project.ts"
);
const platformBuilds = [
  ["darwin-arm64", undefined],
  ["darwin-x64", "x86_64-macos"],
  ["linux-arm64", "aarch64-linux-gnu.2.36"],
  ["linux-x64", "x86_64-linux-gnu.2.36"],
  ["linux-x64-musl", "x86_64-linux-musl"],
  ["windows-arm64.exe", "aarch64-windows-gnu"],
  ["windows-x64.exe", "x86_64-windows-gnu"],
] as const satisfies ReadonlyArray<readonly [string, string | undefined]>;

if (process.argv.includes("--platforms")) {
  await prepareStandaloneEntry();
  await buildPlatformExecutables();
} else {
  await buildNodeEntrypoint();
}

async function buildNodeEntrypoint(): Promise<void> {
  const executable = join(
    packageDirectory,
    "dist",
    "create-taskwish-project.mjs"
  );
  await mkdir(join(packageDirectory, "dist"), { recursive: true });

  const result = await Bun.build({
    entrypoints: [join(packageDirectory, "create-taskwish-project.ts")],
    target: "node",
    format: "esm",
    packages: "external",
    outdir: join(packageDirectory, "dist"),
    naming: "create-taskwish-project.mjs",
  });

  if (!result.success) {
    throw new AggregateError(
      result.logs,
      `Could not build the Node create-project CLI.`
    );
  }

  const embeddedTemplateFiles = await readTemplateFiles(templatesDirectory);
  const embeddedSkill = await readFile(
    join(packageDirectory, "..", "skill", "SKILL.md"),
    "utf8",
  );
  await embedAssets(executable, embeddedTemplateFiles, embeddedSkill);
  await Promise.all([
    embedAssetsIfPresent(
      join(packageDirectory, "dist", "index.mjs"),
      embeddedTemplateFiles,
      embeddedSkill,
    ),
    embedAssetsIfPresent(
      join(packageDirectory, "dist", "index.cjs"),
      embeddedTemplateFiles,
      embeddedSkill,
    ),
  ]);
  await chmod(executable, 0o755);
}

async function prepareStandaloneEntry(): Promise<void> {
  await Bun.$`bare create-taskwish-project`;

  const source = await readFile(bareAction, "utf8");
  const windImport = /import\s*\{[^}]*\}\s*from\s*["']@taskwish\/wind["'];/;

  if (!windImport.test(source)) {
    throw new Error(`Bare output did not contain the expected Wind import.`);
  }

  const staticWind = `class Wind {
  trace(_path: string, _data: unknown): void {}
}`;
  const embeddedTemplateFiles = await readTemplateFiles(templatesDirectory);
  const embeddedSkill = await readFile(
    join(packageDirectory, "..", "skill", "SKILL.md"),
    "utf8",
  );
  const standaloneSource = replaceEmbeddedAssets(
    source.replace(windImport, staticWind),
    embeddedTemplateFiles,
    embeddedSkill,
  );

  await writeFile(bareAction, standaloneSource);

  const entrySource = await readFile(standaloneEntry, "utf8");
  const logoImport =
    /import\s*\{\s*taskwishLogo\s*\}\s*from\s*["']@taskwish\/terminal["'];/;

  if (!logoImport.test(entrySource)) {
    throw new Error(`Bare output did not contain the expected terminal import.`);
  }

  await writeFile(
    standaloneEntry,
    entrySource.replace(logoImport, standaloneLogoSource()),
  );
}

function standaloneLogoSource(): string {
  return `const TASKWISH_LOGO = \`
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣷⣄
⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⠟
⣠⣾⣷⣄⠀⠀⠀⣠⣾⣿⣿⣿⡿⠋⠀⢀⣴⣿⣦⡀⠀⠀⢀⣴⣿⣿⣿⣿⠟⠁⠀
⠻⣿⣿⣿⣷⣤⣾⣿⣿⣿⡿⠋⠀⠀⠀⠙⢿⣿⣿⣿⣦⣴⣿⣿⣿⣿⠟⠁⠀⠀⠀
⠀⠈⠻⣿⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠀
⠀⠀⠀⠈⠻⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⠟
\`;

function taskwishLogo(_color = true): string {
  return TASKWISH_LOGO;
}`;
}

async function embedAssets(
  output: string,
  embeddedTemplateFiles: Readonly<Record<string, string>>,
  embeddedSkill: string,
): Promise<void> {
  const source = await readFile(output, "utf8");
  await writeFile(
    output,
    replaceEmbeddedAssets(source, embeddedTemplateFiles, embeddedSkill),
  );
}

async function embedAssetsIfPresent(
  output: string,
  embeddedTemplateFiles: Readonly<Record<string, string>>,
  embeddedSkill: string,
): Promise<void> {
  try {
    const source = await readFile(output, "utf8");
    if (
      !templatesPlaceholder.test(source) &&
      !skillPlaceholder.test(source)
    ) {
      return;
    }
    await writeFile(
      output,
      replaceEmbeddedAssets(source, embeddedTemplateFiles, embeddedSkill),
    );
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}

function replaceEmbeddedAssets(
  source: string,
  embeddedTemplateFiles: Readonly<Record<string, string>>,
  embeddedSkill: string,
): string {
  if (!templatesPlaceholder.test(source)) {
    throw new Error(`Build output did not contain the templates placeholder.`);
  }
  if (!skillPlaceholder.test(source)) {
    throw new Error(`Build output did not contain the skill placeholder.`);
  }

  return source
    .replace(
      templatesPlaceholder,
      (_, declaration: string) =>
        `${declaration}${JSON.stringify(embeddedTemplateFiles)}`,
    )
    .replace(
      skillPlaceholder,
      (_, declaration: string) =>
        `${declaration}${JSON.stringify(embeddedSkill)}`,
    );
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function buildPlatformExecutables(): Promise<void> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(
      `Platform builds currently require a macOS ARM64 host; received ${process.platform}-${process.arch}.`,
    );
  }
  if (!Bun.which("clang")) {
    throw new Error(
      `Platform builds require clang from Xcode Command Line Tools.`,
    );
  }
  if (!Bun.which("zig")) {
    throw new Error(`Platform builds require Zig: brew install zig`);
  }

  const outputDirectory = join(packageDirectory, "platforms");
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  for (const [platform, target] of platformBuilds) {
    const executable = join(
      outputDirectory,
      `create-taskwish-project-${platform}`
    );
    console.log(`Building create-project for ${platform}...`);
    const child = Bun.spawn(
      ["scriptc", "build", standaloneEntry, "--no-keep-c", "-o", executable],
      {
        cwd: packageDirectory,
        env: {
          ...process.env,
          ...(target ? { SCRIPTC_CC: "zigcc", SCRIPTC_TARGET: target } : {}),
        },
        stdout: "inherit",
        stderr: "inherit",
      },
    );

    if ((await child.exited) !== 0) {
      throw new Error(
        `Could not build the create-project CLI for ${platform}.`,
      );
    }

    const executableSize = (await stat(executable)).size;
    if (executableSize === 0) {
      throw new Error(`Built an empty create-project CLI for ${platform}.`);
    }
  }
}

async function readTemplateFiles(
  directory: string
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  await visit(directory);
  return files;

  async function visit(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const path = join(currentDirectory, entry.name);
      const embeddedPath = relative(directory, path).split(sep).join("/");
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === "playwright-report" ||
          entry.name === "test-results"
        ) {
          continue;
        }
        if (entry.name === "state" && embeddedPath.split("/").length === 2) {
          continue;
        }
        await visit(path);
      } else if (
        entry.isFile() &&
        entry.name !== "bun.lock" &&
        entry.name !== ".DS_Store"
      ) {
        if (embeddedPath.endsWith(`/${PROJECT_SKILL_PATH}`)) continue;
        files[embeddedPath] = await readFile(path, "utf8");
      }
    }
  }
}
