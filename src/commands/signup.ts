import {input, password as passwordPrompt} from '@inquirer/prompts'
import {Command} from '@oclif/core'

import {ForestApiError} from '../services/api-client.js'
import {ensureLoggedIn} from '../services/auth.js'
import {applyInsecure, commonFlags, makeClient} from '../services/cli-helpers.js'
import {realPrompts} from '../services/prompts.js'
import {PASSWORD_HINT, isValidPassword} from '../services/signup.js'

const MAX_PASSWORD_ATTEMPTS = 3

export default class Signup extends Command {
  static description = 'Créer un nouveau compte Forest Admin (email/mot de passe, ou --oauth pour Google/SSO).'

  static flags = {
    insecure: commonFlags.insecure,
    oauth: commonFlags.oauth,
    server: commonFlags.server,
    verbose: commonFlags.verbose,
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Signup)

    applyInsecure(flags.insecure, message => this.warn(message))
    const {client, serverUrl} = makeClient(flags, message => this.log(message))

    // Google/SSO accounts are created in the browser on first sign-in: the OAuth
    // device flow doubles as signup, so we just run it and store the token.
    if (flags.oauth) {
      await ensureLoggedIn({
        client,
        interactive: true,
        log: message => this.log(message),
        oauth: true,
        prompts: realPrompts,
        serverUrl,
      })
      this.log(`✓ Compte prêt et connecté sur ${serverUrl} (OAuth).`)

      return
    }

    const email = await input({message: 'Email'})
    const firstName = await input({message: 'Prénom'})
    const lastName = await input({message: 'Nom'})
    const password = await this.promptPassword()

    try {
      await client.signup({email, firstName, lastName, password})
    } catch (error) {
      if (error instanceof ForestApiError) {
        this.error(error.detail)
      }

      throw error
    }

    this.log(`✓ Compte créé pour ${email} sur ${serverUrl}.`)
    this.log('Connecte-toi avec : forest-onboard login')
  }

  /** Prompt for a policy-compliant password, then confirm it. */
  private async promptPassword(): Promise<string> {
    this.log(PASSWORD_HINT)

    for (let attempt = 1; attempt <= MAX_PASSWORD_ATTEMPTS; attempt++) {
      // eslint-disable-next-line no-await-in-loop
      const password = await passwordPrompt({mask: true, message: 'Mot de passe'})

      if (!isValidPassword(password)) {
        this.log(`Mot de passe trop faible. ${PASSWORD_HINT}`)
         
        continue
      }

      // eslint-disable-next-line no-await-in-loop
      const confirmation = await passwordPrompt({mask: true, message: 'Confirme le mot de passe'})
      if (password === confirmation) return password

      this.log('Les mots de passe ne correspondent pas.')
    }

    this.error('Impossible de définir le mot de passe après plusieurs tentatives.')
  }
}
