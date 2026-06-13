/**
 * Generate a runnable `@forestadmin/workflow-executor` project next to the agent.
 *
 * Pure builder (`buildExecutorProjectFiles`, snapshot-testable) + IO writer
 * (`writeExecutorProject`), mirroring services/scaffolder.ts. The executor's CLI
 * does NOT auto-load `.env`, so the start scripts pass `node --env-file=.env`.
 */
import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Published version of the executor installed into the generated project. */
export const EXECUTOR_PACKAGE_VERSION = '^1.2.0'

const CLI_ENTRY = 'node_modules/@forestadmin/workflow-executor/dist/cli.js'

export type ExecutorScaffoldOptions = {
  /** Root URL of the running agent, e.g. http://localhost:3310 */
  agentUrl: string
  /** Must match the agent's FOREST_AUTH_SECRET. */
  authSecret: string
  /** Postgres URL for the run store; omitted for in-memory-only use. */
  databaseUrl?: string
  envSecret: string
  httpPort: number
  /** Used to name the generated package. */
  name: string
  /** Omitted when targeting the production server. */
  serverUrl?: string
}

function buildEnv(options: ExecutorScaffoldOptions): string {
  const lines = [
    `FOREST_AUTH_SECRET=${options.authSecret}`,
    `FOREST_ENV_SECRET=${options.envSecret}`,
    `AGENT_URL=${options.agentUrl}`,
    `HTTP_PORT=${options.httpPort}`,
  ]
  if (options.databaseUrl) lines.push(`DATABASE_URL=${options.databaseUrl}`)
  if (options.serverUrl) lines.push(`FOREST_SERVER_URL=${options.serverUrl}`)

  return `${lines.join('\n')}\n`
}

function buildGitignore(): string {
  return `${['node_modules/', '.env', '*.log'].join('\n')}\n`
}

function buildPackageJson(name: string): string {
  const pkg = {
    dependencies: {'@forestadmin/workflow-executor': EXECUTOR_PACKAGE_VERSION},
    engines: {node: '>=22.12.0'},
    name: `${name}-workflow-executor`,
    private: true,
    scripts: {
      start: `node --env-file=.env ${CLI_ENTRY}`,
      'start:memory': `node --env-file=.env ${CLI_ENTRY} --in-memory`,
    },
    version: '0.0.0',
  }

  return `${JSON.stringify(pkg, null, 2)}\n`
}

function buildReadme(name: string): string {
  return [
    `# ${name} — workflow executor`,
    '',
    'Runs the Forest Admin workflow engine: polls the orchestrator for pending runs',
    'and executes their steps against the agent. Requires **Node >= 22.12.0**.',
    '',
    '```sh',
    'npm install',
    'npm start            # database mode (uses DATABASE_URL)',
    'npm run start:memory # in-memory mode (no database; run state lost on restart)',
    '```',
    '',
    'Health check: `GET http://localhost:$HTTP_PORT/health`.',
    '',
  ].join('\n')
}

/** Build the executor project files (path -> content). */
export function buildExecutorProjectFiles(options: ExecutorScaffoldOptions): Record<string, string> {
  return {
    '.env': buildEnv(options),
    '.gitignore': buildGitignore(),
    'README.md': buildReadme(options.name),
    'package.json': buildPackageJson(options.name),
  }
}

/** Write the executor project to disk. */
export async function writeExecutorProject(targetDir: string, options: ExecutorScaffoldOptions): Promise<void> {
  await mkdir(targetDir, {recursive: true})
  const files = buildExecutorProjectFiles(options)
  await Promise.all(
    Object.entries(files).map(([relativePath, content]) => writeFile(join(targetDir, relativePath), content, 'utf8')),
  )
}
