import {Command, Flags} from '@oclif/core'
import {hostname} from 'node:os'

import {ForestApiError} from '../../services/api-client.js'
import {AuthError, ensureLoggedIn} from '../../services/auth.js'
import {applyInsecure, commonFlags, makeClient} from '../../services/cli-helpers.js'
import {saveToken} from '../../services/credentials.js'
import {realPrompts} from '../../services/prompts.js'

export default class TokenCreate extends Command {
  static description =
    'Create a long-lived application token (~100 years) for unattended/CI use, instead of the short session token.'

  static examples = [
    '<%= config.bin %> token create --name "ci @my-laptop"',
    '<%= config.bin %> token create --save',
  ]

  static flags = {
    ...commonFlags,
    name: Flags.string({description: 'Name shown in the Forest UI (helps identify/revoke it)'}),
    save: Flags.boolean({
      default: false,
      description: 'Persist it as the castor credential for this server (stay logged in without re-login)',
    }),
    yes: Flags.boolean({char: 'y', default: false, description: 'Non-interactive mode (no prompts)'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(TokenCreate)
    const interactive = !flags.yes && Boolean(process.stdout.isTTY)
    applyInsecure(flags.insecure, message => this.warn(message))
    const {client, serverUrl} = makeClient(flags, message => this.log(message))

    const name = flags.name ?? `castor @${hostname()}`

    try {
      await ensureLoggedIn({
        client,
        interactive,
        log: message => this.log(message),
        oauth: flags.oauth,
        prompts: realPrompts,
        serverUrl,
      })

      const token = await client.createApplicationToken(name)

      if (flags.save) await saveToken(serverUrl, token)

      this.log(`✓ Long-lived application token created — valid ~100 years (name: ${name}).\n`)
      this.log(token)
      this.log(
        '\nUse it as the FOREST_TOKEN environment variable, or re-run with --save to keep castor logged in ' +
          'without re-login. Treat it like a password; revoke it from the Forest UI if it leaks.',
      )

      if (flags.save) {
        this.log(`\n✓ Saved as your castor credential for ${serverUrl} — no re-login needed.`)
      }
    } catch (error) {
      if (error instanceof AuthError || error instanceof ForestApiError) this.error(error.message)
      throw error
    }
  }
}
