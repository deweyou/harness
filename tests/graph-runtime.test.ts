import { describe, expect, test } from 'vitest';
import { materializeStage, readyNodes } from '../src/core/graph.js';
import { assertWithinLoopLimits, buildRehydrationPlan, MAX_NODE_ATTEMPTS, readyWorkflowNodes, transition } from '../src/core/runtime.js';
import type { ResolvedHarnessConfig, RunProjection } from '../src/core/types.js';

describe('stage DAG and runtime', () => {
  test('returns all independent nodes before their dependent node', () => {
    const nodes = materializeStage('execute', [
      { use: 'draft' },
      { use: 'assets' },
      { use: 'compose', needs: ['draft', 'assets'] },
    ]);
    expect(readyNodes(nodes, new Set(), new Set()).map((node) => node.id)).toEqual(['draft', 'assets']);
    expect(readyNodes(nodes, new Set(['draft', 'assets']), new Set()).map((node) => node.id)).toEqual(['compose']);
  });

  test('implements the fixed loop transitions', () => {
    expect(transition('align', 'aligned')).toEqual({ nextStage: 'execute', completed: false });
    expect(transition('verify', 'verification_rejected')).toEqual({ nextStage: 'execute', completed: false });
    expect(transition('verify', 'needs_alignment')).toEqual({ nextStage: 'align', completed: false });
    expect(transition('deliver', 'delivery_approved')).toEqual({ completed: true });
    expect(() => transition('align', 'verification_passed')).toThrow();
    expect(MAX_NODE_ATTEMPTS).toBe(2);
  });

  test('rehydrates workflow context, current skills, and prior activations', () => {
    const config: ResolvedHarnessConfig = {
      version: 1,
      sourceFiles: [],
      resources: {},
      nodes: {
        work: { executor: { type: 'agent', skills: ['writer', 'editor'] } },
        pure: { executor: { type: 'agent' } },
      },
      workflows: {
        flow: {
          name: 'Flow',
          description: 'A flow.',
          selectable: true,
          rules: ['rule'],
          knowledge: ['catalog'],
          stages: {},
        },
      },
    };
    expect(buildRehydrationPlan(config, 'flow', ['work', 'pure'], ['catalog-body', 'writer', 'writer'])).toEqual({
      workflowRules: ['rule'],
      knowledgeMetadata: ['catalog'],
      currentNodeSkills: ['writer', 'editor'],
      activatedResources: ['catalog-body', 'writer'],
    });
  });

  test('calculates ready workflow nodes and enforces fixed loop limits', () => {
    const config: ResolvedHarnessConfig = {
      version: 1,
      sourceFiles: [],
      resources: {},
      nodes: {
        first: { executor: { type: 'agent' } },
        second: { executor: { type: 'command', command: 'true' } },
      },
      workflows: {
        flow: {
          name: 'Flow',
          description: 'A flow.',
          selectable: true,
          stages: { execute: [{ use: 'first' }, { use: 'second', needs: ['first'] }] },
        },
      },
    };
    expect(readyWorkflowNodes(config, 'flow', 'execute', new Set(), new Set()).map((node) => node.id)).toEqual(['first']);
    expect(readyWorkflowNodes(config, 'flow', 'execute', new Set(['first']), new Set()).map((node) => node.id)).toEqual(['second']);
    expect(() => readyWorkflowNodes(config, 'missing', 'execute', new Set(), new Set())).toThrow("Unknown workflow 'missing'");

    const projection: RunProjection = {
      schemaVersion: 1,
      runId: 'run',
      status: 'running',
      stageVisits: { execute: 3 },
      stageVisitExecutions: [],
      nodeExecutions: [],
      nodeStatuses: {},
      activatedResources: [],
      evidenceIds: [],
      resourceProposals: {},
      lastSequence: 1,
      updatedAt: '2026-08-16T00:00:00.000Z',
      timing: { wallTimeMs: 0, executionTimeMs: 0, retryTimeMs: 0, reworkTimeMs: 0, criticalPathMs: 0 },
    };
    expect(() => assertWithinLoopLimits(projection, 'execute')).toThrow(/3-visit limit/);
    projection.stageVisits.execute = 1;
    projection.nodeExecutions = [
      { nodeExecutionId: '1', nodeId: 'first', stage: 'execute', stageVisit: 1, attempt: 1, status: 'failed' },
      { nodeExecutionId: '2', nodeId: 'first', stage: 'execute', stageVisit: 1, attempt: 2, status: 'failed' },
    ];
    expect(() => assertWithinLoopLimits(projection, 'execute', 'first')).toThrow(/2-attempt limit/);
  });
});
