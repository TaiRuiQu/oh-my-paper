import { z } from "zod";
import type { ParticipationStatus } from "./platform";

export const rosterHistoryQuerySchema = z.object({
  assessmentId: z.string().min(1).max(128),
  beforeRevision: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type RosterHistoryEntry = {
  studentId: string;
  name: string;
  studentNumber: string;
  classroomId: string;
  classroomName: string;
  paperId: string;
  subject: string;
  beforeStatus: ParticipationStatus | null;
  status: ParticipationStatus;
  reason: string;
  kind: "ADDED" | "STATUS_CHANGED";
};
export type RosterHistoryEvent = {
  id: string;
  revision: number;
  createdAt: string;
  actorName: string;
  reason: string;
  confirmedReconstruction: boolean;
  reconstructedCandidate: boolean;
  entries: RosterHistoryEntry[];
};
export type RosterHistory = {
  assessmentId: string;
  currentRevision: number;
  scopeRestricted: boolean;
  events: RosterHistoryEvent[];
  nextBeforeRevision: number | null;
};
