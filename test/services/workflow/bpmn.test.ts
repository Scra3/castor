import {expect} from 'chai'

import {compileWorkflowToBpmn, parseWorkflowSpec} from '../../../src/services/workflow/bpmn.js'
import {WorkflowError} from '../../../src/services/workflow/errors.js'

const LINEAR = `
name: Update email
collection: customers
steps:
  - {id: read, type: read, title: Read, auto: true, next: update}
  - {id: update, type: update, title: Update the email, next: done}
  - {id: done, type: end, title: Finished}
`

describe('workflow/bpmn.parseWorkflowSpec', () => {
  it('parses a valid linear spec and defaults start to the first step', () => {
    const spec = parseWorkflowSpec(LINEAR)
    expect(spec.name).to.equal('Update email')
    expect(spec.collection).to.equal('customers')
    expect(spec.start).to.equal('read')
    expect(spec.steps).to.have.length(3)
  })

  it('rejects an unknown step type', () => {
    const yaml = 'name: x\ncollection: c\nsteps:\n  - {id: a, type: frobnicate, next: b}\n  - {id: b, type: end}'
    expect(() => parseWorkflowSpec(yaml)).to.throw(WorkflowError, /unsupported type/)
  })

  it('rejects a dangling next', () => {
    const yaml = 'name: x\ncollection: c\nsteps:\n  - {id: a, type: read, next: ghost}\n  - {id: z, type: end}'
    expect(() => parseWorkflowSpec(yaml)).to.throw(WorkflowError, /unknown step "ghost"/)
  })

  it('requires at least one end step', () => {
    const yaml = 'name: x\ncollection: c\nsteps:\n  - {id: a, type: read, next: a}'
    expect(() => parseWorkflowSpec(yaml)).to.throw(WorkflowError, /at least one `end`/)
  })

  it('requires a condition to have >= 2 branches', () => {
    const yaml =
      'name: x\ncollection: c\nsteps:\n  - {id: g, type: condition, branches: [{answer: Yes, next: e}]}\n  - {id: e, type: end}'
    expect(() => parseWorkflowSpec(yaml)).to.throw(WorkflowError, /at least 2 `branches`/)
  })

  it('requires mcpServerId for an mcp step', () => {
    const yaml = 'name: x\ncollection: c\nsteps:\n  - {id: m, type: mcp, next: e}\n  - {id: e, type: end}'
    expect(() => parseWorkflowSpec(yaml)).to.throw(WorkflowError, /mcpServerId/)
  })
})

describe('workflow/bpmn.compileWorkflowToBpmn', () => {
  it('emits a start event into the entry and the right forest:alternative per type', () => {
    const {bpmn, entryId} = compileWorkflowToBpmn(parseWorkflowSpec(LINEAR))
    expect(entryId).to.equal('read')
    expect(bpmn).to.contain('<bpmn:startEvent id="Start_1">')
    expect(bpmn).to.contain('sourceRef="Start_1" targetRef="read"')
    expect(bpmn).to.contain('id="read" name="Read" forest:alternative="get-data" forest:automaticExecution="true"')
    expect(bpmn).to.contain('id="update" name="Update the email" forest:alternative="update-data"')
    expect(bpmn).to.contain('<bpmn:endEvent id="done"')
    expect(bpmn).to.contain('sourceRef="read" targetRef="update"')
    expect(bpmn).to.contain('sourceRef="update" targetRef="done"')
  })

  it('renders condition branches as named sequence flows', () => {
    const yaml =
      'name: x\ncollection: customers\nstart: g\nsteps:\n' +
      '  - {id: g, type: condition, title: Has email?, branches: [{answer: Yes, color: green, next: u}, {answer: No, next: e}]}\n' +
      '  - {id: u, type: update, next: e}\n  - {id: e, type: end}'
    const {bpmn} = compileWorkflowToBpmn(parseWorkflowSpec(yaml))
    expect(bpmn).to.contain('<bpmn:exclusiveGateway id="g"')
    expect(bpmn).to.contain('sourceRef="g" targetRef="u" name="Yes" forest:buttonColor="green"')
    expect(bpmn).to.contain('sourceRef="g" targetRef="e" name="No"')
  })

  it('XML-escapes titles and prompts', () => {
    const yaml = 'name: x\ncollection: c\nsteps:\n  - {id: a, type: read, title: "A & <b>", prompt: "x\\"y", next: e}\n  - {id: e, type: end}'
    const {bpmn} = compileWorkflowToBpmn(parseWorkflowSpec(yaml))
    expect(bpmn).to.contain('name="A &amp; &lt;b&gt;"')
    expect(bpmn).to.contain('forest:description="x&quot;y"')
  })
})
