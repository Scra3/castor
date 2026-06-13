import {input} from '@inquirer/prompts'
import {Command, Flags} from '@oclif/core'
import {randomBytes} from 'node:crypto'
import {readdir} from 'node:fs/promises'
import {basename, join, resolve} from 'node:path'

import {hasAddressInUse, installAgentDependencies, lastLines, startAgent} from '../services/agent-runner.js'
import {ForestApiError} from '../services/api-client.js'
import {AuthError, ensureLoggedIn} from '../services/auth.js'
import {applyInsecure, commonFlags, makeClient, openUrl} from '../services/cli-helpers.js'
import {isDefaultServerUrl, resolveAppUrl} from '../services/config.js'
import {DatabaseError, resolveDatabase} from '../services/database.js'
import {
  type ExecutorHandle,
  executorErrorReason,
  installExecutorDependencies,
  startExecutor,
  waitForExecutorReady,
} from '../services/executor/runner.js'
import {writeExecutorProject} from '../services/executor/scaffolder.js'
import {CreatedProject, ProjectError, createProject} from '../services/project.js'
import {realConfirm, realPrompts} from '../services/prompts.js'
import {writeAgentProject} from '../services/scaffolder.js'
import {waitUntilActive} from '../services/verifier.js'

const DEFAULT_AGENT_PORT = 3310
const DEFAULT_EXECUTOR_PORT = 3400
const MAX_NAME_ATTEMPTS = 3

/** Turn a free-form project name into a safe directory / npm package name. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^\da-z-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')

  return slug || 'forest-agent'
}

export default class Init extends Command {
  static description = 'Complete onboarding: login, project creation, agent generation, start and verification.'

  static flags = {
    ...commonFlags,
    'database-url': Flags.string({description: 'Existing Postgres connection string (otherwise a Docker database is created)'}),
    'executor-in-memory': Flags.boolean({default: false, description: 'Run the workflow executor with no database'}),
    'executor-port': Flags.integer({default: DEFAULT_EXECUTOR_PORT, description: 'Workflow executor HTTP port'}),
    name: Flags.string({char: 'n', description: 'Forest project name (default: current directory name)'}),
    port: Flags.integer({default: DEFAULT_AGENT_PORT, description: 'Port the agent listens on'}),
    'with-executor': Flags.boolean({default: false, description: 'Also set up and start a workflow executor'}),
    yes: Flags.boolean({char: 'y', default: false, description: 'Non-interactive mode (CI): no prompts'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Init)
    const interactive = !flags.yes && Boolean(process.stdout.isTTY)

    applyInsecure(flags.insecure, message => this.warn(message))
    const {client, serverUrl} = makeClient(flags, message => this.log(message))

    try {
      // [1/5] Authentication
      this.log('[1/5] Authentication')
      const session = await ensureLoggedIn({
        client,
        interactive,
        log: m => this.log(m),
        oauth: flags.oauth,
        prompts: realPrompts,
        serverUrl,
      })

      // [2/5] Project creation
      this.log('[2/5] Creating the project')
      const forestName = await this.resolveProjectName(flags.name, interactive)
      const created = await this.createProjectWithRetry(client, forestName, interactive)
      const slug = slugify(forestName)
      const targetDir = resolve(process.cwd(), slug)
      await this.assertDirIsFree(targetDir)

      // [3/5] Database
      this.log('[3/5] Database')
      const database = await resolveDatabase({
        databaseUrl: flags['database-url'],
        log: m => this.log(`  ${m}`),
        targetDir,
      })

      // Decide on the workflow executor before scaffolding so the agent can be wired to it.
      const withExecutor =
        flags['with-executor'] ||
        (interactive && (await realConfirm('Also set up a workflow executor? (needed for the orchestrator engine)')))

      // [4/5] Scaffold + install + declare endpoint
      this.log('[4/5] Generating the project and installing')
      const authSecret = randomBytes(32).toString('hex')
      const {port} = flags
      const executorPort = flags['executor-port']
      await writeAgentProject(targetDir, {
        agentPort: port,
        authSecret,
        databaseUrl: database.databaseUrl,
        envSecret: created.envSecret,
        name: slug,
        serverUrl: isDefaultServerUrl(serverUrl) ? undefined : serverUrl,
        workflowExecutorUrl: withExecutor ? `http://localhost:${executorPort}` : undefined,
      })

      const install = await installAgentDependencies({dir: targetDir, logFile: join(targetDir, 'install.log')})
      if (install.code !== 0) {
        this.error(`npm install failed (see ${join(slug, 'install.log')}).`)
      }

      await client.setEnvironmentApiEndpoint(created.environmentId, `http://localhost:${port}`)

      // [5/5] Start + verify
      this.log('[5/5] Starting the agent and verifying')
      const agent = startAgent({dir: targetDir, logFile: join(targetDir, 'agent.log')})

      const active = await waitUntilActive(() => client.getEnvironmentIsActive(created.environmentId))

      if (!active) {
        const output = agent.getOutput()
        await agent.stop()
        if (hasAddressInUse(output)) {
          this.error(`Port ${port} is already in use. Retry with --port ${port + 1}.`)
        }

        this.log(lastLines(output, 30))
        this.error(`The agent did not reach the server ${serverUrl} within 90s. Check that it is running and reachable.`)
      }

      // Optional: workflow executor (best-effort — never fails the onboarding).
      let executor: ExecutorHandle | null = null
      if (withExecutor) {
        this.log('[+] Setting up the workflow executor')
        executor = await this.setupExecutor({
          agentPort: port,
          authSecret,
          databaseUrl: database.databaseUrl,
          envSecret: created.envSecret,
          executorPort,
          inMemory: flags['executor-in-memory'],
          serverUrl,
          slug,
          targetDir,
        })
      }

      await this.reportSuccess({
        agent,
        email: session.email,
        executor,
        executorPort,
        interactive,
        password: session.password,
        projectName: forestName,
        serverUrl,
        slug,
      })
    } catch (error) {
      this.handleError(error)
    }
  }

  private async assertDirIsFree(targetDir: string): Promise<void> {
    try {
      const entries = await readdir(targetDir)
      if (entries.length > 0) {
        this.error(`The directory ${targetDir} already exists and is not empty. Delete it or choose another name.`)
      }
    } catch {
      // Directory does not exist yet — good.
    }
  }

  private async createProjectWithRetry(
    client: Parameters<typeof createProject>[0],
    initialName: string,
    interactive: boolean,
  ): Promise<CreatedProject> {
    let name = initialName

    for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
      // eslint-disable-next-line no-await-in-loop
      const created = await createProject(client, name)

      if (!created.alreadyActive) return created

      if (!interactive) {
        this.error(`A project named "${name}" already exists and is active. Choose another name with --name.`)
      }

      this.log(`The project "${name}" already exists. Choose another name.`)
      // eslint-disable-next-line no-await-in-loop
      name = await input({default: `${name}-2`, message: 'New project name'})
    }

    this.error('Unable to create the project: name already taken after several attempts.')
  }

  /** Map known domain errors to a clean CLI exit; rethrow unexpected ones. */
  private handleError(error: unknown): never {
    if (
      error instanceof AuthError ||
      error instanceof DatabaseError ||
      error instanceof ProjectError ||
      error instanceof ForestApiError
    ) {
      this.error(error.message)
    }

    throw error
  }

  private async reportSuccess(options: {
    agent: ReturnType<typeof startAgent>
    email?: string
    executor?: ExecutorHandle | null
    executorPort?: number
    interactive: boolean
    password?: string
    projectName: string
    serverUrl: string
    slug: string
  }): Promise<void> {
    const app = resolveAppUrl(options.serverUrl)
    const loginUrl = `${app.url}/authentication/login`

    this.log('')
    this.log(`✓ Project "${options.projectName}" is up and running!`)
    this.log(`  Code    : ./${options.slug}`)
    this.log(`  Restart : cd ${options.slug} && npm start`)
    if (options.executor) {
      this.log(`  Workflow executor : http://localhost:${options.executorPort} (./${options.slug}/workflow-executor)`)
    }

    this.log('')

    // Credentials box to copy/paste on the login page.
    this.log('Credentials to sign in:')
    if (options.email) this.log(`  Email    : ${options.email}`)
    if (options.password) this.log(`  Password : ${options.password}`)
    if (!options.email) this.log('  (your existing session — no password to enter)')
    this.log(`  Login    : ${loginUrl}`)

    // Open the login page so the user can paste the credentials.
    openUrl(loginUrl)

    // Keep the agent (and executor) running so the data is live in the app.
    if (options.interactive) {
      this.log('')
      const what = options.executor ? 'Agent and workflow executor running' : 'Agent running (live data in the app)'
      this.log(`${what}. Press Ctrl-C to stop.`)
      await new Promise<void>(resolveWait => {
        process.once('SIGINT', () => resolveWait())
      })
    }

    await Promise.all([options.agent.stop(), options.executor?.stop()])
  }

  private async resolveProjectName(flagName: string | undefined, interactive: boolean): Promise<string> {
    if (flagName) return flagName

    if (!interactive) {
      this.error('The project name is required in --yes mode: add --name <name>.')
    }

    return input({default: basename(process.cwd()), message: 'Forest project name'})
  }

  /** Scaffold + install + start the workflow executor; best-effort (returns null on failure). */
  private async setupExecutor(options: {
    agentPort: number
    authSecret: string
    databaseUrl: string
    envSecret: string
    executorPort: number
    inMemory: boolean
    serverUrl: string
    slug: string
    targetDir: string
  }): Promise<ExecutorHandle | null> {
    const executorDir = join(options.targetDir, 'workflow-executor')

    await writeExecutorProject(executorDir, {
      agentUrl: `http://localhost:${options.agentPort}`,
      authSecret: options.authSecret,
      databaseUrl: options.inMemory ? undefined : options.databaseUrl,
      envSecret: options.envSecret,
      httpPort: options.executorPort,
      name: options.slug,
      serverUrl: isDefaultServerUrl(options.serverUrl) ? undefined : options.serverUrl,
    })

    const install = await installExecutorDependencies({
      dir: executorDir,
      logFile: join(executorDir, 'install.log'),
    })
    if (install.code !== 0) {
      this.warn(`Executor npm install failed (see ${join(options.slug, 'workflow-executor', 'install.log')}). Skipped.`)

      return null
    }

    const handle = startExecutor({
      dir: executorDir,
      inMemory: options.inMemory,
      logFile: join(executorDir, 'executor.log'),
    })
    const {output, ready} = await waitForExecutorReady(handle)
    if (!ready) {
      await handle.stop()
      this.warn(`Workflow executor not started: ${executorErrorReason(output)}`)

      return null
    }

    return handle
  }
}
