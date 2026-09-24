import { Node, SourceFile } from "ts-morph";

import { printAction, printService } from "./printer";
import type { ActionSpec, ServiceSpec, TextEdit } from "./types";

export function applyBareMetalReplacements(
  sourceText: string,
  sourceFile: SourceFile,
  actions: ActionSpec[],
  services: ServiceSpec[] = [],
  options: { metadata?: boolean } = {},
): string {
  const edits: TextEdit[] = taskWishImportEdits(sourceText, sourceFile);
  const actorDeclarations = new Set<import("ts-morph").VariableStatement>();

  if (actions.length > 0) {
    const importLines: string[] = [];
    const requiredImports = [
      "Wind",
      actions.some((action) => action.listenEventName !== null)
        ? "addListener"
        : null,
    ].filter((value): value is string => value !== null);
    const windImport = sourceFile
      .getImportDeclarations()
      .find(
        (importDeclaration) =>
          importDeclaration.getModuleSpecifierValue() === "@taskwish/wind"
      );

    if (!windImport) {
      importLines.push(
        `import { ${requiredImports.join(", ")} } from "@taskwish/wind";`
      );
    } else {
      const namedImports = windImport.getNamedImports();
      const existingNames = new Set(
        namedImports.map((namedImport) => namedImport.getName())
      );
      const missingImports = requiredImports.filter(
        (name) => !existingNames.has(name)
      );

      if (missingImports.length > 0 && namedImports.length > 0) {
        edits.push({
          start: namedImports[0]!.getStart(),
          end: namedImports.at(-1)!.getEnd(),
          text: [
            ...namedImports.map((namedImport) => namedImport.getText()),
            ...missingImports,
          ].join(", "),
        });
      } else if (missingImports.length > 0) {
        importLines.push(
          `import { ${missingImports.join(", ")} } from "@taskwish/wind";`
        );
      }
    }

    if (importLines.length > 0) {
      const insertionPosition = importInsertionPosition(sourceText, sourceFile);

      edits.push({
        start: insertionPosition,
        end: insertionPosition,
        text: `${importLines.join("\n")}\n\n`,
      });
    }
  }

  for (const action of actions) {
    edits.push({
      start: action.declaration.getStart(),
      end: action.declaration.getEnd(),
      text: printAction(action, options),
    });
    actorDeclarations.add(action.actorDeclaration);
  }

  for (const service of services) {
    edits.push({
      start: service.declaration.getStart(),
      end: service.declaration.getEnd(),
      text: printService(service),
    });
    actorDeclarations.add(service.actorDeclaration);
  }

  for (const statement of actorDeclarations) {
    edits.push(removeNodeEdit(sourceText, statement));
  }

  return applyTextEdits(sourceText, edits);
}

function importInsertionPosition(
  sourceText: string,
  sourceFile: SourceFile
): number {
  let position = 0;

  for (const statement of sourceFile.getStatements()) {
    if (!statement.getText().match(/^["']use\s+[^"']+["'];?$/)) break;

    position = statement.getEnd();
    while (
      position < sourceText.length &&
      /\s/.test(sourceText[position] ?? "")
    ) {
      position++;
    }
  }

  return position;
}

function taskWishImportEdits(
  sourceText: string,
  sourceFile: SourceFile
): TextEdit[] {
  const edits: TextEdit[] = [];

  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const namedImports = importDeclaration.getNamedImports();
    const remainingImports = namedImports.filter((namedImport) => {
      const name = namedImport.getName();
      return name !== "Actor" && name !== "Event" && name !== "Step";
    });

    if (remainingImports.length === namedImports.length) continue;

    if (
      remainingImports.length === 0 &&
      !importDeclaration.getDefaultImport() &&
      !importDeclaration.getNamespaceImport()
    ) {
      edits.push(removeNodeEdit(sourceText, importDeclaration));
      continue;
    }

    if (remainingImports.length > 0) {
      edits.push({
        start: namedImports[0]!.getStart(),
        end: namedImports.at(-1)!.getEnd(),
        text: remainingImports
          .map((namedImport) => namedImport.getText())
          .join(", "),
      });
    }
  }

  return edits;
}

function removeNodeEdit(sourceText: string, node: Node): TextEdit {
  let end = node.getEnd();

  while (end < sourceText.length && /\s/.test(sourceText[end] ?? "")) {
    end++;
  }

  return {
    start: node.getStart(),
    end,
    text: "",
  };
}

function applyTextEdits(sourceText: string, edits: TextEdit[]): string {
  const orderedEdits = [...edits].sort((a, b) => b.start - a.start);
  let output = sourceText;

  for (const edit of orderedEdits) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }

  return output;
}
