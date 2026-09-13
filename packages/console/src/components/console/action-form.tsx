import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { toast } from "sonner";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../ai-elements/prompt-input";
import { actionTitle, isChatAction } from "../../lib/command-actions";
import {
  buildChatPayload,
  buildPayload,
  formatActionResultBody,
  formDefaultValues,
  streamActionResponse,
  type ActionRunEvent,
  type ActionRunResult,
  type CommandFormValues,
} from "../../lib/command-form";
import type { ConsoleAction, ConsoleConfig } from "../../types";
import { ActionInputField } from "./action-input-field";
import { ActionResult } from "./action-result";
import { ActionSchedule } from "./action-schedule";

function toastResultDescription(result: ActionRunResult): string {
  const body = formatActionResultBody(result.body).trim();
  const summary = body || `${result.status}`;
  return `Result: ${
    summary.length > 140 ? `${summary.slice(0, 137)}...` : summary
  }`;
}

function actionResultValue(result: ActionRunResult): unknown {
  const resultEvent = result.events
    ?.slice()
    .reverse()
    .find((event) => event.type === "result" || event.type === "state");
  if (
    resultEvent?.type === "state" &&
    resultEvent.data !== null &&
    typeof resultEvent.data === "object" &&
    !Array.isArray(resultEvent.data)
  ) {
    return (resultEvent.data as Record<string, unknown>).value;
  }
  return resultEvent ? resultEvent.data : result.body;
}

function sessionIdFromResult(result: ActionRunResult | null): string | null {
  if (!result?.ok) return null;
  const value = actionResultValue(result);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sessionId = (value as Record<string, unknown>).sessionId;
    if (typeof sessionId === "string" && sessionId) return sessionId;
  }
  return null;
}

function cancelledResult(result: ActionRunResult | null): ActionRunResult {
  const current =
    result ??
    ({
      status: 0,
      ok: false,
      contentType: "text/plain",
      body: "",
      events: [],
    } satisfies ActionRunResult);

  return {
    ...current,
    status: 0,
    ok: false,
    streaming: false,
    events: [...(current.events ?? []), { type: "error", data: "Cancelled" }],
  };
}

export type ActionFormHandle = {
  cancel: () => void;
};

export const ActionForm = forwardRef<
  ActionFormHandle,
  {
    action: ConsoleAction;
    config: ConsoleConfig;
    resetToken: number;
    showLogs: boolean;
    onChatModeChange?: (enabled: boolean) => void;
    onRunStateChange?: (running: boolean) => void;
    onStateChange?: (actor: string, event: ActionRunEvent) => void;
    onResultScrollChange?: (scrollTop: number) => void;
  }
>(function ActionForm(
  {
    action,
    config,
    resetToken,
    showLogs,
    onChatModeChange,
    onRunStateChange,
    onStateChange,
    onResultScrollChange,
  },
  ref
) {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionRunResult | null>(null);
  const [submittedPayload, setSubmittedPayload] = useState<unknown>(null);
  const [isChatMode, setIsChatMode] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatRuns, setChatRuns] = useState<
    { id: string; input: unknown; result: ActionRunResult | null }[]
  >([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const suppressSubmitRef = useRef(false);
  const chatSessionInitRef = useRef(false);
  const onChatModeChangeRef = useRef(onChatModeChange);
  const onRunStateChangeRef = useRef(onRunStateChange);
  const onStateChangeRef = useRef(onStateChange);
  const form = useForm<CommandFormValues>({
    defaultValues: formDefaultValues(action.input),
  });

  useEffect(() => {
    onChatModeChangeRef.current = onChatModeChange;
    onRunStateChangeRef.current = onRunStateChange;
    onStateChangeRef.current = onStateChange;
  }, [onChatModeChange, onRunStateChange, onStateChange]);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const resetRun = useCallback(() => {
    const chatAction = isChatAction(action);
    suppressSubmitRef.current = true;
    setIsRunning(false);
    setError(null);
    setResult(null);
    setSubmittedPayload(null);
    setIsChatMode(chatAction);
    setChatSessionId(null);
    setChatRuns([]);
    chatSessionInitRef.current = false;
    onChatModeChangeRef.current?.(chatAction);
    onRunStateChangeRef.current?.(false);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    form.reset(formDefaultValues(action.input));
    window.setTimeout(() => {
      suppressSubmitRef.current = false;
    }, 0);
  }, [action, form]);

  useImperativeHandle(ref, () => ({ cancel }), [cancel]);

  useLayoutEffect(() => {
    resetRun();
  }, [action.id, resetToken, resetRun]);

  const commandName = actionTitle(action);
  const chatAction = isChatAction(action);

  const publishStateEvent = useCallback(
    (nextResult: ActionRunResult) => {
      const event = nextResult.events?.at(-1);
      if (event?.type === "state" || event?.type === "state-change") {
        onStateChangeRef.current?.(action.actor, event);
      }
    },
    [action.actor]
  );

  const runPayload = useCallback(
    async (
      payload: unknown,
      options: {
        onResult: (result: ActionRunResult) => void;
        signal: AbortSignal;
      }
    ) => {
      const response = await fetch(action.route, {
        method: "POST",
        headers: {
          Accept: "text/event-stream, application/json",
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          wire: "commander",
        },
        signal: options.signal,
        body: JSON.stringify(payload),
      });

      let finalResult: ActionRunResult | null = null;
      for await (const result of streamActionResponse(response)) {
        finalResult = result;
        options.onResult(result);
      }
      return finalResult;
    },
    [action.route, config.apiKey]
  );

  useEffect(() => {
    if (
      !chatAction ||
      !isChatMode ||
      chatSessionId ||
      chatSessionInitRef.current
    ) {
      return;
    }

    chatSessionInitRef.current = true;
    setIsRunning(true);
    onRunStateChangeRef.current?.(true);
    setError(null);

    let sessionCreated = false;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    void runPayload(
      {},
      {
        signal: abortController.signal,
        onResult: () => {},
      }
    )
      .then((finalResult) => {
        const sessionId = sessionIdFromResult(finalResult);
        if (!sessionId) {
          throw new Error("Chat session was not created.");
        }
        sessionCreated = true;
        setChatSessionId(sessionId);
      })
      .catch((error) => {
        if (abortController.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setError(message);
        toast.error(commandName, {
          description: `Result: ${message}`,
        });
      })
      .finally(() => {
        if (!sessionCreated) chatSessionInitRef.current = false;
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        setIsRunning(false);
        onRunStateChangeRef.current?.(false);
      });
  }, [
    chatAction,
    chatSessionId,
    commandName,
    isChatMode,
    publishStateEvent,
    runPayload,
  ]);

  useEffect(() => {
    if (!chatAction || !isChatMode || !chatSessionId || isRunning) return;
    chatTextareaRef.current?.focus();
  }, [chatAction, chatSessionId, isChatMode, isRunning]);

  const submitChatMessage = async (input: string) => {
    if (isRunning) return;

    const message = input.trim();
    if (!message) return;
    if (!chatSessionId) {
      setError("Chat session is not ready.");
      return;
    }

    const payload = buildChatPayload(message, action.input, chatSessionId);
    const runId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}`;

    setIsRunning(true);
    onRunStateChangeRef.current?.(true);
    setError(null);
    setChatRuns((runs) => [
      ...runs,
      { id: runId, input: payload, result: null },
    ]);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const finalResult = await runPayload(payload, {
        signal: abortController.signal,
        onResult: (result) => {
          publishStateEvent(result);
          setChatRuns((runs) =>
            runs.map((run) => (run.id === runId ? { ...run, result } : run))
          );
        },
      });

      if (finalResult && !finalResult.ok) {
        toast.error(commandName, {
          description: toastResultDescription(finalResult),
        });
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        setChatRuns((runs) =>
          runs.map((run) =>
            run.id === runId
              ? {
                  ...run,
                  result: cancelledResult(run.result),
                }
              : run
          )
        );
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      setChatRuns((runs) =>
        runs.map((run) =>
          run.id === runId
            ? {
                ...run,
                result: {
                  status: 0,
                  ok: false,
                  contentType: "text/plain",
                  body: message,
                },
              }
            : run
        )
      );
      toast.error(commandName, {
        description: `Result: ${message}`,
      });
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsRunning(false);
      onRunStateChangeRef.current?.(false);
    }
  };

  const submit: SubmitHandler<CommandFormValues> = async (values) => {
    if (suppressSubmitRef.current) {
      return;
    }

    setIsRunning(true);
    onRunStateChangeRef.current?.(true);
    setError(null);
    setResult(null);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const payload = buildPayload(values, action.input);
      setSubmittedPayload(payload);
      setIsChatMode(true);
      onChatModeChangeRef.current?.(true);
      const finalResult = await runPayload(payload, {
        signal: abortController.signal,
        onResult: (nextResult) => {
          publishStateEvent(nextResult);
          setResult(nextResult);
        },
      });
      if (finalResult?.ok) {
        toast.success(commandName, {
          description: toastResultDescription(finalResult),
        });
      } else if (finalResult) {
        toast.error(commandName, {
          description: toastResultDescription(finalResult),
        });
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        setError(null);
        setResult((current) => cancelledResult(current));
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      setResult({
        status: 0,
        ok: false,
        contentType: "text/plain",
        body: message,
      });
      toast.error(commandName, {
        description: `Result: ${message}`,
      });
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsRunning(false);
      onRunStateChangeRef.current?.(false);
    }
  };

  return (
    <>
      <form
        id="console-action-form"
        className={isChatMode ? "hidden" : "space-y-4"}
        onSubmit={form.handleSubmit(submit)}
      >
        <ActionSchedule action={action} />
        {action.input.map((field, index) => (
          <ActionInputField
            key={`${action.id}:${resetToken}:${field.name}`}
            field={field}
            disabled={isRunning}
            autoFocus={index === 0}
            register={form.register}
            control={form.control}
            config={config}
          />
        ))}
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <input type="submit" hidden disabled={isRunning} />
      </form>
      {isChatMode ? (
        <div className="flex h-full min-h-0 flex-1 flex-col">
          <ActionResult
            key={`${action.id}:${resetToken}`}
            className="h-full min-h-0 flex-1"
            input={chatAction ? undefined : submittedPayload}
            result={chatAction ? undefined : result}
            runs={chatAction ? chatRuns : undefined}
            chat={chatAction}
            showLogs={showLogs}
            config={config}
            action={action}
            onScrollChange={onResultScrollChange}
          />
          {chatAction ? (
            <div className="shrink-0 bg-background p-3">
              {error ? (
                <p className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <PromptInput
                onSubmit={({ text }) => {
                  void submitChatMessage(text);
                }}
                className="rounded-lg border border-input bg-background focus-within:ring-0 focus-within:ring-transparent focus-within:ring-offset-0"
              >
                <PromptInputBody>
                  <PromptInputTextarea
                    ref={chatTextareaRef}
                    placeholder="Message..."
                    disabled={isRunning || !chatSessionId}
                    className="max-h-36 min-h-11"
                    autoFocus
                  />
                </PromptInputBody>
                <PromptInputFooter>
                  <PromptInputTools />
                  <PromptInputSubmit
                    disabled={isRunning || !chatSessionId}
                    aria-label="Send message"
                    title="Send message"
                  />
                </PromptInputFooter>
              </PromptInput>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
});
ActionForm.displayName = "ActionForm";
