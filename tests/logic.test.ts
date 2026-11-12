import { expect, test } from 'claude-code/testing'

import {
  MAIN,
  addStep,
  applyExplained,
  applyPlan,
  emptyBoard,
  endLoopTurn,
  percentOf,
  setWaiting,
  startMainTurn,
  withLoop,
  markAgentStart,
  markAgentEnd,
  markAgentTurn,
  busyOf,
} from '../hooks/board'

const step = (id: string) => ({ id, label: id, raw: id, ok: true })
const start = (text: string) => startMainTurn(withLoop(emptyBoard, MAIN, 'ראשי', 'main'), text)

test('a late explainer reply does not reopen an ended task', async () => {
  let b = addStep(start('Research a charting library'), MAIN, step('s1'))
  b = endLoopTurn(b, MAIN)
  const task = b.loops[MAIN]!.tasks[0]!
  b = applyExplained(b, MAIN, {
    steps: [],
    stages: [],
    task: { id: task.id, about: 'x' },
    phases: [
      { title: 'מחפש מקורות', status: 'completed' },
      { title: 'מסכם', status: 'in_progress' },
    ],
    stepPhase: { s1: 0 },
  })
  expect(percentOf(b.loops[MAIN]!.tasks[0]!)).toBe(100)
})

test('two phases never share one id, and no step is lost', async () => {
  let b = addStep(start('Research'), MAIN, step('s1'))
  b = addStep(b, MAIN, step('s2'))
  const id = b.loops[MAIN]!.tasks[0]!.id
  const phases = [
    { title: 'א', status: 'completed' as const },
    { title: 'ב', status: 'in_progress' as const },
  ]
  b = applyExplained(b, MAIN, { steps: [], stages: [], task: { id, about: '' }, phases, stepPhase: { s1: 0, s2: 1 } })
  const first = b.loops[MAIN]!.tasks[0]!.subtasks
  const again = [
    { id: first[0]!.id, title: 'א', status: 'completed' as const },
    { id: first[0]!.id, title: 'ב', status: 'in_progress' as const },
  ]
  b = applyExplained(b, MAIN, { steps: [], stages: [], task: { id, about: '' }, phases: again })
  const subs = b.loops[MAIN]!.tasks[0]!.subtasks
  expect(new Set(subs.map(s => s.id)).size).toBe(2)
  expect(subs.reduce((n, s) => n + s.steps.length, 0)).toBe(2)
})

test('a question as the first call of a turn marks it waiting', async () => {
  const b = setWaiting(start('Pick one'), MAIN, 'Which first?')
  expect(b.loops[MAIN]!.tasks[0]!.waiting).toBe('Which first?')
})

test('TaskCreate replaces inferred phases', async () => {
  let b = addStep(start('Build'), MAIN, step('s1'))
  const id = b.loops[MAIN]!.tasks[0]!.id
  b = applyExplained(b, MAIN, {
    steps: [], stages: [], task: { id, about: '' },
    phases: [{ title: 'א', status: 'in_progress' }, { title: 'ב', status: 'pending' }],
  })
  b = applyPlan(b, MAIN, 'TaskCreate', { subject: 'Write code' }, '1')
  const t = b.loops[MAIN]!.tasks[0]!
  expect(t.subtasks.length).toBe(1)
  expect(t.loose.length).toBe(1)
})

test('a resumed agent counts only its working time', async () => {
  let b = withLoop(emptyBoard, 'a1', 'x', 'Explore')
  b = markAgentStart(b, 'a1', 0)
  b = markAgentEnd(b, 'a1', 30_000)
  b = markAgentTurn(b, 'a1', 20 * 60_000)
  b = markAgentEnd(b, 'a1', 20 * 60_000 + 10_000)
  expect(busyOf(b.loops.a1!, 99 * 60_000)).toBe(40_000)
})

test('a "continuation" plan that shares nothing with the current one starts a new task', async () => {
  let b = start('Improve the board')
  b = applyPlan(b, MAIN, 'mcp__ccd_turn__update_plan', { items: [{ content: 'Fix layout', status: 'in_progress' }], scope: 'first_task' })
  b = startMainTurn(b, 'Show agents in the app')
  b = applyPlan(b, MAIN, 'mcp__ccd_turn__update_plan', { items: [{ content: 'Look at the app', status: 'in_progress' }], scope: 'continuation' })
  const tasks = b.loops[MAIN]!.tasks
  expect(tasks.length).toBe(2)
  expect(tasks[1]!.title).toBe('Show agents in the app')
  // The same list again (with progress) stays on that task.
  b = applyPlan(b, MAIN, 'mcp__ccd_turn__update_plan', { items: [{ content: 'Look at the app', status: 'completed' }], scope: 'continuation' })
  expect(b.loops[MAIN]!.tasks.length).toBe(2)
})
