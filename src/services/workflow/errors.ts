/** Error type for the `workflow` topic — user-facing, actionable messages. */
export class WorkflowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowError'
  }
}
