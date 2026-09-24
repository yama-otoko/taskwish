import { useEffect, useMemo, useState } from "react";
import type { Control, UseFormRegister } from "react-hook-form";

import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { PromptInputTextarea } from "../ai-elements/prompt-input";
import {
  enumValue,
  fieldPlaceholder,
  parseActionResponse,
  schemaType,
  type CommandFormValues,
} from "../../lib/command-form";
import { sentenceFromIdentifier } from "../../lib/console-text";
import type { ConsoleConfig, ConsoleInputField } from "../../types";
import {
  actionResultValue,
  actionSuggestion,
  actionSuggestionOptions,
  type ActionSuggestionOption,
} from "../../lib/action-suggestions";
import { FieldDescription } from "./field-description";
import { FormCombobox } from "./form-combobox";
import { ListInputField } from "./list-input-field";
import { FileInputField } from "./file-input-field";
import { fileInputConfig } from "../../lib/file-input";

export function ActionInputField({
  field,
  disabled,
  autoFocus,
  register,
  control,
  config,
}: {
  field: ConsoleInputField;
  disabled: boolean;
  autoFocus?: boolean;
  register: UseFormRegister<CommandFormValues>;
  control: Control<CommandFormValues>;
  config: ConsoleConfig;
}) {
  const id = `command-${field.name}`;
  const type = schemaType(field.schema);
  const enumValues = field.schema?.enum;
  const suggestion = useMemo(
    () => actionSuggestion(field, config.actions),
    [config.actions, field],
  );
  const [suggestionOptions, setSuggestionOptions] = useState<
    ActionSuggestionOption[]
  >([]);
  const [suggestionStatus, setSuggestionStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >(suggestion ? "loading" : "idle");

  useEffect(() => {
    if (!suggestion) {
      setSuggestionOptions([]);
      setSuggestionStatus("idle");
      return;
    }

    const abortController = new AbortController();
    setSuggestionStatus("loading");

    void fetch(suggestion.action.route, {
      method: "POST",
      headers: {
        Accept: "text/event-stream, application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        wind: "commander",
      },
      signal: abortController.signal,
      body: JSON.stringify(suggestion.payload),
    })
      .then(parseActionResponse)
      .then((result) => {
        if (!result.ok) {
          throw new Error(`Suggestion action failed: ${result.status}`);
        }
        setSuggestionOptions(
          actionSuggestionOptions(
            actionResultValue(result),
            suggestion.selector,
          ),
        );
        setSuggestionStatus("ready");
      })
      .catch(() => {
        if (!abortController.signal.aborted) setSuggestionStatus("error");
      });

    return () => abortController.abort();
  }, [config.apiKey, suggestion]);
  const fieldLabel = sentenceFromIdentifier(field.name);
  const label = (
    <Label htmlFor={id} className="flex items-center gap-1">
      {fieldLabel}
      {field.required ? <span className="text-muted-foreground">*</span> : null}
    </Label>
  );

  if (fileInputConfig(field)) {
    return (
      <FileInputField
        field={field}
        control={control}
        disabled={disabled}
        autoFocus={autoFocus}
        label={label}
      />
    );
  }

  if (type === "array") {
    return (
      <ListInputField
        field={field}
        disabled={disabled}
        autoFocus={autoFocus}
        register={register}
        control={control}
        label={label}
      />
    );
  }

  if (suggestion) {
    const placeholder =
      suggestionStatus === "loading"
        ? "Loading..."
        : suggestionStatus === "error"
          ? "Unable to load options"
          : suggestionOptions.length
            ? "Select..."
            : "No options";

    return (
      <div className="space-y-2">
        {label}
        <FormCombobox
          id={id}
          name={field.name}
          control={control}
          options={suggestionOptions}
          placeholder={placeholder}
          emptyText="No options found."
          disabled={disabled || suggestionStatus !== "ready"}
          autoFocus={autoFocus}
        />
        <FieldDescription field={field} />
      </div>
    );
  }

  if (Array.isArray(enumValues)) {
    return (
      <div className="space-y-2">
        {label}
        <FormCombobox
          id={id}
          name={field.name}
          control={control}
          options={enumValues.map((value) => ({
            label: enumValue(value),
            value: enumValue(value),
          }))}
          clearable={!field.required}
          disabled={disabled}
          autoFocus={autoFocus}
        />
        <FieldDescription field={field} />
      </div>
    );
  }

  if (type === "boolean") {
    return (
      <div className="space-y-2">
        <label
          htmlFor={id}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <input
            id={id}
            type="checkbox"
            disabled={disabled}
            autoFocus={autoFocus}
            {...register(field.name)}
            className="h-4 w-4 rounded border border-input accent-primary disabled:cursor-not-allowed disabled:opacity-50"
          />
          <span>
            {fieldLabel}
            {field.required ? (
              <span className="ml-1 text-muted-foreground">*</span>
            ) : null}
          </span>
        </label>
        <FieldDescription field={field} />
      </div>
    );
  }

  if (type === "string" || type === "number" || type === "integer") {
    return (
      <div className="space-y-2">
        {label}
        <Input
          id={id}
          type={type === "string" ? "text" : "number"}
          step={type === "integer" ? "1" : "any"}
          placeholder={fieldPlaceholder(field)}
          disabled={disabled}
          autoFocus={autoFocus}
          {...register(field.name)}
        />
        <FieldDescription field={field} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {label}
      <PromptInputTextarea
        id={id}
        placeholder={fieldPlaceholder(field)}
        className="min-h-[110px] resize-none"
        disabled={disabled}
        autoFocus={autoFocus}
        {...register(field.name)}
      />
      <FieldDescription field={field} />
    </div>
  );
}
