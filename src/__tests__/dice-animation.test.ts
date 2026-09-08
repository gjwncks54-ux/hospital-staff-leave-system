import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForDiceAnimation } from "../lib/dice-animation";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("dice animation duration", () => {
  it("keeps a fast successful result hidden for two seconds", async () => {
    const response = { rollScore: 24 };
    const onResult = vi.fn();
    const pending = waitForDiceAnimation(Promise.resolve(response)).then(onResult);
    await vi.advanceTimersByTimeAsync(1999);
    expect(onResult).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(onResult).toHaveBeenCalledExactlyOnceWith(response);
  });

  it("waits two seconds before reporting an early error and preserves that error", async () => {
    const error = new Error("Request failed");
    const onError = vi.fn();
    const pending = waitForDiceAnimation(Promise.reject(error)).catch(onError);
    await vi.advanceTimersByTimeAsync(1999);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("waits for a slow successful response without adding another two seconds", async () => {
    let resolve!: (value: number) => void;
    const onResult = vi.fn();
    const request = new Promise<number>((done) => { resolve = done; });
    const pending = waitForDiceAnimation(request).then(onResult);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onResult).not.toHaveBeenCalled();
    resolve(24);
    await pending;
    expect(onResult).toHaveBeenCalledExactlyOnceWith(24);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a late error immediately after the response arrives", async () => {
    let reject!: (error: Error) => void;
    const error = new Error("Request failed");
    const onError = vi.fn();
    const request = new Promise<never>((_resolve, fail) => { reject = fail; });
    const pending = waitForDiceAnimation(request).catch(onError);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onError).not.toHaveBeenCalled();
    reject(error);
    await pending;
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(vi.getTimerCount()).toBe(0);
  });
});
