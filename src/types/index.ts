export type UserRole = 'admin' | 'user'

export interface Profile {
  user_id: string
  role: UserRole
  full_name: string | null
  created_at: string
}

export type ProjectType = 'greenfield' | 'brownfield'
export type ProjectMode = 'epics_and_stories' | 'stories_only'
export type ProjectStatus = 'setup' | 'sources' | 'charter' | 'prd' | 'epics' | 'stories' | 'approved'

export interface Project {
  id: string
  user_id: string
  name: string
  client_name: string | null
  industry: string | null
  type: ProjectType
  mode: ProjectMode
  status: ProjectStatus
  created_at: string
  updated_at: string
}

export type SourceType =
  | 'text'
  | 'pdf'
  | 'json_schema'
  | 'website'
  | 'questionnaire'
  | 'job_description_initial'
  | 'job_description_detailed'
  | 'call_transcript'
  | 'domain_knowledge'

export type SourceStatus = 'processing' | 'ready' | 'error'

export interface DataSource {
  id: string
  project_id: string
  user_id: string
  type: SourceType
  title: string
  content: string | null
  file_path: string | null
  metadata: Record<string, unknown>
  status: SourceStatus
  enabled: boolean
  has_embedding: boolean
  created_at: string
}

export type DocumentStatus = 'draft' | 'approved'

export interface ProjectCharter {
  id: string
  project_id: string
  sponsor: string | null
  budget: string | null
  start_date: string | null
  approximate_duration: string | null
  high_level_timeline: string | null
  goals: string | null
  business_case: string | null
  major_risks: string | null
  difficulties: string | null
  success_criteria: string | null
  qc_goal: string | null
  participants: Participant[]
  stakeholders: Stakeholder[]
  communication: string | null
  website: string | null
  content: string | null
  version: number
  status: DocumentStatus
  created_at: string
  updated_at: string
}

export interface Participant {
  title: string
  name: string
  email: string | null
  phone: string | null
  role: string
}

export interface Stakeholder {
  name: string
  role: string
  interest: string | null
  influence: 'high' | 'medium' | 'low'
}

export interface PRD {
  id: string
  project_id: string
  business_case: string | null
  success_metrics: string | null
  pain_points: string | null
  goals: string | null
  potential_solutions: string | null
  business_context: string | null
  kpis: string | null
  definition_of_success: string | null
  current_state: CurrentState | null
  users_and_stakeholders: UsersAndStakeholders | null
  desired_future_state: DesiredFutureState | null
  technical_constraints: string | null
  content: string | null
  version: number
  status: DocumentStatus
  created_at: string
  updated_at: string
}

export interface CurrentState {
  manual_processes: string
  software_used: string
  top_pain_points: string[]
}

export interface UsersAndStakeholders {
  primary_users: string
  decision_maker: string
}

export interface DesiredFutureState {
  ideal_process: string
  key_data_needs: string
}

export type Priority = 'must' | 'should' | 'could' | 'wont'
export type ItemStatus = 'draft' | 'in_review' | 'approved'

export interface Epic {
  id: string
  project_id: string
  prd_id: string | null
  code: string
  title: string
  description: string | null
  acceptance_criteria: string | null
  priority: Priority
  order: number
  version: number
  status: ItemStatus
  created_at: string
  updated_at: string
}

export interface UserStory {
  id: string
  project_id: string
  epic_id: string | null
  code: string
  title: string
  as_a: string
  i_want: string
  so_that: string
  acceptance_criteria: string[]
  priority: Priority
  effort_estimate: 'S' | 'M' | 'L' | 'XL' | null
  order: number
  version: number
  status: ItemStatus
  created_at: string
  updated_at: string
}

export type PromptStage = 'charter' | 'prd' | 'epics' | 'stories' | 'domain_research'

export interface SystemPrompt {
  id: string
  stage: PromptStage
  content: string
  updated_by: string | null
  updated_at: string
}

export interface ProjectPrompt {
  id: string
  project_id: string
  stage: PromptStage
  content: string
  updated_at: string
}

export interface UserSettings {
  user_id: string
  anthropic_api_key: string | null
  voyage_api_key: string | null
  model: string
}

export type MemberRole = 'viewer' | 'editor'

export interface ProjectMember {
  id: string
  project_id: string
  user_id: string
  role: MemberRole
  invited_by: string | null
  created_at: string
  // joined from auth/profiles:
  email?: string
  name?: string | null
}

export interface ProjectInvitation {
  id: string
  project_id: string
  email: string
  role: MemberRole
  invited_by: string
  status: 'pending' | 'accepted'
  created_at: string
}
