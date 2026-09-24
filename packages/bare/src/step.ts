import { Node, SyntaxKind } from "ts-morph";

import { inferFunctionReturn } from "./infer";
import {
  belongsToFunction,
  isDirectFinalReturn,
  normalizeBlock,
  ownReturnStatements,
  unwrapExpression,
} from "./syntax";
import type { StepSpec } from "./types";

export function parseStep(node: Node): StepSpec | null {
  const call = unwrapExpression(node);
  if (!Node.isCallExpression(call)) return null;

  const expression = unwrapExpression(call.getExpression());
  if (!Node.isIdentifier(expression) || expression.getText() !== "Step") {
    return null;
  }

  const [nameArg, handlerArg] = call.getArguments();
  if (!nameArg || !Node.isStringLiteral(nameArg) || !handlerArg) return null;

  const handler = Array.isArray(handlerArg)
    ? null
    : unwrapExpression(handlerArg);
  if (!handler || !Node.isFunctionExpression(handler)) return null;

  return parseFunctionStep(nameArg.getLiteralText(), handler);
}

export function parseFunctionStep(name: string, node: Node): StepSpec | null {
  const handler = unwrapExpression(node);
  if (!Node.isFunctionExpression(handler)) return null;

  const returnInfo = inferFunctionReturn(handler);
  const directExpressionText = rewriteDirectStepExpression(
    handler,
    returnInfo.shouldAwait
  );
  const useBreakBlock =
    directExpressionText === null && needsBreakBlock(handler);
  const blockLabel = useBreakBlock ? `${name}Block` : null;

  return {
    name,
    propertyType: returnInfo.propertyType,
    directExpressionText,
    blockText: rewriteStepBody(
      handler,
      name,
      blockLabel,
      returnInfo.shouldAwait
    ),
    useBreakBlock,
    usesSignal: usesThisSignal(handler),
    usesAbortSignal: usesThisProperty(handler, "abortSignal"),
    actionUses: collectActionUses(handler),
  };
}

let stepBodyProbeId = 0;

function rewriteDirectStepExpression(
  handler: import("ts-morph").FunctionExpression,
  shouldAwait: boolean
): string | null {
  const body = handler.getBody();
  if (!body || !Node.isBlock(body)) return null;

  const statements = body.getStatements();
  if (statements.length !== 1) return null;

  const statement = statements[0]!;
  if (!Node.isReturnStatement(statement)) return null;

  const expression = statement.getExpression();
  if (!expression) return null;

  const project = handler.getProject();
  const probe = project.createSourceFile(
    `${handler
      .getSourceFile()
      .getDirectoryPath()}/.taskwish-morph-step-expression-${stepBodyProbeId++}.ts`,
    `function __step__() {\n  return ${expression.getText()};\n}`,
    { overwrite: true }
  );

  try {
    const fn = probe.getFunctionOrThrow("__step__");
    const rewrittenBody = fn.getBodyOrThrow();
    if (!Node.isBlock(rewrittenBody)) return null;

    const returnStatement = rewrittenBody
      .getStatements()
      .find(Node.isReturnStatement);

    if (!returnStatement) return null;

    rewriteThisPropertyAccesses(fn.getBodyOrThrow(), fn);

    const rewrittenExpression = returnStatement.getExpression();
    if (!rewrittenExpression) return null;

    return normalizeDirectExpressionText(
      assignmentExpressionText(rewrittenExpression, shouldAwait)
    );
  } finally {
    project.removeSourceFile(probe);
  }
}

function rewriteStepBody(
  handler: import("ts-morph").FunctionExpression,
  stepName: string,
  blockLabel: string | null,
  shouldAwait: boolean
): string {
  const bodyText = functionBodyText(handler);
  const project = handler.getProject();
  const probe = project.createSourceFile(
    `${handler
      .getSourceFile()
      .getDirectoryPath()}/.taskwish-morph-step-body-${stepBodyProbeId++}.ts`,
    `function __step__() {\n${bodyText}\n}`,
    { overwrite: true }
  );

  try {
    const fn = probe.getFunctionOrThrow("__step__");
    const body = fn.getBodyOrThrow();

    rewriteThisPropertyAccesses(body, fn);

    const rewrittenBody = fn.getBodyOrThrow();
    const probeText = probe.getFullText();
    const contentStart = rewrittenBody.getStart() + 1;
    const contentEnd = rewrittenBody.getEnd() - 1;
    let contentText = probeText.slice(contentStart, contentEnd);
    const returnEdits = rewrittenBody
      .getDescendantsOfKind(SyntaxKind.ReturnStatement)
      .filter((returnStatement) => belongsToFunction(returnStatement, fn))
      .map((returnStatement) => {
        const expression = returnStatement.getExpression();
        const assignmentExpression = expression
          ? assignmentExpressionText(expression, shouldAwait)
          : "undefined";
        const lineStart =
          probeText.lastIndexOf("\n", returnStatement.getStart()) + 1;
        const indentation = probeText.slice(
          lineStart,
          returnStatement.getStart()
        );

        return {
          start: returnStatement.getStart() - contentStart,
          end: returnStatement.getEnd() - contentStart,
          text: blockLabel
            ? `${stepName} = ${assignmentExpression};\n${indentation}break ${blockLabel};`
            : `${stepName} = ${assignmentExpression};`,
        };
      });

    for (const edit of returnEdits.sort((a, b) => b.start - a.start)) {
      contentText =
        contentText.slice(0, edit.start) +
        edit.text +
        contentText.slice(edit.end);
    }

    return normalizeBlock(contentText.replace(/^\s*\n/, ""));
  } finally {
    project.removeSourceFile(probe);
  }
}

function rewriteThisPropertyAccesses(root: Node, owner: Node): void {
  const propertyAccesses = root.getDescendantsOfKind(
    SyntaxKind.PropertyAccessExpression
  );
  if (Node.isPropertyAccessExpression(root)) {
    propertyAccesses.unshift(root);
  }

  for (const propertyAccess of propertyAccesses.reverse()) {
    if (!belongsToFunction(propertyAccess, owner)) continue;

    const expression = unwrapExpression(propertyAccess.getExpression());
    if (!Node.isThisExpression(expression)) continue;

    propertyAccess.replaceWithText(
      propertyAccess.getName() === "actions"
        ? `scope.${propertyAccess.getName()}`
        : propertyAccess.getName() === "signal"
        ? "scope.wind.signal"
        : propertyAccess.getName()
    );
  }
}

function usesThisSignal(root: Node): boolean {
  return usesThisProperty(root, "signal");
}

function usesThisProperty(root: Node, name: string): boolean {
  return root
    .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
    .some((propertyAccess) => {
      if (propertyAccess.getName() !== name) return false;

      const expression = unwrapExpression(propertyAccess.getExpression());
      return Node.isThisExpression(expression);
    });
}

function collectActionUses(root: Node): import("./types").ActionUse[] {
  const uniquePaths = new Set<string>();

  for (const call of root.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const path = thisActionsPath(call.getExpression());
    if (path.length < 2) continue;

    uniquePaths.add(path.join("."));
  }

  return [...uniquePaths].sort().map((path) => ({ path: path.split(".") }));
}

function thisActionsPath(node: Node): string[] {
  const names: string[] = [];
  let current = unwrapExpression(node);

  while (Node.isPropertyAccessExpression(current)) {
    names.unshift(current.getName());
    current = unwrapExpression(current.getExpression());
  }

  if (!Node.isThisExpression(current)) return [];
  if (names[0] !== "actions") return [];

  return names.slice(1);
}

function needsBreakBlock(fn: import("ts-morph").FunctionExpression): boolean {
  const returns = ownReturnStatements(fn);
  if (returns.length !== 1) return returns.length > 0;

  return !isDirectFinalReturn(returns[0]!, fn);
}

function awaitOperandText(expression: Node): string {
  const node = unwrapExpression(expression);

  if (
    Node.isCallExpression(node) ||
    Node.isIdentifier(node) ||
    Node.isPropertyAccessExpression(node) ||
    Node.isElementAccessExpression(node)
  ) {
    return expression.getText();
  }

  return `(${expression.getText()})`;
}

function assignmentExpressionText(
  expression: Node,
  shouldAwait: boolean
): string {
  return shouldAwait &&
    !Node.isAwaitExpression(unwrapExpression(expression)) &&
    !isDirectSynchronousReturnExpression(expression)
    ? `await ${awaitOperandText(expression)}`
    : expression.getText();
}

function isDirectSynchronousReturnExpression(expression: Node): boolean {
  const node = unwrapExpression(expression);

  return Node.isObjectLiteralExpression(node) || Node.isArrayLiteralExpression(node);
}

function normalizeDirectExpressionText(value: string): string {
  const lines = value.split("\n");
  if (lines.length === 1) return value;

  const continuationLines = lines.slice(1);
  const indents = continuationLines
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  const targetIndent = 4;
  const shift = Math.max(0, minIndent - targetIndent);

  return [
    lines[0]!,
    ...continuationLines.map((line) =>
      line.trim() ? line.slice(shift) : line
    ),
  ].join("\n");
}

function functionBodyText(fn: import("ts-morph").FunctionExpression): string {
  const body = fn.getBody();
  if (!body) return "";

  return normalizeBlock(
    body
      .getText()
      .slice(1, -1)
      .replace(/^\s*\n/, "")
  );
}
