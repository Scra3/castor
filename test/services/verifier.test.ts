import {expect} from 'chai'

import {waitUntilActive} from '../../src/services/verifier.js'

describe('verifier.waitUntilActive', () => {
  it('returns true as soon as the predicate succeeds', async () => {
    const results = [false, false, true]
    let calls = 0
    const checkActive = (): Promise<boolean> => {
      calls += 1

      return Promise.resolve(results.shift() ?? false)
    }

    const active = await waitUntilActive(checkActive, {intervalMs: 1, now: () => 0, sleep: () => Promise.resolve()})

    expect(active).to.equal(true)
    expect(calls).to.equal(3)
  })

  it('returns true immediately without sleeping when already active', async () => {
    let slept = false
    const active = await waitUntilActive(() => Promise.resolve(true), {
      now: () => 0,
      sleep() {
        slept = true

        return Promise.resolve()
      },
    })

    expect(active).to.equal(true)
    expect(slept).to.equal(false)
  })

  it('returns false when the timeout elapses', async () => {
    let clock = 0
    const active = await waitUntilActive(() => Promise.resolve(false), {
      intervalMs: 4,
      now: () => clock,
      sleep(ms) {
        clock += ms

        return Promise.resolve()
      },
      timeoutMs: 10,
    })

    expect(active).to.equal(false)
  })
})
