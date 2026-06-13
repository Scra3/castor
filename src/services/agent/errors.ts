/** Error type for the `agent` topic — user-facing, actionable messages (French). */
export class AgentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentError'
  }
}
