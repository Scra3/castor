/** Error type for the workflow executor setup — user-facing, actionable messages. */
export class ExecutorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutorError'
  }
}
