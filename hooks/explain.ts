// The explainer: a small model reads finished steps in batches and writes,
// in Hebrew, one sentence on what each does and one on why, plus a line or
// two on the stage and the task they belong to.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { MAIN, applyExplained, emptyBoard, findStep, hasOwnPlan } from './board'
import type { Explained } from './board'

// Change a tag when that value's fields change: it declines what an earlier
// version stored, which outlives a reload. (Same refs in every file that uses them.)
const board = atom({ plugin: 'task-board', key: 'board' } as const, emptyBoard, {
  shape: 'board-4',
})

const MODEL = 'haiku'
const BATCH = 6
const DELAY_MS = 1500

const SYSTEM = `אתה מסביר לאדם לא טכני מה סוכן תכנות (Claude) או סוכן משנה שלו עושה ברגע זה, בעברית פשוטה וקונקרטית.
תקבל: הבקשה, תוכנית השלבים (אם יש), מה הסוכן כתב לאחרונה, ורשימת פעולות (כלי + קלט).

לכל פעולה כתוב:
- what: משפט אחד קצר (עד 15 מילים) שאומר מה הפעולה עושה בפועל ומה התוצאה שלה. לא "כותב קובץ" או "מריץ פקודה" — אלא מה הקובץ עושה או מה הפקודה בודקת. דוגמה: "כותב את קובץ הבדיקות שמוודא שהפס מציג אחוז התקדמות נכון".
- why: משפט אחד: למה הפעולה נחוצה כדי להשלים את הבקשה.

שלבים — תמיד כותרת קצרה בלשון הווה שמתארת את סוג העבודה, למשל:
"מחפש מקורות", "לומד את הדוקומנטציה", "בודק מה חדש בגרסה", "חוקר את הנושא לעומק", "משווה בין אפשרויות", "מסכם את הממצאים", "מגבש דעה והמלצה", "בוחן כיצד לשלב בפרויקט", "כותב קוד שעושה X כדי Y", "מריץ בדיקות לוודא ש-X עובד", "מתקן באג ב-X".
- אם יש תוכנית: לכל שלב ברשימה "שלבים שצריכים כותרת" החזר ב-stages את ה-id שלו, title בסגנון הזה, ו-about (משפט או שניים: מה השלב עושה ולמה). לשלב שנמצא in_progress החזר גם progress: מספר 0–100, כמה ממנו כבר בוצע לפי הפעולות.
- אם אין תוכנית: בנה ב-phases את רשימת השלבים המלאה של המשימה, 3 עד 8 שלבים לפי הסדר, כולל שלבים עתידיים הגיוניים שעוד לא התחילו (כדי שאפשר יהיה לחשב אחוז התקדמות). לכל שלב: id (של שלב קיים אם הוא אותו שלב, אחרת השמט), title, status ("completed" / "in_progress" / "pending", בדיוק אחד in_progress), about, ולשלב ה-in_progress גם progress (0–100). שמור על שלבים קיימים ככל האפשר ועדכן רק סטטוסים או הוסף שלבים. ב-stepPhase מפה כל id של פעולה למספר השלב (מ-0) ב-phases.

למשימה: about — משפט או שניים: מה המשימה כולה ולמה; short — שם קצר למשימה, 2 עד 5 מילים (למשל "מחקר על ספריית גרפים", "שיפור דף ההרשמה").
שמות קבצים, כלים ופקודות כתוב כמו שהם. בלי הקדמות.
החזר JSON בלבד, בלי טקסט נוסף:
{"steps":[{"id":"...","what":"...","why":"..."}],"stages":[{"id":"...","title":"...","about":"...","progress":40}],"phases":[{"id":"...","title":"...","status":"...","about":"...","progress":40}],"stepPhase":{"<step id>":0},"task":{"id":"...","about":"...","short":"..."}}`

/** Steps waiting for an explanation: `${loopId}\u0000${stepId}`. */
const queue = new Set<string>()
/** Failed tries per step key: a batch that fails is tried once more, never a third time. */
const tries = new Map<string, number>()
/** Steps sent to the model right now: a sweep must not queue them again. */
const inFlight = new Set<string>()
/** Steps that got their sentence: never sent again. */
const settled = new Set<string>()

/** Whether a step may go (back) into the queue. */
const mayQueue = (k: string): boolean =>
  !queue.has(k) && !inFlight.has(k) && !settled.has(k) && (tries.get(k) ?? 0) < 2
let isScheduled = false
/** When the pending timer was set: one older than this is taken as lost. */
let scheduledAt = 0
const STALE_MS = 15000
let isRunning = false

export function explainLater($: EngineInterface, loopId: string, stepId: string): void {
  const k = `${loopId}\u0000${stepId}`
  if (mayQueue(k)) queue.add(k)
  schedule($)
}

/**
 * Sends what is still unexplained back to the explainer: steps with no
 * sentence yet, newest first, at most `cap`. A finished turn (and a reload)
 * sweeps, so nothing stays as a raw English label.
 */
export async function sweep($: EngineInterface, loopIds: readonly string[] | null, cap = 24): Promise<void> {
  const b = await read($, board)
  let left = cap
  for (const id of loopIds ?? [...b.order].reverse()) {
    const loop = b.loops[id]
    const task = loop?.tasks[loop.tasks.length - 1]
    if (!task) continue
    const steps = [...task.subtasks.flatMap(s => s.steps), ...task.loose].filter(s => s.what === undefined && s.ok !== null)
    for (const s of steps.slice(-left)) {
      const k = `${id}\u0000${s.id}`
      if (mayQueue(k)) queue.add(k)
    }
    left -= Math.min(left, steps.length)
    if (left <= 0) break
  }
  schedule($)
}

function schedule($: EngineInterface): void {
  // A timer that never fired (refused, or lost) must not silence the explainer.
  if (isScheduled && Date.now() - scheduledAt > STALE_MS) isScheduled = false
  if (isScheduled || isRunning || queue.size === 0) return
  isScheduled = true
  scheduledAt = Date.now()
  try {
    $.clock.after(DELAY_MS, () => {
      isScheduled = false
      void flush($)
    })
  } catch {
    isScheduled = false
  }
}

function parse(text: string): Explained | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as Partial<Explained>
    const steps = Array.isArray(v.steps)
      ? v.steps.filter(s => s && typeof s.id === 'string' && typeof s.what === 'string')
      : []
    const stages = Array.isArray(v.stages)
      ? v.stages
          .filter(s => s && typeof s.id === 'string')
          .map(s => ({
            id: s.id,
            about: typeof s.about === 'string' ? s.about : '',
            ...(typeof s.title === 'string' ? { title: s.title } : {}),
            ...(typeof s.progress === 'number' ? { progress: s.progress } : {}),
          }))
      : []
    const task =
      v.task && typeof v.task.id === 'string' && typeof v.task.about === 'string'
        ? { id: v.task.id, about: v.task.about, ...(typeof v.task.short === 'string' ? { short: v.task.short } : {}) }
        : null
    const phases = Array.isArray(v.phases)
      ? v.phases
          .filter(p => p && typeof p.title === 'string')
          .map(p => ({
            title: p.title,
            status: p.status,
            ...(typeof p.id === 'string' ? { id: p.id } : {}),
            ...(typeof p.about === 'string' ? { about: p.about } : {}),
            ...(typeof p.progress === 'number' ? { progress: p.progress } : {}),
          }))
      : undefined
    const stepPhase: Record<string, number> = {}
    if (v.stepPhase && typeof v.stepPhase === 'object') {
      for (const [k, n] of Object.entries(v.stepPhase)) if (typeof n === 'number') stepPhase[k] = n
    }
    return {
      steps: steps.map(s => ({ id: s.id, what: s.what, why: typeof s.why === 'string' ? s.why : '' })),
      stages,
      task,
      ...(phases ? { phases } : {}),
      stepPhase,
    }
  } catch {
    return null
  }
}

async function recentText($: EngineInterface, loopId: string): Promise<string> {
  try {
    const rows = await $.session.messages(loopId === MAIN ? {} : { agentId: loopId })
    if (!Array.isArray(rows)) return ''
    const said = rows
      .filter(r => r.role === 'assistant' && r.text.trim() !== '')
      .slice(-3)
      .map(r => r.text.trim())
      .join('\n')
    return said.slice(-1500)
  } catch {
    return ''
  }
}

/** Puts failed steps back once; after a second failure they keep their raw labels for good. */
function retry(keys: string[]): void {
  for (const k of keys) {
    const n = (tries.get(k) ?? 0) + 1
    tries.set(k, n)
    if (n < 2) queue.add(k)
  }
}

async function flush($: EngineInterface): Promise<void> {
  if (isRunning) return
  isRunning = true
  let taken: string[] = []
  try {
    // One batch: the first queued loop's steps, up to BATCH, all of one task.
    const first = [...queue][0]
    if (!first) return
    const loopId = first.split('\u0000')[0]!
    const b = await read($, board)
    const loop = b.loops[loopId]
    if (!loop) {
      for (const k of [...queue]) if (k.startsWith(`${loopId}\u0000`)) queue.delete(k)
      return
    }
    const ids = [...queue]
      .filter(k => k.startsWith(`${loopId}\u0000`))
      .map(k => k.split('\u0000')[1]!)
    // A step explained meanwhile (a sweep raced a batch) is settled, not sent again.
    const found = ids.map(id => findStep(loop, id)).filter(f => f !== null)
    for (const f of found) {
      if (f.step.what === undefined) continue
      const k = `${loopId}\u0000${f.step.id}`
      queue.delete(k)
      settled.add(k)
    }
    const open = found.filter(f => f.step.what === undefined)
    const task = open[0]?.task
    const batch = open.filter(f => f.task.id === task?.id).slice(0, BATCH)
    taken = batch.map(f => `${loopId}\u0000${f.step.id}`)
    for (const k of taken) {
      queue.delete(k)
      inFlight.add(k)
    }
    for (const id of ids) if (!findStep(loop, id)) queue.delete(`${loopId}\u0000${id}`)
    if (!task || batch.length === 0) return

    const ownPlan = hasOwnPlan(task)
    const planText = ownPlan
      ? `תוכנית השלבים של הסוכן:\n${task.subtasks.map(s => `- ${s.id} [${s.status}] ${s.content}`).join('\n')}`
      : task.subtasks.length > 0
        ? `אין תוכנית מפורשת. השלבים שכבר זוהו:\n${task.subtasks.map(s => `- ${s.id} [${s.status}] ${s.content}`).join('\n')}`
        : 'אין תוכנית מפורשת ואין עדיין שלבים: בנה phases.'
    const untitled = ownPlan ? task.subtasks.filter(s => !s.title || s.status === 'in_progress') : []
    const prompt = [
      loopId === MAIN
        ? `הבקשה של האדם: ${task.title}`
        : `סוכן משנה (${loop.kind}). המשימה שקיבל: ${loop.brief ?? loop.label}`,
      task.about ? `מה שכבר ידוע על המשימה: ${task.about}` : '',
      planText,
      untitled.length > 0 ? `שלבים שצריכים כותרת: ${untitled.map(s => s.id).join(', ')}` : '',
      `מזהה המשימה: ${task.id}`,
      `מה הסוכן כתב לאחרונה:\n${await recentText($, loopId)}`,
      `הפעולות:\n${batch.map(f => `- id ${f.step.id}: ${f.step.raw}`).join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n')

    const r = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt,
      maxTokens: 3000,
      effort: 'low',
      timeoutMs: 30000,
    })
    const x = r.isAnswered ? parse(r.text) : null
    // An answer that explains none of the steps counts as a failure.
    if (x && x.steps.length > 0) {
      await update($, board, bb => applyExplained(bb, loopId, x))
      // Steps the answer left out count as a failed try.
      const got = new Set(x.steps.map(st => `${loopId}\u0000${st.id}`))
      for (const k of taken) if (got.has(k)) settled.add(k)
      retry(taken.filter(k => !got.has(k)))
    } else {
      retry(taken)
    }
    taken = []
  } catch {
    // A thrown call (timeout, rate limit): try the batch once more.
    retry(taken)
  } finally {
    inFlight.clear()
    isRunning = false
    schedule($)
  }
}
