export type Role = "parent" | "curator";
export type Priority = "high" | "medium" | "low";
export type StepStatus = "locked" | "todo" | "in_progress" | "done";
export type CaseStatus = "draft" | "awaiting_curator" | "confirmed";
export type Agency = "медицина" | "образование" | "соцзащита";
export type Domain = "health" | "communication" | "education" | "daily_skills" | "accessibility" | "family_support";
export type Blocker = "missing_document" | "awaiting_agency" | "no_service_in_region" | "family_declined" | "decision_disputed";
export type Language = "ru" | "kk";
export type Stage = "early" | "correction" | "socialization";
export type Indicator = "ok" | "due_soon" | "overdue" | "escalated" | "locked" | "done";
export type QuestionType = "choice" | "multi" | "text" | "confirm";

export interface Intake {
  has_conclusion: boolean;
  conclusion_date: string | null;
  dispensary: boolean;
  pmpk_status: "none" | "valid" | "expired";
  pmpk_date: string | null;
  mse_status: "none" | "valid" | "expired";
  mse_valid_until: string | null;
  mchat_status: "none" | "done";
  mchat_date: string | null;
  pediatrician_visited: boolean;
  documents: string[];
}

export interface InterviewItem {
  qid: string;
  slot: string;
  text: string;
  type: QuestionType;
  options: string[];
  answer: string | string[] | null;
  source: "llm" | "template";
  n: number;
  autofilled?: boolean;
  corrected?: boolean;
}

export interface Progress {
  asked: number;
  answered: number;
  expected_total: number;
  max_questions: number;
  min_questions: number;
  planned: string[];
}

export interface SummaryLine {
  slot: string;
  question_id: string;
  label: string;
  value: string;
  raw: string | string[];
  options: string[];
  type: QuestionType;
}

export interface Summary {
  lines: SummaryLine[];
  red_flags: string[];
  handling_mode: "system" | "curator";
  confirmed: boolean;
}

export interface NextResponse {
  done: boolean;
  question_id: string | null;
  slot: string | null;
  text: string | null;
  type: QuestionType | null;
  options: string[];
  item: InterviewItem | null;
  progress: Progress;
  interview: { items: InterviewItem[]; done: boolean };
  summary: Summary | null;
}

export interface StepDoc {
  doc_type: string;
  name: string;
  note: string;
  have: boolean;
  marked: boolean;
  expired: boolean;
  optional: boolean;
  issued_at: string | null;
  valid_until: string | null;
}

export interface FolderDoc extends Omit<StepDoc, "optional"> {
  used_in?: string[];
}

export interface Letter {
  to: string;
  subject: string;
  body: string;
  sent: boolean;
}

export interface Step {
  id: number;
  case_id: number;
  position: number;
  service_id: string;
  title: string;
  agency: Agency;
  domain: Domain;
  channel: string;
  channel_label: string;
  responsible: string;
  how_to: string;
  typical_duration: string;
  egov_url: string | null;
  priority: Priority | null;
  base_priority: Priority;
  owner: string;
  due_date: string;
  due_basis: "default" | "document_expiry" | "age_window" | "rule";
  depends_on: string[];
  unlock_date: string | null;
  unlock_hint: string;
  status: StepStatus;
  explanation: string;
  curator_note: string;
  blocker: Blocker | null;
  blocker_label: string | null;
  blocker_note: string;
  completed_at: string | null;
  documents: StepDoc[];
  docs_missing: number;
  days_to_due: number | null;
  days_overdue: number;
  overdue: boolean;
  due_soon: boolean;
  escalated?: boolean;
  indicator: Indicator;
  notification?: Letter;
  case_alias?: string;
  reason?: string;
}

export interface AppNotification {
  id: number;
  case_id: number;
  step_id: number | null;
  type: "overdue" | "escalation" | "red_flag" | "unlocked" | "due_soon";
  audience: "curator" | "parent";
  message: string;
  created_at: string;
  read: number;
  case_alias?: string;
}

export interface PlanMeta {
  source: "llm" | "llm_retry" | "fallback" | "rules";
  model: string | null;
  attempts: number;
  warnings: string[];
  errors: string[];
  generated_at: string;
  base_date: string;
  steps: number;
}

export interface CaseSummary {
  id: number;
  child_alias: string;
  birth_date: string;
  age_months: number;
  age_text: string;
  stage: Stage;
  stage_label: string;
  city: string;
  language: Language;
  scenario: string | null;
  scenario_summary: string | null;
  created_at: string;
  status: CaseStatus;
  confirmed_at: string | null;
  alert: boolean;
  handling_mode: "system" | "curator";
  summary_confirmed: boolean;
  interview_done: boolean;
  interview_answered: number;
  steps_total: number;
  steps_done: number;
  steps_locked: number;
  overdue: number;
  escalated?: number;
  due_soon: number;
  blockers: number;
  unread?: number;
}

export interface CaseView extends CaseSummary {
  intake: Intake;
  interview: { items: InterviewItem[]; done: boolean; pending: InterviewItem | null; progress: Progress };
  red_flag_text: string | null;
  plan_visible: boolean;
  plan_meta: PlanMeta | null;
  steps: Step[];
  notifications: AppNotification[];
}

export interface Help {
  step_id: number;
  service_id: string;
  title: string;
  status: StepStatus;
  indicator: Indicator;
  due_date: string;
  days_to_due: number | null;
  days_overdue: number;
  what_to_do: string;
  description: string;
  channel: string;
  typical_duration: string;
  egov_url: string | null;
  checklist: StepDoc[];
  have: StepDoc[];
  optional_missing: StepDoc[];
  notes: string[];
  blocker: { code: Blocker; label: string; note: string } | null;
  dispute_hint: string | null;
  family_message: string;
  agency_letter?: Letter | null;
}

export interface Service {
  id: string;
  title: string;
  agency: Agency;
  domain: Domain;
  description: string;
  channel: string;
}

export interface DocType {
  id: string;
  name: string;
  note: string;
}

export interface Settings {
  today: string;
  demo_today: string | null;
  real_today: string;
  seed_today: string;
  escalation_after_days: number;
  due_soon_days: number;
  llm_mode: "openai" | "mock";
  model: string | null;
  demo_mode: boolean;
  stages: Record<Stage, string>;
  domains: Record<Domain, string>;
  blockers: Record<Blocker, string>;
  slot_labels: Record<string, string>;
}

export interface OverdueResponse {
  today: string;
  escalation_after_days: number;
  overdue_count: number;
  escalated_count: number;
  items: Step[];
  due_soon: Step[];
  blocked: Step[];
}

export interface HandoffStep {
  step_id: number;
  service_id: string;
  title: string;
  agency: Agency;
  domain: Domain;
  owner: string;
  due_date: string;
  status: StepStatus;
  days_overdue: number;
  completed_at: string | null;
  unlock_hint: string;
}

export interface Handoff {
  case: {
    id: number;
    alias: string;
    age_months: number;
    city: string;
    language: Language;
    confirmed_at: string | null;
    stage: Stage;
    stage_label: string;
    handling_mode: string;
    alert: boolean;
  };
  as_of: string;
  done: HandoffStep[];
  pending: HandoffStep[];
  overdue: HandoffStep[];
  documents: { have: string[]; missing: string[] };
  blockers: { step: string; step_id: number; blocker: Blocker; blocker_label: string; note: string }[];
  next_deadlines: HandoffStep[];
  coverage_by_domain: Record<Domain, { label: string; total: number; done: number }>;
  gaps: { domain: Domain; label: string }[];
  summary_text: string;
}

export interface GovSource {
  key: string;
  short: string;
  name: string;
  what: string;
}

export interface GovRow {
  doc: string;
  source: string;
  issued: string;
  validity: string;
  tone: "ok" | "warn" | "crit" | "muted";
  detail: string;
}

export interface GovSync {
  sources: GovSource[];
  not_requested: string;
  rows: GovRow[];
}
