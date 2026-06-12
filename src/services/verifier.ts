/**
 * Polls a "is it ready yet?" predicate until it succeeds or a deadline passes.
 * Used to wait for the Forest environment to become `isActive` after the agent
 * posts its schema. `now`/`sleep` are injectable so tests run instantly.
 */
export type WaitOptions = {
  /** Delay between polls (default 2s). */
  intervalMs?: number
  /** Injectable clock (tests). */
  now?: () => number
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>
  /** Total time to wait before giving up (default 90s). */
  timeoutMs?: number
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

/**
 * Resolve to `true` as soon as `checkActive()` returns true, or `false` if the
 * timeout elapses first. The predicate is checked once immediately.
 */
export async function waitUntilActive(checkActive: () => Promise<boolean>, options: WaitOptions = {}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 90_000
  const intervalMs = options.intervalMs ?? 2000
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? (() => Date.now())

  const deadline = now() + timeoutMs

   
  let active = await checkActive()

  while (!active && now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs)
    // eslint-disable-next-line no-await-in-loop
    active = await checkActive()
  }

  return active
}
