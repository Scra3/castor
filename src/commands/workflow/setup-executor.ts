import {Command, Flags} from '@oclif/core'
import {readFile, writeFile} from 'node:fs/promises'
import {basename, join, resolve} from 'node:path'

import {isDefaultServerUrl} from '../../services/config.js'
import {readEnvFile} from '../../services/env-file.js'
import {ExecutorError} from '../../services/executor/errors.js'
import {
  executorErrorReason,
  installExecutorDependencies,
  lastLines,
  startExecutor,
  waitForExecutorReady,
} from '../../services/executor/runner.js'
import {writeExecutorProject} from '../../services/executor/scaffolder.js'

const DEFAULT_HTTP_PORT = 3400
const DEFAULT_AGENT_PORT = 3310

export default class WorkflowSetupExecutor extends Command {
  static description = 'Scaffold, install and start a workflow executor for the agent (orchestrator engine).'

  static examples = [
    '<%= config.bin %> workflow setup-executor --project-dir ./my-project',
    '<%= config.bin %> workflow setup-executor --project-dir ./my-project --in-memory',
  ]

  static flags = {
    'database-url': Flags.string({description: 'Postgres URL for the run store (default: the agent’s DATABASE_URL)'}),
    'executor-dir': Flags.string({description: 'Where to scaffold the executor (default: <project-dir>/workflow-executor)'}),
    'in-memory': Flags.boolean({default: false, description: 'Run with no database (run state lost on restart)'}),
    port: Flags.integer({default: DEFAULT_HTTP_PORT, description: 'Executor HTTP port'}),
    'project-dir': Flags.string({description: 'Agent project directory (reads its .env for secrets and port)', required: true}),
    server: Flags.string({description: 'Forest API server URL (default: the agent’s, or production)'}),
    verbose: Flags.boolean({default: false, description: 'Stream the executor output'}),
    yes: Flags.boolean({char: 'y', default: false, description: 'Non-interactive mode'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(WorkflowSetupExecutor)
    const projectDir = resolve(flags['project-dir'])

    try {
      const agentEnv = await this.readAgentEnv(projectDir)

      const authSecret = agentEnv.FOREST_AUTH_SECRET
      const envSecret = agentEnv.FOREST_ENV_SECRET
      if (!authSecret || !envSecret) {
        throw new ExecutorError(`FOREST_AUTH_SECRET / FOREST_ENV_SECRET missing from ${join(projectDir, '.env')}.`)
      }

      const databaseUrl = flags['in-memory'] ? undefined : flags['database-url'] ?? agentEnv.DATABASE_URL
      if (!flags['in-memory'] && !databaseUrl) {
        throw new ExecutorError('No DATABASE_URL for the run store. Pass --database-url, or use --in-memory.')
      }

      const agentPort = Number(agentEnv.AGENT_PORT) || DEFAULT_AGENT_PORT
      const serverUrl = flags.server ?? agentEnv.FOREST_SERVER_URL
      const executorDir = resolve(flags['executor-dir'] ?? join(projectDir, 'workflow-executor'))

      this.log(`Scaffolding the workflow executor in ${executorDir}…`)
      await writeExecutorProject(executorDir, {
        agentUrl: `http://localhost:${agentPort}`,
        authSecret,
        databaseUrl,
        envSecret,
        httpPort: flags.port,
        name: basename(projectDir),
        serverUrl: serverUrl && !isDefaultServerUrl(serverUrl) ? serverUrl : undefined,
      })

      this.log('Installing dependencies (npm install)…')
      const install = await installExecutorDependencies({dir: executorDir, logFile: join(executorDir, 'install.log')})
      if (install.code !== 0) {
        throw new ExecutorError(`npm install failed (see ${join(executorDir, 'install.log')}).`)
      }

      this.log('Starting the executor…')
      const executor = startExecutor({
        dir: executorDir,
        inMemory: flags['in-memory'],
        logFile: join(executorDir, 'executor.log'),
        onOutput: flags.verbose ? chunk => this.log(chunk.replace(/\n$/, '')) : undefined,
      })

      const {output, ready} = await waitForExecutorReady(executor)
      if (!ready) {
        await executor.stop()
        this.log(lastLines(output, 20))
        throw new ExecutorError(executorErrorReason(output))
      }

      // Wire the agent so it proxies trigger/status to the executor (exposes it to Forest).
      const wired = await this.wireAgent(projectDir, `http://localhost:${flags.port}`)

      this.log('')
      this.log(`✓ Workflow executor running on http://localhost:${flags.port} (health: /health).`)
      if (wired) {
        this.log('→ Set WORKFLOW_EXECUTOR_URL in the agent .env. Restart the agent to expose the executor to Forest.')
      }

      this.log('Leave it running. Ctrl-C to stop.')
    } catch (error) {
      if (error instanceof ExecutorError) this.error(error.message)
      throw error
    }
  }

  /** Read the agent's .env, surfacing a clear error if the directory is wrong. */
  private async readAgentEnv(projectDir: string): Promise<Record<string, string>> {
    try {
      return await readEnvFile(join(projectDir, '.env'))
    } catch {
      throw new ExecutorError(`Cannot read ${join(projectDir, '.env')} — check --project-dir.`)
    }
  }

  /** Add WORKFLOW_EXECUTOR_URL to the agent's .env if absent. Returns true when written. */
  private async wireAgent(projectDir: string, executorUrl: string): Promise<boolean> {
    const envPath = join(projectDir, '.env')
    const content = await readFile(envPath, 'utf8')
    if (/^WORKFLOW_EXECUTOR_URL=/m.test(content)) return false

    await writeFile(envPath, `${content.replace(/\n*$/, '\n')}WORKFLOW_EXECUTOR_URL=${executorUrl}\n`, 'utf8')

    return true
  }
}
