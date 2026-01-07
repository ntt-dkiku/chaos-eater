// ===== Message Types =====
export type MessageType = 'text' | 'code' | 'subheader' | 'status' | 'iframe' | 'tag';
export type MessageRole = 'user' | 'assistant';

export interface BaseMessage {
  type?: MessageType;
  role: MessageRole;
  content: string;
}

export interface CodeMessage extends BaseMessage {
  type: 'code';
  language?: string;
  filename?: string;
}

export interface TagMessage extends BaseMessage {
  type: 'tag';
  color?: string;
  background?: string;
}

export interface IframeMessage extends BaseMessage {
  type: 'iframe';
  title?: string;
}

export interface SubheaderMessage extends BaseMessage {
  type: 'subheader';
}

export interface StatusMessage extends BaseMessage {
  type: 'status';
}

export type Message = BaseMessage | CodeMessage | TagMessage | IframeMessage | SubheaderMessage | StatusMessage;

// ===== Form Data Types =====
export interface FormData {
  model: string;
  apiKey: string;
  apiKeyVisible: boolean;
  cluster: string;
  projectName: string;
  instructions: string;
  cleanBefore: boolean;
  cleanAfter: boolean;
  newDeployment: boolean;
  temperature: number;
  seed: number;
  maxSteadyStates: number;
  maxRetries: number;
}

export const DEFAULT_FORM_DATA: FormData = {
  model: 'openai/gpt-4.1',
  apiKey: '',
  apiKeyVisible: false,
  cluster: '',
  projectName: 'chaos-project',
  instructions: '',
  cleanBefore: true,
  cleanAfter: true,
  newDeployment: true,
  temperature: 0.0,
  seed: 42,
  maxSteadyStates: 2,
  maxRetries: 3,
};

// ===== Cluster Types =====
export interface ClusterState {
  all: string[];
  used: string[];
  available: string[];
  mine: string | null;
}

// ===== Run State =====
export type RunState = 'idle' | 'running' | 'paused' | 'completed';

// ===== Ollama Pull State =====
export interface OllamaPullState {
  inProgress: boolean;
  pct: number | null;
  status: string;
  model: string;
  abort: AbortController | null;
}

// ===== Notification =====
export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface Notification {
  type: NotificationType;
  message: string;
}

// ===== File Upload =====
export interface UploadedFile {
  name: string;
  content: string;
  size: number;
  project_path?: string;
}

export interface UploadedFileMeta {
  name: string;
  size: number;
}

// ===== Sidebar State =====
export interface SidebarCollapsedState {
  general: boolean;
  usage: boolean;
  cycles: boolean;
}

// ===== Snapshot/Session =====
export interface Session {
  id: string;
  createdAt: number;
  lastOpenedAt: number;
  name?: string;
}

export interface Snapshot {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  jobId?: string;
  jobWorkDir?: string;
  messages: Message[];
  panelVisible: boolean;
  backendProjectPath: string | null;
  uploadedFilesMeta: UploadedFileMeta[];
  formData: Omit<FormData, 'apiKey'> & { apiKey: '' };
}

// ===== API Types =====
export interface CleanClusterParams {
  kube_context: string;
  namespace: string;
  project_name: string;
}

export interface CleanClusterResponse {
  cleaned: boolean;
  error?: string;
}

export interface JobCreatePayload {
  project_path: string | null;
  ce_instructions: string;
  kube_context: string;
  project_name: string;
  work_dir: string | null;
  clean_cluster_before_run: boolean;
  clean_cluster_after_run: boolean;
  is_new_deployment: boolean;
  model_name: string;
  temperature: number;
  seed: number;
  max_num_steadystates: number;
  max_retries: number;
  namespace: string;
}

export interface JobCreateResponse {
  job_id: string;
  work_dir?: string;
}

export interface UploadResponse {
  project_path: string;
}

// ===== Stats Types =====
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface AgentStats {
  agent_name: string;
  token_usage: TokenUsage;
}

export interface TimeStats {
  elapsed_sec: number | null;
  first_ts: number | null;
  last_ts: number | null;
}

export interface StatsSnapshot {
  total: TokenUsage;
  time: TimeStats;
  by_agent: AgentStats[];
}

// ===== WebSocket Event Types =====
export interface WSPartialEvent {
  type: 'partial';
  partial: string;
  role?: MessageRole;
  mode?: 'delta' | 'frame';
  format?: 'plain' | 'code';
  language?: string;
  filename?: string;
  final?: boolean;
}

export interface WSWriteEvent {
  type: 'write';
  text: string;
  role?: MessageRole;
}

export interface WSCodeEvent {
  type: 'code';
  code: string;
  language?: string;
  filename?: string;
  role?: MessageRole;
}

export interface WSSubheaderEvent {
  type: 'subheader';
  text: string;
  role?: MessageRole;
}

export interface WSStatusEvent {
  type: 'status';
  status: string;
}

export interface WSIframeEvent {
  type: 'iframe';
  url: string;
  title?: string;
}

export interface WSTagEvent {
  type: 'tag';
  text: string;
  color?: string;
  background?: string;
}

export interface WSDoneEvent {
  type: 'done';
  status?: 'completed' | 'paused' | 'error';
}

export interface WSErrorEvent {
  type: 'error';
  detail?: string;
}

export interface WSStatsEvent {
  type: 'stats';
  snapshot: StatsSnapshot;
}

export interface WSWarningEvent {
  type: 'warning';
  detail?: string;
}

export type WSEvent =
  | WSPartialEvent
  | WSWriteEvent
  | WSCodeEvent
  | WSSubheaderEvent
  | WSStatusEvent
  | WSIframeEvent
  | WSTagEvent
  | WSDoneEvent
  | WSErrorEvent
  | WSStatsEvent
  | WSWarningEvent;

// ===== Component Props Types =====
export interface NumberFieldProps {
  label: string;
  value: number | '';
  onChange: (value: number | '') => void;
  min?: number;
  max?: number;
  step?: number;
}

export interface CollapseProps {
  open: boolean;
  children: React.ReactNode;
}

export interface MessagesPanelProps {
  messages: Message[];
  showResume?: boolean;
  showNextRun?: boolean;
  onResume?: () => void;
  onDownload?: () => void;
}

export interface StatsPanelProps {
  apiBase: string;
  jobId: string | null;
  snapshotKey?: string;
  collapsed?: boolean;
}

export interface CleanClusterButtonProps {
  API_BASE: string;
  kubeContext: string;
  namespace?: string;
  projectName?: string;
  onNotify: (type: NotificationType, message: string) => void;
}

export interface OllamaPullWidgetProps {
  ollamaPull: OllamaPullState;
  onRetry: () => void;
}

export interface LandingLogoProps {
  size?: number;
}

export interface LandingMessageProps {
  text: string;
  speed?: number;
  onDone?: () => void;
}
