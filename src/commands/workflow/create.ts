import {Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'

import {parseWorkflowSpec} from '../../services/workflow/bpmn.js'
import {printJson, withWorkflow, workflowFlags} from '../../services/workflow/command.js'
import {createWorkflow} from '../../services/workflow/create.js'
import {WorkflowError} from '../../services/workflow/errors.js'

export default class WorkflowCreate extends Command {
  static description = 'Create a workflow from a YAML spec (compiled to BPMN) — orchestrator engine only.'

  static examples = ['<%= config.bin %> workflow create -f workflow.yml --project "My Project"']

  static flags = {
    ...workflowFlags,
    collection: Flags.string({description: 'Override the spec’s collection'}),
    file: Flags.string({char: 'f', description: 'Path to the YAML workflow spec', required: true}),
    name: Flags.string({description: 'Override the spec’s name'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(WorkflowCreate)

    await withWorkflow(this, flags, async ({client, renderingId, scope}) => {
      const yaml = await readFile(flags.file, 'utf8').catch(() => {
        throw new WorkflowError(`Cannot read the spec file ${flags.file}.`)
      })
      const spec = parseWorkflowSpec(yaml)
      if (flags.name) spec.name = flags.name
      if (flags.collection) spec.collection = flags.collection

      const result = await createWorkflow({client, renderingId, scope, spec})
      this.log(`✓ Workflow "${result.name}" created on "${result.collectionId}".`)
      printJson(this, result)
      this.log('')
      this.log('Run it with:')
      this.log(`  forest-onboard workflow run --workflow ${result.id} --collection ${result.collectionId} --record <id> --project-dir <agent-dir>`)
    })
  }
}
