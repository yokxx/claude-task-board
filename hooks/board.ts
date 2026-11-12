// Pure state logic for the task board: no `$`, so it is easy to test.
import type { Board, Loop, Step, SubStatus, Subtask, Task } from '../types'

export const MAIN = 'main'
export const UPDATE_PLAN = 'mcp__ccd_turn__update_plan'
export const WRAP_UP = 'mcp__ccd_turn__wrap_up'

/** Tools that change the plan instead of being a step of it. */
const PLAN_TOOLS = new Set([UPDATE_PLAN, 'TodoWrite', 'TaskCreate', 'TaskUpdate'])
/** Bookkeeping tools that are not shown as steps. */
const QUIET_TOOLS = new Set([
  ...PLAN_TOOLS,
  WRAP_UP,
  'TaskList',
  'TaskGet',
  'ToolSearch',
  'mcp__ccd_session__mark_chapter',
  'AskUserQuestion',
])

const MAX_TASKS = 15
const MAX_STEPS = 60
const MAX_AGENT_LOOPS = 20

export const emptyBoard: Board = {
  loops: {},
  order: [],
  pendingTitle: '',
  mainTurnTask: null,
  turnCreated: null,
  seq: 0,
}

export type Input = Record<string, unknown>

export const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
const oneLine = (s: string, max = 70): string => {
  const line = s.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
const base = (p: string): string => p.split('/').filter(Boolean).pop() ?? p

export const isPlanTool = (tool: string): boolean => PLAN_TOOLS.has(tool)
export const isQuietTool = (tool: string): boolean => QUIET_TOOLS.has(tool)

/** A short human label for one tool call. */
export function labelOf(tool: string, input: Input): string {
  switch (tool) {
    case 'Bash':
      return str(input.description) ? oneLine(str(input.description), 60) : 'מריץ פקודה במסוף'
    case 'Read':
      return `קריאה · ${base(str(input.file_path))}`
    case 'Edit':
    case 'MultiEdit':
      return `עריכה · ${base(str(input.file_path))}`
    case 'Write':
      return `כתיבה · ${base(str(input.file_path))}`
    case 'Grep':
      return `חיפוש · ${oneLine(str(input.pattern), 40)}`
    case 'Glob':
      return `קבצים · ${oneLine(str(input.pattern), 40)}`
    case 'Agent':
    case 'Task':
      return `סוכן · ${oneLine(str(input.description), 50)}`
    case 'WebFetch':
      return `דף · ${oneLine(str(input.url), 50)}`
    case 'WebSearch':
      return `חיפוש רשת · ${oneLine(str(input.query), 40)}`
    case 'Skill':
      return `skill · ${str(input.skill)}`
    default: {
      if (tool.startsWith('mcp__')) {
        const parts = tool.split('__')
        return `${parts[parts.length - 1]} (${parts[1] ?? 'mcp'})`
      }
      return tool
    }
  }
}

// ---------- loops and tasks ----------

export function withLoop(b: Board, id: string, label: string, kind: string, brief?: string): Board {
  if (b.loops[id]) return b
  const loop: Loop = { id, label, kind, tasks: [], ...(brief ? { brief: brief.slice(0, 800) } : {}) }
  let order = [...b.order, id]
  let loops: Record<string, Loop> = { ...b.loops, [id]: loop }
  // Keep the board small: drop the oldest subagents past the cap.
  const agents = order.filter(x => x !== MAIN)
  if (agents.length > MAX_AGENT_LOOPS) {
    const drop = new Set(agents.slice(0, agents.length - MAX_AGENT_LOOPS))
    order = order.filter(x => !drop.has(x))
    loops = Object.fromEntries(Object.entries(loops).filter(([k]) => !drop.has(k)))
  }
  return { ...b, loops, order }
}

function putLoop(b: Board, loop: Loop): Board {
  return { ...b, loops: { ...b.loops, [loop.id]: loop } }
}

function newTask(b: Board, loopId: string, title: string): [Board, Task] {
  const task: Task = {
    id: `${loopId}#${b.seq + 1}`,
    title: oneLine(title || 'משימה', 80),
    subtasks: [],
    loose: [],
    isEnded: false,
  }
  const loop = b.loops[loopId]!
  const tasks = [...loop.tasks, task].slice(-MAX_TASKS)
  return [putLoop({ ...b, seq: b.seq + 1 }, { ...loop, tasks }), task]
}

function putTask(b: Board, loopId: string, task: Task): Board {
  const loop = b.loops[loopId]!
  return putLoop(b, {
    ...loop,
    tasks: loop.tasks.map(t => (t.id === task.id ? task : t)),
  })
}

/**
 * The task a call in this loop belongs to, creating one when needed.
 * `reuse` lets the main loop continue the previous task (a "continuation");
 * a turn with no prompt of its own (a background event) always continues.
 */
function taskFor(b: Board, loopId: string, reuse: boolean): [Board, Task] {
  const loop = b.loops[loopId]!
  const last = loop.tasks[loop.tasks.length - 1]
  if (loopId === MAIN) {
    const current = loop.tasks.find(t => t.id === b.mainTurnTask)
    if (current) return [b, current]
    if ((reuse || b.pendingTitle === '') && last) {
      const revived = { ...last, isEnded: false }
      return [putTask({ ...b, mainTurnTask: last.id }, loopId, revived), revived]
    }
    const [next, task] = newTask(b, loopId, b.pendingTitle)
    return [{ ...next, mainTurnTask: task.id, turnCreated: task.id }, task]
  }
  if (last) return [b, last]
  return newTask(b, loopId, loop.label)
}

/**
 * A continuation plan that arrives after this turn already opened a task of
 * its own for a step (calls dispatch in any order): fold that task's steps
 * into the previous task and continue there.
 */
function foldIntoPrevious(b: Board): Board {
  const loop = b.loops[MAIN]
  if (!loop || b.mainTurnTask === null || b.mainTurnTask !== b.turnCreated) return b
  const at = loop.tasks.findIndex(t => t.id === b.mainTurnTask)
  const fresh = loop.tasks[at]
  const prev = loop.tasks[at - 1]
  if (!fresh || !prev || fresh.subtasks.length > 0 || at !== loop.tasks.length - 1) return b
  const merged: Task = { ...prev, isEnded: false, loose: [...prev.loose, ...fresh.loose].slice(-MAX_STEPS) }
  const tasks = [...loop.tasks.slice(0, at - 1), merged]
  return { ...putLoop(b, { ...loop, tasks }), mainTurnTask: merged.id, turnCreated: null }
}

// ---------- plans ----------

type Item = { content: string; status: SubStatus }

const toStatus = (v: unknown): SubStatus =>
  v === 'completed' || v === 'in_progress' ? v : 'pending'

function readItems(v: unknown): Item[] | null {
  if (!Array.isArray(v)) return null
  return v
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map(x => ({ content: str(x.content) || str(x.subject), status: toStatus(x.status) }))
    .filter(x => x.content !== '')
}

/** Replaces a task's plan, keeping the steps of items whose text is unchanged. */
/** A real plan replaces inferred phases: their steps move to the loose list. */
function dropInferred(task: Task): Task {
  const inferred = task.subtasks.filter(s => s.inferred)
  if (inferred.length === 0) return task
  return {
    ...task,
    subtasks: task.subtasks.filter(s => !s.inferred),
    loose: [...inferred.flatMap(s => s.steps), ...task.loose].slice(-MAX_STEPS),
  }
}

function setItems(b: Board, loopId: string, task0: Task, items: Item[]): [Board, Task] {
  const task = dropInferred(task0)
  const used = new Set<string>()
  let seq = b.seq
  const subtasks = items.map(it => {
    const prev = task.subtasks.find(s => s.content === it.content && !used.has(s.id))
    if (prev) used.add(prev.id)
    seq += 1
    return {
      id: prev?.id ?? `${loopId}:s${seq}`,
      content: it.content,
      status: it.status,
      steps: prev?.steps ?? [],
    }
  })
  return [{ ...b, seq }, { ...task, subtasks }]
}

function setStatus(task: Task, index: number, status: SubStatus): Task {
  return {
    ...task,
    subtasks: task.subtasks.map((s, i) => (i === index ? { ...s, status } : s)),
  }
}

/** update_plan's `done`, `advance` and `start`; one subtask stays in progress. */
function moveSteps(task: Task, input: Input): Task {
  let t = task
  if (Array.isArray(input.done)) {
    for (const n of input.done) if (typeof n === 'number') t = setStatus(t, n - 1, 'completed')
  }
  if (input.advance === true) {
    const at = t.subtasks.findIndex(s => s.status === 'in_progress')
    if (at >= 0) t = setStatus(t, at, 'completed')
    const after = t.subtasks.findIndex((s, i) => i > at && s.status === 'pending')
    const next = after >= 0 ? after : t.subtasks.findIndex(s => s.status === 'pending')
    if (next >= 0) t = setStatus(t, next, 'in_progress')
  }
  if (typeof input.start === 'number' && t.subtasks[input.start - 1]) {
    const target = input.start - 1
    t = {
      ...t,
      subtasks: t.subtasks.map((s, i) =>
        i === target ? { ...s, status: 'in_progress' } : s.status === 'in_progress' ? { ...s, status: 'pending' } : s,
      ),
    }
  }
  return t
}

/**
 * Applies one plan tool call of a loop. TaskCreate needs the id its result
 * names: `createdId`, and it is applied only once the call succeeded.
 */
export function applyPlan(
  b: Board,
  loopId: string,
  tool: string,
  input: Input,
  createdId?: string,
): Board {
  if (tool === 'TaskUpdate') return updateTask(b, loopId, input)

  let isContinuation = tool === UPDATE_PLAN && (input.scope === 'continuation' || input.items === undefined)
  let board = b
  // A whole new list that shares no item with the task it would continue is a new task:
  // "continuation" says this session goes on, not that it is the same work.
  const items = tool === UPDATE_PLAN || tool === 'TodoWrite' ? readItems(tool === UPDATE_PLAN ? input.items : input.todos) : null
  if (loopId === MAIN && items && items.length > 0) {
    const loop = b.loops[MAIN]
    const cur = loop?.tasks.find(t => t.id === b.mainTurnTask) ?? (isContinuation ? loop?.tasks[loop.tasks.length - 1] : undefined)
    const own = cur?.subtasks.filter(s => !s.inferred) ?? []
    if (cur && own.length > 0 && !items.some(it => own.some(s => s.content === it.content))) {
      isContinuation = false
      const title = b.pendingTitle || items.find(it => it.status === 'in_progress')?.content || items[0]!.content
      const [nb, task] = newTask(b, MAIN, title)
      board = { ...nb, mainTurnTask: task.id, turnCreated: task.id }
    }
  }
  if (isContinuation && tool === UPDATE_PLAN && input.scope === 'continuation' && loopId === MAIN) board = foldIntoPrevious(board)
  const [b1, task] = taskFor(board, loopId, isContinuation)
  board = b1
  let t = task

  if (tool === UPDATE_PLAN) {
    const items = readItems(input.items)
    if (items) [board, t] = setItems(board, loopId, t, items)
    t = moveSteps(t, input)
  } else if (tool === 'TodoWrite') {
    const items = readItems(input.todos)
    if (items) [board, t] = setItems(board, loopId, t, items)
  } else if (tool === 'TaskCreate') {
    const content = oneLine(str(input.subject) || str(input.description) || 'משימה', 80)
    const id = createdId ? `${loopId}:t${createdId}` : `${loopId}:s${board.seq + 1}`
    board = { ...board, seq: board.seq + 1 }
    t = dropInferred(t)
    t = { ...t, subtasks: [...t.subtasks, { id, content, status: 'pending', steps: [] }] }
  }
  return putTask(board, loopId, t)
}

/** TaskUpdate finds its task across the whole loop, any turn. */
function updateTask(b: Board, loopId: string, input: Input): Board {
  const loop = b.loops[loopId]
  if (!loop) return b
  const id = `${loopId}:t${str(input.taskId)}`
  const change = (s: Subtask): Subtask => ({
    ...s,
    status: input.status === undefined ? s.status : toStatus(input.status),
    content: str(input.subject) ? oneLine(str(input.subject), 80) : s.content,
  })
  return putLoop(b, {
    ...loop,
    tasks: loop.tasks.map(t =>
      t.subtasks.some(s => s.id === id)
        ? {
            ...t,
            isEnded: false,
            subtasks:
              input.status === 'deleted'
                ? t.subtasks.filter(s => s.id !== id)
                : t.subtasks.map(s => (s.id === id ? change(s) : s)),
          }
        : t,
    ),
  })
}

/** wrap_up checks off the main turn's whole task list; its `ask` is a decision the person owes. */
export function wrapUp(b: Board, ask?: string): Board {
  const loop = b.loops[MAIN]
  const id = b.mainTurnTask ?? loop?.tasks[loop.tasks.length - 1]?.id
  if (!loop || !id) return b
  return putLoop(b, {
    ...loop,
    tasks: loop.tasks.map(t =>
      t.id === id
        ? {
            ...t,
            subtasks: t.subtasks.map(s => ({ ...s, status: 'completed' as const })),
            ...(ask ? { waiting: oneLine(ask, 120) } : {}),
          }
        : t,
    ),
  })
}

/** Claude asks the person something (or stops asking): the loop's current task waits. */
export function setWaiting(b0: Board, loopId: string, question: string | null): Board {
  if (!b0.loops[loopId]) return b0
  // A question may be the turn's first call: it opens the turn's task.
  const [b, task] = question ? taskFor(b0, loopId, false) : [b0, null]
  const loop = b.loops[loopId]!
  const id = task?.id ?? (loopId === MAIN ? b.mainTurnTask : loop.tasks[loop.tasks.length - 1]?.id)
  return putLoop(b, {
    ...loop,
    tasks: loop.tasks.map(t => {
      if (t.id !== id) return t
      const { waiting: _, ...rest } = t
      return question ? { ...rest, waiting: oneLine(question, 120) } : rest
    }),
  })
}

/** The question text of an AskUserQuestion call. */
export function questionOf(input: Input): string {
  const qs = input.questions
  if (Array.isArray(qs) && qs[0] && typeof qs[0] === 'object') {
    return str((qs[0] as Record<string, unknown>).question) || 'שאלה'
  }
  return str(input.question) || str(input.text) || 'שאלה'
}

// ---------- steps ----------

const cap = (steps: Step[]): Step[] => steps.slice(-MAX_STEPS)

export function addStep(b: Board, loopId: string, step: Step): Board {
  const [b1, task] = taskFor(b, loopId, false)
  const at = task.subtasks.findIndex(s => s.status === 'in_progress')
  const t: Task =
    at >= 0
      ? {
          ...task,
          subtasks: task.subtasks.map((s, i) => (i === at ? { ...s, steps: cap([...s.steps, step]) } : s)),
        }
      : { ...task, loose: cap([...task.loose, step]) }
  return putTask(b1, loopId, t)
}

export function finishStep(b: Board, loopId: string, id: string, ok: boolean): Board {
  const loop = b.loops[loopId]
  if (!loop) return b
  const mark = (steps: Step[]): Step[] => steps.map(s => (s.id === id ? { ...s, ok } : s))
  return putLoop(b, {
    ...loop,
    tasks: loop.tasks.map(t => ({
      ...t,
      loose: mark(t.loose),
      subtasks: t.subtasks.map((s: Subtask) => ({ ...s, steps: mark(s.steps) })),
    })),
  })
}

// ---------- turns ----------

/** A main turn begins: `text` is its prompt, '' for a turn with none. */
export function startMainTurn(b: Board, text: string): Board {
  const loop = b.loops[MAIN]
  const cleared = loop
    ? putLoop(b, {
        ...loop,
        tasks: loop.tasks.map(t => {
          const { waiting: _, ...rest } = t
          return rest
        }),
      })
    : b
  return { ...cleared, pendingTitle: oneLine(text, 80), mainTurnTask: null, turnCreated: null }
}

export function endLoopTurn(b: Board, loopId: string): Board {
  const loop = b.loops[loopId]
  if (!loop) return b
  const end = (t: Task): Task => ({
    ...t,
    isEnded: true,
    subtasks: t.subtasks.map(s => (s.inferred && !t.waiting ? { ...s, status: 'completed' as const } : s)),
  })
  if (loopId === MAIN) {
    const id = b.mainTurnTask
    if (!id) return b
    return putLoop(b, { ...loop, tasks: loop.tasks.map(t => (t.id === id ? end(t) : t)) })
  }
  return putLoop(b, { ...loop, tasks: loop.tasks.map(end) })
}

// ---------- reading ----------

/** Percent done, or null while a task without a plan still runs. */
export function percentOf(task: Task): number | null {
  const n = task.subtasks.length
  if (n === 0) return task.isEnded ? 100 : null
  const sum = task.subtasks.reduce((n, s) => n + stagePercent(s), 0)
  return Math.round(sum / n)
}

/** One stage's percent: done 100, pending 0, in progress by the explainer's judgment. */
export function stagePercent(s: Subtask): number {
  if (s.status === 'completed') return 100
  if (s.status === 'pending') return 0
  return Math.max(5, Math.min(95, Math.round(s.progress ?? 10)))
}

/** Stages not finished yet. */
export const remainingStages = (t: Task): number => t.subtasks.filter(s => s.status !== 'completed').length

/** Hebrew count of subagents: "סוכן אחד", "3 סוכנים". */
/** Hebrew summary of the subagents: who runs now (in parallel?), who waits, who is done. */
export function agentsText(running: number, queued: number, done: number): string {
  const parts: string[] = []
  if (running === 1) parts.push('סוכן אחד רץ')
  else if (running > 1) parts.push(`${running} סוכנים רצים במקביל`)
  if (queued > 0) parts.push(queued === 1 ? 'אחד בתור' : `${queued} בתור`)
  if (done > 0) parts.push(done === 1 ? 'אחד הושלם' : `${done} הושלמו`)
  return parts.join(' · ')
}

/** Records when a subagent started and which main task spawned it. */
export function markAgentStart(b: Board, id: string, at: number): Board {
  const loop = b.loops[id]
  if (!loop || loop.startedAt !== undefined) return b
  return putLoop(b, {
    ...loop,
    startedAt: at,
    turnStartedAt: at,
    ...(b.mainTurnTask ? { parentTask: b.mainTurnTask } : {}),
  })
}

/** A subagent's turn begins (a resume too): it runs again. */
export function markAgentTurn(b: Board, id: string, at: number): Board {
  const loop = b.loops[id]
  if (!loop || id === MAIN) return b
  const { endedAt: _, ...rest } = loop
  // A resumed agent works on its last task again.
  const tasks = loop.tasks.map((t, i) => (i === loop.tasks.length - 1 ? { ...t, isEnded: false } : t))
  return putLoop(b, { ...rest, tasks, startedAt: loop.startedAt ?? at, turnStartedAt: at })
}

export function markAgentEnd(b: Board, id: string, at: number): Board {
  const loop = b.loops[id]
  if (!loop || id === MAIN) return b
  const turn = loop.turnStartedAt !== undefined && loop.endedAt === undefined ? at - loop.turnStartedAt : 0
  return putLoop(b, { ...loop, endedAt: at, busyMs: (loop.busyMs ?? 0) + Math.max(0, turn) })
}

/** How long a subagent has worked: finished turns plus the one running now. */
export function busyOf(loop: Loop, now: number): number {
  const live = loop.endedAt === undefined && loop.turnStartedAt !== undefined ? now - loop.turnStartedAt : 0
  return (loop.busyMs ?? 0) + Math.max(0, live)
}

/** "45 שנ׳", "3:20 דק׳". */
export function durationText(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  if (sec < 60) return `${sec} שנ׳`
  const m = Math.floor(sec / 60)
  return `${m}:${String(sec % 60).padStart(2, '0')} דק׳`
}

export function bar(pct: number | null, cells = 10): string {
  if (pct === null) return '░'.repeat(cells)
  const full = Math.round((pct / 100) * cells)
  return '█'.repeat(full) + '░'.repeat(cells - full)
}

export function stepCount(task: Task): number {
  return task.loose.length + task.subtasks.reduce((n, s) => n + s.steps.length, 0)
}

/** The tool and its input as one short string for the explainer. */
export function rawOf(tool: string, input: Input): string {
  const skip = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta'])
  const parts: string[] = []
  for (const [k, v] of Object.entries(input)) {
    if (skip.has(k)) continue
    const text = typeof v === 'string' ? v : JSON.stringify(v)
    parts.push(`${k}: ${(text ?? '').slice(0, 300)}`)
  }
  return `${tool} — ${parts.join(' | ')}`.slice(0, 700)
}

/** Where a step sits: its task and subtask (if any). */
export type Found = { task: Task; subtask: Subtask | null; step: Step }

export function findStep(loop: Loop, id: string): Found | null {
  for (const task of loop.tasks) {
    const loose = task.loose.find(s => s.id === id)
    if (loose) return { task, subtask: null, step: loose }
    for (const subtask of task.subtasks) {
      const step = subtask.steps.find(s => s.id === id)
      if (step) return { task, subtask, step }
    }
  }
  return null
}

export type Phase = { id?: string; title: string; status: SubStatus; about?: string; progress?: number }

export type Explained = {
  steps: { id: string; what: string; why: string }[]
  stages: { id: string; about: string; title?: string; progress?: number }[]
  task: { id: string; about: string; short?: string } | null
  /** For a task with no plan of its own: the phases the explainer sees, in order. */
  phases?: Phase[]
  /** Step id → index into `phases`. */
  stepPhase?: Record<string, number>
}

/** Whether a task's subtasks came from the explainer, not from a plan. */
export const hasOwnPlan = (t: Task): boolean => t.subtasks.some(s => !s.inferred)

/** Replaces a planless task's inferred phases and sorts its steps into them. */
function applyPhases(b: Board, loopId: string, t: Task, x: Explained): [Board, Task] {
  const phases = (x.phases ?? []).filter(p => p.title.trim() !== '').slice(0, 10)
  if (phases.length === 0 || hasOwnPlan(t)) return [b, t]
  let seq = b.seq
  const old = t.subtasks
  const used = new Set<string>()
  const subs: Subtask[] = phases.map(p => {
    const title = oneLine(p.title, 80)
    const prev =
      old.find(s => !used.has(s.id) && p.id !== undefined && s.id === p.id) ??
      old.find(s => !used.has(s.id) && s.content === title)
    if (prev) used.add(prev.id)
    seq += 1
    // A reply that lands after the task ended does not reopen it.
    const status = t.isEnded && !t.waiting ? 'completed' : toStatus(p.status)
    return {
      id: prev?.id ?? `${loopId}:p${seq}`,
      content: title,
      title,
      status,
      steps: [],
      inferred: true,
      ...(p.about ? { about: p.about } : prev?.about ? { about: prev.about } : {}),
      ...(typeof p.progress === 'number' ? { progress: p.progress } : {}),
    }
  })
  // Every step of the task, with where it sat before.
  const placed = [
    ...old.flatMap(s => s.steps.map(step => ({ step, from: s.id as string | null }))),
    ...t.loose.map(step => ({ step, from: null as string | null })),
  ]
  const current = subs.findIndex(s => s.status === 'in_progress')
  const loose: Step[] = []
  for (const { step, from } of placed) {
    const byModel = x.stepPhase?.[step.id]
    const byOld = from ? subs.findIndex(s => s.id === from) : -1
    const at =
      typeof byModel === 'number' && subs[byModel] ? byModel : byOld >= 0 ? byOld : current
    if (at >= 0) subs[at]!.steps.push(step)
    else loose.push(step)
  }
  for (const s of subs) s.steps = cap(s.steps)
  return [{ ...b, seq }, { ...t, subtasks: subs, loose: cap(loose) }]
}

/** Writes the explainer's sentences (and phases) into one loop. */
export function applyExplained(b: Board, loopId: string, x: Explained): Board {
  const loop = b.loops[loopId]
  if (!loop) return b
  const steps = new Map(x.steps.map(s => [s.id, s]))
  const stages = new Map(x.stages.map(s => [s.id, s]))
  const fill = (list: Step[]): Step[] =>
    list.map(s => {
      const e = steps.get(s.id)
      return e ? { ...s, what: e.what, why: e.why } : s
    })
  let board = b
  const tasks = loop.tasks.map(t0 => {
    let t: Task = {
      ...t0,
      ...(x.task && x.task.id === t0.id
        ? { about: x.task.about, ...(x.task.short ? { short: oneLine(x.task.short, 40) } : {}) }
        : {}),
      loose: fill(t0.loose),
      subtasks: t0.subtasks.map(s => {
        const st = stages.get(s.id)
        return {
          ...s,
          ...(st?.about ? { about: st.about } : {}),
          ...(st?.title ? { title: oneLine(st.title, 80) } : {}),
          ...(typeof st?.progress === 'number' ? { progress: st.progress } : {}),
          steps: fill(s.steps),
        }
      }),
    }
    if (x.task && x.task.id === t0.id) [board, t] = applyPhases(board, loopId, t, x)
    return t
  })
  return putLoop(board, { ...board.loops[loopId]!, tasks })
}
