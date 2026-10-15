import type { TeachingAssignment } from "./permissions";

export const SUBJECTS = [
  "语文",
  "数学",
  "英语",
  "物理",
  "化学",
  "生物",
  "政治",
  "历史",
  "地理",
] as const;
export const RECORD_NAME_MAX_LENGTH = 200;
export type Role = "ADMIN" | "TEACHER" | "STUDENT";
export type Actor = { id: string; role?: string; name?: string; email?: string };
export type PlatformActor = Actor;
export type QuestionType = "SINGLE" | "MULTIPLE" | "BLANK" | "SUBJECTIVE" | "MIXED";
export type QuestionPart = {
  id: string;
  type: Exclude<QuestionType, "MIXED">;
  stem: string;
  options: { label: string; text: string }[];
  answers: string[];
  explanation: string;
  rubric: string;
  knowledgeTags: string[];
  score: number;
};
export type QuestionContent = {
  stem: string;
  options: { label: string; text: string }[];
  answers: string[];
  explanation: string;
  rubric: string;
  parts: QuestionPart[];
  images: string[];
};
export type BankQuestion = {
  id: string;
  ownerId: string;
  type: QuestionType;
  subject: string;
  /** Fixed curriculum level, e.g. 高中一年级; independent of student cohorts. */
  grade: string;
  difficulty: number;
  knowledgeTags: string[];
  content: QuestionContent;
  createdAt: string;
  updatedAt: string;
};
export type PaperItem = {
  id: string;
  questionId: string;
  position: number;
  score: number;
  section: string;
  snapshot: BankQuestion;
};
export type DocumentTextBlock = {
  id: string;
  text: string;
  beforeQuestionId?: string;
  pageBreakBefore?: boolean;
};
export const DOCUMENT_FONTS = [
  "NSimSun",
  "SimSun",
  "SimHei",
  "Microsoft YaHei",
  "Noto Serif SC",
  "Arial",
  "Times New Roman",
] as const;
/** A single installed font family; teachers may select fonts on their own computer. */
export type DocumentFont = string;
export type DocumentLayout = {
  orientation?: "portrait" | "landscape";
  fontFamily?: DocumentFont;
  textBlocks?: DocumentTextBlock[];
  paperSize: "A4" | "A3";
  columns: number;
  marginMm?: number;
  fontSizePt?: number;
  lineHeight?: number;
  showScores?: boolean;
  questionLayouts?: Record<
    string,
    { pageBreakBefore?: boolean; answerSpaceMm?: number; spaceAfterMm?: number }
  >;
};
export type Paper = {
  id: string;
  ownerId: string;
  name: string;
  kind: "EXAM" | "HOMEWORK";
  subject: string;
  /** Fixed curriculum level, e.g. 高中一年级; independent of student cohorts. */
  grade: string;
  instructions: string;
  layout: DocumentLayout;
  items: PaperItem[];
  createdAt: string;
  updatedAt: string;
};
export type Student = {
  id: string;
  classroomId: string;
  userId: string | null;
  studentNumber: string;
  name: string;
};
export const SCHOOL_STAGES = ["小学", "初中", "高中"] as const;
export type SchoolStage = (typeof SCHOOL_STAGES)[number];

export type Classroom = {
  id: string;
  ownerId: string;
  name: string;
  stage: string;
  /** Student cohort, e.g. 2027届 or 2024级; independent of a question’s grade. */
  cohort: string;
  students: Student[];
};
export type GradeBand = { upperPercent: number; min: number; max: number };
export type GradeConversion = { enabled: boolean; bands: GradeBand[] };
export type QuestionReviewRule = {
  doubleReview: boolean;
  arbitrationEnabled: boolean;
  maxDifference: number;
};
export type AssessmentPaper = {
  questionRules?: Record<string, QuestionReviewRule>;
  paperId: string;
  subject: string;
  gradingMode: "SINGLE" | "DOUBLE";
  arbitrationThreshold: number;
  conversion: GradeConversion;
};
export type Assessment = {
  id: string;
  ownerId: string;
  name: string;
  kind: "EXAM" | "HOMEWORK";
  reviewScope: "CLASSROOM" | "GRADE";
  classroomIds: string[];
  papers: AssessmentPaper[];
  published: boolean;
  createdAt: string;
};
export type Box = { page: number; x: number; y: number; width: number; height: number };
export type CardRegion = Box & {
  itemId: string;
  kind: "CHOICE" | "BLANK" | "WRITING";
  options?: string[];
  multiple?: boolean;
  image?: string;
  label?: string;
  writingStyle?: "plain" | "lines" | "grid";
};
export type CardLayout = {
  showAbsent?: boolean;
  showFooter?: boolean;
  showSubject?: boolean;
  locked?: boolean;
  annotations?: (Box & { id: string; text: string })[];
  omrVersion?: 2;
  paperSize?: "A4" | "A3";
  orientation?: "portrait" | "landscape";
  columns?: number;
  fontFamily?: DocumentFont;
  width: number;
  height: number;
  pageCount: number;
  markers: { x: number; y: number }[];
  studentNumber: {
    mode?: "OMR" | "BARCODE";
    digits: number;
    x: number;
    y: number;
    cellWidth: number;
    cellHeight: number;
  };
  regions: CardRegion[];
};
export type CardTemplate = {
  id: string;
  ownerId: string | null;
  paperId: string | null;
  name: string;
  subject: string;
  preset: boolean;
  layout: CardLayout;
};
export type SubmissionAnswer = {
  itemId: string;
  text: string;
  images: string[];
  box?: Box;
  sourcePage?: string;
};
export type ScanSubmission = {
  id: string;
  ownerId: string;
  assessmentId: string;
  paperId: string;
  studentId: string;
  templateId: string | null;
  kind: "CARD" | "WORKBOOK";
  status: "PENDING" | "REVIEW" | "GRADED";
  sourceFiles: string[];
  answers: SubmissionAnswer[];
  alignment: Record<string, unknown> | null;
  createdAt: string;
};
export type PartScore = { partId: string; score: number; feedback: string };
export type Review = {
  id: string;
  submissionId: string;
  itemId: string;
  reviewerId: string;
  round: "FIRST" | "SECOND" | "ARBITRATION";
  partScores?: PartScore[];
  source?: "HUMAN" | "AI";
  aiJobId?: string | null;
  score: number;
  feedback: string;
  createdAt: string;
};
export type FinalGrade = {
  calculation?: string;
  itemId: string;
  score: number | null;
  maxScore: number;
  status: "PENDING" | "SECOND" | "ARBITRATION" | "FINAL";
  partScores?: PartScore[];
  feedback: string;
};
export type SubjectResult = {
  paperId: string;
  subject: string;
  rawScore: number | null;
  score: number | null;
  maxScore: number;
  rank: number | null;
  grades: FinalGrade[];
};
export type StudentResult = {
  totalRestricted?: boolean;
  assessmentId: string;
  studentId: string;
  studentName: string;
  studentNumber: string;
  classroomId: string;
  classroomName: string;
  total: number | null;
  rank: number | null;
  classRank: number | null;
  subjects: SubjectResult[];
};
export type KnowledgeStat = {
  tag: string;
  earned: number;
  maximum: number;
  accuracy: number;
  attempts: number;
};
export type WrongQuestion = {
  assessmentId: string;
  paperId: string;
  itemId: string;
  question: BankQuestion;
  score: number;
  maximum: number;
  answer: SubmissionAnswer;
  partScores?: PartScore[];
  wrongPartIds?: string[];
  feedback: string;
};
export type LearningReport = {
  studentId: string;
  subjects: { subject: string; earned: number; maximum: number; accuracy: number }[];
  knowledge: KnowledgeStat[];
  wrongQuestions: WrongQuestion[];
  recommendations: BankQuestion[];
};
export type Analytics = {
  results: StudentResult[];
  knowledge: KnowledgeStat[];
  students: LearningReport[];
  classrooms: {
    id: string;
    name: string;
    average: number | null;
    participantCount: number;
    knowledge: KnowledgeStat[];
  }[];
};
export type PlatformState = {
  reviewing?: boolean;
  actor: { id: string; name: string; role: Role; teachingAssignments?: TeachingAssignment[] };
  questions: BankQuestion[];
  questionCount?: number;
  papers: Paper[];
  classrooms: Classroom[];
  assessments: Assessment[];
  templates: CardTemplate[];
  submissions: ScanSubmission[];
  reviews: Review[];
  reviewHistory?: Review[];
  analytics: Analytics;
  users: {
    id: string;
    name: string;
    email: string;
    username?: string | null;
    role: Role;
    teachingAssignments?: TeachingAssignment[];
  }[];
};
export type PlatformCommand =
  | {
      type: "question.save";
      question: Partial<BankQuestion> &
        Pick<
          BankQuestion,
          "type" | "subject" | "grade" | "difficulty" | "knowledgeTags" | "content"
        >;
    }
  | { type: "question.delete"; id: string }
  | {
      type: "paper.save";
      paper: Omit<Partial<Paper>, "items"> &
        Pick<Paper, "name" | "kind" | "subject" | "grade" | "instructions" | "layout"> & {
          items: {
            questionId: string;
            score: number;
            section: string;
            content?: QuestionContent;
            question?: Pick<
              BankQuestion,
              "type" | "subject" | "grade" | "difficulty" | "knowledgeTags" | "content"
            >;
          }[];
        };
    }
  | { type: "paper.delete"; id: string }
  | { type: "paper.rename"; id: string; name: string }
  | {
      type: "classroom.save";
      classroom: { id?: string; name: string; stage: string; cohort: string };
    }
  | {
      type: "student.save";
      student: {
        id?: string;
        classroomId: string;
        studentNumber?: string;
        name: string;
        userId?: string | null;
      };
    }
  | { type: "student.delete"; id: string }
  | {
      type: "assessment.save";
      assessment: {
        id?: string;
        name: string;
        kind: "EXAM" | "HOMEWORK";
        reviewScope?: Assessment["reviewScope"];
        classroomIds: string[];
        papers: AssessmentPaper[];
      };
    }
  | { type: "assessment.publish"; id: string; published: boolean }
  | { type: "assessment.rename"; id: string; name: string }
  | {
      type: "template.save";
      paperDraft?: {
        itemIds: string[];
        items: {
          questionId: string;
          score: number;
          section: string;
          question: Pick<
            BankQuestion,
            "type" | "subject" | "grade" | "difficulty" | "knowledgeTags" | "content"
          >;
        }[];
      };
      template: { id?: string; paperId: string; name: string; subject: string; layout: CardLayout };
    }
  | { type: "template.delete"; id: string }
  | {
      type: "submission.save";
      submission: {
        id?: string;
        assessmentId: string;
        paperId: string;
        studentId: string;
        templateId?: string | null;
        kind: "CARD" | "WORKBOOK";
        sourceFiles: string[];
        answers: SubmissionAnswer[];
        alignment?: Record<string, unknown> | null;
      };
    }
  | {
      type: "review.save";
      review: {
        submissionId: string;
        itemId: string;
        round: Review["round"];
        partScores?: PartScore[];
        score: number;
        feedback: string;
      };
    };

export type QuestionStatistics = {
  total: number;
  subjects: Record<string, number>;
  types: Record<string, number>;
  missingAnswers: number;
  missingExplanations: number;
  tags: { tag: string; count: number; subjects: string[]; difficulty: number }[];
};
