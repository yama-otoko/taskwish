import { indent } from "./syntax";
import type { ActionSpec, ServiceSpec } from "./types";

export function printAction(
  action: ActionSpec,
  options: { metadata?: boolean } = {},
): string {
  if (action.steps.length === 0) {
    throw new Error(
      `${action.actorName}.${action.actionName} has no Step calls.`
    );
  }

  const actionEventName = `${action.actorName}::${action.actionName}`;
  const ctxName = `${action.actionName}Ctx`;
  const interfaceName = `${upperFirst(action.actionName)}Action`;
  const scopeTypeName = `${upperFirst(action.actionName)}Scope`;
  const scopePatchTypeName = `${upperFirst(action.actionName)}ScopePatch`;
  const parameterText = action.inputType ? `input: ${action.inputType}` : "";
  const inputArgText = action.inputType ? "input" : "";
  const usesAbortSignal = action.steps.some((step) => step.usesAbortSignal);
  const returnTypeText = action.steps.at(-1)!.propertyType;
  const scopeTypeProperties = [
    `wind: Wind`,
    usesAbortSignal ? `abortSignal: AbortSignal | undefined` : null,
    action.actionDependencies.length > 0
      ? `actions: { ${action.actionDependencies
          .map((dependency) => printActionDependencyType(dependency))
          .join("; ")} }`
      : null,
  ].filter((property): property is string => property !== null);
  const initialScopeProperties = [
    `wind`,
    usesAbortSignal ? `abortSignal: undefined as AbortSignal | undefined` : null,
    action.actionDependencies.length > 0
      ? `actions: { ${action.actionDependencies
          .map((dependency) => printActionDependencyDefault(dependency))
          .join(", ")} }`
      : null,
  ].filter((property): property is string => property !== null);
  const initialScopeText = `{ ${initialScopeProperties.join(", ")} }`;
  const scopeReferenceName = "scope";
  const lines: string[] = [
    `interface ${interfaceName} {`,
    `  (${parameterText}): Promise<${returnTypeText}>;`,
    `  run(${parameterText}): Promise<${returnTypeText}>;`,
    `  stream(${parameterText}): Promise<${returnTypeText}>;`,
    options.metadata === false
      ? null
      : `  __taskwish: { name: string; meta: unknown; inputSchema: unknown };`,
    `}`,
    ``,
    `type ${scopeTypeName} = { ${scopeTypeProperties.join("; ")} };`,
    `type ${scopePatchTypeName} = { ${printScopePatchTypeProperties(action).join("; ")} };`,
    ``,
    `export const ${action.actionName} = async function ${action.actionName}(${parameterText}) {`,
    `    return ${ctxName}().run(${inputArgText});`,
    `  } as ${interfaceName};`,
    `${action.actionName}.run = ${ctxName}().run;`,
    `${action.actionName}.stream = ${ctxName}().stream;`,
    ...(options.metadata === false
      ? []
      : [
          `export const ${action.actionName}Metadata = {`,
          `  name: "${actionEventName}",`,
          `  meta: ${action.metaText ?? "null"},`,
          `  inputSchema: ${action.inputSchemaText ?? "undefined"}`,
          `};`,
          `${action.actionName}.__taskwish = ${action.actionName}Metadata;`,
        ]),
    ``,
    `function ${ctxName}(ctx: ${scopePatchTypeName} = {}) {`,
    `  const wind = new Wind();`,
    `  const initialScope: ${scopeTypeName} = ${initialScopeText};`,
    `  const ${scopeReferenceName}: ${scopeTypeName} = initialScope;`,
    ...printScopePatchLines(action, scopeReferenceName),
    ``,
    `  async function run(${parameterText}) {`,
    `    return stream(${inputArgText});`,
    `  }`,
    ``,
    `  async function stream(${parameterText}) {`,
    action.inputType ? null : `    const input = undefined;`,
    ...(usesAbortSignal
      ? [
          `    const abortSignal = ${scopeReferenceName}.abortSignal as AbortSignal | undefined;`,
        ]
      : []),
    ``,
    `    scope.wind.trace("${actionEventName}", { input });`,
    ``,
  ].filter((line): line is string => line !== null);

  for (const step of action.steps) {
    if (step.directExpressionText !== null) {
      const expressionText = scopeText(
        step.directExpressionText,
        scopeReferenceName
      );

      lines.push(
        `    const ${step.name} = ${step.usesSignal ? `${expressionText} as Record<string, unknown>` : expressionText};`
      );
    } else {
      lines.push(`    let ${step.name}: ${step.propertyType};`);
      lines.push(step.useBreakBlock ? `    ${step.name}Block: {` : "    {");
      lines.push(indent(scopeText(step.blockText, scopeReferenceName), 6));
      lines.push("    }");
    }
    lines.push("");
    lines.push(
      `    scope.wind.trace("${actionEventName}.${step.name}", { result: ${step.name} });`
    );
    lines.push("");
  }

  const lastStep = action.steps.at(-1)!;
  lines.push(
    `    scope.wind.trace("${actionEventName}", { result: ${lastStep.name} });`
  );
  lines.push("");
  lines.push(`    return ${lastStep.name};`);
  lines.push("  }");
  lines.push("");
  lines.push("  return { run, stream };");
  lines.push("}");

  if (action.listenEventName !== null) {
    lines.push("");
    lines.push(`addListener("${action.listenEventName}", ${action.actionName});`);
  }

  return lines.join("\n");
}

function scopeText(value: string, scopeReferenceName: string): string {
  return scopeReferenceName === "scope"
    ? value
    : value.replace(/\bscope\./g, `${scopeReferenceName}.`);
}

function upperFirst(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function printActionDependencyDefault(
  dependency: import("./types").ActionDependency,
): string {
  return `${dependency.scopeName}: { ${dependency.actionNames
    .map((actionName) => `${actionName}: ${dependency.identifier}.${actionName}`)
    .join(", ")} }`;
}

function printActionDependencyType(
  dependency: import("./types").ActionDependency,
): string {
  return `${dependency.scopeName}: { ${dependency.actionNames
    .map((actionName) => `${actionName}: typeof ${dependency.identifier}.${actionName}`)
    .join("; ")} }`;
}

function printScopePatchTypeProperties(action: ActionSpec): string[] {
  const properties = [
    `wind?: Wind`,
    action.steps.some((step) => step.usesAbortSignal)
      ? `abortSignal?: AbortSignal | undefined`
      : null,
    action.actionDependencies.length > 0
      ? `actions?: { ${action.actionDependencies
          .map((dependency) => printActionDependencyPatchType(dependency))
          .join("; ")} }`
      : null,
  ];

  return properties.filter((property): property is string => property !== null);
}

function printActionDependencyPatchType(
  dependency: import("./types").ActionDependency,
): string {
  return `${dependency.scopeName}?: { ${dependency.actionNames
    .map((actionName) => `${actionName}?: typeof ${dependency.identifier}.${actionName}`)
    .join("; ")} }`;
}

function printScopePatchLines(
  action: ActionSpec,
  scopeReferenceName: string,
): string[] {
  const lines = [
    `  if (ctx.wind !== undefined) ${scopeReferenceName}.wind = ctx.wind;`,
  ];

  if (action.steps.some((step) => step.usesAbortSignal)) {
    lines.push(
      `  if (ctx.abortSignal !== undefined) ${scopeReferenceName}.abortSignal = ctx.abortSignal;`,
    );
  }

  if (action.actionDependencies.length > 0) {
    lines.push(`  if (ctx.actions !== undefined) {`);

    for (const dependency of action.actionDependencies) {
      lines.push(`    if (ctx.actions.${dependency.scopeName} !== undefined) {`);

      for (const actionName of dependency.actionNames) {
        lines.push(
          `      if (ctx.actions.${dependency.scopeName}.${actionName} !== undefined) ${scopeReferenceName}.actions.${dependency.scopeName}.${actionName} = ctx.actions.${dependency.scopeName}.${actionName};`,
        );
      }

      lines.push(`    }`);
    }

    lines.push(`  }`);
  }

  return lines;
}

export function printService(service: ServiceSpec): string {
  const lines = [`export const ${service.serviceName} = {`];

  for (const [index, actionName] of service.actionNames.entries()) {
    const separator = index === service.actionNames.length - 1 ? "" : ",";
    lines.push(`  ${actionName}${separator}`);
  }

  lines.push("};");

  return lines.join("\n");
}
