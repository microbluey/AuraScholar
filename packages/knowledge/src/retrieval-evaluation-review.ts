import { canonicalJson } from "./hash.js";
import {
  assertRetrievalEvaluationDataset,
  type BilingualRetrievalLanguage,
  type RetrievalEvaluationDataset,
  type RetrievalRelevanceGrade,
} from "./retrieval-evaluation.js";

/** Zero means that a blinded reviewer found the candidate not relevant. */
export type RetrievalEvaluationReviewGrade = 0 | RetrievalRelevanceGrade;

/** Public, label-free material sent to one independent reviewer. */
export interface RetrievalEvaluationBlindReviewPacket {
  readonly dataset: Pick<RetrievalEvaluationDataset, "id" | "split" | "version">;
  readonly id: string;
  readonly tasks: readonly RetrievalEvaluationBlindReviewTask[];
}

export interface RetrievalEvaluationBlindReviewTask {
  readonly candidates: readonly RetrievalEvaluationBlindReviewCandidate[];
  readonly discipline: string;
  readonly id: string;
  readonly language: BilingualRetrievalLanguage;
  readonly targetLanguage: BilingualRetrievalLanguage;
  readonly text: string;
}

/** Candidate aliases deliberately omit the canonical ContentUnit and source IDs. */
export interface RetrievalEvaluationBlindReviewCandidate {
  readonly id: string;
  readonly language: BilingualRetrievalLanguage;
  readonly text: string;
}

/**
 * Keep this private with the coordinator. It maps a blinded packet back to the
 * immutable evaluation corpus after reviewers submit their grades.
 */
export interface RetrievalEvaluationBlindReviewKey {
  readonly candidateToContentUnitId: Readonly<Record<string, string>>;
  readonly packetId: string;
  readonly taskToQueryId: Readonly<Record<string, string>>;
}

export interface RetrievalEvaluationBlindReviewBundle {
  readonly key: RetrievalEvaluationBlindReviewKey;
  readonly packet: RetrievalEvaluationBlindReviewPacket;
}

/** One reviewer must grade every supplied candidate for every blinded task. */
export interface RetrievalEvaluationBlindReviewSubmission {
  readonly packetId: string;
  readonly reviewerId: string;
  readonly tasks: readonly RetrievalEvaluationBlindReviewTaskGrades[];
}

export interface RetrievalEvaluationBlindReviewTaskGrades {
  readonly grades: readonly RetrievalEvaluationBlindReviewCandidateGrade[];
  readonly taskId: string;
}

export interface RetrievalEvaluationBlindReviewCandidateGrade {
  readonly candidateId: string;
  readonly relevance: RetrievalEvaluationReviewGrade;
}

/** An explicit adjudicator decision uses the same complete grade matrix. */
export interface RetrievalEvaluationBlindReviewAdjudication {
  readonly adjudicatorId: string;
  readonly packetId: string;
  readonly tasks: readonly RetrievalEvaluationBlindReviewTaskGrades[];
}

export interface RetrievalEvaluationReviewDisagreement {
  readonly candidateId: string;
  readonly firstRelevance: RetrievalEvaluationReviewGrade;
  readonly secondRelevance: RetrievalEvaluationReviewGrade;
  readonly taskId: string;
}

export interface FinalizeHumanReviewedRetrievalEvaluationInput {
  readonly adjudication: RetrievalEvaluationBlindReviewAdjudication;
  readonly reviewBundle: RetrievalEvaluationBlindReviewBundle;
  /** Exactly two structurally independent reviewer submissions are required. */
  readonly reviewerSubmissions: readonly RetrievalEvaluationBlindReviewSubmission[];
  /** Must be a separately prepared held-out dataset, never a development set. */
  readonly sourceDataset: RetrievalEvaluationDataset;
}

/** Auditable metadata retained alongside, rather than inside, a public corpus. */
export interface RetrievalEvaluationHumanReviewAudit {
  readonly adjudicatorId: string;
  readonly disagreementCount: number;
  readonly packetId: string;
  readonly reviewerIds: readonly [string, string];
}

export interface FinalizedHumanReviewedRetrievalEvaluation {
  readonly audit: RetrievalEvaluationHumanReviewAudit;
  readonly dataset: RetrievalEvaluationDataset;
}

/**
 * Creates a deterministic, label-free packet from a valid corpus. The seed
 * labels remain inside `dataset` and never appear in the public packet; they
 * can therefore be replaced by genuine independent review and adjudication.
 */
export function createRetrievalEvaluationBlindReviewBundle(
  dataset: RetrievalEvaluationDataset,
): RetrievalEvaluationBlindReviewBundle {
  assertRetrievalEvaluationDataset(dataset);
  const packetId = `retrieval-review:${dataset.id}@${dataset.version}`;
  const units = [...dataset.contentUnits].sort((left, right) => compareText(left.id, right.id));
  const candidateToContentUnitId: Record<string, string> = {};
  const candidateIdByContentUnitId = new Map<string, string>();
  for (const [index, unit] of units.entries()) {
    const candidateId = `candidate:${String(index + 1).padStart(4, "0")}`;
    candidateToContentUnitId[candidateId] = unit.id;
    candidateIdByContentUnitId.set(unit.id, candidateId);
  }

  const taskToQueryId: Record<string, string> = {};
  const tasks = [...dataset.queries]
    .sort((left, right) => compareText(left.id, right.id))
    .map((query, index): RetrievalEvaluationBlindReviewTask => {
      const taskId = `task:${String(index + 1).padStart(4, "0")}`;
      taskToQueryId[taskId] = query.id;
      return {
        candidates: units
          .filter((unit) => unit.language === query.targetLanguage)
          .map((unit) => {
            const candidateId = candidateIdByContentUnitId.get(unit.id);
            if (!candidateId)
              throw new Error("Retrieval evaluation review candidate alias is missing");
            return { id: candidateId, language: unit.language, text: unit.text };
          }),
        discipline: query.discipline,
        id: taskId,
        language: query.language,
        targetLanguage: query.targetLanguage,
        text: query.text,
      };
    });

  return {
    key: { candidateToContentUnitId, packetId, taskToQueryId },
    packet: {
      dataset: { id: dataset.id, split: dataset.split, version: dataset.version },
      id: packetId,
      tasks,
    },
  };
}

/** Validates one complete independent reviewer submission against a public packet. */
export function assertRetrievalEvaluationBlindReviewSubmission(
  packet: RetrievalEvaluationBlindReviewPacket,
  submission: RetrievalEvaluationBlindReviewSubmission,
): void {
  assertPacket(packet);
  normalizeSubmission(packet, submission, "reviewer");
}

/**
 * Lists every cell that two independent reviewers scored differently. It does
 * not choose a winner: an explicit adjudication must make that decision.
 */
export function listRetrievalEvaluationReviewDisagreements(
  packet: RetrievalEvaluationBlindReviewPacket,
  reviewerSubmissions: readonly RetrievalEvaluationBlindReviewSubmission[],
): readonly RetrievalEvaluationReviewDisagreement[] {
  assertPacket(packet);
  const [first, second] = normalizeReviewerSubmissions(packet, reviewerSubmissions);
  const disagreements: RetrievalEvaluationReviewDisagreement[] = [];
  for (const task of packet.tasks) {
    const firstGrades = first.gradesByTask.get(task.id);
    const secondGrades = second.gradesByTask.get(task.id);
    if (!firstGrades || !secondGrades) {
      throw new Error(`Retrieval evaluation review task ${task.id} is missing from a submission`);
    }
    for (const candidate of task.candidates) {
      const firstRelevance = firstGrades.get(candidate.id);
      const secondRelevance = secondGrades.get(candidate.id);
      if (firstRelevance === undefined || secondRelevance === undefined) {
        throw new Error(
          `Retrieval evaluation review candidate ${candidate.id} is missing from a submission`,
        );
      }
      if (firstRelevance !== secondRelevance) {
        disagreements.push({
          candidateId: candidate.id,
          firstRelevance,
          secondRelevance,
          taskId: task.id,
        });
      }
    }
  }
  return disagreements;
}

/**
 * Replaces provisional labels with an adjudicated, structurally auditable
 * human-reviewed set. It deliberately refuses development data, so a corpus
 * already used for tuning can never be relabelled into a release gate.
 */
export function finalizeHumanReviewedRetrievalEvaluation(
  input: FinalizeHumanReviewedRetrievalEvaluationInput,
): FinalizedHumanReviewedRetrievalEvaluation {
  if (!input || typeof input !== "object") {
    throw new Error("Human-reviewed retrieval evaluation finalization input must be an object");
  }
  const sourceDataset = input.sourceDataset;
  assertRetrievalEvaluationDataset(sourceDataset);
  if (sourceDataset.split !== "held-out") {
    throw new Error("Human-reviewed retrieval evaluation finalization requires a held-out dataset");
  }
  assertBundleMatchesDataset(sourceDataset, input.reviewBundle);
  const packet = input.reviewBundle.packet;
  const [firstReview, secondReview] = normalizeReviewerSubmissions(
    packet,
    input.reviewerSubmissions,
  );
  const adjudication = normalizeSubmission(packet, input.adjudication, "adjudication");
  const taskIdByQueryId = new Map(
    Object.entries(input.reviewBundle.key.taskToQueryId).map(([taskId, queryId]) => [
      queryId,
      taskId,
    ]),
  );

  const dataset: RetrievalEvaluationDataset = {
    ...sourceDataset,
    queries: sourceDataset.queries.map((query) => {
      const taskId = taskIdByQueryId.get(query.id);
      if (!taskId)
        throw new Error(`Retrieval evaluation review key has no task for query ${query.id}`);
      const grades = adjudication.gradesByTask.get(taskId);
      if (!grades) throw new Error(`Retrieval evaluation adjudication is missing task ${taskId}`);
      const relevanceJudgments = packetTaskFor(packet, taskId).candidates.flatMap((candidate) => {
        const relevance = grades.get(candidate.id);
        if (relevance === undefined) {
          throw new Error(`Retrieval evaluation adjudication is missing candidate ${candidate.id}`);
        }
        if (relevance === 0) return [];
        const contentUnitId = input.reviewBundle.key.candidateToContentUnitId[candidate.id];
        if (!contentUnitId) {
          throw new Error(`Retrieval evaluation review key has no ContentUnit for ${candidate.id}`);
        }
        return [{ contentUnitId, relevance }];
      });
      if (relevanceJudgments.length === 0) {
        throw new Error(
          `Retrieval evaluation adjudication must select a relevant candidate for ${taskId}`,
        );
      }
      return {
        ...query,
        labelProvenance: {
          adjudicated: true,
          independentReviewerCount: 2,
          kind: "human-reviewed" as const,
        },
        relevanceJudgments,
      };
    }),
  };
  assertRetrievalEvaluationDataset(dataset);
  return {
    audit: {
      adjudicatorId: adjudication.reviewerId,
      disagreementCount: listRetrievalEvaluationReviewDisagreements(
        packet,
        input.reviewerSubmissions,
      ).length,
      packetId: packet.id,
      reviewerIds: [firstReview.reviewerId, secondReview.reviewerId],
    },
    dataset,
  };
}

interface NormalizedReviewSubmission {
  readonly gradesByTask: ReadonlyMap<string, ReadonlyMap<string, RetrievalEvaluationReviewGrade>>;
  readonly reviewerId: string;
}

function assertBundleMatchesDataset(
  dataset: RetrievalEvaluationDataset,
  reviewBundle: RetrievalEvaluationBlindReviewBundle,
): void {
  if (!reviewBundle || typeof reviewBundle !== "object") {
    throw new Error("Retrieval evaluation review bundle must be an object");
  }
  const expected = createRetrievalEvaluationBlindReviewBundle(dataset);
  if (
    canonicalJson(reviewBundle.packet) !== canonicalJson(expected.packet) ||
    canonicalJson(reviewBundle.key) !== canonicalJson(expected.key)
  ) {
    throw new Error("Retrieval evaluation review bundle does not match the supplied dataset");
  }
}

function assertPacket(packet: RetrievalEvaluationBlindReviewPacket): void {
  if (!packet || typeof packet !== "object") {
    throw new Error("Retrieval evaluation blind review packet must be an object");
  }
  assertNonEmpty(packet.id, "Retrieval evaluation blind review packet id");
  if (!packet.dataset || typeof packet.dataset !== "object") {
    throw new Error("Retrieval evaluation blind review packet dataset must be an object");
  }
  assertNonEmpty(packet.dataset.id, "Retrieval evaluation blind review packet dataset id");
  assertNonEmpty(
    packet.dataset.version,
    "Retrieval evaluation blind review packet dataset version",
  );
  if (packet.dataset.split !== "development" && packet.dataset.split !== "held-out") {
    throw new Error("Retrieval evaluation blind review packet split is unsupported");
  }
  if (!Array.isArray(packet.tasks) || packet.tasks.length === 0) {
    throw new Error("Retrieval evaluation blind review packet must contain tasks");
  }
  const taskIds = new Set<string>();
  for (const task of packet.tasks) {
    assertNonEmpty(task.id, "Retrieval evaluation blind review task id");
    if (taskIds.has(task.id)) {
      throw new Error(
        `Retrieval evaluation blind review task ${task.id} was supplied more than once`,
      );
    }
    taskIds.add(task.id);
    assertNonEmpty(task.discipline, `Retrieval evaluation blind review task ${task.id} discipline`);
    assertNonEmpty(task.text, `Retrieval evaluation blind review task ${task.id} text`);
    assertLanguage(task.language, `Retrieval evaluation blind review task ${task.id} language`);
    assertLanguage(
      task.targetLanguage,
      `Retrieval evaluation blind review task ${task.id} target language`,
    );
    if (!Array.isArray(task.candidates) || task.candidates.length === 0) {
      throw new Error(`Retrieval evaluation blind review task ${task.id} must contain candidates`);
    }
    const candidateIds = new Set<string>();
    for (const candidate of task.candidates) {
      assertNonEmpty(
        candidate.id,
        `Retrieval evaluation blind review task ${task.id} candidate id`,
      );
      if (candidateIds.has(candidate.id)) {
        throw new Error(
          `Retrieval evaluation blind review task ${task.id} candidate ${candidate.id} was supplied more than once`,
        );
      }
      candidateIds.add(candidate.id);
      assertLanguage(
        candidate.language,
        `Retrieval evaluation blind review task ${task.id} candidate ${candidate.id} language`,
      );
      if (candidate.language !== task.targetLanguage) {
        throw new Error(
          `Retrieval evaluation blind review task ${task.id} candidate ${candidate.id} has the wrong target language`,
        );
      }
      assertNonEmpty(
        candidate.text,
        `Retrieval evaluation blind review candidate ${candidate.id} text`,
      );
    }
  }
}

function normalizeReviewerSubmissions(
  packet: RetrievalEvaluationBlindReviewPacket,
  submissions: readonly RetrievalEvaluationBlindReviewSubmission[],
): readonly [NormalizedReviewSubmission, NormalizedReviewSubmission] {
  if (!Array.isArray(submissions) || submissions.length !== 2) {
    throw new Error("Retrieval evaluation finalization requires exactly two reviewer submissions");
  }
  const firstSubmission = submissions[0];
  const secondSubmission = submissions[1];
  if (!firstSubmission || !secondSubmission) {
    throw new Error("Retrieval evaluation finalization requires exactly two reviewer submissions");
  }
  const first = normalizeSubmission(packet, firstSubmission, "reviewer");
  const second = normalizeSubmission(packet, secondSubmission, "reviewer");
  if (first.reviewerId === second.reviewerId) {
    throw new Error("Retrieval evaluation reviewers must have distinct reviewer ids");
  }
  return [first, second];
}

function normalizeSubmission(
  packet: RetrievalEvaluationBlindReviewPacket,
  submission: RetrievalEvaluationBlindReviewSubmission | RetrievalEvaluationBlindReviewAdjudication,
  kind: "reviewer" | "adjudication",
): NormalizedReviewSubmission {
  if (!submission || typeof submission !== "object") {
    throw new Error(`Retrieval evaluation ${kind} submission must be an object`);
  }
  if (submission.packetId !== packet.id) {
    throw new Error(`Retrieval evaluation ${kind} submission packet id does not match`);
  }
  const reviewerId =
    kind === "reviewer"
      ? normalizeReviewerId(
          "reviewerId" in submission ? submission.reviewerId : undefined,
          "Retrieval evaluation reviewer id",
        )
      : normalizeReviewerId(
          "adjudicatorId" in submission ? submission.adjudicatorId : undefined,
          "Retrieval evaluation adjudication id",
        );
  if (!Array.isArray(submission.tasks) || submission.tasks.length !== packet.tasks.length) {
    throw new Error(`Retrieval evaluation ${kind} submission must grade every task exactly once`);
  }
  const packetTaskById = new Map(packet.tasks.map((task) => [task.id, task]));
  const gradesByTask = new Map<string, ReadonlyMap<string, RetrievalEvaluationReviewGrade>>();
  for (const taskGrades of submission.tasks) {
    const task = packetTaskById.get(taskGrades.taskId);
    if (!task) {
      throw new Error(`Retrieval evaluation ${kind} submission has an unknown task`);
    }
    if (gradesByTask.has(task.id)) {
      throw new Error(
        `Retrieval evaluation ${kind} submission grades task ${task.id} more than once`,
      );
    }
    if (!Array.isArray(taskGrades.grades) || taskGrades.grades.length !== task.candidates.length) {
      throw new Error(
        `Retrieval evaluation ${kind} submission must grade every candidate for ${task.id}`,
      );
    }
    const grades = new Map<string, RetrievalEvaluationReviewGrade>();
    for (const grade of taskGrades.grades) {
      if (!task.candidates.some((candidate) => candidate.id === grade.candidateId)) {
        throw new Error(
          `Retrieval evaluation ${kind} submission has an unknown candidate for ${task.id}`,
        );
      }
      if (grades.has(grade.candidateId)) {
        throw new Error(
          `Retrieval evaluation ${kind} submission grades candidate ${grade.candidateId} more than once`,
        );
      }
      if (!isReviewGrade(grade.relevance)) {
        throw new Error(`Retrieval evaluation ${kind} relevance must be an integer from 0 to 3`);
      }
      grades.set(grade.candidateId, grade.relevance);
    }
    gradesByTask.set(task.id, grades);
  }
  if (gradesByTask.size !== packet.tasks.length) {
    throw new Error(`Retrieval evaluation ${kind} submission must grade every task exactly once`);
  }
  return { gradesByTask, reviewerId };
}

function packetTaskFor(
  packet: RetrievalEvaluationBlindReviewPacket,
  taskId: string,
): RetrievalEvaluationBlindReviewTask {
  const task = packet.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Retrieval evaluation blind review task ${taskId} is missing`);
  return task;
}

function isReviewGrade(value: unknown): value is RetrievalEvaluationReviewGrade {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function assertLanguage(
  value: unknown,
  label: string,
): asserts value is BilingualRetrievalLanguage {
  if (value !== "zh" && value !== "en") throw new Error(`${label} must be zh or en`);
}

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty`);
}

function normalizeReviewerId(value: unknown, label: string): string {
  assertNonEmpty(value, label);
  if (value.length > 256) throw new Error(`${label} must contain at most 256 characters`);
  return value.trim();
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
