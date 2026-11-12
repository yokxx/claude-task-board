export type SubStatus = 'pending' | 'in_progress' | 'completed'

/** One tool call Claude (or a subagent) made. */
export type Step = {
  id: string
  /** The raw short label (tool and target). */
  label: string
  /** The tool's name and its input, cut short: what the explainer reads. */
  raw: string
  ok: boolean | null
  /** One sentence: what this action does (written by the explainer). */
  what?: string
  /** One sentence: why it is needed. */
  why?: string
}

/** One item of a plan (update_plan / TodoWrite / TaskCreate). */
export type Subtask = {
  id: string
  content: string
  status: SubStatus
  steps: Step[]
  /** One or two sentences: what this stage does and why. */
  about?: string
  /** A human title for the stage, in Hebrew ("מחפש מקורות"), from the explainer. */
  title?: string
  /** A phase the explainer inferred (the task had no plan of its own). */
  inferred?: boolean
  /** How far an in-progress stage is, 0–100, as the explainer judges it. */
  progress?: number
}

/** One unit of work: a user request (main loop) or a subagent's job. */
export type Task = {
  id: string
  title: string
  subtasks: Subtask[]
  /** Steps made while no subtask was in progress. */
  loose: Step[]
  isEnded: boolean
  /** One or two sentences: what the whole task is and why. */
  about?: string
  /** The question Claude waits on the person for, while it waits. */
  waiting?: string
  /** A short name for the task (2–5 words), from the explainer. */
  short?: string
}

/** Everything one loop (the main conversation or one subagent) did. */
export type Loop = {
  id: string
  label: string
  kind: string
  tasks: Task[]
  /** A subagent's prompt, cut short. */
  brief?: string
  /** When the subagent first started, its current turn started, and its last turn ended (ms since the epoch). */
  startedAt?: number
  turnStartedAt?: number
  endedAt?: number
  /** Time spent in finished turns: a resumed agent adds to it, idle time between turns does not count. */
  busyMs?: number
  /** The main task that was running when it was spawned. */
  parentTask?: string
}

export type Board = {
  /** Keyed by loop id; 'main' is the main conversation. */
  loops: Record<string, Loop>
  /** Loop ids in order of first appearance. */
  order: string[]
  /** The current main turn's prompt: the title a new task gets ('' for a continuation). */
  pendingTitle: string
  /** The main-loop task the current turn works on, once it has one. */
  mainTurnTask: string | null
  /** The main-loop task this turn created itself, if any (only it may be folded). */
  turnCreated: string | null
  /** Counter for task ids. */
  seq: number
}

export type View = {
  isOpen: boolean
  loop: string
  /** Rows the person opened (true) or closed (false); others use their default. */
  expanded: Record<string, boolean>
}

declare module 'claude-code' {
  interface PluginState {
    'task-board': { board: Shaped<Board>; view: Shaped<View> }
  }
}
