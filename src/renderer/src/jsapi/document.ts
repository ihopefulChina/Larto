/**
 * Guest documents each get a new isolated-world preload (`seq` restarts at 1). The shell
 * stamps every invoke with this generation and drops the result after `did-navigate`.
 */
export function createJsapiDocumentGuard() {
  let generation = 0
  return {
    begin(): number {
      return ++generation
    },
    current(): number {
      return generation
    },
    isCurrent(started: number): boolean {
      return started === generation
    }
  }
}
