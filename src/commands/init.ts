import {input} from '@inquirer/prompts'
import {Command, Flags} from '@oclif/core'
import {randomBytes} from 'node:crypto'
import {readdir} from 'node:fs/promises'
import {basename, join, resolve} from 'node:path'

import {hasAddressInUse, installAgentDependencies, lastLines, startAgent} from '../services/agent-runner.js'
import {ForestApiError} from '../services/api-client.js'
import {AuthError, ensureLoggedIn} from '../services/auth.js'
import {applyInsecure, commonFlags, makeClient} from '../services/cli-helpers.js'
import {isDefaultServerUrl, resolveAppUrl} from '../services/config.js'
import {DatabaseError, resolveDatabase} from '../services/database.js'
import {CreatedProject, ProjectError, createProject} from '../services/project.js'
import {realPrompts} from '../services/prompts.js'
import {writeAgentProject} from '../services/scaffolder.js'
import {waitUntilActive} from '../services/verifier.js'

const DEFAULT_AGENT_PORT = 3310
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
  static description = 'Onboarding complet : login, création du projet, génération de l’agent, démarrage et vérification.'

  static flags = {
    ...commonFlags,
    'database-url': Flags.string({description: 'Connection string Postgres existante (sinon une base Docker est créée)'}),
    'keep-running': Flags.boolean({default: false, description: 'Garder l’agent en marche jusqu’à Ctrl-C'}),
    name: Flags.string({char: 'n', description: 'Nom du projet Forest (défaut : nom du dossier courant)'}),
    port: Flags.integer({default: DEFAULT_AGENT_PORT, description: 'Port d’écoute de l’agent'}),
    yes: Flags.boolean({char: 'y', default: false, description: 'Mode non-interactif (CI) : aucun prompt'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Init)
    const interactive = !flags.yes && Boolean(process.stdout.isTTY)

    applyInsecure(flags.insecure, message => this.warn(message))
    const {client, serverUrl} = makeClient(flags, message => this.log(message))

    try {
      // [1/5] Authentication
      this.log('[1/5] Authentification')
      await ensureLoggedIn({client, interactive, log: m => this.log(m), oauth: flags.oauth, prompts: realPrompts, serverUrl})

      // [2/5] Project creation
      this.log('[2/5] Création du projet')
      const forestName = await this.resolveProjectName(flags.name, interactive)
      const created = await this.createProjectWithRetry(client, forestName, interactive)
      const slug = slugify(forestName)
      const targetDir = resolve(process.cwd(), slug)
      await this.assertDirIsFree(targetDir)

      // [3/5] Database
      this.log('[3/5] Base de données')
      const database = await resolveDatabase({
        databaseUrl: flags['database-url'],
        log: m => this.log(`  ${m}`),
        targetDir,
      })

      // [4/5] Scaffold + install + declare endpoint
      this.log('[4/5] Génération du projet et installation')
      const authSecret = randomBytes(32).toString('hex')
      const {port} = flags
      await writeAgentProject(targetDir, {
        agentPort: port,
        authSecret,
        databaseUrl: database.databaseUrl,
        envSecret: created.envSecret,
        name: slug,
        serverUrl: isDefaultServerUrl(serverUrl) ? undefined : serverUrl,
      })

      const install = await installAgentDependencies({dir: targetDir, logFile: join(targetDir, 'install.log')})
      if (install.code !== 0) {
        this.error(`npm install a échoué (voir ${join(slug, 'install.log')}).`)
      }

      await client.setEnvironmentApiEndpoint(created.environmentId, `http://localhost:${port}`)

      // [5/5] Start + verify
      this.log('[5/5] Démarrage de l’agent et vérification')
      const agent = startAgent({dir: targetDir, logFile: join(targetDir, 'agent.log')})

      const active = await waitUntilActive(() => client.getEnvironmentIsActive(created.environmentId))

      if (!active) {
        const output = agent.getOutput()
        await agent.stop()
        if (hasAddressInUse(output)) {
          this.error(`Le port ${port} est déjà utilisé. Relance avec --port ${port + 1}.`)
        }

        this.log(lastLines(output, 30))
        this.error(`L’agent n’a pas rejoint le serveur ${serverUrl} sous 90 s. Vérifie qu’il tourne et qu’il y a accès.`)
      }

      await this.reportSuccess({agent, created, keepRunning: flags['keep-running'], serverUrl, slug})
    } catch (error) {
      this.handleError(error)
    }
  }

  private async assertDirIsFree(targetDir: string): Promise<void> {
    try {
      const entries = await readdir(targetDir)
      if (entries.length > 0) {
        this.error(`Le dossier ${targetDir} existe déjà et n’est pas vide. Supprime-le ou choisis un autre nom.`)
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
        this.error(`Un projet « ${name} » existe déjà et est actif. Choisis un autre nom avec --name.`)
      }

      this.log(`Le projet « ${name} » existe déjà. Choisis un autre nom.`)
      // eslint-disable-next-line no-await-in-loop
      name = await input({default: `${name}-2`, message: 'Nouveau nom du projet'})
    }

    this.error('Impossible de créer le projet : nom déjà utilisé après plusieurs tentatives.')
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
    created: CreatedProject
    keepRunning: boolean
    serverUrl: string
    slug: string
  }): Promise<void> {
    const app = resolveAppUrl(options.serverUrl)

    this.log('')
    this.log(`✓ Projet « ${options.created.environmentName} » opérationnel !`)
    this.log(`  App      : ${app.url}${app.uncertain ? ' (ouvre l’app associée à ce serveur)' : ''}`)
    this.log(`  Code     : ./${options.slug}`)
    this.log(`  Relancer : cd ${options.slug} && npm start`)

    if (options.keepRunning) {
      this.log('')
      this.log('Agent en cours d’exécution. Ctrl-C pour arrêter.')
      await new Promise<void>(resolveWait => {
        process.once('SIGINT', () => resolveWait())
      })
    }

    await options.agent.stop()
  }

  private async resolveProjectName(flagName: string | undefined, interactive: boolean): Promise<string> {
    if (flagName) return flagName

    if (!interactive) {
      this.error('Le nom du projet est requis en mode --yes : ajoute --name <nom>.')
    }

    return input({default: basename(process.cwd()), message: 'Nom du projet Forest'})
  }
}
