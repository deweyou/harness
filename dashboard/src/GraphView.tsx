import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node as FlowNode,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CheckCircle, Circle, Clock, SpinnerGap, XCircle } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { stageLabels, type NodeStatus, type WorkflowNode } from './data';
import { cn } from './lib/utils';

function statusIcon(status: NodeStatus) {
  if (status === 'succeeded' || status === 'skipped') return <CheckCircle weight="fill" />;
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return <XCircle weight="fill" />;
  if (status === 'running') return <SpinnerGap className="animate-spin" />;
  if (status === 'blocked') return <Clock weight="fill" />;
  return <Circle weight="regular" />;
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return '—';
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function WorkflowCard({ data, selected }: NodeProps<FlowNode<WorkflowNode>>) {
  return (
    <div className={cn('graph-node', `is-${data.status}`, selected && 'is-selected')}>
      <Handle type="target" position={Position.Left} className="graph-handle" />
      <div className="graph-node__title">{data.label}</div>
      <div className="graph-node__meta">
        <span className={`status status--${data.status}`}>
          {statusIcon(data.status)} {data.status[0]!.toUpperCase() + data.status.slice(1)}
        </span>
        <span>{formatDuration(data.durationMs)}</span>
      </div>
      {data.attempt && data.attempt > 1 ? <span className="graph-node__attempt">{data.attempt}/3</span> : null}
      <Handle type="source" position={Position.Right} className="graph-handle" />
    </div>
  );
}

const nodeTypes = { workflow: WorkflowCard };
const stageX = { align: 24, execute: 202, verify: 380, deliver: 558 };

interface GraphViewProps {
  workflowNodes: WorkflowNode[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}

export function GraphView({ workflowNodes, selectedNodeId, onSelectNode }: GraphViewProps) {
  const graphNodes = useMemo(() => {
    const stagePositions: Partial<Record<keyof typeof stageX, number>> = {};
    return workflowNodes.map((node): FlowNode<WorkflowNode> => {
      const stageIndex = stagePositions[node.stage] ?? 0;
      stagePositions[node.stage] = stageIndex + 1;
      return {
        id: node.id,
        type: 'workflow',
        position: { x: stageX[node.stage], y: 66 + stageIndex * 88 },
        data: node,
      };
    });
  }, [workflowNodes]);
  const visibleNodeIds = useMemo(() => new Set(workflowNodes.map((node) => node.id)), [workflowNodes]);
  const visibleEdges = useMemo(() => {
    return workflowNodes.flatMap((node) => node.needs.filter((dependency) => visibleNodeIds.has(dependency)).map((dependency, index): Edge => ({
      id: `${dependency}-${node.id}-${index}`,
      source: dependency,
      target: node.id,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    })));
  }, [visibleNodeIds, workflowNodes]);

  return (
    <div className="graph-shell" aria-label="Workflow dependency graph">
      <div className="graph-stages" aria-hidden="true">
        {(Object.keys(stageLabels) as Array<keyof typeof stageLabels>).map((stage) => <span key={stage}>{stageLabels[stage]}</span>)}
      </div>
      <ReactFlow
        nodes={graphNodes.map((node) => ({ ...node, selected: node.id === selectedNodeId }))}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        defaultViewport={{ x: 8, y: 138, zoom: 0.88 }}
        minZoom={0.55}
        maxZoom={1.4}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
