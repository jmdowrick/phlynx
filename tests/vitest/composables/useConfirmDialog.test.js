import { beforeEach, describe, expect, it, vi } from 'vitest'

const require = vi.hoisted(() => vi.fn())
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require }) }))

import { useConfirmDialog } from '../../../src/composables/useConfirmDialog'

describe('useConfirmDialog', () => {
  const shown = () => require.mock.calls.at(-1)[0]

  beforeEach(() => require.mockClear())

  it('answers true on accept and false on reject', async () => {
    const { confirm } = useConfirmDialog()
    const accepted = confirm({ message: 'Go?' })
    shown().accept()
    expect(await accepted).toBe(true)

    const rejected = confirm({ message: 'Go?' })
    shown().reject()
    expect(await rejected).toBe(false)
  })

  it('answers null when closed without an answer, as by Escape', async () => {
    const { confirm } = useConfirmDialog()
    const closed = confirm({ message: 'Go?' })
    shown().onHide()
    expect(await closed).toBeNull()
  })

  it('keeps an answer given, though the dialog then hides', async () => {
    const { confirm } = useConfirmDialog()
    const accepted = confirm({ message: 'Go?' })
    shown().accept()
    shown().onHide()
    expect(await accepted).toBe(true)
  })
})
