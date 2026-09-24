import { describe, expect, test } from "bun:test";
import { Trace } from "@taskwish/wind";

describe("TW", () => {
  test("Trace serializes to its SSE payload and logs compactly", () => {
    const trace = new Trace("Worker::run", {
      input: { value: 42 },
    });

    expect(trace.data).toEqual({
      path: "Worker::run",
      input: { value: 42 },
    });
    expect(JSON.parse(JSON.stringify(trace.data))).toEqual({
      path: "Worker::run",
      input: { value: 42 },
    });
    expect(trace.log).toEqual({
      ">>": "Worker::run",
      input: { value: 42 },
    });
  });
});
