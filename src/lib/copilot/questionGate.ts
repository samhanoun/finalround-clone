/**
 * Question gate: decides when the interviewer has asked something the
 * candidate should get an answer for, and what kind of question it is.
 *
 * Pure and synchronous apart from the optional classifier, so it can be
 * tested against a corpus of real interview lines. Input is Deepgram text
 * with smart formatting (punctuation, "?" on most questions), one utterance
 * per speaker turn.
 */

import type { Utterance } from '@/lib/stt/utterances';

export type QuestionCategory = 'behavioral' | 'technical' | 'coding' | 'system_design' | 'other';

export const QUESTION_CATEGORIES: readonly QuestionCategory[] = [
  'behavioral',
  'technical',
  'coding',
  'system_design',
  'other',
];

export type GateDecision = 'answer' | 'skip' | 'unsure';

export type GateVerdict = {
  decision: GateDecision;
  /** 0..1, how much the line looks like a question worth answering. */
  score: number;
  category: QuestionCategory;
  reasons: string[];
};

/** At or above: answer. At or below SKIP_AT: skip. In between: ask the classifier. */
export const ANSWER_AT = 0.6;
export const SKIP_AT = 0.3;
/** Decides unsure lines when the classifier is missing, slow or failing. */
export const FALLBACK_ANSWER_AT = 0.45;

const FILLER_PREFIX =
  /^(?:(?:um+|uh+|erm|hmm+|so|okay|ok|alright|all right|right|well|yeah|yes|great|cool|perfect|awesome|got it|thanks|thank you|and|now|next)[,.!]?\s+)+/;

const WH_START = /^(?:what|why|how|when|where|which|who|whom|whose)\b/;
const AUX_START =
  /^(?:can|could|would|will|do|does|did|have|has|had|are|is|was|were|should|shall|may|might)\s+(?:you|we|i|there|it|that|this|your|they)\b/;

const PROMPT_PATTERNS = [
  /\b(?:tell|talk to) (?:me|us)\b/,
  /\btalk (?:me |us )?(?:about|through)\b/,
  /\bwalk (?:me|us) through\b/,
  /\btake (?:me|us) through\b/,
  /\bgive (?:me|us) (?:an? |some )?(?:example|overview|sense|idea|rundown)/,
  /^(?:describe|explain|share|elaborate|summari[sz]e|compare|define|outline|design|implement|write|build|sketch|estimate)\b/,
  /\b(?:describe|explain) (?:how|what|why|a|an|the|your)\b/,
  /\bhow (?:would|do|did|will|could|should) you\b/,
  /\bwhat (?:would|do|did|will|could|should) you\b/,
  /\b(?:i'd|i would|i'm|i am|we'd|we would) (?:like|love|curious|interested|keen) (?:to (?:hear|know|understand|see|learn)|about|in|how|what|why)/,
  /\bi (?:want|wanted) to (?:hear|know|understand|ask)\b/,
  /\bhelp (?:me|us) understand\b/,
  /\b(?:let's|let us) say\b/,
  /^(?:suppose|imagine|assume|say) (?:you|that|we|there)\b/,
  /\bgiven (?:an?|the|two|some) (?:array|list|string|tree|graph|matrix|number|integer|set|linked list|binary|sorted|stream|map)/,
  /\bwrite (?:a|an|me a|some|the) (?:function|method|class|query|program|script|algorithm|test)/,
  /\bdesign (?:a|an|the|me a)\b/,
  /\b(?:walk|go) (?:me )?through (?:your|the|how)\b/,
  /\bany questions for (?:me|us)\b/,
];

/** Very short follow-ups an interviewer uses to probe the last answer. */
const SHORT_FOLLOW_UP =
  /^(?:why|why not|how|how so|how come|such as|for example|like what|meaning|and then|then what|what else|anything else|and why|in what way|what happened|what did you learn)\??$/;

/**
 * Lines that look like questions but need no prepared answer (call logistics,
 * small talk, checking understanding), and lines that are plainly not questions.
 */
const NOT_INTERVIEW_QUESTION = [
  /\bcan you (?:hear|see) (?:me|my|us|it|that)\b/,
  /\b(?:is|was) my (?:audio|video|screen|mic|microphone|connection)\b/,
  /\bare you (?:there|still there|able to (?:hear|see))\b/,
  /\byou(?:'re| are) (?:on )?mute(?:d)?\b/,
  /\b(?:share|sharing|stop sharing) (?:my|your) screen\b/,
  /^how(?: are|'re| is|'s| was) (?:you|things|it going|everything|your (?:day|week|morning|afternoon|weekend))(?: going| doing)?(?: so far| today| this (?:morning|afternoon|week))?[?.!]*$/,
  /^(?:hi|hello|hey|good (?:morning|afternoon|evening))\b/,
  /\bnice (?:to )?(?:meet|meeting|see|seeing) you\b/,
  /\b(?:does that make sense|is that clear|is that okay|are you ready|ready to (?:start|begin|go)|sound good)\b/,
  /\b(?:shall|should|can) we (?:start|begin|get started|move on|jump|switch|go)\b/,
  /\b(?:could|can|would) you (?:please )?(?:repeat|say) (?:that|the last part|it)(?: again)?\b/,
  /^(?:sorry,? )?(?:what was that|come again|pardon)[?.!]*$/,
  /\bspeak up\b/,
  /\bany questions so far\b/,
  /\b(?:one|a) (?:sec|second|moment|minute)\b/,
  /\b(?:take your time|no rush|whenever you're ready|go ahead|bear with me|my bad|sorry about that)\b/,
  /\b(?:internet|connection|wifi|wi-fi) (?:cut|dropped|is bad|froze|is unstable)\b/,
  /\b(?:you (?:froze|cut out|broke up)|i (?:lost|missed) you)\b/,
  /\bdo you want me to repeat\b/,
  /^(?:let me|i'll|i will|we'll|we will|i'm going to|i am going to|we're going to) (?:share|send|tell you|give you|explain|introduce|pull up|move|switch|check|start|note|write|look|copy|paste|stop|wrap)/,
  /^(?:that's|that is|those are) (?:all|it|great|good|fine|a great|a good|interesting|helpful|fair)\b/,
  /^(?:we have|we've got|there are) (?:about |around )?\d+ (?:minutes|mins)\b/,
];

const ACKNOWLEDGEMENT =
  /^(?:ok|okay|great|good|nice|cool|awesome|perfect|sure|right|yes|yeah|yep|no|nope|got it|i see|makes sense|that makes sense|that's fair|good to know|very interesting|interesting|love that|i like that|fantastic|hmm+|mm+|uh-?huh|thanks|thank you|sounds good|fair enough|understood|wonderful|excellent|alright|all right)[\s,.!]*(?:(?:thanks|thank you|that makes sense|makes sense|got it|great|good|cool|okay|i see|interesting|sure)[\s,.!]*)*$/;

const CATEGORY_RULES: Array<[QuestionCategory, RegExp[]]> = [
  [
    'coding',
    [
      /\bwrite (?:a|an|me a|some|the) (?:function|method|class|program|script|algorithm|test|query)/,
      /\bimplement (?:a|an|the)\b/,
      /\bgiven (?:an?|the|two|some) (?:array|list|string|tree|graph|matrix|number|integer|set|linked list|binary|sorted|stream|map)/,
      /\b(?:time|space) complexity\b|\bbig[- ]o\b/,
      /\b(?:leetcode|algorithm|data structure|binary search|two pointers|sliding window|dynamic programming|recursion|recursive|hash ?map|linked list|binary tree|bfs|dfs|sql query)\b/,
      /\breturn (?:the|a|an|true|false|all)\b/,
      /\b(?:code|coding) (?:this|it|up|that|problem|challenge|exercise)\b/,
    ],
  ],
  [
    'system_design',
    [
      /\bdesign (?:a|an|the|me a) (?!.*\balgorithm\b)/,
      /\bhow would you (?:design|architect|scale|build) (?:a|an|the)\b/,
      /\b(?:scale|scaling) (?:to|this|it|that|up)\b/,
      /\b(?:millions|billions|thousands) of (?:users|requests|records|events|messages)\b/,
      /\b(?:load balancer|shard|shards|sharding|partitioning|replication|high availability|throughput|rate limiter|message queue|cdn|consistent hashing|microservices|system design|architecture)\b/,
    ],
  ],
  [
    'behavioral',
    [
      /\btell (?:me|us) about (?:a time|yourself|a situation|an? (?:instance|occasion|example|project|challenge|mistake|failure|conflict))/,
      /\b(?:describe|share|give (?:me|us)) (?:a|an) (?:time|situation|example|instance|occasion)\b/,
      /\ba time (?:when|that|where|you)\b/,
      /\bproject (?:you|that you) (?:led|owned|ran|drove|are proud of)\b/,
      /\bwalk (?:me|us) through your (?:resume|background|career|experience|cv)\b/,
      /\bhow do you (?:handle|deal with|manage|approach|prioriti[sz]e|respond to|work with|stay)\b/,
      /\b(?:conflict|disagree|disagreement|mistake|failure|failed|proud|strength|strengths|weakness|weaknesses|feedback|teammate|stakeholder|leadership|motivat|pressure|deadline|difficult (?:person|coworker|colleague|manager))/,
      /\bwhy (?:do you want|are you (?:interested|looking|leaving)|this (?:role|company|team|position|job)|us|here|should we hire)/,
      /\bwhy did you (?:leave|choose|decide|join|move|switch|pick|go)\b/,
      /\bwhere do you see yourself\b/,
      /\bwhat (?:are you looking for|motivates you|did you learn|would your (?:manager|colleagues|team))\b/,
    ],
  ],
  [
    'technical',
    [
      /\b(?:difference between|how does|how do (?:you|we) (?:use|configure|debug|test|deploy|optimi[sz]e|secure|monitor)|what is (?:a|an|the)|what are (?:the|some))\b/,
      /\b(?:api|rest|graphql|http|https|tcp|dns|oauth|jwt|cors|sql|nosql|postgres|mysql|mongodb|redis|kafka|react|angular|vue|node|python|java|javascript|typescript|golang|rust|kotlin|swift|c\+\+|docker|kubernetes|aws|gcp|azure|ci\/cd|git|thread|threads|concurrency|memory|garbage collection|index|indexes|cache|caching|transaction|latency|encryption|testing|unit test|database|framework|compiler|runtime|cloud|linux|machine learning|model|pipeline)\b/,
    ],
  ],
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripFillers(text: string): string {
  return text.replace(FILLER_PREFIX, '').trim();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length;
}

/** Splits into sentences so "Great, thanks. Why did you leave?" scores on its question. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((sentence) => stripFillers(sentence.trim()))
    .filter(Boolean);
}

export function categorizeQuestion(text: string): QuestionCategory {
  const normalized = normalize(text);
  for (const [category, patterns] of CATEGORY_RULES) {
    if (patterns.some((pattern) => pattern.test(normalized))) return category;
  }
  return 'other';
}

function scoreSentence(sentence: string): { score: number; reasons: string[] } {
  if (SHORT_FOLLOW_UP.test(sentence)) return { score: 0.7, reasons: ['short follow-up'] };
  if (NOT_INTERVIEW_QUESTION.some((pattern) => pattern.test(sentence))) {
    return { score: 0, reasons: ['logistics or small talk'] };
  }
  if (ACKNOWLEDGEMENT.test(sentence)) return { score: 0, reasons: ['acknowledgement'] };

  const reasons: string[] = [];
  const words = wordCount(sentence);
  let score = 0;
  if (sentence.endsWith('?')) {
    score += 0.45;
    reasons.push('ends with ?');
  }
  if (WH_START.test(sentence)) {
    score += 0.3;
    reasons.push('wh-question');
  } else if (AUX_START.test(sentence)) {
    score += 0.3;
    reasons.push('yes/no question form');
  }
  // A clear interview prompt ("Tell me about yourself.") answers on its own.
  if (PROMPT_PATTERNS.some((pattern) => pattern.test(sentence))) {
    score += 0.6;
    reasons.push('interview prompt');
  }
  if (words < 3) {
    score -= 0.35;
    reasons.push('very short');
  } else if (words >= 6 && score > 0) {
    score += 0.05;
  }
  return { score: Math.max(0, Math.min(1, score)), reasons };
}

/** Scores one utterance. The best-scoring sentence decides. */
export function scoreUtterance(text: string): GateVerdict {
  let best = { score: 0, reasons: ['no question signals'] };
  for (const part of sentences(normalize(text))) {
    const scored = scoreSentence(part);
    if (scored.score > best.score) best = scored;
  }
  const decision: GateDecision = best.score >= ANSWER_AT ? 'answer' : best.score <= SKIP_AT ? 'skip' : 'unsure';
  return { decision, score: best.score, category: categorizeQuestion(text), reasons: best.reasons };
}

/** Lines that only fill air: they never extend or re-trigger a question. */
export function isFiller(text: string): boolean {
  return sentences(normalize(text)).every(
    (part) =>
      wordCount(part) === 0 ||
      ACKNOWLEDGEMENT.test(part) ||
      NOT_INTERVIEW_QUESTION.some((pattern) => pattern.test(part)),
  );
}

/** Short and without "?": probably cut off by a pause, so the next line may finish it. */
function looksCutOff(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed.endsWith('?') && wordCount(normalize(trimmed)) < 6;
}

export type ClassifierResult = { answer: boolean; category: QuestionCategory };
export type Classifier = (text: string, signal: AbortSignal) => Promise<ClassifierResult | null>;

export type GatedQuestion = {
  /** The question with the turn's earlier lines for context ("I see you were at Stripe. What did you build?"). */
  text: string;
  category: QuestionCategory;
  trigger: 'gate' | 'manual';
  /** 'screen': Solve screen, answered from a frame of the shared screen rather than speech. */
  via: 'heuristic' | 'classifier' | 'fallback' | 'manual' | 'screen';
  score: number;
  decidedAt: number;
  /** Automatic questions: when the interviewer stopped talking (wall clock, ms). */
  speechEndedAt?: number | null;
  /** Automatic questions: when the triggering utterance became final. */
  finalAt?: number | null;
};

export type QuestionGateOptions = {
  onQuestion: (question: GatedQuestion) => void;
  classify?: Classifier;
  /** Classifier time budget; on timeout the heuristic fallback decides. */
  classifierBudgetMs?: number;
  /** Interviewer lines closer together than this belong to the same turn. */
  turnGapSec?: number;
  /** A line this soon after a cut-off question that fired finishes that question. */
  continuationSec?: number;
  /** How many of the turn's latest lines go into the question text. */
  maxTurnParts?: number;
  now?: () => number;
};

type Turn = {
  parts: string[];
  lastEndSec: number;
  lastTriggerText: string | null;
  /** The line that fired looked cut off, so the next line may finish it. */
  lastTriggerOpen: boolean;
  /** Timing of the latest line, for latency per question. */
  lastSpeechEndedAt: number | null;
  lastFinalAt: number | null;
};

/**
 * Tracks the interviewer's current turn and fires `onQuestion` when it holds
 * a question. A later line in the same turn that is itself a question, or that
 * finishes a question cut off by a pause, fires again with the whole turn; the
 * caller treats that as a supersede.
 */
export class QuestionGate {
  private readonly onQuestion: (question: GatedQuestion) => void;
  private readonly classify?: Classifier;
  private readonly classifierBudgetMs: number;
  private readonly turnGapSec: number;
  private readonly continuationSec: number;
  private readonly maxTurnParts: number;
  private readonly now: () => number;

  private turn: Turn | null = null;
  /** The last turn that ended, for Answer now after the candidate started talking. */
  private previousTurnText = '';
  private triggerCount = 0;
  private classifySeq = 0;
  private classifierAbort: AbortController | null = null;

  constructor(options: QuestionGateOptions) {
    this.onQuestion = options.onQuestion;
    this.classify = options.classify;
    this.classifierBudgetMs = options.classifierBudgetMs ?? 600;
    this.turnGapSec = options.turnGapSec ?? 4;
    this.continuationSec = options.continuationSec ?? 3;
    this.maxTurnParts = options.maxTurnParts ?? 3;
    this.now = options.now ?? (() => Date.now());
  }

  /** Feed every committed utterance, both speakers, in order. */
  observe(utterance: Utterance): Promise<void> {
    if (utterance.role === 'candidate') {
      this.endTurn();
      return Promise.resolve();
    }

    const text = utterance.text.trim();
    if (!text) return Promise.resolve();

    let turn = this.turn;
    if (!turn || utterance.startSec - turn.lastEndSec > this.turnGapSec) {
      this.endTurn();
      turn = {
        parts: [],
        lastEndSec: utterance.endSec,
        lastTriggerText: null,
        lastTriggerOpen: false,
        lastSpeechEndedAt: null,
        lastFinalAt: null,
      };
      this.turn = turn;
    }
    const gapSec = utterance.startSec - turn.lastEndSec;
    turn.parts.push(text);
    turn.lastEndSec = utterance.endSec;
    turn.lastSpeechEndedAt = utterance.speechEndedAt ?? null;
    turn.lastFinalAt = utterance.completedAt;

    const turnText = this.turnText(turn);
    const own = scoreUtterance(text);
    const continuesQuestion =
      turn.lastTriggerOpen && gapSec <= this.continuationSec && !isFiller(text);

    if (own.decision === 'answer') {
      this.fire(turn, turnText, own, 'heuristic', looksCutOff(text));
      return Promise.resolve();
    }
    if (continuesQuestion) {
      const whole = scoreUtterance(turnText);
      this.fire(turn, turnText, whole, 'heuristic', looksCutOff(text));
      return Promise.resolve();
    }
    if (own.decision === 'skip') return Promise.resolve();
    return this.resolveUnsure(turn, turnText, own);
  }

  /** Answer now: the current interviewer turn (plus words still being spoken), else the last one. */
  answerNow(liveInterviewerText = ''): GatedQuestion | null {
    const live = liveInterviewerText.trim();
    const current = this.turn ? this.turnText(this.turn) : '';
    // With no turn open, words still being spoken start a new question on their own.
    const text = (current && live ? `${current} ${live}` : current || live || this.previousTurnText).trim();
    if (!text) return null;

    this.cancelClassifier();
    this.triggerCount += 1;
    if (this.turn) {
      this.turn.lastTriggerText = text;
      this.turn.lastTriggerOpen = false;
    }
    const question: GatedQuestion = {
      text,
      category: categorizeQuestion(text),
      trigger: 'manual',
      via: 'manual',
      score: 1,
      decidedAt: this.now(),
    };
    this.onQuestion(question);
    return question;
  }

  reset(): void {
    this.cancelClassifier();
    this.turn = null;
    this.previousTurnText = '';
  }

  private async resolveUnsure(turn: Turn, turnText: string, verdict: GateVerdict): Promise<void> {
    if (!this.classify) {
      if (verdict.score >= FALLBACK_ANSWER_AT) this.fire(turn, turnText, verdict, 'fallback', looksCutOff(turnText));
      return;
    }

    this.cancelClassifier();
    const seq = this.classifySeq;
    const abort = new AbortController();
    this.classifierAbort = abort;
    const triggersBefore = this.triggerCount;
    const timer = setTimeout(() => abort.abort(), this.classifierBudgetMs);

    let result: ClassifierResult | null = null;
    try {
      result = await this.classify(turnText, abort.signal);
    } catch {
      result = null; // timed out or failed
    } finally {
      clearTimeout(timer);
      if (this.classifierAbort === abort) this.classifierAbort = null;
    }

    // A newer line, Answer now or the end of the turn made this call stale.
    if (seq !== this.classifySeq || this.triggerCount !== triggersBefore || this.turn !== turn) return;
    if (result === null) {
      if (verdict.score >= FALLBACK_ANSWER_AT) this.fire(turn, turnText, verdict, 'fallback', looksCutOff(turnText));
    } else if (result.answer) {
      this.fire(turn, turnText, { ...verdict, category: result.category }, 'classifier', looksCutOff(turnText));
    }
  }

  private fire(turn: Turn, text: string, verdict: GateVerdict, via: GatedQuestion['via'], open: boolean): void {
    if (turn.lastTriggerText === text) return;
    this.cancelClassifier();
    turn.lastTriggerText = text;
    turn.lastTriggerOpen = open;
    this.triggerCount += 1;
    this.onQuestion({
      text,
      category: verdict.category,
      trigger: 'gate',
      via,
      score: verdict.score,
      decidedAt: this.now(),
      speechEndedAt: turn.lastSpeechEndedAt,
      finalAt: turn.lastFinalAt,
    });
  }

  private endTurn(): void {
    if (this.turn) this.previousTurnText = this.turnText(this.turn);
    this.turn = null;
    this.cancelClassifier();
  }

  /** Invalidates any classifier call in flight. */
  private cancelClassifier(): void {
    this.classifySeq += 1;
    this.classifierAbort?.abort();
    this.classifierAbort = null;
  }

  private turnText(turn: Turn): string {
    return turn.parts.slice(-this.maxTurnParts).join(' ');
  }
}
