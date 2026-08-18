#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { access, appendFile, mkdir, open, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dump, load } from "js-yaml";
import { homedir } from "node:os";
import { constants } from "node:fs";
//#region package.json
var version = "0.1.0";
//#endregion
//#region src/core/errors.ts
var HarnessError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "HarnessError";
		this.code = code;
	}
};
function invariant(condition, code, message) {
	if (!condition) throw new HarnessError(code, message);
}
//#endregion
//#region src/core/graph.ts
function materializeStage(stage, instances) {
	const materialized = instances.map((instance) => ({
		...instance,
		id: instance.id ?? instance.use,
		needs: [...instance.needs ?? []]
	}));
	const ids = /* @__PURE__ */ new Set();
	for (const instance of materialized) {
		invariant(!ids.has(instance.id), "DUPLICATE_NODE_INSTANCE", `Stage '${stage}' has duplicate node instance '${instance.id}'`);
		ids.add(instance.id);
	}
	for (const instance of materialized) for (const dependency of instance.needs) {
		invariant(dependency !== instance.id, "SELF_DEPENDENCY", `Node '${instance.id}' cannot depend on itself`);
		invariant(ids.has(dependency), "MISSING_DEPENDENCY", `Node '${instance.id}' depends on missing same-stage node '${dependency}'`);
	}
	const visiting = /* @__PURE__ */ new Set();
	const visited = /* @__PURE__ */ new Set();
	const byId = new Map(materialized.map((instance) => [instance.id, instance]));
	const visit = (id) => {
		invariant(!visiting.has(id), "DAG_CYCLE", `Stage '${stage}' contains a dependency cycle at '${id}'`);
		if (visited.has(id)) return;
		visiting.add(id);
		for (const dependency of byId.get(id)?.needs ?? []) visit(dependency);
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of ids) visit(id);
	return materialized;
}
function readyNodes(instances, completed, started) {
	return instances.filter((instance) => !completed.has(instance.id) && !started.has(instance.id) && instance.needs.every((dependency) => completed.has(dependency)));
}
//#endregion
//#region src/core/types.ts
const STAGES = [
	"align",
	"execute",
	"verify",
	"deliver"
];
//#endregion
//#region src/core/config/validate.ts
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertId(id, label) {
	invariant(ID_PATTERN.test(id), "INVALID_ID", `${label} '${id}' must be a stable lowercase identifier`);
}
function assertString(value, label) {
	invariant(typeof value === "string" && value.trim().length > 0, "INVALID_CONFIG", `${label} must be a non-empty string`);
}
function assertKnownKeys(value, allowed, label) {
	const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
	invariant(unknown.length === 0, "UNKNOWN_CONFIG_FIELD", `${label} has unknown field(s): ${unknown.join(", ")}`);
}
function validateResource(id, value) {
	invariant(isRecord(value), "INVALID_RESOURCE", `Resource '${id}' must be an object`);
	assertKnownKeys(value, [
		"kind",
		"description",
		"source"
	], `Resource '${id}'`);
	invariant([
		"skill",
		"rule",
		"knowledge"
	].includes(String(value.kind)), "INVALID_RESOURCE", `Resource '${id}' has an invalid kind`);
	invariant(isRecord(value.source), "INVALID_RESOURCE", `Resource '${id}' must define source`);
	const source = value.source;
	assertKnownKeys(source, source.type === "workspace" ? ["type", "path"] : source.type === "registry" ? [
		"type",
		"repo",
		"skill"
	] : [
		"type",
		"repo",
		"path",
		"ref"
	], `Resource '${id}' source`);
	invariant([
		"workspace",
		"registry",
		"git"
	].includes(String(source.type)), "INVALID_RESOURCE", `Resource '${id}' has an invalid source type`);
	if (source.type === "workspace") {
		assertString(source.path, `Resource '${id}' source.path`);
		invariant(!isAbsolute(source.path), "INVALID_RESOURCE", `Workspace resource '${id}' path must be relative to its config`);
	} else if (source.type === "registry") {
		assertString(source.repo, `Resource '${id}' source.repo`);
		assertString(source.skill, `Resource '${id}' source.skill`);
	} else {
		assertString(source.repo, `Resource '${id}' source.repo`);
		assertString(source.path, `Resource '${id}' source.path`);
		if (source.ref !== void 0) assertString(source.ref, `Resource '${id}' source.ref`);
	}
}
function validateNodeInstance(instance, label) {
	invariant(isRecord(instance), "INVALID_NODE_INSTANCE", `${label} must be an object`);
	assertKnownKeys(instance, [
		"use",
		"id",
		"needs",
		"with"
	], label);
	assertString(instance.use, `${label}.use`);
	if (instance.id !== void 0) {
		assertString(instance.id, `${label}.id`);
		assertId(instance.id, `${label}.id`);
	}
	if (instance.needs !== void 0) {
		invariant(Array.isArray(instance.needs), "INVALID_NODE_INSTANCE", `${label}.needs must be an array`);
		for (const dependency of instance.needs) assertString(dependency, `${label}.needs[]`);
	}
	if (instance.with !== void 0) invariant(isRecord(instance.with), "INVALID_NODE_INSTANCE", `${label}.with must be an object`);
}
function validateConfigDocument(value, source) {
	invariant(isRecord(value), "INVALID_CONFIG", `${source} must contain a YAML object`);
	assertKnownKeys(value, [
		"$schema",
		"version",
		"imports",
		"resources",
		"nodes",
		"workflows"
	], source);
	invariant(value.version === 1, "UNSUPPORTED_CONFIG_VERSION", `${source} must set version: 1`);
	if (value.imports !== void 0) {
		invariant(Array.isArray(value.imports), "INVALID_IMPORT", `${source} imports must be an array`);
		for (const entry of value.imports) if (typeof entry === "string") assertString(entry, "Import path");
		else {
			invariant(isRecord(entry), "INVALID_IMPORT", "Import must be a path string or object");
			assertKnownKeys(entry, ["path", "as"], "Import");
			assertString(entry.path, "Import path");
			if (entry.as !== void 0) {
				assertString(entry.as, "Import namespace");
				assertId(entry.as, "Import namespace");
			}
		}
	}
	if (value.resources !== void 0) {
		invariant(isRecord(value.resources), "INVALID_CONFIG", "resources must be an object");
		for (const [id, resource] of Object.entries(value.resources)) {
			assertId(id, "Resource id");
			validateResource(id, resource);
		}
	}
	if (value.nodes !== void 0) {
		invariant(isRecord(value.nodes), "INVALID_CONFIG", "nodes must be an object");
		for (const [id, node] of Object.entries(value.nodes)) {
			assertId(id, "Node id");
			invariant(isRecord(node) && isRecord(node.executor), "INVALID_NODE", `Node '${id}' must define executor`);
			assertKnownKeys(node, [
				"name",
				"description",
				"executor"
			], `Node '${id}'`);
			if (node.name !== void 0) assertString(node.name, `Node '${id}'.name`);
			if (node.description !== void 0) assertString(node.description, `Node '${id}'.description`);
			const executor = node.executor;
			invariant(executor.type === "agent" || executor.type === "command", "INVALID_EXECUTOR", `Node '${id}' has an invalid executor type`);
			if (executor.type === "agent") {
				assertKnownKeys(executor, ["type", "skills"], `Node '${id}' executor`);
				if (executor.skills !== void 0) {
					invariant(Array.isArray(executor.skills), "INVALID_EXECUTOR", `Node '${id}' skills must be an array`);
					for (const skill of executor.skills) assertString(skill, `Node '${id}' skill`);
				}
			} else {
				assertKnownKeys(executor, ["type", "command"], `Node '${id}' executor`);
				assertString(executor.command, `Node '${id}' command`);
			}
		}
	}
	if (value.workflows !== void 0) {
		invariant(isRecord(value.workflows), "INVALID_CONFIG", "workflows must be an object");
		for (const [id, workflow] of Object.entries(value.workflows)) {
			assertId(id, "Workflow id");
			invariant(isRecord(workflow), "INVALID_WORKFLOW", `Workflow '${id}' must be an object`);
			assertKnownKeys(workflow, [
				"name",
				"description",
				"selectable",
				"extends",
				"rules",
				"knowledge",
				"stages"
			], `Workflow '${id}'`);
			assertString(workflow.name, `Workflow '${id}'.name`);
			assertString(workflow.description, `Workflow '${id}'.description`);
			if (workflow.selectable !== void 0) invariant(typeof workflow.selectable === "boolean", "INVALID_WORKFLOW", `Workflow '${id}'.selectable must be boolean`);
			if (workflow.extends !== void 0) assertString(workflow.extends, `Workflow '${id}'.extends`);
			for (const field of ["rules", "knowledge"]) if (workflow[field] !== void 0) {
				invariant(Array.isArray(workflow[field]), "INVALID_WORKFLOW", `Workflow '${id}'.${field} must be an array`);
				for (const resource of workflow[field]) assertString(resource, `Workflow '${id}'.${field}[]`);
			}
			if (workflow.stages !== void 0) {
				invariant(isRecord(workflow.stages), "INVALID_WORKFLOW", `Workflow '${id}'.stages must be an object`);
				for (const [stage, instances] of Object.entries(workflow.stages)) {
					invariant(STAGES.includes(stage), "INVALID_STAGE", `Workflow '${id}' uses unsupported stage '${stage}'`);
					invariant(Array.isArray(instances), "INVALID_STAGE", `Workflow '${id}' stage '${stage}' must be an array`);
					instances.forEach((instance, index) => validateNodeInstance(instance, `Workflow '${id}' ${stage}[${index}]`));
				}
			}
		}
	}
}
//#endregion
//#region src/core/config/load.ts
function emptyFragment() {
	return {
		sourceFiles: [],
		resources: {},
		nodes: {},
		workflows: {}
	};
}
function insertUnique(target, additions, kind) {
	for (const [id, value] of Object.entries(additions)) {
		invariant(!(id in target), "IMPORT_COLLISION", `${kind} '${id}' is defined more than once; use an import namespace`);
		target[id] = value;
	}
}
function qualify(namespace, id) {
	return `${namespace}.${id}`;
}
function namespaceFragment(fragment, namespace) {
	const resources = Object.fromEntries(Object.entries(fragment.resources).map(([id, value]) => [qualify(namespace, id), value]));
	const nodes = Object.fromEntries(Object.entries(fragment.nodes).map(([id, node]) => [qualify(namespace, id), node.executor.type === "agent" ? {
		...node,
		executor: {
			...node.executor,
			...node.executor.skills ? { skills: node.executor.skills.map((skill) => qualify(namespace, skill)) } : {}
		}
	} : node]));
	const workflows = Object.fromEntries(Object.entries(fragment.workflows).map(([id, workflow]) => [qualify(namespace, id), {
		...workflow,
		...workflow.extends ? { extends: qualify(namespace, workflow.extends) } : {},
		...workflow.rules ? { rules: workflow.rules.map((resource) => qualify(namespace, resource)) } : {},
		...workflow.knowledge ? { knowledge: workflow.knowledge.map((resource) => qualify(namespace, resource)) } : {},
		...workflow.stages ? { stages: Object.fromEntries(Object.entries(workflow.stages).map(([stage, instances]) => [stage, instances?.map((instance) => ({
			...instance,
			id: instance.id ?? instance.use,
			use: qualify(namespace, instance.use)
		}))])) } : {}
	}]));
	return {
		...fragment,
		resources,
		nodes,
		workflows
	};
}
function resolveWorkspaceSources(resources, configDirectory) {
	return Object.fromEntries(Object.entries(resources).map(([id, resource]) => [id, resource.source.type === "workspace" ? {
		...resource,
		source: {
			...resource.source,
			path: resolve(configDirectory, resource.source.path)
		}
	} : resource]));
}
async function loadFragment(configPath, stack) {
	const canonicalPath = await realpath(configPath);
	invariant(!stack.includes(canonicalPath), "IMPORT_CYCLE", `Config import cycle: ${[...stack, canonicalPath].join(" -> ")}`);
	const document = load(await readFile(canonicalPath, "utf8"));
	validateConfigDocument(document, canonicalPath);
	const fragment = emptyFragment();
	const nextStack = [...stack, canonicalPath];
	for (const rawImport of document.imports ?? []) {
		const entry = typeof rawImport === "string" ? { path: rawImport } : rawImport;
		const loaded = await loadFragment(isAbsolute(entry.path) ? entry.path : resolve(dirname(canonicalPath), entry.path), nextStack);
		const imported = entry.as ? namespaceFragment(loaded, entry.as) : loaded;
		fragment.sourceFiles.push(...imported.sourceFiles);
		insertUnique(fragment.resources, imported.resources, "Resource");
		insertUnique(fragment.nodes, imported.nodes, "Node");
		insertUnique(fragment.workflows, imported.workflows, "Workflow");
	}
	fragment.sourceFiles.push(canonicalPath);
	insertUnique(fragment.resources, resolveWorkspaceSources(document.resources ?? {}, dirname(canonicalPath)), "Resource");
	insertUnique(fragment.nodes, document.nodes ?? {}, "Node");
	insertUnique(fragment.workflows, document.workflows ?? {}, "Workflow");
	return fragment;
}
function resolveWorkflows(fragment) {
	const resolved = /* @__PURE__ */ new Map();
	const visiting = /* @__PURE__ */ new Set();
	const resolveOne = (id) => {
		const cached = resolved.get(id);
		if (cached) return cached;
		invariant(!visiting.has(id), "WORKFLOW_INHERITANCE_CYCLE", `Workflow inheritance cycle at '${id}'`);
		const workflow = fragment.workflows[id];
		invariant(workflow, "MISSING_WORKFLOW", `Workflow '${id}' does not exist`);
		visiting.add(id);
		const parent = workflow.extends ? resolveOne(workflow.extends) : void 0;
		const stages = {
			...parent?.stages ?? {},
			...workflow.stages ?? {}
		};
		const result = {
			name: workflow.name,
			description: workflow.description,
			selectable: workflow.selectable ?? parent?.selectable ?? true,
			rules: workflow.rules === void 0 ? [...parent?.rules ?? []] : [...workflow.rules],
			knowledge: workflow.knowledge === void 0 ? [...parent?.knowledge ?? []] : [...workflow.knowledge],
			stages
		};
		visiting.delete(id);
		resolved.set(id, result);
		return result;
	};
	for (const id of Object.keys(fragment.workflows)) resolveOne(id);
	return Object.fromEntries(resolved);
}
function validateReferences(config) {
	for (const [nodeId, node] of Object.entries(config.nodes)) if (node.executor.type === "agent") for (const resourceId of node.executor.skills ?? []) {
		const resource = config.resources[resourceId];
		invariant(resource, "MISSING_RESOURCE", `Node '${nodeId}' refers to missing skill '${resourceId}'`);
		invariant(resource.kind === "skill", "RESOURCE_KIND_MISMATCH", `Node '${nodeId}' resource '${resourceId}' is not a skill`);
	}
	for (const [workflowId, workflow] of Object.entries(config.workflows)) {
		for (const resourceId of workflow.rules ?? []) invariant(config.resources[resourceId]?.kind === "rule", "RESOURCE_KIND_MISMATCH", `Workflow '${workflowId}' rule '${resourceId}' is missing or not a rule`);
		for (const resourceId of workflow.knowledge ?? []) invariant(config.resources[resourceId]?.kind === "knowledge", "RESOURCE_KIND_MISMATCH", `Workflow '${workflowId}' knowledge '${resourceId}' is missing or not knowledge`);
		for (const stage of STAGES) {
			const instances = workflow.stages[stage] ?? [];
			for (const instance of instances) invariant(config.nodes[instance.use], "MISSING_NODE", `Workflow '${workflowId}' stage '${stage}' refers to missing node '${instance.use}'`);
			workflow.stages[stage] = materializeStage(stage, instances);
		}
	}
}
async function loadHarnessConfig(configPath) {
	const fragment = await loadFragment(resolve(configPath), []);
	const config = {
		version: 1,
		sourceFiles: [...new Set(fragment.sourceFiles)],
		resources: fragment.resources,
		nodes: fragment.nodes,
		workflows: resolveWorkflows(fragment)
	};
	validateReferences(config);
	return config;
}
function selectableWorkflows(config) {
	return Object.entries(config.workflows).filter(([, workflow]) => workflow.selectable).map(([id, workflow]) => ({
		id,
		name: workflow.name,
		description: workflow.description
	}));
}
//#endregion
//#region src/core/resources.ts
async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
async function resourceFile(path, kind) {
	if ((await stat(path)).isFile()) return path;
	if (kind === "skill") return join(path, "SKILL.md");
	const preferred = join(path, kind === "rule" ? "RULE.md" : "KNOWLEDGE.md");
	if (await exists(preferred)) return preferred;
	return join(path, "README.md");
}
function metadataOnly(content) {
	if (content.startsWith("---")) {
		const end = content.indexOf("\n---", 3);
		if (end >= 0) return content.slice(0, end + 4);
	}
	return content.split("\n").slice(0, 12).join("\n");
}
async function findRegistrySkill(skill, workspacePath) {
	const candidates = [
		join(workspacePath, ".agents", "skills", skill, "SKILL.md"),
		join(workspacePath, ".codex", "skills", skill, "SKILL.md"),
		join(homedir(), ".agents", "skills", skill, "SKILL.md"),
		join(homedir(), ".codex", "skills", skill, "SKILL.md")
	];
	for (const candidate of candidates) if (await exists(candidate)) return candidate;
}
async function locateResource(resource, workspacePath) {
	if (resource.source.type === "workspace") return { locator: resource.source.path };
	if (resource.source.type === "registry") {
		const found = await findRegistrySkill(resource.source.skill, workspacePath);
		return found ? { locator: found } : {
			locator: `registry:${resource.source.repo}#${resource.source.skill}`,
			hint: `npx skills add ${resource.source.repo} --skill ${resource.source.skill} --yes`,
			preparation: {
				command: "npx",
				args: [
					"skills",
					"add",
					resource.source.repo,
					"--skill",
					resource.source.skill,
					"--yes"
				]
			}
		};
	}
	const repoPath = resource.source.repo.startsWith("file://") ? new URL(resource.source.repo).pathname : resource.source.repo;
	if (isAbsolute(repoPath) || repoPath.startsWith(".")) return { locator: resolve(workspacePath, repoPath, resource.source.path) };
	const identity = createHash("sha256").update(`${resource.source.repo}\0${resource.source.ref ?? "HEAD"}`).digest("hex").slice(0, 16);
	const cacheRoot = join(homedir(), ".deweyou", "harness", "resources", "git", identity);
	return {
		locator: join(cacheRoot, resource.source.path),
		hint: `Clone ${resource.source.repo}${resource.source.ref ? ` at ${resource.source.ref}` : ""} into ${cacheRoot}`,
		preparation: {
			command: "git",
			args: [
				"clone",
				"--depth",
				"1",
				...resource.source.ref ? ["--branch", resource.source.ref] : [],
				"--",
				resource.source.repo,
				cacheRoot
			]
		}
	};
}
async function dispatchResource(config, resourceId, mode, workspacePath) {
	const resource = config.resources[resourceId];
	if (!resource) throw new Error(`Unknown resource '${resourceId}'`);
	const located = await locateResource(resource, workspacePath);
	if (!await exists(located.locator)) return {
		resourceId,
		kind: resource.kind,
		mode,
		status: "missing",
		locator: located.locator,
		...located.hint ? { installHint: located.hint } : {},
		...located.preparation ? { preparation: located.preparation } : {}
	};
	const file = await resourceFile(located.locator, resource.kind);
	if (!await exists(file)) return {
		resourceId,
		kind: resource.kind,
		mode,
		status: "missing",
		locator: file
	};
	const fullContent = await readFile(file, "utf8");
	const content = mode === "metadata" ? metadataOnly(fullContent) : fullContent;
	return {
		resourceId,
		kind: resource.kind,
		mode,
		status: "loaded",
		locator: file,
		digest: createHash("sha256").update(fullContent).digest("hex"),
		content
	};
}
async function dispatchWorkflowContext(config, workflowId, workspacePath) {
	const workflow = config.workflows[workflowId];
	if (!workflow) throw new Error(`Unknown workflow '${workflowId}'`);
	const rules = await Promise.all((workflow.rules ?? []).map((id) => dispatchResource(config, id, "full", workspacePath)));
	const knowledge = await Promise.all((workflow.knowledge ?? []).map((id) => dispatchResource(config, id, "metadata", workspacePath)));
	return [...rules, ...knowledge];
}
async function dispatchNodeSkills(config, nodeId, workspacePath) {
	const node = config.nodes[nodeId];
	if (!node) throw new Error(`Unknown node '${nodeId}'`);
	if (node.executor.type !== "agent") return [];
	return Promise.all((node.executor.skills ?? []).map((id) => dispatchResource(config, id, "full", workspacePath)));
}
//#endregion
//#region src/core/runtime.ts
function readyWorkflowNodes(config, workflowId, stage, completed, started) {
	const workflow = config.workflows[workflowId];
	if (!workflow) throw new Error(`Unknown workflow '${workflowId}'`);
	return readyNodes(materializeStage(stage, workflow.stages[stage] ?? []), completed, started);
}
function buildRehydrationPlan(config, workflowId, currentNodeIds, activatedResources) {
	const workflow = config.workflows[workflowId];
	if (!workflow) throw new Error(`Unknown workflow '${workflowId}'`);
	const currentNodeSkills = currentNodeIds.flatMap((nodeId) => {
		const node = config.nodes[nodeId];
		if (!node) throw new Error(`Unknown node '${nodeId}'`);
		return node.executor.type === "agent" ? node.executor.skills ?? [] : [];
	});
	return {
		workflowRules: [...workflow.rules ?? []],
		knowledgeMetadata: [...workflow.knowledge ?? []],
		currentNodeSkills: [...new Set(currentNodeSkills)],
		activatedResources: [...new Set(activatedResources)]
	};
}
//#endregion
//#region src/core/retrospective.ts
function eventResourceIds(event) {
	if (typeof event.payload.resourceId === "string") return [event.payload.resourceId];
	if (Array.isArray(event.payload.resourceIds)) return event.payload.resourceIds.filter((value) => typeof value === "string");
	return [];
}
function observationCategory(event) {
	if (event.type === "resource.feedback.recorded") return typeof event.payload.category === "string" ? event.payload.category : "resource-feedback";
	if ([
		"node.failed",
		"node.blocked",
		"node.interrupted"
	].includes(event.type)) return event.type;
	if (event.type === "decision.recorded" && event.payload.result === "verification_rejected") return "verification-rejected";
}
function observationSummary(event, category) {
	for (const key of [
		"summary",
		"reason",
		"message"
	]) if (typeof event.payload[key] === "string" && event.payload[key].trim()) return event.payload[key];
	return `Run evidence recorded ${category}.`;
}
function stableId(prefix, value) {
	return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}
function buildRetrospective(runId, events, resourceLock, createdAt) {
	const observations = events.flatMap((event) => {
		const category = observationCategory(event);
		if (!category) return [];
		return eventResourceIds(event).map((resourceId) => ({
			eventId: event.id,
			resourceId,
			category,
			summary: observationSummary(event, category)
		}));
	});
	const byResource = /* @__PURE__ */ new Map();
	for (const observation of observations) {
		const grouped = byResource.get(observation.resourceId) ?? [];
		grouped.push(observation);
		byResource.set(observation.resourceId, grouped);
	}
	const proposals = [...byResource].map(([resourceId, resourceObservations]) => {
		const evidenceEventIds = resourceObservations.map((observation) => observation.eventId);
		const categories = [...new Set(resourceObservations.map((observation) => observation.category))];
		const summaries = [...new Set(resourceObservations.map((observation) => observation.summary))];
		const lock = resourceLock[resourceId];
		return {
			schemaVersion: 1,
			id: stableId("proposal", `${runId}\0${resourceId}\0${evidenceEventIds.join("\0")}`),
			runId,
			resourceId,
			resourceKind: lock?.kind ?? "unknown",
			baseDigest: lock?.digest ?? null,
			status: "proposed",
			createdAt,
			evidenceEventIds,
			problem: {
				categories,
				summary: summaries.join(" ")
			},
			suggestion: { summary: `Review '${resourceId}' against the attributed Run evidence and update only the instructions or facts that caused the observed gap.` },
			validation: {
				replayRunIds: [runId],
				acceptance: `Replay the affected cases without equivalent feedback attributed to '${resourceId}'.`
			}
		};
	});
	return {
		retrospective: {
			schemaVersion: 1,
			id: stableId("retro", runId),
			runId,
			createdAt,
			observations,
			proposalIds: proposals.map((proposal) => proposal.id)
		},
		proposals
	};
}
//#endregion
//#region src/core/state/projection.ts
const NODE_TERMINAL = new Map([
	["node.succeeded", "succeeded"],
	["node.failed", "failed"],
	["node.blocked", "blocked"],
	["node.cancelled", "cancelled"],
	["node.skipped", "skipped"],
	["node.interrupted", "interrupted"]
]);
function stringValue(payload, key) {
	const value = payload[key];
	if (typeof value !== "string") throw new Error(`Event payload.${key} must be a string`);
	return value;
}
function numberValue(payload, key) {
	const value = payload[key];
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`Event payload.${key} must be a positive integer`);
	return value;
}
function projectRun(events) {
	if (events.length === 0) throw new Error("Cannot project an empty run");
	const first = events[0];
	const executions = /* @__PURE__ */ new Map();
	const stageExecutionMap = /* @__PURE__ */ new Map();
	const nodeStatuses = {};
	const stageVisits = {};
	const activatedResources = /* @__PURE__ */ new Set();
	const evidenceIds = /* @__PURE__ */ new Set();
	const resourceProposals = {};
	let retrospective;
	let status = "running";
	let currentStage;
	for (const event of events) if (event.type === "run.created") {
		const plannedNodes = event.payload.plannedNodes;
		if (Array.isArray(plannedNodes)) {
			for (const planned of plannedNodes) if (typeof planned === "object" && planned !== null && "stage" in planned && "nodeId" in planned) {
				const stage = String(planned.stage);
				const nodeId = String(planned.nodeId);
				nodeStatuses[`${stage}:${nodeId}`] = "pending";
			}
		}
	} else if (event.type === "stage.started") {
		currentStage = stringValue(event.payload, "stage");
		const stageVisit = numberValue(event.payload, "stageVisit");
		stageVisits[currentStage] = Math.max(stageVisits[currentStage] ?? 0, stageVisit);
		const key = `${currentStage}:${stageVisit}`;
		if (stageExecutionMap.has(key)) throw new Error(`Duplicate stage visit '${key}'`);
		stageExecutionMap.set(key, {
			stage: currentStage,
			stageVisit,
			status: "running",
			startedAt: event.timestamp
		});
	} else if (event.type === "stage.completed") {
		const stage = stringValue(event.payload, "stage");
		const stageVisit = numberValue(event.payload, "stageVisit");
		const stageExecution = stageExecutionMap.get(`${stage}:${stageVisit}`);
		if (!stageExecution || stageExecution.status === "completed") throw new Error(`Unknown or completed stage visit '${stage}:${stageVisit}'`);
		stageExecution.status = "completed";
		stageExecution.endedAt = event.timestamp;
		stageExecution.durationMs = Math.max(0, Date.parse(event.timestamp) - Date.parse(stageExecution.startedAt));
	} else if (event.type === "node.ready") {
		const stage = stringValue(event.payload, "stage");
		const nodeId = stringValue(event.payload, "nodeId");
		nodeStatuses[`${stage}:${nodeId}`] = "ready";
	} else if (event.type === "node.started") {
		const nodeExecutionId = stringValue(event.payload, "nodeExecutionId");
		if (executions.has(nodeExecutionId)) throw new Error(`Duplicate node execution '${nodeExecutionId}'`);
		executions.set(nodeExecutionId, {
			nodeExecutionId,
			nodeId: stringValue(event.payload, "nodeId"),
			stage: stringValue(event.payload, "stage"),
			stageVisit: numberValue(event.payload, "stageVisit"),
			attempt: numberValue(event.payload, "attempt"),
			status: "running",
			startedAt: event.timestamp
		});
		nodeStatuses[`${stringValue(event.payload, "stage")}:${stringValue(event.payload, "nodeId")}`] = "running";
	} else if (NODE_TERMINAL.has(event.type)) {
		const nodeExecutionId = stringValue(event.payload, "nodeExecutionId");
		const execution = executions.get(nodeExecutionId);
		if (!execution) throw new Error(`Terminal event refers to unknown node execution '${nodeExecutionId}'`);
		if (execution.status !== "running") throw new Error(`Node execution '${nodeExecutionId}' is already terminal`);
		const endedAt = Date.parse(event.timestamp);
		const startedAt = Date.parse(execution.startedAt);
		execution.status = NODE_TERMINAL.get(event.type);
		execution.endedAt = event.timestamp;
		execution.durationMs = Math.max(0, endedAt - startedAt);
		nodeStatuses[`${execution.stage}:${execution.nodeId}`] = execution.status;
		if (execution.status === "blocked") status = "blocked";
	} else if (event.type === "resource.activated") activatedResources.add(stringValue(event.payload, "resourceId"));
	else if (event.type === "evidence.recorded") evidenceIds.add(stringValue(event.payload, "evidenceId"));
	else if (event.type === "run.completed") {
		status = "completed";
		currentStage = void 0;
	} else if (event.type === "resource.change.proposed") {
		const proposalId = stringValue(event.payload, "proposalId");
		resourceProposals[proposalId] = {
			resourceId: stringValue(event.payload, "resourceId"),
			status: "proposed",
			summary: stringValue(event.payload, "summary")
		};
	} else if (event.type === "resource.change.accepted" || event.type === "resource.change.rejected") {
		const proposalId = stringValue(event.payload, "proposalId");
		const proposal = resourceProposals[proposalId];
		if (!proposal) throw new Error(`Decision refers to unknown resource proposal '${proposalId}'`);
		const decision = event.type === "resource.change.accepted" ? "accepted" : "rejected";
		if (proposal.status !== "proposed" && proposal.status !== decision) throw new Error(`Resource proposal '${proposalId}' already has decision '${proposal.status}'`);
		proposal.status = decision;
	} else if (event.type === "retrospective.generated") {
		const proposalIds = event.payload.proposalIds;
		const observationCount = event.payload.observationCount;
		if (!Array.isArray(proposalIds) || !proposalIds.every((value) => typeof value === "string")) throw new Error("Event payload.proposalIds must be a string array");
		if (typeof observationCount !== "number" || !Number.isInteger(observationCount) || observationCount < 0) throw new Error("Event payload.observationCount must be a non-negative integer");
		retrospective = {
			id: stringValue(event.payload, "retrospectiveId"),
			observationCount,
			proposalIds
		};
	}
	const nodeExecutions = [...executions.values()];
	const executionTimeMs = nodeExecutions.reduce((sum, execution) => sum + (execution.durationMs ?? 0), 0);
	const retryTimeMs = nodeExecutions.filter((execution) => execution.attempt > 1).reduce((sum, execution) => sum + (execution.durationMs ?? 0), 0);
	const reworkTimeMs = nodeExecutions.filter((execution) => execution.stageVisit > 1).reduce((sum, execution) => sum + (execution.durationMs ?? 0), 0);
	const intervals = nodeExecutions.filter((execution) => execution.startedAt && execution.endedAt).map((execution) => [Date.parse(execution.startedAt), Date.parse(execution.endedAt)]).sort((left, right) => left[0] - right[0]);
	let criticalPathMs = 0;
	let intervalStart;
	let intervalEnd;
	for (const [start, end] of intervals) if (intervalStart === void 0 || intervalEnd === void 0) {
		intervalStart = start;
		intervalEnd = end;
	} else if (start <= intervalEnd) intervalEnd = Math.max(intervalEnd, end);
	else {
		criticalPathMs += intervalEnd - intervalStart;
		intervalStart = start;
		intervalEnd = end;
	}
	if (intervalStart !== void 0 && intervalEnd !== void 0) criticalPathMs += intervalEnd - intervalStart;
	const last = events.at(-1);
	return {
		schemaVersion: 1,
		runId: first.runId,
		status,
		stageVisits,
		stageVisitExecutions: [...stageExecutionMap.values()],
		nodeExecutions,
		nodeStatuses,
		activatedResources: [...activatedResources],
		evidenceIds: [...evidenceIds],
		resourceProposals,
		lastSequence: last.sequence,
		updatedAt: last.timestamp,
		timing: {
			wallTimeMs: Math.max(0, Date.parse(last.timestamp) - Date.parse(first.timestamp)),
			executionTimeMs,
			retryTimeMs,
			reworkTimeMs,
			criticalPathMs
		},
		...currentStage ? { currentStage } : {},
		...retrospective ? { retrospective } : {}
	};
}
//#endregion
//#region src/core/state/store.ts
const delay = (milliseconds) => new Promise((accept) => setTimeout(accept, milliseconds));
async function atomicJson(path, value) {
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 384 });
	await rename(temporary, path);
}
async function withFileLock(lockPath, operation) {
	const deadline = Date.now() + 2e3;
	let handle;
	while (!handle) try {
		handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 384);
	} catch (error) {
		if ((error instanceof Error && "code" in error ? error.code : void 0) !== "EEXIST" || Date.now() >= deadline) throw error;
		await delay(25);
	}
	try {
		return await operation();
	} finally {
		await handle.close();
		await import("node:fs/promises").then(({ unlink }) => unlink(lockPath).catch(() => void 0));
	}
}
function eventHash(event) {
	return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}
var RunStore = class {
	stateRoot;
	now;
	constructor(options = {}) {
		this.stateRoot = options.stateRoot ?? join(homedir(), ".deweyou", "harness");
		this.now = options.now ?? (() => /* @__PURE__ */ new Date());
	}
	async createRun(input) {
		const workspacePath = await realpath(resolve(input.workspacePath));
		invariant(input.config.workflows[input.workflowId], "MISSING_WORKFLOW", `Unknown workflow '${input.workflowId}'`);
		const workspaceId = createHash("sha256").update(workspacePath).digest("hex").slice(0, 20);
		const runId = `${this.now().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
		const runDirectory = this.runDirectory(workspaceId, runId);
		await Promise.all([mkdir(join(runDirectory, "evidence"), {
			recursive: true,
			mode: 448
		}), mkdir(join(runDirectory, "proposals"), {
			recursive: true,
			mode: 448
		})]);
		const createdAt = this.now().toISOString();
		const metadata = {
			schemaVersion: 1,
			id: runId,
			workspaceId,
			workspacePath,
			workflowId: input.workflowId,
			createdAt,
			hostSessions: input.hostSessionId ? [input.hostSessionId] : []
		};
		await Promise.all([
			atomicJson(join(runDirectory, "run.json"), metadata),
			atomicJson(join(runDirectory, "request.json"), input.request),
			writeFile(join(runDirectory, "config.snapshot.yaml"), dump(input.config, { noRefs: true }), { mode: 384 }),
			atomicJson(join(runDirectory, "resources.lock.json"), {}),
			atomicJson(join(runDirectory, "plan.json"), {
				workflowId: input.workflowId,
				stages: input.config.workflows[input.workflowId]?.stages ?? {}
			}),
			writeFile(join(runDirectory, "events.jsonl"), "", {
				mode: 384,
				flag: "wx"
			}),
			atomicJson(join(runDirectory, "artifacts.json"), [])
		]);
		await this.appendEvent(workspaceId, runId, {
			type: "run.created",
			traceId: randomUUID(),
			spanId: randomUUID(),
			timestamp: createdAt,
			payload: {
				workflowId: input.workflowId,
				workspaceId,
				plannedNodes: Object.entries(input.config.workflows[input.workflowId]?.stages ?? {}).flatMap(([stage, instances]) => (instances ?? []).map((instance) => ({
					stage,
					nodeId: instance.id ?? instance.use
				})))
			}
		});
		return metadata;
	}
	async appendEvent(workspaceId, runId, input) {
		const directory = this.runDirectory(workspaceId, runId);
		await access(join(directory, "run.json"));
		const event = await withFileLock(join(directory, ".events.lock"), async () => {
			const events = await this.readEvents(workspaceId, runId);
			if (input.idempotencyKey) {
				const existing = events.find((event) => event.idempotencyKey === input.idempotencyKey);
				if (existing) {
					invariant(existing.type === input.type && JSON.stringify(existing.payload) === JSON.stringify(input.payload), "IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was already used for different event content`);
					return existing;
				}
			}
			const previous = events.at(-1);
			const withoutHash = {
				...input,
				schemaVersion: 1,
				id: randomUUID(),
				runId,
				sequence: (previous?.sequence ?? 0) + 1,
				timestamp: input.timestamp ?? this.now().toISOString(),
				previousHash: previous?.hash ?? null
			};
			const event = {
				...withoutHash,
				hash: eventHash(withoutHash)
			};
			const projection = projectRun([...events, event]);
			await appendFile(join(directory, "events.jsonl"), `${JSON.stringify(event)}\n`, {
				encoding: "utf8",
				mode: 384
			});
			await atomicJson(join(directory, "state.json"), projection);
			return event;
		});
		if (input.type === "run.completed") await this.ensureRetrospective(workspaceId, runId, input.traceId, input.spanId);
		return event;
	}
	async ensureRetrospective(workspaceId, runId, traceId, parentSpanId) {
		const directory = this.runDirectory(workspaceId, runId);
		const events = await this.readEvents(workspaceId, runId);
		if (events.find((event) => event.type === "retrospective.generated")) return JSON.parse(await readFile(join(directory, "retrospective.json"), "utf8"));
		invariant(events.some((event) => event.type === "run.completed"), "RUN_NOT_COMPLETED", "Retrospective requires a completed Run");
		const resourceLock = JSON.parse(await readFile(join(directory, "resources.lock.json"), "utf8"));
		const latestTimestamp = events.at(-1).timestamp;
		const generatedAt = new Date(Math.max(this.now().getTime(), Date.parse(latestTimestamp))).toISOString();
		const generated = buildRetrospective(runId, events, resourceLock, generatedAt);
		for (const proposal of generated.proposals) {
			const path = join(directory, "proposals", `${proposal.id}.json`);
			await atomicJson(path, proposal);
			await this.appendEvent(workspaceId, runId, {
				type: "resource.change.proposed",
				traceId,
				spanId: randomUUID(),
				parentSpanId,
				timestamp: generatedAt,
				idempotencyKey: `proposal:${proposal.id}`,
				payload: {
					proposalId: proposal.id,
					resourceId: proposal.resourceId,
					summary: proposal.problem.summary,
					path
				}
			});
		}
		await atomicJson(join(directory, "retrospective.json"), generated.retrospective);
		await this.appendEvent(workspaceId, runId, {
			type: "retrospective.generated",
			traceId,
			spanId: randomUUID(),
			parentSpanId,
			timestamp: generatedAt,
			idempotencyKey: `retrospective:${generated.retrospective.id}`,
			payload: {
				retrospectiveId: generated.retrospective.id,
				observationCount: generated.retrospective.observations.length,
				proposalIds: generated.retrospective.proposalIds
			}
		});
		return generated.retrospective;
	}
	async getRetrospective(workspaceId, runId) {
		const directory = this.runDirectory(workspaceId, runId);
		const retrospective = JSON.parse(await readFile(join(directory, "retrospective.json"), "utf8"));
		const projection = await this.getProjection(workspaceId, runId);
		return {
			retrospective,
			proposals: await Promise.all(retrospective.proposalIds.map(async (proposalId) => {
				const proposal = JSON.parse(await readFile(join(directory, "proposals", `${proposalId}.json`), "utf8"));
				const projected = projection.resourceProposals[proposalId];
				return projected ? {
					...proposal,
					status: projected.status
				} : proposal;
			}))
		};
	}
	async decideProposal(workspaceId, runId, proposalId, decision, traceId, spanId, reason) {
		const path = join(this.runDirectory(workspaceId, runId), "proposals", `${proposalId}.json`);
		const proposal = JSON.parse(await readFile(path, "utf8"));
		const projectedStatus = (await this.getProjection(workspaceId, runId)).resourceProposals[proposalId]?.status;
		invariant(projectedStatus, "UNKNOWN_PROPOSAL", `Unknown proposal '${proposalId}'`);
		invariant(projectedStatus === "proposed" || projectedStatus === decision, "PROPOSAL_ALREADY_DECIDED", `Proposal '${proposalId}' is already ${projectedStatus}`);
		if (projectedStatus === decision) return {
			...proposal,
			status: projectedStatus
		};
		const decidedAt = this.now().toISOString();
		await this.appendEvent(workspaceId, runId, {
			type: decision === "accepted" ? "resource.change.accepted" : "resource.change.rejected",
			traceId,
			spanId,
			idempotencyKey: `proposal-decision:${proposalId}`,
			payload: {
				proposalId,
				...reason ? { reason } : {}
			}
		});
		proposal.status = decision;
		proposal.decision = {
			decidedAt,
			...reason ? { reason } : {}
		};
		await atomicJson(path, proposal);
		return proposal;
	}
	async readEvents(workspaceId, runId) {
		const events = (await readFile(join(this.runDirectory(workspaceId, runId), "events.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
		let previousHash = null;
		for (const [index, event] of events.entries()) {
			invariant(event.sequence === index + 1, "INVALID_EVENT_SEQUENCE", `Expected event sequence ${index + 1}`);
			invariant(event.previousHash === previousHash, "INVALID_EVENT_CHAIN", `Broken event chain at sequence ${event.sequence}`);
			const { hash, ...withoutHash } = event;
			invariant(hash === eventHash(withoutHash), "INVALID_EVENT_HASH", `Invalid event hash at sequence ${event.sequence}`);
			previousHash = hash;
		}
		return events;
	}
	async getProjection(workspaceId, runId) {
		return projectRun(await this.readEvents(workspaceId, runId));
	}
	async rebuildProjection(workspaceId, runId) {
		const projection = await this.getProjection(workspaceId, runId);
		await atomicJson(join(this.runDirectory(workspaceId, runId), "state.json"), projection);
		return projection;
	}
	async attachHostSession(workspaceId, runId, hostSessionId) {
		const directory = this.runDirectory(workspaceId, runId);
		return withFileLock(join(directory, ".run.lock"), async () => {
			const path = join(directory, "run.json");
			const metadata = JSON.parse(await readFile(path, "utf8"));
			if (!metadata.hostSessions.includes(hostSessionId)) {
				metadata.hostSessions.push(hostSessionId);
				await atomicJson(path, metadata);
			}
			return metadata;
		});
	}
	async updateResourceLock(workspaceId, runId, receipts) {
		const directory = this.runDirectory(workspaceId, runId);
		return withFileLock(join(directory, ".resources.lock"), async () => {
			const path = join(directory, "resources.lock.json");
			const current = JSON.parse(await readFile(path, "utf8"));
			for (const receipt of receipts) current[receipt.resourceId] = {
				kind: receipt.kind,
				mode: receipt.mode,
				status: receipt.status,
				locator: receipt.locator,
				digest: receipt.digest ?? null
			};
			await atomicJson(path, current);
			return current;
		});
	}
	async recoverInterrupted(workspaceId, runId, traceId) {
		const projection = await this.getProjection(workspaceId, runId);
		for (const execution of projection.nodeExecutions.filter((candidate) => candidate.status === "running")) await this.appendEvent(workspaceId, runId, {
			type: "node.interrupted",
			traceId,
			spanId: randomUUID(),
			payload: {
				nodeExecutionId: execution.nodeExecutionId,
				nodeId: execution.nodeId,
				stage: execution.stage,
				stageVisit: execution.stageVisit,
				attempt: execution.attempt,
				reason: "host session ended without a terminal event"
			}
		});
		return this.getProjection(workspaceId, runId);
	}
	async writeEvidence(workspaceId, runId, content) {
		const evidenceId = createHash("sha256").update(content).digest("hex");
		const path = join(this.runDirectory(workspaceId, runId), "evidence", evidenceId);
		try {
			await writeFile(path, content, {
				encoding: "utf8",
				mode: 384,
				flag: "wx"
			});
		} catch (error) {
			if ((error instanceof Error && "code" in error ? error.code : void 0) !== "EEXIST") throw error;
		}
		return {
			evidenceId,
			path
		};
	}
	runDirectory(workspaceId, runId) {
		return join(this.stateRoot, "workspaces", workspaceId, "runs", runId);
	}
	static async workspaceId(workspacePath) {
		return createHash("sha256").update(await realpath(resolve(workspacePath))).digest("hex").slice(0, 20);
	}
};
async function findConfig(workspacePath) {
	let directory = await realpath(resolve(workspacePath));
	while (true) {
		const candidate = join(directory, "harness.yaml");
		try {
			await access(candidate);
			return candidate;
		} catch {
			const parent = dirname(directory);
			invariant(parent !== directory, "CONFIG_NOT_FOUND", `No harness.yaml found from '${workspacePath}' upward`);
			directory = parent;
		}
	}
}
//#endregion
//#region src/mcp/server.ts
const VERSION = version;
const eventTypes = [
	"run.created",
	"workflow.selected",
	"stage.started",
	"stage.completed",
	"node.ready",
	"node.started",
	"node.succeeded",
	"node.failed",
	"node.blocked",
	"node.cancelled",
	"node.skipped",
	"node.interrupted",
	"resource.activated",
	"resource.feedback.recorded",
	"evidence.recorded",
	"decision.recorded",
	"run.completed",
	"retrospective.generated",
	"resource.change.proposed",
	"resource.change.accepted",
	"resource.change.rejected"
];
function result(value) {
	return {
		content: [{
			type: "text",
			text: JSON.stringify(value, null, 2)
		}],
		structuredContent: value
	};
}
async function configFor(workspacePath, configPath) {
	const path = configPath ? resolve(workspacePath, configPath) : await findConfig(workspacePath);
	return {
		path,
		config: await loadHarnessConfig(path)
	};
}
function createHarnessServer() {
	const server = new McpServer({
		name: "deweyou-harness",
		version: VERSION
	});
	server.registerTool("config_inspect", {
		description: "Load and validate harness.yaml, imports, workflow inheritance, resource references, and stage DAGs.",
		inputSchema: z.object({
			workspacePath: z.string(),
			configPath: z.string().optional()
		})
	}, async ({ workspacePath, configPath }) => {
		const loaded = await configFor(workspacePath, configPath);
		return result({
			configPath: loaded.path,
			workflows: selectableWorkflows(loaded.config),
			sourceFiles: loaded.config.sourceFiles
		});
	});
	server.registerTool("run_create", {
		description: "Create a durable Harness Run bundle after the controller has selected a workflow.",
		inputSchema: z.object({
			workspacePath: z.string(),
			configPath: z.string().optional(),
			workflowId: z.string(),
			request: z.record(z.string(), z.unknown()),
			hostSessionId: z.string().optional()
		})
	}, async ({ workspacePath, configPath, workflowId, request, hostSessionId }) => {
		const { config } = await configFor(workspacePath, configPath);
		return result(await new RunStore().createRun({
			workspacePath,
			workflowId,
			request,
			config,
			...hostSessionId ? { hostSessionId } : {}
		}));
	});
	server.registerTool("run_get", {
		description: "Read and verify the authoritative event chain, then rebuild the Run projection.",
		inputSchema: z.object({
			workspacePath: z.string(),
			runId: z.string(),
			recoverInterrupted: z.boolean().default(false),
			hostSessionId: z.string().optional()
		})
	}, async ({ workspacePath, runId, recoverInterrupted, hostSessionId }) => {
		const store = new RunStore();
		const workspaceId = await RunStore.workspaceId(workspacePath);
		if (hostSessionId) await store.attachHostSession(workspaceId, runId, hostSessionId);
		return result(recoverInterrupted ? await store.recoverInterrupted(workspaceId, runId, randomUUID()) : await store.rebuildProjection(workspaceId, runId));
	});
	server.registerTool("event_append", {
		description: "Append one validated, hash-chained lifecycle event. Repeated attempts always use new nodeExecutionId values.",
		inputSchema: z.object({
			workspacePath: z.string(),
			runId: z.string(),
			type: z.enum(eventTypes),
			traceId: z.string(),
			spanId: z.string(),
			parentSpanId: z.string().optional(),
			idempotencyKey: z.string().optional(),
			timestamp: z.string().optional(),
			payload: z.record(z.string(), z.unknown())
		})
	}, async ({ workspacePath, runId, parentSpanId, idempotencyKey, timestamp, ...required }) => {
		const workspaceId = await RunStore.workspaceId(workspacePath);
		const input = {
			...required,
			...parentSpanId ? { parentSpanId } : {},
			...idempotencyKey ? { idempotencyKey } : {},
			...timestamp ? { timestamp } : {}
		};
		return result(await new RunStore().appendEvent(workspaceId, runId, input));
	});
	server.registerTool("retrospective_get", {
		description: "Read the automatic post-delivery retrospective and its actionable resource improvement proposals.",
		inputSchema: z.object({
			workspacePath: z.string(),
			runId: z.string()
		})
	}, async ({ workspacePath, runId }) => {
		const workspaceId = await RunStore.workspaceId(workspacePath);
		return result(await new RunStore().getRetrospective(workspaceId, runId));
	});
	server.registerTool("proposal_decide", {
		description: "Record the user decision for a resource proposal. Acceptance authorizes a separate maintenance Run, not direct mutation.",
		inputSchema: z.object({
			workspacePath: z.string(),
			runId: z.string(),
			proposalId: z.string(),
			decision: z.enum(["accepted", "rejected"]),
			traceId: z.string(),
			spanId: z.string(),
			reason: z.string().optional()
		})
	}, async ({ workspacePath, runId, proposalId, decision, traceId, spanId, reason }) => {
		const workspaceId = await RunStore.workspaceId(workspacePath);
		return result(await new RunStore().decideProposal(workspaceId, runId, proposalId, decision, traceId, spanId, reason));
	});
	server.registerTool("ready_nodes", {
		description: "Return all currently ready same-stage DAG nodes so the controller can dispatch independent nodes in parallel.",
		inputSchema: z.object({
			workspacePath: z.string(),
			configPath: z.string().optional(),
			workflowId: z.string(),
			stage: z.enum(STAGES),
			completed: z.array(z.string()).default([]),
			started: z.array(z.string()).default([])
		})
	}, async ({ workspacePath, configPath, workflowId, stage, completed, started }) => {
		const { config } = await configFor(workspacePath, configPath);
		return result(readyWorkflowNodes(config, workflowId, stage, new Set(completed), new Set(started)));
	});
	server.registerTool("resources_dispatch", {
		description: "Progressively load workflow rules, knowledge metadata, node skills, or an explicitly requested resource.",
		inputSchema: z.discriminatedUnion("scope", [
			z.object({
				scope: z.literal("workflow"),
				workspacePath: z.string(),
				configPath: z.string().optional(),
				workflowId: z.string(),
				runId: z.string().optional()
			}),
			z.object({
				scope: z.literal("node"),
				workspacePath: z.string(),
				configPath: z.string().optional(),
				nodeId: z.string(),
				runId: z.string().optional()
			}),
			z.object({
				scope: z.literal("resource"),
				workspacePath: z.string(),
				configPath: z.string().optional(),
				resourceId: z.string(),
				mode: z.enum(["full", "metadata"]),
				runId: z.string().optional()
			})
		])
	}, async (input) => {
		const { config } = await configFor(input.workspacePath, input.configPath);
		const receipts = input.scope === "workflow" ? await dispatchWorkflowContext(config, input.workflowId, input.workspacePath) : input.scope === "node" ? await dispatchNodeSkills(config, input.nodeId, input.workspacePath) : [await dispatchResource(config, input.resourceId, input.mode, input.workspacePath)];
		if (input.runId) {
			const workspaceId = await RunStore.workspaceId(input.workspacePath);
			await new RunStore().updateResourceLock(workspaceId, input.runId, receipts);
		}
		return result(receipts);
	});
	server.registerTool("run_rehydrate", {
		description: "Build the mandatory resource redispatch plan after compaction, handoff, or resume.",
		inputSchema: z.object({
			workspacePath: z.string(),
			configPath: z.string().optional(),
			workflowId: z.string(),
			currentNodeIds: z.array(z.string()).default([]),
			activatedResources: z.array(z.string()).default([])
		})
	}, async ({ workspacePath, configPath, workflowId, currentNodeIds, activatedResources }) => {
		const { config } = await configFor(workspacePath, configPath);
		return result(buildRehydrationPlan(config, workflowId, currentNodeIds, activatedResources));
	});
	server.registerTool("evidence_record", {
		description: "Persist content-addressed evidence and append its lifecycle event without recording secrets or raw unrelated chat.",
		inputSchema: z.object({
			workspacePath: z.string(),
			runId: z.string(),
			traceId: z.string(),
			spanId: z.string(),
			content: z.string(),
			summary: z.string()
		})
	}, async ({ workspacePath, runId, traceId, spanId, content, summary }) => {
		const store = new RunStore();
		const workspaceId = await RunStore.workspaceId(workspacePath);
		const evidence = await store.writeEvidence(workspaceId, runId, content);
		await store.appendEvent(workspaceId, runId, {
			type: "evidence.recorded",
			traceId,
			spanId,
			payload: {
				evidenceId: evidence.evidenceId,
				summary,
				path: evidence.path
			}
		});
		return result(evidence);
	});
	return server;
}
if (import.meta.url === `file://${process.argv[1]}`) await serveStdio(() => createHarnessServer());
//#endregion
export { createHarnessServer };
