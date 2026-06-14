/**
 * Thin read-only client for Forest's public API (audit/observability).
 *
 * A separate host from the private API, plain JSON (not JSON:API), responses
 * shaped `{ hasMore, data[], parameters }`. Uses the native `fetch` (Node >= 18),
 * injectable for tests. Every non-2xx response becomes a `PublicApiError`.
 */
import {PublicApiError} from './errors.js'

type Logger = (message: string) => void

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

/** A query value; `undefined` entries are dropped from the query string. */
export type QueryValue = number | string | undefined

export type PublicApiResult<T> = {
  data: T[]
  hasMore: boolean
  parameters: unknown
}

export type PublicApiClientOptions = {
  baseUrl: string
  /** Injectable fetch, mainly for tests. Defaults to the global fetch. */
  fetch?: FetchImpl
  /** Sink for verbose logs (defaults to console.error). */
  logger?: Logger
  token: string
  /** When true, log every request/response (the token is never logged). */
  verbose?: boolean
}

/** Build a `?a=1&b=2` query string, dropping undefined values and encoding both sides. */
function buildQuery(query: Record<string, QueryValue>): string {
  const pairs = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)

  return pairs.length > 0 ? `?${pairs.join('&')}` : ''
}

/** Turn a public-API error body into a readable, actionable message. */
function describeError(status: number, rawBody: string, retryAfter: null | string): string {
  let message = rawBody || 'no response body'
  let code: string | undefined
  let feature: string | undefined

  try {
    const parsed = JSON.parse(rawBody) as {code?: string; details?: {feature?: string}; message?: string}
    if (parsed.message) message = parsed.message
    code = parsed.code
    feature = parsed.details?.feature
  } catch {
    // not JSON — keep the raw body
  }

  if (status === 401) {
    return `${message} — pass a long-lived application token via --api-token / $FOREST_API_TOKEN, or re-login with \`castor login\`.`
  }

  if (status === 403) {
    return `${message} — your account has no access to this project/environment.`
  }

  if (status === 402 || code === 'PaymentRequiredError') {
    const which = feature ? ` (feature: ${feature})` : ''

    return `${message}${which} — this public-API feature is not enabled on your Forest plan.`
  }

  if (status === 429) {
    const wait = retryAfter ? ` Retry after ${retryAfter}s.` : ''

    return `${message} — rate limit exceeded.${wait}`
  }

  return code ? `${message} (${code})` : message
}

export class PublicApiClient {
  private readonly baseUrl: string

  private readonly fetchImpl: FetchImpl

  private readonly logger: Logger

  private readonly token: string

  private readonly verbose: boolean

  constructor(options: PublicApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
    this.verbose = options.verbose ?? false
    this.logger = options.logger ?? (message => console.error(message))
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
  }

  /** GET `path` with a query string, returning the parsed `{ data, hasMore, parameters }`. */
  async get<T>(path: string, query: Record<string, QueryValue> = {}): Promise<PublicApiResult<T>> {
    const url = `${this.baseUrl}${path}${buildQuery(query)}`

    if (this.verbose) this.logger(`→ GET ${url}`)

    let response: Response
    try {
      response = await this.fetchImpl(url, {
        headers: {Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json'},
        method: 'GET',
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new PublicApiError(0, `Cannot reach the Forest public API at ${this.baseUrl} (${reason})`)
    }

    const rawBody = await response.text()

    if (this.verbose) this.logger(`← ${response.status} GET ${url}`)

    if (!response.ok) {
      throw new PublicApiError(response.status, describeError(response.status, rawBody, response.headers.get('retry-after')))
    }

    const parsed = (rawBody ? JSON.parse(rawBody) : {}) as Partial<PublicApiResult<T>>

    return {
      data: parsed.data ?? [],
      hasMore: parsed.hasMore ?? false,
      parameters: parsed.parameters,
    }
  }
}
