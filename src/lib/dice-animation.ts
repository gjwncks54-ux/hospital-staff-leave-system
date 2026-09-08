export async function waitForDiceAnimation<T>(request: Promise<T>): Promise<T> {
  // A failed request must not end the dice animation before two seconds.
  const [result] = await Promise.allSettled([
    request,
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (result.status === "rejected") {
    throw result.reason;
  }
  return result.value;
}
