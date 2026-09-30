export type Role = "parent" | "curator";
export type Priority = "high" | "medium" | "low";
export type StepStatus = "todo" | "in_progress" | "done";
export type CaseStatus = "draft" | "awaiting_curator" | "confirmed";
export type Agency = "медицина" | "образование" | "соцзащита";
export type Domain = "health" | "communication" | "education" | "daily_skills" | "accessibility" | "family_support";
export type Blocker = "missing_document" | "awaiting_agency" | "no_service_in_region" | "family_declined";
export type Language = "ru" | "kk";

export interface Question {
  n: number;
  topic: string;
  topic_label?: string;
  question: string;
  type: "single" | "multi" | "text";
  options: string[];
  answer: string | string[] | null;
  source?: "llm" | "template";
  autofilled?: boolean;
}

export interface Progress {
  asked: number;
  answered: number;
  min_questions: number;
  max_questions: number;
  covered_topics: string[];
  open_topics: string[];
}

export interface InterviewState extends Progress {
  items: Question[];
  done: boolean;
  pending: Question | null;
}

export interface NextResponse {
  done: boolean;
  question: string | null;
  topic: string | null;
  options: string[];
  item: Question | null;
  progress: Progress;
  interview: InterviewState;
}

export interface Doc {
  name: string;
  have: boolean;
}

export interface Notification {
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
  priority: Priority;
  owner: string;
  due_date: string;
  documents: Doc[];
  status: StepStatus;
  explanation: string;
  curator_note: string;
  blocker: Blocker | null;
  blocker_label: string | null;
  blocker_note: string;
  completed_at: string | null;
  overdue: boolean;
  days_overdue: number;
  escalated?: boolean;
  notification?: Notification;
  case_alias?: string;
  reason?: string;
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
  city: string;
  language: Language;
  scenario: string | null;
  scenario_summary: string | null;
  created_at: string;
  status: CaseStatus;
  confirmed_at: string | null;
  interview_done: boolean;
  interview_answered: number;
  steps_total: number;
  steps_done: number;
  overdue: number;
  escalated?: number;
  blockers: number;
}

export interface CaseView extends CaseSummary {
  interview: InterviewState;
  plan_visible: boolean;
  plan_meta: PlanMeta | null;
  steps: Step[];
}

export interface Service {
  id: string;
  title: string;
  agency: Agency;
  domain: Domain;
  description: string;
  min_age_months: number | null;
  max_age_months: number | null;
  available_cities: string[] | null;
}

export interface Settings {
  today: string;
  demo_today: string | null;
  real_today: string;
  escalation_after_days: number;
  llm_mode: "openai" | "mock";
  model: string | null;
  demo_mode: boolean;
  topics: { id: string; label: string }[];
  domains: Record<Domain, string>;
  blockers: Record<Blocker, string>;
}

export interface OverdueResponse {
  today: string;
  escalation_after_days: number;
  overdue_count: number;
  escalated_count: number;
  items: Step[];
  blocked: Step[];
}

export interface HandoffStep {
  step_id: number;
  title: string;
  agency: Agency;
  domain: Domain;
  owner: string;
  due_date: string;
  status: StepStatus;
  days_overdue: number;
  completed_at: string | null;
}

export interface Handoff {
  case: { id: number; alias: string; age_months: number; city: string; language: Language; confirmed_at: string | null };
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
