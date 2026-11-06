/* eslint-disable @typescript-eslint/require-await -- Async act flushes React effects between assertions. */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { PreviewRefreshContext, usePreviewRefresh } from './use-preview-refresh.js'

const { router } = vi.hoisted(() => ({ router: { refresh: vi.fn() } }))
vi.mock('next/navigation.js', () => ({ useRouter: () => router }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount())
  }
  vi.useRealTimers()
  vi.resetAllMocks()
  document.body.replaceChildren()
})

async function mount(prepare?: (signal: AbortSignal) => Promise<void>) {
  let refresh!: ReturnType<typeof usePreviewRefresh>
  function Editor() {
    refresh = usePreviewRefresh()
    return null
  }
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  roots.push(root)
  await act(async () => {
    root.render(
      createElement(PreviewRefreshContext.Provider, { value: prepare }, createElement(Editor)),
    )
  })
  return () => refresh()
}

it('renews preview mode before refreshing and shares overlapping requests', async () => {
  let renew!: () => void
  const prepare = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        renew = resolve
      }),
  )
  const refresh = await mount(prepare)
  const first = refresh()
  expect(refresh()).toBe(first)
  expect(router.refresh).not.toHaveBeenCalled()
  await act(async () => renew())
  await first
  expect(prepare).toHaveBeenCalledOnce()
  expect(router.refresh).toHaveBeenCalledOnce()
  await act(async () => {
    void refresh()
  })
  await act(async () => renew())
  expect(router.refresh).toHaveBeenCalledTimes(2)
})

it('keeps the current route intact when renewal fails and allows retry', async () => {
  const prepare = vi
    .fn()
    .mockRejectedValueOnce(new Error('Sign in again'))
    .mockResolvedValue(undefined)
  const refresh = await mount(prepare)
  await expect(refresh()).rejects.toThrow('Sign in again')
  expect(router.refresh).not.toHaveBeenCalled()
  let retried!: Promise<void>
  await act(async () => {
    retried = refresh()
  })
  await retried
  expect(router.refresh).toHaveBeenCalledOnce()
})

it('aborts stalled renewal and ignores late completion', async () => {
  vi.useFakeTimers()
  let renew!: () => void
  let signal!: AbortSignal
  const refresh = await mount((value) => {
    signal = value
    return new Promise<void>((resolve) => {
      renew = resolve
    })
  })
  const result = expect(refresh()).rejects.toThrow('timed out')
  await act(async () => vi.advanceTimersByTimeAsync(20000))
  await result
  expect(signal.aborted).toBe(true)
  await act(async () => renew())
  expect(router.refresh).not.toHaveBeenCalled()
})

it('settles outstanding callers when the editor unmounts', async () => {
  const refresh = await mount(() => new Promise(() => {}))
  const result = expect(refresh()).rejects.toThrow('Preview closed')
  await act(async () => roots.pop()!.unmount())
  await result
})

it('times out a stalled route transition after successful renewal', async () => {
  vi.useFakeTimers()
  let finishRoute!: () => void
  router.refresh.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishRoute = resolve
      }),
  )
  const refresh = await mount()
  let result!: Promise<void>
  await act(async () => {
    result = refresh()
  })
  const failure = expect(result).rejects.toThrow('timed out')
  await act(async () => vi.advanceTimersByTimeAsync(20000))
  await failure
  await act(async () => finishRoute())
})
