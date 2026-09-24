import { dispatch } from "./logger";

export async function consume<Event, Result>(
  generator: AsyncGenerator<Event, Result, unknown>,
): Promise<Result> {
  const trace = dispatch(console);

  while (true) {
    const next = await generator.next();

    if (next.done) {
      return next.value;
    }

    trace(next.value);
  }
}
