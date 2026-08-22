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
import { type NodeStatus, type PlannedNode } from './data';
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

function PlanNodeCard({ data, selected }: NodeProps<FlowNode<PlannedNode>>) {
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

const nodeTypes = { plan: PlanNodeCard };

interface GraphViewProps {
  planNodes: PlannedNode[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}

function nodeDepth(node: PlannedNode, nodesById: Map<string, PlannedNode>, visiting = new Set<string>()): number {
  if (visiting.has(node.id)) return 0;
  const nextVisiting = new Set(visiting).add(node.id);
  const dependencies = node.needs.flatMap((id) => {
    const dependency = nodesById.get(id);
    return dependency ? [nodeDepth(dependency, nodesById, nextVisiting) + 1] : [];
  });
  return dependencies.length ? Math.max(...dependencies) : 0;
}

export function GraphView({ planNodes, selectedNodeId, onSelectNode }: GraphViewProps) {
  const graphNodes = useMemo(() => {
    const nodesById = new Map(planNodes.map((node) => [node.id, node]));
    const depthPositions = new Map<number, number>();
    return planNodes.map((node): FlowNode<PlannedNode> => {
      const depth = nodeDepth(node, nodesById);
      const row = depthPositions.get(depth) ?? 0;
      depthPositions.set(depth, row + 1);
      return {
        id: node.id,
        type: 'plan',
        position: { x: 24 + depth * 210, y: 42 + row * 96 },
        data: node,
      };
    });
  }, [planNodes]);
  const visibleNodeIds = useMemo(() => new Set(planNodes.map((node) => node.id)), [planNodes]);
  const visibleEdges = useMemo(() => {
    return planNodes.flatMap((node) => node.needs.filter((dependency) => visibleNodeIds.has(dependency)).map((dependency, index): Edge => ({
      id: `${dependency}-${node.id}-${index}`,
      source: dependency,
      target: node.id,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    })));
  }, [visibleNodeIds, planNodes]);

  return (
    <div className="graph-shell" aria-label="Plan dependency graph">
      <ReactFlow
        nodes={graphNodes.map((node) => ({ ...node, selected: node.id === selectedNodeId }))}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.65, maxZoom: 1 }}
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
