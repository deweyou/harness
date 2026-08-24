import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, CheckCircle, Clock, Copy, FileText, Graph, ListBullets, MagnifyingGlass, Moon, SpinnerGap, Sun, Warning, X, XCircle } from '@phosphor-icons/react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { DashboardApiError, fetchRetrospective, fetchRun, fetchRunEvents, fetchRuns, type DashboardRun, type HarnessEvent, type NodeStatus, type PlannedNode, type RunStatus } from './data';
import { Button } from './components/ui/button';
import { cn } from './lib/utils';

const GraphView = lazy(() => import('./GraphView').then((module) => ({ default: module.GraphView })));
type Theme = 'light' | 'dark';
type ViewMode = 'list' | 'graph' | 'report';
type NodeDetailTab = 'overview' | 'input' | 'output' | 'evidence' | 'activity';
type RunScope = 'active' | 'attention' | 'archived';

function statusIcon(status: NodeStatus | RunStatus, size = 17) {
  if (status === 'succeeded' || status === 'completed' || status === 'skipped') return <CheckCircle size={size} weight="fill" />;
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return <XCircle size={size} weight="fill" />;
  if (status === 'running') return <SpinnerGap size={size} className="animate-spin" />;
  if (status === 'blocked') return <Clock size={size} weight="fill" />;
  return <span className="pending-dot" />;
}

function statusLabel(status: NodeStatus | RunStatus) {
  return status[0]!.toUpperCase() + status.slice(1);
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return '—';
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function eventLabel(type: string) {
  const text = type.replaceAll('.', ' ').replaceAll('_', ' ');
  return text[0]!.toUpperCase() + text.slice(1);
}

function InlineMarkdown({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/g).filter(Boolean).map((part, index) => part.startsWith('`') && part.endsWith('`')
    ? <code key={index}>{part.slice(1, -1)}</code>
    : <span key={index}>{part}</span>)}</>;
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  return <article className="markdown-preview">{markdown.split('\n').map((line, index) => {
    if (!line) return <div className="markdown-spacer" key={index} />;
    if (line.startsWith('# ')) return <h1 key={index}><InlineMarkdown text={line.slice(2)} /></h1>;
    if (line.startsWith('## ')) return <h2 key={index}><InlineMarkdown text={line.slice(3)} /></h2>;
    if (line.startsWith('### ')) return <h3 key={index}><InlineMarkdown text={line.slice(4)} /></h3>;
    if (line.startsWith('- ')) return <div className="markdown-list-item" key={index}><span>•</span><p><InlineMarkdown text={line.slice(2)} /></p></div>;
    return <p key={index}><InlineMarkdown text={line} /></p>;
  })}</article>;
}

function JsonPreview({ value, emptyLabel }: { value: Record<string, unknown> | undefined; emptyLabel: string }) {
  const [copied, setCopied] = useState(false);
  if (value === undefined) return <div className="panel-empty">{emptyLabel}</div>;
  const content = JSON.stringify(value, null, 2);
  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return <div className="json-preview"><Button variant="ghost" size="icon" onClick={() => void copy()} aria-label="Copy JSON">{copied ? <Check /> : <Copy />}</Button><pre>{content}</pre></div>;
}

function AppHeader({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  return <header className="app-header">
    <Link className="brand" to="/runs" aria-label="Harness runs"><img src="/harness.png" alt="" className="brand-mark" /><span><strong>Harness</strong><small>Runs</small></span></Link>
    <Button variant="ghost" size="icon" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun /> : <Moon />}</Button>
  </header>;
}

function LoadingState({ label }: { label: string }) {
  return <div className="empty-state"><SpinnerGap className="animate-spin" /><strong>{label}</strong></div>;
}

function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return <div className="empty-state"><Warning /><strong>Dashboard data unavailable</strong><span>{error.message}</span><Button variant="outline" onClick={onRetry}>Try again</Button></div>;
}

function RunsPage() {
  const [scope, setScope] = useState<RunScope>('active');
  const [query, setQuery] = useState('');
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: fetchRuns, refetchInterval: 2_000 });
  const runs = runsQuery.data ?? [];
  const activeRuns = runs.filter((run) => !run.archived);
  const archivedRuns = runs.filter((run) => run.archived);
  const attentionCount = activeRuns.filter((run) => run.needsAttention).length;
  const visibleRuns = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return runs
      .filter((run) => scope === 'archived' ? run.archived : !run.archived && (scope !== 'attention' || run.needsAttention))
      .filter((run) => !normalized || `${run.title} ${run.workspace}`.toLowerCase().includes(normalized));
  }, [query, runs, scope]);

  return <main className="runs-page page-container">
    <div className="page-heading"><div><p className="eyebrow">Global overview</p><h1>Runs</h1><p>Monitor work across every workspace from one place.</p></div></div>
    <section className="runs-section">
      <div className="runs-toolbar">
        <div className="scope-tabs" role="tablist" aria-label="Run status"><button className={scope === 'active' ? 'is-active' : ''} onClick={() => setScope('active')} role="tab" aria-selected={scope === 'active'}>Active <span>{activeRuns.length}</span></button><button className={scope === 'attention' ? 'is-active' : ''} onClick={() => setScope('attention')} role="tab" aria-selected={scope === 'attention'}>Needs attention <span>{attentionCount}</span></button><button className={scope === 'archived' ? 'is-active' : ''} onClick={() => setScope('archived')} role="tab" aria-selected={scope === 'archived'}>Archived <span>{archivedRuns.length}</span></button></div>
        <label className="search-box"><MagnifyingGlass /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search runs…" /></label>
      </div>
      <div className="run-list">
        {runsQuery.isPending && <LoadingState label="Loading runs…" />}
        {runsQuery.isError && <ErrorState error={runsQuery.error} onRetry={() => void runsQuery.refetch()} />}
        {runsQuery.isSuccess && visibleRuns.map((run) => { const progress = run.totalNodes ? Math.round((run.completedNodes / run.totalNodes) * 100) : 0; return <Link className="run-card" to={`/runs/${run.id}`} key={run.id}>
          <span className={`run-card__status status-icon status-icon--${run.status}`}>{statusIcon(run.status, 19)}</span>
          <div className="run-card__body"><div className="run-card__title"><strong>{run.title}</strong>{run.needsAttention && <span className="attention-pill"><Clock weight="fill" /> Attention</span>}</div><div className="run-card__meta"><span>{run.workspace}</span><i /><span>{run.commitmentRevision ? `Commitment r${run.commitmentRevision}` : 'No commitment'}</span><i /><span>{run.archived ? 'Duration' : 'Elapsed'} {formatDuration(run.durationMs)}</span></div><div className="progress-row"><span className="progress-track"><i style={{ width: `${progress}%` }} /></span><span>{run.totalNodes ? `${run.completedNodes}/${run.totalNodes} nodes` : `${run.acceptanceSatisfied}/${run.acceptanceTotal} claims`}</span></div></div>
          <div className="run-card__current"><small>{run.archived ? 'Result' : run.planRevision ? `Plan r${run.planRevision}` : 'Run'}</small><strong>{run.archived ? statusLabel(run.status) : run.currentNode ?? 'Awaiting plan'}</strong><span className={`status status--${run.status}`}>{statusIcon(run.status, 14)} {statusLabel(run.status)}</span></div><ArrowRight className="run-card__arrow" />
        </Link>; })}
        {runsQuery.isSuccess && visibleRuns.length === 0 && <div className="empty-state"><MagnifyingGlass /><strong>{query ? 'No matching runs' : `No ${scope === 'attention' ? 'runs needing attention' : `${scope} runs`}`}</strong><span>{query ? 'Try a different title or workspace.' : 'Runs will appear here when their state is indexed.'}</span></div>}
      </div>
    </section>
  </main>;
}

function NodeTable({ planNodes, selectedNodeId, onSelectNode }: { planNodes: PlannedNode[]; selectedNodeId: string; onSelectNode: (id: string) => void }) {
  return <div className="node-table"><div className="node-table__header"><span>Node</span><span>Status</span><span>Duration</span></div>{planNodes.map((node) => <button key={node.id} type="button" className={cn('node-row', selectedNodeId === node.id && 'is-selected')} onClick={() => onSelectNode(node.id)}><span className="node-row__name"><strong>{node.label}</strong><small>{node.needs.length ? `After ${node.needs.join(', ')}` : node.definitionId}</small></span><span className={`status status--${node.status}`}>{statusIcon(node.status)} {statusLabel(node.status)}</span><span>{formatDuration(node.durationMs)}</span></button>)}</div>;
}

function NodeDetailPanel({ planNodes, events, selectedNodeId, onClose }: { planNodes: PlannedNode[]; events: HarnessEvent[]; selectedNodeId: string; onClose: () => void }) {
  const selectedNode = planNodes.find((node) => node.id === selectedNodeId) ?? planNodes[0]!;
  const [selectedAttemptId, setSelectedAttemptId] = useState(selectedNode.attempts.at(-1)?.id ?? '');
  const [tab, setTab] = useState<NodeDetailTab>('overview');
  useEffect(() => {
    setSelectedAttemptId(selectedNode.attempts.at(-1)?.id ?? '');
    setTab('overview');
  }, [selectedNode.id, selectedNode.attempts.length]);
  const selectedAttempt = selectedNode.attempts.find((attempt) => attempt.id === selectedAttemptId) ?? selectedNode.attempts.at(-1);
  const evidenceIds = new Set(selectedAttempt?.evidenceIds ?? []);
  const evidence = events.flatMap((event) => {
    if (event.type !== 'evidence.recorded' || typeof event.payload.evidence !== 'object' || event.payload.evidence === null) return [];
    const item = event.payload.evidence as Record<string, unknown>;
    return evidenceIds.has(String(item.id ?? '')) ? [{ event, evidence: item }] : [];
  });
  const activity = events.filter((event) => event.payload.plannedNodeId === selectedNode.id || event.payload.executionId === selectedAttempt?.id);
  const tabs: NodeDetailTab[] = ['overview', 'input', 'output', 'evidence', 'activity'];
  return <aside className="detail-panel" aria-label="Node details"><div className="detail-panel__scroll">
    <header className="detail-header"><div><span className={`status status--${selectedNode.status}`}>{statusIcon(selectedNode.status)} {statusLabel(selectedNode.status)}</span><h2>{selectedNode.label}</h2><p>{selectedNode.needs.length ? `Depends on ${selectedNode.needs.join(', ')}` : 'No dependencies'} · {selectedNode.expectedOutputs.length ? `${selectedNode.expectedOutputs.length} expected outputs` : 'No declared outputs'}</p></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close node details"><X /></Button></header>
    {selectedNode.attempts.length > 0 && <label className="attempt-picker"><span>Execution attempt</span><select value={selectedAttempt?.id ?? ''} onChange={(event) => setSelectedAttemptId(event.target.value)}>{[...selectedNode.attempts].reverse().map((attempt) => <option value={attempt.id} key={attempt.id}>Attempt {attempt.attempt} · {statusLabel(attempt.status)}</option>)}</select></label>}
    <div className="detail-tabs" role="tablist" aria-label="Node execution data">{tabs.map((item) => <button className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)} role="tab" aria-selected={tab === item} key={item}>{item}</button>)}</div>
    {tab === 'overview' && <section className="detail-section"><h3>Execution overview</h3>{selectedAttempt ? <dl className="execution-summary"><div><dt>Status</dt><dd className={`status status--${selectedAttempt.status}`}>{statusLabel(selectedAttempt.status)}</dd></div><div><dt>Attempt</dt><dd>{selectedAttempt.attempt}</dd></div><div><dt>Duration</dt><dd>{formatDuration(selectedAttempt.durationMs)}</dd></div><div><dt>Evidence</dt><dd>{selectedAttempt.evidenceIds.length}</dd></div></dl> : <div className="panel-empty">This node has not started yet.</div>}{selectedNode.status === 'blocked' && <div className="warning-callout"><Warning size={20} weight="fill" /><div><strong>Node is blocked</strong><p>Review its activity and external context before continuing.</p></div></div>}</section>}
    {tab === 'input' && <section className="detail-section"><h3>Resolved input</h3><JsonPreview value={selectedAttempt?.input} emptyLabel="No structured input was recorded." /></section>}
    {tab === 'output' && <section className="detail-section"><h3>Structured output</h3><JsonPreview value={selectedAttempt?.output} emptyLabel="No structured output was recorded. Large results may be stored as Evidence." /></section>}
    {tab === 'evidence' && <section className="detail-section"><h3>Attempt evidence</h3><div className="evidence-list">{evidence.map(({ event, evidence: item }) => <article className="evidence-row" key={event.id}><FileText size={21} /><div><strong>{String(item.summary ?? 'Recorded evidence')}</strong><span className="mono">{String(item.locator ?? item.id ?? event.id)}</span><small>{new Date(String(item.createdAt ?? event.timestamp)).toLocaleString()}</small></div><CheckCircle className="success" weight="fill" /></article>)}</div>{evidence.length === 0 && <div className="panel-empty">No Evidence is linked to this attempt.</div>}</section>}
    {tab === 'activity' && <section className="detail-section"><h3>Attempt activity</h3>{activity.length ? <div className="timeline">{activity.map((item) => <div className={item.type === 'node.blocked' ? 'is-current' : ''} key={item.id}>{item.type === 'node.blocked' ? <Clock weight="fill" /> : <CheckCircle weight="fill" />} {eventLabel(item.type)}</div>)}</div> : <div className="panel-empty">No activity has been recorded for this attempt.</div>}</section>}
  </div></aside>;
}

function RunDetailPage() {
  const { runId = '' } = useParams();
  const runQuery = useQuery({ queryKey: ['run', runId], queryFn: () => fetchRun(runId), enabled: Boolean(runId), refetchInterval: 2_000 });
  const eventsQuery = useQuery({ queryKey: ['run-events', runId], queryFn: () => fetchRunEvents(runId), enabled: Boolean(runId), refetchInterval: 2_000 });
  const run = runQuery.data;
  const [view, setView] = useState<ViewMode>('list');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const retrospectiveQuery = useQuery({ queryKey: ['run-retrospective', runId], queryFn: () => fetchRetrospective(runId), enabled: Boolean(runId) && view === 'report' && Boolean(run?.archived) });
  useEffect(() => { if (!run) return; setSelectedNodeId(run.nodes.find((node) => node.status === 'blocked' || node.status === 'running' || node.status === 'ready')?.id ?? run.nodes[0]?.id ?? ''); setDetailOpen(false); }, [run?.id]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key.toLowerCase() === 'l' && !(event.target instanceof HTMLInputElement)) setView('list'); if (event.key.toLowerCase() === 'g' && !(event.target instanceof HTMLInputElement)) setView('graph'); if (event.key.toLowerCase() === 'r' && !(event.target instanceof HTMLInputElement) && run?.archived) { setView('report'); setDetailOpen(false); } if (event.key === 'Escape') setDetailOpen(false); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [run?.archived]);
  if (runQuery.isPending) return <main className="run-detail-layout"><LoadingState label="Loading run…" /></main>;
  if (runQuery.isError) {
    const missing = runQuery.error instanceof DashboardApiError && runQuery.error.status === 404;
    return <main className="run-detail-layout"><div className="empty-state"><Warning /><strong>{missing ? 'Run not found' : 'Run unavailable'}</strong><span>{missing ? 'It may have been removed from the global index.' : runQuery.error.message}</span>{missing ? <Button asChild><Link to="/runs">All runs</Link></Button> : <Button onClick={() => void runQuery.refetch()}>Try again</Button>}</div></main>;
  }
  if (!run) return null;
  const selectNode = (nodeId: string) => { setSelectedNodeId(nodeId); setDetailOpen(true); };
  const blockedNode = run.nodes.find((node) => node.status === 'blocked');
  return <main className={cn('run-detail-layout', detailOpen && view !== 'report' && 'has-detail')}><section className="workspace">
    <header className="workspace-header"><Link className="back-link" to="/runs"><ArrowLeft /> All runs</Link><div className="workspace-title"><h1>{run.title}</h1><p><span className={`run-state status--${run.status}`}><i />{statusLabel(run.status)}</span><span />{run.workspace}{run.commitmentRevision && <><span />Commitment r{run.commitmentRevision}</>}{run.planRevision && <><span />Plan r{run.planRevision}</>}<span />{formatDuration(run.durationMs)}</p></div></header>
    {run.needsAttention && <section className="attention-banner"><Clock size={19} weight="fill" /><div><strong>Run needs attention</strong><p>{blockedNode ? `${blockedNode.label} is blocked.` : `${run.unresolvedDecisionCount} unresolved decision${run.unresolvedDecisionCount === 1 ? '' : 's'} remain.`}</p></div>{run.nodes.length > 0 && <Button onClick={() => selectNode(blockedNode?.id ?? run.nodes[0]!.id)}>Review</Button>}</section>}
    <div className="view-toolbar"><div className={cn('segmented', run.archived && 'segmented--three')} role="tablist" aria-label="Run view"><button className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')} role="tab" aria-selected={view === 'list'}><ListBullets /> List</button><button className={view === 'graph' ? 'is-active' : ''} onClick={() => setView('graph')} role="tab" aria-selected={view === 'graph'}><Graph /> Graph</button>{run.archived && <button className={view === 'report' ? 'is-active' : ''} onClick={() => { setView('report'); setDetailOpen(false); }} role="tab" aria-selected={view === 'report'}><FileText /> Report</button>}</div></div>
    <div className="execution-view">{view === 'report' ? <div className="report-view">{retrospectiveQuery.isPending && <LoadingState label="Loading retrospective…" />}{retrospectiveQuery.isError && <ErrorState error={retrospectiveQuery.error} onRetry={() => void retrospectiveQuery.refetch()} />}{retrospectiveQuery.data && <MarkdownPreview markdown={retrospectiveQuery.data} />}</div> : run.nodes.length === 0 ? <div className="empty-state"><ListBullets /><strong>No planned nodes</strong><span>This Run is awaiting a Plan with executable nodes.</span></div> : view === 'list' ? <NodeTable planNodes={run.nodes} selectedNodeId={detailOpen ? selectedNodeId : ''} onSelectNode={selectNode} /> : <Suspense fallback={<div className="graph-loading"><SpinnerGap className="animate-spin" /> Loading graph…</div>}><GraphView planNodes={run.nodes} selectedNodeId={detailOpen ? selectedNodeId : ''} onSelectNode={selectNode} /></Suspense>}</div>
  </section>{detailOpen && view !== 'report' && selectedNodeId && <div className="detail-column"><NodeDetailPanel planNodes={run.nodes} events={eventsQuery.data ?? []} selectedNodeId={selectedNodeId} onClose={() => setDetailOpen(false)} /></div>}</main>;
}

export function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('harness-theme') as Theme | null) ?? 'dark');
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); localStorage.setItem('harness-theme', theme); }, [theme]);
  return <div className="app-shell"><AppHeader theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} /><Routes><Route path="/runs" element={<RunsPage />} /><Route path="/runs/:runId" element={<RunDetailPage />} /><Route path="*" element={<Navigate to="/runs" replace />} /></Routes></div>;
}
