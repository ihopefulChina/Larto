import type { IpcArgs, IpcEventChannel, IpcEvents, IpcRequestChannel, IpcResult } from '@shared/ipc'

/** Typed access to the preload bridge (`window.larto`). */
export function invoke<C extends IpcRequestChannel>(
  channel: C,
  ...args: IpcArgs<C>
): Promise<IpcResult<C>> {
  return window.larto.invoke(channel, ...args)
}

export function on<C extends IpcEventChannel>(
  channel: C,
  listener: (payload: IpcEvents[C]) => void
): () => void {
  return window.larto.on(channel, listener)
}

export const isMac = window.larto.platform === 'darwin'
