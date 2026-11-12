import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'task-board',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 40,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 39 },
    view: {},
  },
} as const

const PLAN = 'mcp__ccd_turn__update_plan'

test('main plan, steps and a subagent show on the band', async ($, on) => {
  mock.clock(on)
  // Hooks here stand for the engine beneath the mod.
  on('command.register', () => ({ value: { command: 'task-board' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Search the docs', type: 'Explore', status: 'running' }],
  }))

  // Loose inputs: the MCP tools' own types are too deep to spell here.
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Build the task board mod', turnId: 't1' })

  await call({
    tool: PLAN,
    items: [
      { content: 'Read the API', status: 'in_progress' },
      { content: 'Write files', status: 'pending' },
      { content: 'Test', status: 'pending' },
      { content: 'Ship', status: 'pending' },
    ],
    scope: 'first_task',
  })
  await call({ tool: 'Bash', command: 'ls', description: 'List the folder' })
  await call({ tool: PLAN, advance: true })
  await call({ tool: 'Bash', command: 'cat x', description: 'Print x' })

  await $.agent.spawn({ prompt: 'look', description: 'Search the docs', subagentType: 'Explore' } as never)
  await call({ tool: 'Bash', command: 'grep a', description: 'Grep docs', agentId: 'a1' })
  await call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Find page', status: 'completed', activeForm: 'x' },
      { content: 'Summarize', status: 'in_progress', activeForm: 'y' },
    ],
    agentId: 'a1',
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    // Collapsed: the header alone, 1 of 4 done.
    expect((await ui.find({ type: 'Text', text: /Build the task board mod/ }))?.text).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^28%$/ }))?.text).toBe('28%')
    // Closed: one thin line, with what is left; the plan waits for "details".
    expect((await ui.find({ type: 'Text', text: /עוד 3 שלבים/ }))?.text).toBe('· עוד 3 שלבים')
    expect(await ui.find({ type: 'Text', text: /סוכן אחד/ })).toBeDefined()
    // A drawn bar on the desktop, glyphs on the terminal.
    if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeDefined()
    else expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Ship$/ })).toBeUndefined()

    // Open: subtasks and the in-progress subtask's steps.
    await ui.press({ key: 'toggle-board' })
    expect(await ui.find({ text: /^Ship$/ })).toBeDefined()
    expect(await ui.find({ text: /Print x/ })).toBeDefined()

    // Pick the subagent: its own plan, 50%.
    await ui.press({ key: 'loop-a1' })
    expect(await ui.find({ text: /Summarize/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^55%$/ }))?.text).toBe('55%')

    // Back to main, then the red ✕ closes it to one line.
    await ui.press({ key: 'loop-main' })
    await ui.press({ key: 'close-board' })
    expect(await ui.find({ type: 'Text', text: /^Ship$/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('nothing tracked yet: the band passes', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('the explainer writes what and why for each step', async ($, on) => {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'task-board' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'Now I write the tests.', toolUses: [] }] }))
  let asked = ''
  on('model.complete', (_, e) => {
    asked = String(e.prompt)
    const ids = [...asked.matchAll(/- id (\S+):/g)].map(m => m[1])
    const task = /מזהה המשימה: (\S+)/.exec(asked)?.[1] ?? ''
    const text = JSON.stringify({
      steps: ids.map(id => ({ id, what: 'כותב את קובץ הבדיקות של הפס', why: 'כדי לוודא שהאחוזים נכונים' })),
      stages: [],
      task: { id: task, about: 'בונה פס משימות מעל חלון הכתיבה' },
    })
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as never
  })
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Build the board', turnId: 't1' })
  await call({ tool: 'Write', file_path: '/x/tests/board.test.tsx', content: 'test(...)' })
  await clock.advance(2000)

  expect(asked).toContain('board.test.tsx')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'toggle-board' })
  expect(await ui.find({ text: /כותב את קובץ הבדיקות/ })).toBeDefined()
  // The why stays closed until its purple arrow is pressed.
  expect(await ui.find({ type: 'Text', text: /כדי לוודא שהאחוזים נכונים/ })).toBeUndefined()
  const stepId = /- id (\S+):/.exec(asked)?.[1]
  await ui.press({ key: `arrow-st-${stepId}` })
  expect(await ui.find({ type: 'Text', text: /כדי לוודא שהאחוזים נכונים/ })).toBeDefined()
  // The overall goal is always on screen, under the title.
  expect(await ui.find({ text: /בונה פס משימות/ })).toBeDefined()
  await ui.unmount()
})

test('a research task with no plan gets Hebrew phases and a percent', async ($, on) => {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'task-board' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  on('session.messages', () => ({ value: [] }))
  on('model.complete', (_, e) => {
    const asked = String(e.prompt)
    const ids = [...asked.matchAll(/- id (\S+):/g)].map(m => m[1]!)
    const task = /מזהה המשימה: (\S+)/.exec(asked)?.[1] ?? ''
    const text = JSON.stringify({
      steps: ids.map(id => ({ id, what: 'מחפש את הערות השחרור של ספריית הגרפים', why: 'כדי לדעת מה חדש' })),
      stages: [],
      phases: [
        { title: 'מחפש מקורות', status: 'completed' },
        { title: 'בודק מה חדש בגרסה', status: 'in_progress' },
        { title: 'מסכם את הממצאים', status: 'pending' },
        { title: 'מגבש דעה והמלצה', status: 'pending' },
      ],
      stepPhase: Object.fromEntries(ids.map(id => [id, 1])),
      task: { id: task, about: 'חוקר ספריית גרפים' },
    })
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as never
  })
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Research a charting library', turnId: 't1' })
  await call({ tool: 'WebSearch', query: 'charting library release notes' })
  await clock.advance(2000)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^28%$/ }))?.text).toBe('28%')
  expect(await ui.find({ text: /בודק מה חדש בגרסה|28%/ })).toBeDefined()
  await ui.press({ key: 'toggle-board' })
  expect(await ui.find({ text: /מגבש דעה והמלצה/ })).toBeDefined()
  expect(await ui.find({ text: /מחפש את הערות השחרור/ })).toBeDefined()
  await ui.unmount()
})

test('a question to the person shows as waiting for a decision', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'task-board' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Pick an approach', turnId: 't1' })
  await call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'Compare options', status: 'in_progress' }], scope: 'first_task' })
  await call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'done', ask: 'Which option first?' })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /ממתין להחלטה שלך/ })).toBeDefined()
  await ui.unmount()
})

test('the agents panel says who runs in parallel, who waits and who is done', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'task-board' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  let n = 0
  on('agent.spawn', () => ({ model: 'm', agentId: `a${++n}` }))
  on('agent.list', () => ({
    value: [
      { id: 'a1', description: 'Search docs', type: 'Explore', status: 'running' },
      { id: 'a2', description: 'Review code', type: 'general-purpose', status: 'running' },
      { id: 'a3', description: 'Write summary', type: 'general-purpose', status: 'pending' },
      { id: 'a4', description: 'Check tests', type: 'general-purpose', status: 'completed' },
    ],
  }))
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Research', turnId: 't1' })
  // The main task exists before it spawns (its Agent calls are steps of it).
  await call({ tool: 'Read', file_path: '/x/plan.md' })
  for (const d of ['Search docs', 'Review code', 'Write summary', 'Check tests']) {
    await $.agent.spawn({ prompt: d, description: d, subagentType: 'general-purpose' } as never)
  }
  await call({ tool: 'Grep', pattern: 'release', description: 'x', agentId: 'a1' })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /2 סוכנים רצים במקביל · אחד בתור · אחד הושלם/ })).toBeDefined()
  await ui.press({ key: 'toggle-board' })
  // The summary says it once; no repeated "in parallel" line, no hint text.
  expect(await ui.find({ type: 'Text', text: /⇉/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /לחיצה על שם סוכן/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^בתור$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^הושלם$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /חיפוש · release/ })).toBeDefined()
  await ui.press({ key: 'loop-a1' })
  // The top line stays on the main task; the agent's own steps open below.
  expect((await ui.find({ text: /^Research$/ }))?.text).toBe('Research')
  expect(await ui.find({ text: /^Search docs$/ })).toBeDefined()
  await ui.unmount()
})

test('an agent the session no longer lists, with no recorded start, is done', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'task-board' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }) as never)
  // Listed while it runs (so the board picks it up), gone afterwards.
  let listed = true
  on('agent.list', () => ({
    value: listed ? [{ id: 'old', description: 'Old review', type: 'general-purpose', status: 'running' }] : [],
  }))
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Main', turnId: 't1' })
  await call({ tool: 'Grep', pattern: 'x', agentId: 'old' })
  await $.turn.complete({ turnId: 't2', agentId: 'old', answer: '', durationMs: 1, isAborted: false, reason: 'end_turn' } as never)
  listed = false

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // Not of the current task: folded into one line, not counted as running.
  expect(await ui.find({ type: 'Text', text: /רץ/ })).toBeUndefined()
  await ui.press({ key: 'toggle-board' })
  expect(await ui.find({ text: /סוכנים ממשימות קודמות/ })).toBeDefined()
  await ui.unmount()
})

test('a step the model never explains is sent at most twice, however many turns end', async ($, on) => {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'task-board' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', () => ({ result: {} }))
  on('session.messages', () => ({ value: [] }))
  let calls = 0
  on('model.complete', () => {
    calls += 1
    const text = JSON.stringify({ steps: [], stages: [], task: null })
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as never
  })
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Main', turnId: 't1' })
  await call({ tool: 'Grep', pattern: 'x' })
  for (let i = 0; i < 5; i++) {
    await clock.advance(2000)
    await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'end_turn' } as never)
    await clock.advance(2000)
  }
  expect(calls).toBe(2)
})
