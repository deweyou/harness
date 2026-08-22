export type RunStatus = 'running' | 'blocked' | 'completed';
export type NodeStatus = 'pending' | 'ready' | 'running' | 'blocked' | 'succeeded' | 'failed' | 'cancelled' | 'skipped' | 'interrupted';
export type StageId = 'align' | 'execute' | 'verify' | 'deliver';

export interface WorkflowNode {
  [key: string]: unknown;
  id: string;
  label: string;
  stage: StageId;
  status: NodeStatus;
  attempt: number | null;
  durationMs: number | null;
  evidenceCount: number;
  needs: string[];
  executionIds: string[];
}

export interface DashboardRun {
  id: string;
  title: string;
  workspace: string;
  workspacePath: string;
  workspaceId: string;
  workflowId: string;
  status: RunStatus;
  needsAttention: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  currentStage?: StageId;
  currentNode?: string;
  completedNodes: number;
  totalNodes: number;
  durationMs: number;
  nodes: WorkflowNode[];
}

export interface HarnessEvent {
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
}

export const stageLabels: Record<StageId, string> = {
  align: 'Align',
  execute: 'Execute',
  verify: 'Verify',
  deliver: 'Deliver',
};

export class DashboardApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new DashboardApiError(response.status, body.error ?? `Request failed (${response.status})`);
  return body as T;
}

export async function fetchRuns(): Promise<DashboardRun[]> {
  return (await getJson<{ runs: DashboardRun[] }>('/api/runs')).runs;
}

export async function fetchRun(runId: string): Promise<DashboardRun> {
  return (await getJson<{ run: DashboardRun }>(`/api/runs/${encodeURIComponent(runId)}`)).run;
}

export async function fetchRunEvents(runId: string): Promise<HarnessEvent[]> {
  return (await getJson<{ events: HarnessEvent[] }>(`/api/runs/${encodeURIComponent(runId)}/events`)).events;
}
