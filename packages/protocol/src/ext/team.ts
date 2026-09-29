// Your team: the everyday coworkers the owner meets first, each with a first job ready to start, and one who keeps the
// company's second brain (its memory and Handbook) tidy every week. The owner can change who is on the team; anyone in
// the directory can still be brought into a project.
import type { HandbookSectionId } from './memory';

export type FirstTaskKind = 'second-brain' | 'research' | 'project';

export interface FirstTask {
  kind: FirstTaskKind;
  /** What it is called when it starts (a job's or project's title). */
  title: string;
  /** What to do, with the owner's business in mind (the Handbook and files fill in the details). */
  brief: string;
}

export interface StarterMember {
  personaId: string;
  /** Why they are on a small business's team, in one plain sentence. */
  why: string;
  firstTask: FirstTask;
}

/** The team a new office starts with: everyday roles a small business recognises. */
export const STARTER_TEAM: readonly StarterMember[] = [
  {
    personaId: 'knowledge-librarian',
    why: 'Keeps what the business knows in order, so everyone works from the same facts.',
    firstTask: {
      kind: 'second-brain',
      title: 'Tidy the company’s second brain',
      brief: 'Every week: merge duplicate memories, flag ones that contradict each other or look out of date, and suggest what the Handbook is missing.',
    },
  },
  {
    personaId: 'bookkeeper',
    why: 'Keeps the money side clear: what came in, what went out, and what is still owed.',
    firstTask: {
      kind: 'research',
      title: 'A simple monthly money check-in',
      brief:
        'Set up a simple monthly money check-in for the business: what to look at each month (money in, costs, cash in the bank, unpaid invoices), a one-page template to fill in, and the three numbers most worth watching. Use what the Handbook and shared files say about the business; mark anything that needs the owner’s real figures.',
    },
  },
  {
    personaId: 'social-media-manager',
    why: 'Keeps your social accounts busy with posts that sound like you.',
    firstTask: {
      kind: 'project',
      title: 'A month of social posts',
      brief:
        'Plan a month of social media posts for the business: twelve posts across its main channels, each with a caption in the business’s voice, a picture idea and the best day to post. Base them on what the Handbook says about the business, its customers and its offer.',
    },
  },
  {
    personaId: 'senior-copywriter',
    why: 'Writes the words customers read: your website, emails, flyers and ads.',
    firstTask: {
      kind: 'research',
      title: 'A clearer website front page',
      brief:
        'Write a clearer front page for the business’s website: a headline, a two-sentence introduction, three reasons to choose us and a call to action, in the owner’s voice. Give two versions to choose from, and say what each one is for.',
    },
  },
  {
    personaId: 'head-of-support',
    why: 'Makes sure customers get quick, friendly answers and nobody falls through the cracks.',
    firstTask: {
      kind: 'research',
      title: 'Answers to the questions customers ask most',
      brief:
        'Draft short, friendly answers to the ten questions customers of this kind of business ask most (opening times, prices, bookings, returns, delivery and so on). Base them on the Handbook and shared files, and mark every answer that needs the owner’s own facts.',
    },
  },
  {
    personaId: 'operations-director',
    why: 'Keeps the day-to-day running smoothly: stock, suppliers, rotas and routines.',
    firstTask: {
      kind: 'research',
      title: 'A weekly running-the-business checklist',
      brief:
        'Create a simple weekly checklist for running the business smoothly: opening and closing, stock and suppliers, the staff rota, money to chase, and the one thing to review every Friday. Keep it to one page, grouped by day.',
    },
  },
  {
    personaId: 'account-executive',
    why: 'Finds new customers and follows up so good leads don’t go cold.',
    firstTask: {
      kind: 'research',
      title: 'Ten likely new customers',
      brief:
        'Describe the business’s best kind of customer, then list ten kinds of new customers (or local businesses) worth approaching, why each is a good fit, and a short, friendly first message for each.',
    },
  },
  {
    personaId: 'market-research-analyst',
    why: 'Finds out what customers and competitors are doing, so decisions rest on facts.',
    firstTask: {
      kind: 'research',
      title: 'What our competitors are doing',
      brief:
        'Look at five competitors of the business: what they offer, what they charge, what their customers say about them, and two ideas worth borrowing. Cite where each fact comes from.',
    },
  },
];

/** The steward of the second brain (their first task is the weekly tidy). */
export const SECOND_BRAIN_STEWARD = 'knowledge-librarian';
export const TEAM_MAX = 20;
/** How often the second brain is tidied (days). */
export const TIDY_EVERY_DAYS = 7;

export interface SecondBrainReport {
  at: string;
  /** Who tidied it (a persona id). */
  by: string;
  /** Duplicates merged. */
  merged: number;
  /** Memories looked at. */
  checked: number;
  /** Memories that contradict each other: keep one, or both if both are true. */
  conflicts: { a: string; b: string; note: string }[];
  /** Memories that look out of date. */
  outdated: { memoryId: string; note: string }[];
  /** What the Handbook could say, by section. */
  handbook: { section: HandbookSectionId; suggestion: string }[];
  summary: string;
}

export interface TeamMemberView {
  personaId: string;
  why: string;
  firstTask: FirstTask;
  /** The first task, once started: when, and what it became. */
  started?: { at: string; jobId?: string; projectId?: string };
}

export interface TeamResponse {
  members: TeamMemberView[];
  secondBrain: {
    on: boolean;
    steward: string;
    nextAt?: string;
    last?: SecondBrainReport;
  };
}

export interface TeamStartResponse {
  personaId: string;
  kind: FirstTaskKind;
  jobId?: string;
  projectId?: string;
  report?: SecondBrainReport;
  say: string;
}
