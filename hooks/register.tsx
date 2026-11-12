import { atom, read, update } from 'claude-code'
import type { AgentInfo, Register, RenderChildren } from 'claude-code'

import type { Board, Loop, Step, Subtask, Task, View } from '../types'
import {
  MAIN,
  WRAP_UP,
  addStep,
  applyPlan,
  bar,
  emptyBoard,
  endLoopTurn,
  finishStep,
  isPlanTool,
  isQuietTool,
  labelOf,
  agentsText,
  durationText,
  markAgentEnd,
  markAgentStart,
  markAgentTurn,
  busyOf,
  percentOf,
  remainingStages,
  stagePercent,
  questionOf,
  rawOf,
  setWaiting,
  startMainTurn,
  stepCount,
  withLoop,
  wrapUp,
} from './board'
import type { Input } from './board'
import { explainLater, sweep } from './explain'

// Change a tag when that value's fields change: it declines what an earlier
// version stored, which outlives a reload. (Same refs in every file that uses them.)
const board = atom({ plugin: 'task-board', key: 'board' } as const, emptyBoard, {
  shape: 'board-4',
})
const view = atom(
  { plugin: 'task-board', key: 'view' } as const,
  { isOpen: false, loop: MAIN, expanded: {} } as View,
  { shape: 'view-2' },
)

/** One color language: blue for progress, green for done, amber for waiting. */
const FILL_A = '#06b6d4'
const FILL_B = '#2563eb'
const DONE = '#10b981'
const WAIT = '#d97706'
const TRACK = 'rgba(100,116,139,0.20)'

/** A real progress bar for the desktop: rounded track, blue fill, green when done. */
function barSvg(pct: number | null, w: number, ht: number, waiting = false): string {
  const h = ht
  const r = h / 2
  if (pct === null) {
    // Running with no measure yet: a soft moving sheen over the track.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="s" x1="0" x2="1"><stop offset="0" stop-color="${FILL_A}" stop-opacity="0"/><stop offset="0.5" stop-color="${FILL_A}" stop-opacity="0.7"/><stop offset="1" stop-color="${FILL_A}" stop-opacity="0"/></linearGradient></defs><rect width="${w}" height="${h}" rx="${r}" fill="${TRACK}"/><rect x="${-w / 3}" width="${w / 3}" height="${h}" rx="${r}" fill="url(#s)"><animate attributeName="x" from="${-w / 3}" to="${w}" dur="1.6s" repeatCount="indefinite"/></rect></svg>`
  }
  const fw = Math.max(pct > 0 ? h : 0, Math.round((w * Math.min(100, pct)) / 100))
  const fill = pct >= 100 ? DONE : waiting ? WAIT : 'url(#g)'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="1" x2="0"><stop offset="0" stop-color="${FILL_A}"/><stop offset="1" stop-color="${FILL_B}"/></linearGradient></defs><rect width="${w}" height="${h}" rx="${r}" fill="${TRACK}"/>${fw > 0 ? `<rect x="${w - fw}" width="${fw}" height="${h}" rx="${r}" fill="${fill}"/>` : ''}</svg>`
}
const TASKS_SHOWN = 5
const STEPS_SHOWN = 10

const statusWord: Record<string, string> = {
  pending: 'ממתין',
  running: 'פועל',
  waiting: 'ממתין',
  idle: 'במנוחה',
  completed: 'הושלם',
  failed: 'נכשל',
  killed: 'נעצר',
}

const subIcon = (s: Subtask): string =>
  s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '◐' : '○'
const stepIcon = (s: Step): string => (s.ok === null ? '…' : s.ok ? '✓' : '✗')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'task-board',
      description: 'Open or close the task board above the prompt',
    })
    // A reload: explain what an earlier version left unexplained.
    await sweep($, null).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'task-board' }, async $ => {
    const v = await update($, view, x => ({ ...x, isOpen: !x.isOpen }))
    return { text: v.isOpen ? 'לוח המשימות נפתח.' : 'לוח המשימות נסגר.' }
  })

  // Each main turn starts a task; a turn begun by a notice, not typed text, continues.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      const at = await $.clock.now()
      await update($, board, b => markAgentTurn(b, id, at))
    } else {
      const text = e.text.trim().startsWith('<') ? '' : e.text
      await update($, board, b => startMainTurn(withLoop(b, MAIN, 'ראשי', 'main'), text))
    }
    return next(e)
  })

  // A subagent the model spawns becomes a loop of its own.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) {
      const id = r.agentId
      const at = await $.clock.now()
      await update($, board, b =>
        markAgentStart(withLoop(b, id, e.description || e.subagentType, e.subagentType, e.prompt), id, at),
      )
    }
    return r
  }).catch(($, e, next) => next(e))

  // Loop ids the session does not list (compaction or memory forks): not shown.
  const unlisted = new Set<string>()

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const loopId = e.agentId ?? MAIN
    const input = e as unknown as Input
    if (unlisted.has(loopId)) return next(e)

    if (!(await read($, board)).loops[loopId]) {
      if (loopId === MAIN) {
        await update($, board, b => withLoop(b, MAIN, 'ראשי', 'main'))
      } else {
        const info = (await $.agent.list()).find(a => a.id === loopId)
        if (!info) {
          unlisted.add(loopId)
          return next(e)
        }
        const at = await $.clock.now()
        await update($, board, b =>
          markAgentStart(withLoop(b, loopId, info.description || info.type, info.type), loopId, at),
        )
      }
    }

    if (tool === 'TaskCreate') {
      const r = await next(e)
      const created = (r.result as { task?: { id?: unknown } } | undefined)?.task?.id
      if (!r.deny && !r.isError) {
        await update($, board, b =>
          applyPlan(b, loopId, tool, input, created === undefined ? undefined : String(created)),
        )
      }
      return r
    }
    if (isPlanTool(tool)) {
      await update($, board, b => applyPlan(b, loopId, tool, input))
      return next(e)
    }
    if (tool === WRAP_UP && loopId === MAIN) {
      const ask = typeof input.ask === 'string' ? input.ask : undefined
      await update($, board, b => wrapUp(b, ask))
      return next(e)
    }
    // A question to the person: the task waits on a decision while it is open.
    if (tool === 'AskUserQuestion') {
      const q = questionOf(input)
      await update($, board, b => setWaiting(b, loopId, q))
      const r = await next(e)
      await update($, board, b => setWaiting(b, loopId, null))
      return r
    }
    if (isQuietTool(tool)) return next(e)

    const id = e.tool_use_id
    const step: Step = { id, label: labelOf(tool, input), raw: rawOf(tool, input), ok: null }
    await update($, board, b => addStep(b, loopId, step))
    explainLater($, loopId, id)
    const r = await next(e)
    const ok = !r.deny && !r.isError
    await update($, board, b => finishStep(b, loopId, id, ok))
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const loopId = e.agentId ?? MAIN
    const at = await $.clock.now()
    await update($, board, b => markAgentEnd(endLoopTurn(b, loopId), loopId, at))
    await sweep($, [loopId]).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const b: Board = await read($, board)
    const v: View = await read($, view)
    if (b.order.length === 0) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const isDesktop = e.surface !== 'terminal'
    const agents: AgentInfo[] = await $.agent.list().catch(() => [])
    const statusOf = (loop: Loop): string => {
      if (loop.id === MAIN) return e.props.isWorking ? 'פועל' : 'במנוחה'
      return { running: 'רץ עכשיו', queued: 'בתור', done: 'הושלם', failed: 'נכשל' }[phaseOf(loop.id)]
    }

    const seenAgent = e.props.view.agentId
    const selectedId =
      (b.loops[v.loop] ? v.loop : undefined) ??
      (seenAgent && b.loops[seenAgent] ? seenAgent : undefined) ??
      (b.loops[MAIN] ? MAIN : b.order[0]!)
    const loop = b.loops[selectedId]!
    const latest: Task | undefined = loop.tasks[loop.tasks.length - 1]
    const pct = latest ? percentOf(latest) : null
    const subAgents = b.order.filter(id => id !== MAIN)
    const now = await $.clock.now().catch(() => 0)
    /** Where a subagent stands: running now, waiting in the queue, or finished. */
    const phaseOf = (id: string): 'running' | 'queued' | 'done' | 'failed' => {
      const st = agents.find(a => a.id === id)?.status
      // `waiting` is held on its own work (a nested agent, a plan approval): still running.
      if (st === 'running' || st === 'waiting') return 'running'
      if (st === 'pending') return 'queued'
      if (st === 'failed' || st === 'killed') return 'failed'
      if (st === 'completed' || st === 'idle') return 'done'
      // Not listed: judge by what the board saw. It runs only while a turn of it is open;
      // one recorded before timing existed (no start) is long done.
      const l = b.loops[id]
      if (!l || l.endedAt !== undefined || l.startedAt === undefined) return 'done'
      return 'running'
    }
    const running = subAgents.filter(id => phaseOf(id) === 'running')
    const queued = subAgents.filter(id => phaseOf(id) === 'queued')
    const finished = subAgents.filter(id => phaseOf(id) === 'done' || phaseOf(id) === 'failed')

    const isOpen = (id: string, byDefault: boolean): boolean => v.expanded[id] ?? byDefault
    const toggle = (id: string, now: boolean) =>
      update($, view, x => {
        const kept = Object.entries(x.expanded).slice(-200)
        return { ...x, expanded: { ...Object.fromEntries(kept), [id]: !now } }
      })
    const pctText = (p: number | null) => (p === null ? '…' : `${p}%`)
    const titleOf = (t: Task) => t.short ?? t.title

    /** A progress bar: drawn on the desktop, glyphs on the terminal. */
    const meter = (p: number | null, w: number, tall: number, waiting = false) =>
      isDesktop && 'Svg' in ui ? (
        <ui.Svg
          source={barSvg(p, w, tall, waiting)}
          alt={p === null ? 'בתהליך' : `${p}%`}
          width={w}
          height={tall}
          {...(p === null ? { isInteractive: true } : {})}
        />
      ) : (
        // Right to left, like the desktop bar.
        <Text color={p === 100 ? 'success' : waiting ? 'warning' : 'claude'}>
          {[...bar(p, Math.max(4, Math.round(w / 14)))].reverse().join('')}
        </Text>
      )

    /**
     * One line, read right to left. With an explanation, the sentence itself
     * is the control: pressing it opens the explanation under the line.
     */
    const line = (
      key: string,
      lead: RenderChildren[],
      sentence: string,
      detail: string | undefined,
      tail: RenderChildren[] = [],
      opts: { pad?: number; dim?: boolean; bold?: boolean } = {},
    ) => {
      const id = `d:${key}`
      const open = detail ? isOpen(id, false) : false
      return (
        <Box key={key} flexDirection="column">
          <Box flexDirection="row-reverse" gap={1} paddingRight={opts.pad ?? 0} alignItems="center">
            {lead}
            {detail ? (
              <Button key={`arrow-${key}`} plain dimColor={opts.dim} onPress={() => toggle(id, open)}>
                {sentence}
              </Button>
            ) : (
              <Text dir="rtl" dimColor={opts.dim} bold={opts.bold} wrap="truncate-end">
                {sentence}
              </Text>
            )}
            {tail}
          </Box>
          {open && (
            <Box paddingRight={(opts.pad ?? 0) + 3} flexDirection="row-reverse">
              <Text dir="rtl" dimColor wrap="wrap">
                {detail}
              </Text>
            </Box>
          )}
        </Box>
      )
    }

    // The top line is always the main task, whichever loop is opened below.
    const mainLoop = b.loops[MAIN]
    const top: Task | undefined = mainLoop?.tasks[mainLoop.tasks.length - 1]
    const topTitle = top ? titleOf(top) : b.pendingTitle || 'אין משימה פעילה'
    const topPct = top ? percentOf(top) : null
    // What runs now: the open step, else the last one; and the current stage.
    const allSteps = top ? [...top.subtasks.flatMap(s => s.steps), ...top.loose] : []
    const nowStep = allSteps.find(s => s.ok === null) ?? allSteps[allSteps.length - 1]
    const nowPhase = top?.subtasks.find(s => s.status === 'in_progress')
    const left = top ? remainingStages(top) : 0
    // Only the agents of the current task: running or queued ones, and those it spawned.
    // Agents of earlier tasks fold into one line.
    const finishedNow = finished.filter(id => top !== undefined && b.loops[id]?.parentTask === top.id)
    const earlierAgents = finished.filter(id => !finishedNow.includes(id))
    const agentNote =
      running.length + queued.length + finishedNow.length > 0
        ? agentsText(running.length, queued.length, finishedNow.length) || null
        : null

    // ---------- closed: one thin line ----------
    if (!v.isOpen) {
      return (
        <Box flexDirection="row-reverse" gap={1} alignItems="center">
          <Text bold color={topPct === 100 ? DONE : FILL_B}>
            {pctText(topPct)}
          </Text>
          {meter(topPct, 150, 6, Boolean(top?.waiting))}
          <Box flexShrink={1}>
            <Text dir="rtl" wrap="truncate-end">
              {topTitle}
            </Text>
          </Box>
          {top?.waiting ? (
            <Text color={WAIT}>⏸ ממתין להחלטה שלך</Text>
          ) : left > 0 ? (
            <Text dimColor>· עוד {left === 1 ? 'שלב אחד' : `${left} שלבים`}</Text>
          ) : null}
          {agentNote && <Text dimColor>· {agentNote}</Text>}
          <Box flexGrow={1} />
          <Button key="toggle-board" plain dimColor onPress={() => update($, view, x => ({ ...x, isOpen: true }))}>
            פרטים ▾
          </Button>
        </Box>
      )
    }

    // ---------- open ----------
    const closeX = (key: string) => (
      <Button key={key} plain onPress={() => update($, view, x => ({ ...x, isOpen: false }))}>
        ✕
      </Button>
    )

    const header = (
      <Box flexDirection="row-reverse" gap={1} alignItems="center">
        {closeX('close-board')}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {line(
            'head',
            [
              <Text size="heading" weight="bold" color={topPct === 100 ? DONE : FILL_B}>
                {pctText(topPct)}
              </Text>,
              meter(topPct, 180, 8, Boolean(top?.waiting)),
            ],
            topTitle,
            undefined,
            [
              top?.waiting ? <Text color={WAIT}>⏸ ממתין להחלטה שלך</Text> : null,
            ],
            { bold: true },
          )}
          {top?.about && (
            <Box flexDirection="row-reverse" paddingRight={1}>
              <Text dir="rtl" dimColor wrap="wrap">
                <Text color={FILL_B}>המטרה: </Text>
                {top.about}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    )

    const nowLine =
      nowStep && e.props.isWorking
        ? line(
            'now',
            [<Text color={FILL_B}>עכשיו</Text>],
            nowStep.what ?? nowStep.label,
            nowStep.why,
            [],
            { pad: 2 },
          )
        : null

    /** A subagent's Hebrew name (from the explainer) or the Agent call's description. */
    const agentName = (l: Loop) => {
      const t = l.tasks[l.tasks.length - 1]
      return t?.short ?? l.label
    }
    const agentWord = { running: 'רץ עכשיו', queued: 'בתור', done: 'הושלם', failed: 'נכשל' } as const
    const agentColor = { running: FILL_B, queued: WAIT, done: DONE, failed: 'error' } as const
    const agentIcon = { running: '●', queued: '◌', done: '✓', failed: '✗' } as const

    const agentRow = (id: string) => {
      const l = b.loops[id]!
      const ph = phaseOf(id)
      const t = l.tasks[l.tasks.length - 1]
      const p = t ? percentOf(t) : null
      const mine = id === selectedId
      const steps = t ? [...t.subtasks.flatMap(s => s.steps), ...t.loose] : []
      const last = steps.find(s => s.ok === null) ?? steps[steps.length - 1]
      const stage = t?.subtasks.find(s => s.status === 'in_progress')
      const busy = now === 0 || l.startedAt === undefined ? 0 : busyOf(l, now)
      const time = busy === 0 ? '' : ph === 'running' ? `רץ ${durationText(busy)}` : `לקח ${durationText(busy)}`
      return (
        <Box key={`agent-${id}`} flexDirection="column">
          <Box flexDirection="row-reverse" gap={1} alignItems="center" paddingRight={2}>
            <Text color={agentColor[ph]}>{agentIcon[ph]}</Text>
            <Text color={agentColor[ph]} bold>
              {agentWord[ph]}
            </Text>
            {meter(ph === 'done' ? 100 : p, 64, 5)}
            <Button key={`loop-${id}`} plain dimColor={!mine && ph !== 'running'} onPress={() => update($, view, x => ({ ...x, loop: mine ? MAIN : id }))}>
              {`${mine ? '◉ ' : ''}${agentName(l)}`}
            </Button>
            {time ? <Text dimColor>· {time}</Text> : null}
          </Box>
          {ph === 'running' && (last || stage) && (
            <Box flexDirection="row-reverse" gap={1} paddingRight={6}>
              <Text dimColor>עכשיו:</Text>
              <Text dir="rtl" wrap="truncate-end">
                {last?.what ?? stage?.title ?? stage?.content ?? last?.label}
              </Text>
            </Box>
          )}
        </Box>
      )
    }

    const DONE_SHOWN = 4
    const showEarlierAgents = isOpen('agents:earlier', false)
    const agentsPanel =
      subAgents.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row-reverse" gap={1} alignItems="center">
            <Text bold>סוכני משנה</Text>
            {agentNote ? <Text dimColor>· {agentNote}</Text> : <Text dimColor>· אין במשימה הזו</Text>}
            <Box flexGrow={1} />
            {selectedId !== MAIN && (
              <Button key="loop-main" plain dimColor onPress={() => update($, view, x => ({ ...x, loop: MAIN }))}>
                חזרה לשיחה הראשית
              </Button>
            )}
          </Box>
          {running.map(agentRow)}
          {queued.map(agentRow)}
          {finishedNow.slice(-DONE_SHOWN).reverse().map(agentRow)}
          {finishedNow.length > DONE_SHOWN && (
            <Box flexDirection="row-reverse" paddingRight={2}>
              <Text dimColor>+{finishedNow.length - DONE_SHOWN} נוספים שהושלמו</Text>
            </Box>
          )}
          {earlierAgents.length > 0 && (
            <Box flexDirection="row-reverse" paddingRight={2}>
              <Button key="agents-earlier" plain dimColor onPress={() => toggle('agents:earlier', showEarlierAgents)}>
                {`${earlierAgents.length} סוכנים ממשימות קודמות ${showEarlierAgents ? '▴' : '▾'}`}
              </Button>
            </Box>
          )}
          {showEarlierAgents && earlierAgents.slice(-DONE_SHOWN).reverse().map(agentRow)}
        </Box>
      ) : null

    const loopLine =
      selectedId === MAIN
        ? null
        : line(
            'loop',
            [
              <Text bold color={FILL_B}>
                {pctText(pct)}
              </Text>,
              meter(phaseOf(loop.id) === 'done' ? 100 : pct, 120, 6),
            ],
            agentName(loop),
            latest?.about ?? loop.brief,
            [<Text dimColor>· {statusOf(loop)}</Text>],
            { bold: true },
          )

    const stepsOf = (steps: Step[], pad: number) => {
      const shown = steps.slice(-STEPS_SHOWN)
      return (
        <Box flexDirection="column">
          {steps.length > shown.length && (
            <Box flexDirection="row-reverse" paddingRight={pad}>
              <Text dimColor>+{steps.length - shown.length} פעולות קודמות</Text>
            </Box>
          )}
          {shown.map(s =>
            line(
              `st-${s.id}`,
              [<Text color={s.ok === false ? 'error' : s.ok === null ? FILL_B : DONE}>{stepIcon(s)}</Text>],
              s.what ?? s.label,
              s.what ? [s.why, `(${s.label})`].filter(Boolean).join(' ') : undefined,
              [],
              { pad, dim: s.ok === true },
            ),
          )}
        </Box>
      )
    }

    const subtaskRow = (s: Subtask) => {
      const open = s.steps.length > 0 && isOpen(s.id, s.status === 'in_progress')
      const sp = stagePercent(s)
      return (
        <Box key={`sub-${s.id}`} flexDirection="column">
          {line(
            `sh-${s.id}`,
            [
              <Text color={s.status === 'completed' ? DONE : s.status === 'in_progress' ? FILL_B : 'inactive'}>
                {subIcon(s)}
              </Text>,
              meter(sp, 56, 4),
            ],
            s.title ?? s.content,
            s.about,
            s.steps.length > 0
              ? [
                  <Button key={`subtoggle-${s.id}`} plain dimColor onPress={() => toggle(s.id, open)}>
                    {`${s.steps.length} פעולות ${open ? '▴' : '▾'}`}
                  </Button>,
                ]
              : [],
            { pad: 2, dim: s.status === 'completed', bold: s.status === 'in_progress' },
          )}
          {open && stepsOf(s.steps, 6)}
        </Box>
      )
    }

    const taskRow = (t: Task) => {
      const p = percentOf(t)
      const open = isOpen(t.id, t.id === latest?.id)
      return (
        <Box key={`task-${t.id}`} flexDirection="column">
          {line(
            `th-${t.id}`,
            [
              <Button key={`tasktoggle-${t.id}`} plain dimColor onPress={() => toggle(t.id, open)}>
                {open ? '▾' : '◂'}
              </Button>,
              <Text bold>{pctText(p)}</Text>,
              meter(p, 96, 6, Boolean(t.waiting)),
            ],
            titleOf(t),
            t.about,
            [<Text dimColor>· {stepCount(t)} פעולות</Text>],
            { bold: t.id === latest?.id },
          )}
          {open && taskBody(t)}
        </Box>
      )
    }

    /** A task's stages, its waiting row and its steps outside the stages. */
    const taskBody = (t: Task) => {
      const looseId = `${t.id}:loose`
      const looseOpen = isOpen(looseId, t.subtasks.length === 0 && !t.isEnded)
      return (
            <Box key={`body-${t.id}`} flexDirection="column">
              {t.subtasks.length === 0 && t.loose.length === 0 && (
                <Box flexDirection="row-reverse" paddingRight={2}>
                  <Text dimColor>עוד אין שלבים — הם יופיעו אחרי הפעולה הראשונה.</Text>
                </Box>
              )}
              {t.subtasks.map(subtaskRow)}
              {t.waiting &&
                line(`wait-${t.id}`, [<Text color={WAIT}>⏸</Text>], 'ממתין להחלטה שלך', t.waiting, [], { pad: 2, bold: true })}
              {t.loose.length > 0 && (
                <Box key={`loose-${t.id}`} flexDirection="column">
                  <Box flexDirection="row-reverse" gap={1} paddingRight={2}>
                    <Text dimColor>פעולות מחוץ לשלבים</Text>
                    <Button key={`loosetoggle-${t.id}`} plain dimColor onPress={() => toggle(looseId, looseOpen)}>
                      {`${t.loose.length} ${looseOpen ? '▴' : '▾'}`}
                    </Button>
                  </Box>
                  {looseOpen && stepsOf(t.loose, 4)}
                </Box>
              )}
            </Box>
      )
    }

    // Earlier tasks: closed by default, newest first, at most TASKS_SHOWN.
    const earlier = loop.tasks.slice(0, -1)
    const earlierTasks = earlier.slice(-TASKS_SHOWN).reverse()
    const older = earlier.length - earlierTasks.length
    const showEarlierTasks = isOpen('tasks:earlier', false)

    return (
      <Box flexDirection="column" gap={0}>
        {header}
        <Box flexDirection="column" paddingRight={3}>
          {nowLine}
          {agentsPanel}
          {selectedId !== MAIN ? (
            <Box marginTop={1} flexDirection="column">
              {loopLine}
              {latest ? taskBody(latest) : null}
            </Box>
          ) : (
            <Box marginTop={1} flexDirection="column">
              {!latest && (
                <Box flexDirection="row-reverse">
                  <Text dimColor>אין עדיין משימות.</Text>
                </Box>
              )}
              {latest ? taskBody(latest) : null}
              {earlierTasks.length > 0 && (
                <Box flexDirection="row-reverse" marginTop={1}>
                  <Button key="tasks-earlier" plain dimColor onPress={() => toggle('tasks:earlier', showEarlierTasks)}>
                    {`${earlierTasks.length === 1 ? 'משימה קודמת אחת' : `${earlierTasks.length} משימות קודמות`} ${showEarlierTasks ? '▴' : '▾'}`}
                  </Button>
                </Box>
              )}
              {showEarlierTasks && earlierTasks.map(taskRow)}
              {showEarlierTasks && older > 0 && (
                <Box flexDirection="row-reverse">
                  <Text dimColor>+{older} ישנות יותר</Text>
                </Box>
              )}
            </Box>
          )}
        </Box>
        {/* Scrolled past the header: the close mark follows, top-right of the window. */}
        {e.props.scroll.offset > 2 && (
          <Box position="absolute" top={e.props.scroll.offset} right={0}>
            {closeX('close-board-pinned')}
          </Box>
        )}
      </Box>
    )
  })
}
