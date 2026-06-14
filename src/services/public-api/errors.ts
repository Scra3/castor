/** Error thrown for any non-2xx response from Forest's public API. */
export class PublicApiError extends Error {
  /** HTTP status code, or 0 when the request never reached the server. */
  readonly status: number

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'PublicApiError'
    this.status = status
  }
}
