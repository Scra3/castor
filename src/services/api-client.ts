/**
 * Thin typed HTTP client for the Forest Admin server API.
 *
 * Uses the native `fetch` (Node >= 18). Every non-2xx response is turned into a
 * `ForestApiError` carrying the HTTP status and a human-readable detail (parsed
 * from the JSON:API `errors[]` payload when present). Nothing else throws raw.
 */
/* eslint-disable camelcase -- some Forest attributes are snake_case (first_name, ...) */

/** Error thrown for any non-2xx Forest API response, or a transport failure. */
export class ForestApiError extends Error {
  /** Best-effort human-readable explanation extracted from the response. */
  readonly detail: string

  /** HTTP status code, or 0 when the request never reached the server. */
  readonly status: number

  constructor(status: number, detail: string) {
    super(`Forest API error ${status}: ${detail}`)
    this.name = 'ForestApiError'
    this.status = status
    this.detail = detail
  }
}

export type SessionResponse = {
  refreshToken: string
  token: string
}

export type JsonApiResource = {
  attributes?: Record<string, unknown>
  id: string
  relationships?: Record<string, {data?: {id: string; type: string} | null}>
  type: string
}

export type JsonApiDocument = {
  data: JsonApiResource
  included?: JsonApiResource[]
}

type Logger = (message: string) => void

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

export type ForestApiClientOptions = {
  /** Injectable fetch, mainly for tests. Defaults to the global fetch. */
  fetch?: FetchImpl
  /** Sink for verbose logs (defaults to console.error). */
  logger?: Logger
  serverUrl: string
  token?: string
  /** When true, log every request/response with secrets redacted. */
  verbose?: boolean
}

const REDACTED = '***redacted***'
const SENSITIVE_KEYS = new Set(['password', 'token', 'refreshToken', 'secretKey', 'timeBasedOneTimePassword'])

function redactBody(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(item => redactBody(item))

  if (body && typeof body === 'object') {
    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>).map(([key, value]) => [
        key,
        SENSITIVE_KEYS.has(key) ? REDACTED : redactBody(value),
      ]),
    )
  }

  return body
}

/** Extract a readable message from a JSON:API error document or raw text. */
function extractDetail(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as {
      errors?: Array<{detail?: string; message?: string; title?: string}>
      message?: string
    }

    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const first = parsed.errors[0]

      return first.detail || first.message || first.title || rawBody
    }

    if (parsed.message) return parsed.message
  } catch {
    // not JSON, fall through
  }

  return rawBody || 'no response body'
}

export class ForestApiClient {
  private readonly fetchImpl: FetchImpl

  private readonly logger: Logger

  private readonly serverUrl: string

  private token?: string

  private readonly verbose: boolean

  constructor(options: ForestApiClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '')
    this.token = options.token
    this.verbose = options.verbose ?? false
     
    this.logger = options.logger ?? (message => console.error(message))
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
  }

  /**
   * POST /api/application-tokens — exchange the current bearer (e.g. a short-lived
   * OIDC access token) for a long-lived application token, and return it.
   */
  async createApplicationToken(name: string): Promise<string> {
    const doc = await this.request<JsonApiDocument>('POST', '/api/application-tokens', {
      auth: true,
      body: {data: {attributes: {name}, type: 'application-tokens'}},
    })

    const token = doc.data.attributes?.token
    if (typeof token !== 'string') {
      throw new ForestApiError(0, 'Réponse application-token inattendue : aucun token.')
    }

    return token
  }

  /** POST /api/projects — create a project for an agent-nodejs / postgres stack. */
  createProject(name: string): Promise<JsonApiDocument> {
    return this.request<JsonApiDocument>('POST', '/api/projects', {
      auth: true,
      body: {
        data: {
          attributes: {agent: 'agent-nodejs', architecture: 'microservice', databaseType: 'postgres', name},
          type: 'projects',
        },
      },
    })
  }

  /** GET /api/environments/:id — read the `is_active` onboarding flag. */
  async getEnvironmentIsActive(environmentId: string): Promise<boolean> {
    const doc = await this.request<JsonApiDocument>('GET', `/api/environments/${environmentId}`, {auth: true})
    // The server serializes attributes in snake_case (is_active); tolerate camelCase too.
    const attributes = doc.data.attributes ?? {}

    return (attributes.is_active ?? attributes.isActive) === true
  }

  /** GET /api/environments/:id/secretKey — returns FOREST_ENV_SECRET. */
  async getEnvironmentSecretKey(environmentId: string): Promise<string> {
    const response = await this.request<{secretKey: string}>(
      'GET',
      `/api/environments/${environmentId}/secretKey`,
      {auth: true},
    )

    return response.secretKey
  }

  /**
   * GET /api/:domain/:project/:env/:team — raw patchable document.
   * Works for folders/workflows; for the layout domain the server always
   * returns [] (no layout column on renderings) — use getRendering instead.
   */
  getLayoutDomain(
    domain: 'folders' | 'workflows',
    projectName: string,
    environmentName: string,
    teamName: string,
  ): Promise<unknown[]> {
    const path = [domain, projectName, environmentName, teamName].map(s => encodeURIComponent(s)).join('/')

    return this.request<unknown[]>('GET', `/api/${path}`, {auth: true})
  }

  /** GET /api/renderings/:project/:env/:team — JSON:API rendering (layout source of truth). */
  getRendering(
    projectName: string,
    environmentName: string,
    teamName: string,
  ): Promise<{data: JsonApiResource; included?: JsonApiResource[]}> {
    const path = [projectName, environmentName, teamName].map(s => encodeURIComponent(s)).join('/')

    return this.request<{data: JsonApiResource; included?: JsonApiResource[]}>(
      'GET',
      `/api/renderings/${path}`,
      {auth: true},
    )
  }

  /** GET /api/projects/:id/environments — environments with their type. */
  async listEnvironments(projectId: string): Promise<Array<{id: string; name: string; type?: string}>> {
    const doc = await this.request<{data: JsonApiResource[]}>(
      'GET',
      `/api/projects/${projectId}/environments`,
      {auth: true},
    )

    return doc.data.map(e => ({
      id: e.id,
      name: (e.attributes?.name as string) ?? e.id,
      type: (e.attributes?.type as string) ?? undefined,
    }))
  }

  /** GET /api/projects — projects visible to the user. */
  async listProjects(): Promise<Array<{id: string; name: string}>> {
    const doc = await this.request<{data: JsonApiResource[]}>('GET', '/api/projects', {auth: true})

    return doc.data.map(p => ({id: p.id, name: (p.attributes?.name as string) ?? p.id}))
  }

  /** GET /api/projects/:id/teams — teams of a project. */
  async listTeams(projectId: string): Promise<Array<{id: string; name: string}>> {
    const doc = await this.request<{data: JsonApiResource[]}>('GET', `/api/projects/${projectId}/teams`, {
      auth: true,
    })

    return doc.data.map(t => ({id: t.id, name: (t.attributes?.name as string) ?? t.id}))
  }

  /** POST /api/sessions — email/password (+ optional TOTP) login. */
  login(email: string, password: string, timeBasedOneTimePassword?: string): Promise<SessionResponse> {
    return this.request<SessionResponse>('POST', '/api/sessions', {
      body: {email, password, ...(timeBasedOneTimePassword ? {timeBasedOneTimePassword} : {})},
    })
  }

  /** PATCH /api/:domain — raw RFC 6902 ops, scoped by env/team headers. 204 expected. */
  async patchLayoutDomain(
    domain: 'folders' | 'layout' | 'workflows',
    ops: Array<{op: string; path: string; value?: unknown}>,
    context: {environmentId: number; teamId: number},
  ): Promise<void> {
    await this.request<void>('PATCH', `/api/${domain}`, {
      auth: true,
      body: ops,
      headers: {
        'forest-environment-id': String(context.environmentId),
        'forest-team-id': String(context.teamId),
      },
    })
  }

  /** PUT /api/environments/:id — declare where the agent listens. */
  async setEnvironmentApiEndpoint(environmentId: string, apiEndpoint: string): Promise<void> {
    await this.request<JsonApiDocument>('PUT', `/api/environments/${environmentId}`, {
      auth: true,
      body: {data: {attributes: {apiEndpoint}, id: environmentId, type: 'environments'}},
    })
  }

  /** Set the bearer token used for subsequent authenticated requests. */
  setToken(token: string): void {
    this.token = token
  }

  /** POST /api/users — open account creation (no auth). Returns the new user id. */
  async signup(input: {email: string; firstName: string; lastName: string; password: string}): Promise<string> {
    const doc = await this.request<JsonApiDocument>('POST', '/api/users', {
      body: {
        data: {
          attributes: {
            email: input.email,
            first_name: input.firstName,
            last_name: input.lastName,
            password: input.password,
          },
          type: 'users',
        },
      },
    })

    return doc.data.id
  }

  private async request<T>(
    method: string,
    path: string,
    options: {auth?: boolean; body?: unknown; headers?: Record<string, string>} = {},
  ): Promise<T> {
    const url = `${this.serverUrl}${path}`
    const headers: Record<string, string> = {'Content-Type': 'application/json', ...options.headers}

    if (options.auth) {
      if (!this.token) throw new ForestApiError(0, 'Not authenticated: missing token')
      headers.Authorization = `Bearer ${this.token}`
    }

    if (this.verbose) {
      this.logger(`→ ${method} ${url}`)
      if (options.body !== undefined) this.logger(`  body: ${JSON.stringify(redactBody(options.body))}`)
    }

    let response: Response
    try {
      response = await this.fetchImpl(url, {
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        headers,
        method,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new ForestApiError(0, `Cannot reach Forest server at ${this.serverUrl} (${reason})`)
    }

    const rawBody = await response.text()

    if (this.verbose) this.logger(`← ${response.status} ${method} ${url}`)

    if (!response.ok) {
      throw new ForestApiError(response.status, extractDetail(rawBody))
    }

    if (!rawBody) return undefined as T

    return JSON.parse(rawBody) as T
  }
}
