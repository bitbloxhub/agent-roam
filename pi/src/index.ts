import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { AutocompleteItem } from "@earendil-works/pi-tui"
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent"
import { z } from "zod"

interface AgentRuntime {
	agent: string
	kbDir: string
	stateDir: string
	initDir: string
	socket: string
}

const MAX_NOTE_BYTES = 24_000
const PI_AGENT_DIR = getAgentDir()
const AGENT_ROOT = path.join(PI_AGENT_DIR, "..", "agent-roam")
const LAST_AGENT_FILE = path.join(AGENT_ROOT, ".last-agent")
const SESSION_AGENT_CUSTOM_TYPE = "agent-roam:selected-agent"

function sanitizeAgentName(raw: string) {
	return raw.trim().replace(/[^\w.-]/g, "-") || "default"
}

function listAgentNames() {
	if (!existsSync(AGENT_ROOT))
		return [] as string[]
	return readdirSync(AGENT_ROOT, { withFileTypes: true })
		.filter(d => d.isDirectory())
		.map(d => d.name)
		.sort()
}

function readLastSelectedAgent() {
	if (!existsSync(LAST_AGENT_FILE))
		return undefined
	const raw = readFileSync(LAST_AGENT_FILE, "utf8").trim()
	if (!raw)
		return undefined
	return sanitizeAgentName(raw)
}

function writeLastSelectedAgent(agent: string) {
	mkdirSync(AGENT_ROOT, { recursive: true })
	writeFileSync(LAST_AGENT_FILE, `${sanitizeAgentName(agent)}\n`, "utf8")
}

function getAgentFromSessionEntries(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>) {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type: string, customType?: string, data?: unknown }
		if (entry.type !== "custom" || entry.customType !== SESSION_AGENT_CUSTOM_TYPE)
			continue
		const data = entry.data as { agent?: string } | undefined
		if (typeof data?.agent === "string" && data.agent.trim())
			return sanitizeAgentName(data.agent)
	}
	return undefined
}

function appendSessionAgent(sessionFile: string | undefined, sessionDir: string, agent: string) {
	if (!sessionFile)
		return
	const manager = SessionManager.open(sessionFile, sessionDir)
	manager.appendCustomEntry(SESSION_AGENT_CUSTOM_TYPE, { agent: sanitizeAgentName(agent) })
}

function buildRuntime(agent: string): AgentRuntime {
	const name = sanitizeAgentName(agent)
	const root = path.join(AGENT_ROOT, name)
	const kbDir = path.join(root, "kb")
	const stateDir = path.join(root, "state")
	const initDir = path.join(PI_AGENT_DIR, "skills", "agent-roam", "init")
	const socket = `agent-memory-${randomUUID().slice(0, 8)}`
	return { agent: name, kbDir, stateDir, initDir, socket }
}

function applyEnv(runtime: AgentRuntime) {
	process.env.AGENT_ROAM_KB_DIR = runtime.kbDir
	process.env.AGENT_ROAM_STATE_DIR = runtime.stateDir
	process.env.AGENT_EMACS_SOCKET = runtime.socket
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
	return spawnSync(cmd, args, {
		encoding: "utf8",
		env: env ?? process.env,
	})
}

function runBackground(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
	const child = spawn(cmd, args, {
		env: env ?? process.env,
		detached: true,
		stdio: "ignore",
	})
	child.unref()
}

function ensureGitRepo(kbDir: string) {
	const check = run("git", ["-C", kbDir, "rev-parse", "--is-inside-work-tree"])
	if (check.status === 0)
		return
	const init = run("git", ["-C", kbDir, "init"])
	if (init.status !== 0) {
		throw new Error(init.stderr || init.stdout || "failed to init kb git repo")
	}
}

function ensureDaemon(runtime: AgentRuntime) {
	mkdirSync(runtime.kbDir, { recursive: true })
	mkdirSync(runtime.stateDir, { recursive: true })
	ensureGitRepo(runtime.kbDir)

	const check = run("emacsclient", ["-s", runtime.socket, "--eval", "t"])
	if (check.status === 0)
		return

	const env = {
		...process.env,
		AGENT_ROAM_KB_DIR: runtime.kbDir,
		AGENT_ROAM_STATE_DIR: runtime.stateDir,
	}
	runBackground(
		"emacs",
		["--init-directory", runtime.initDir, `--daemon=${runtime.socket}`],
		env,
	)
}

async function waitForDaemonReady(runtime: AgentRuntime, tries = 40, delayMs = 100) {
	for (let i = 0; i < tries; i++) {
		const ping = run("emacsclient", ["-s", runtime.socket, "--eval", "t"])
		if (ping.status === 0)
			return { ok: true, reason: "ok", semanticReady: true } as const
		await new Promise(resolve => setTimeout(resolve, delayMs))
	}
	return { ok: false, reason: "socket-unreachable", semanticReady: false } as const
}

function stopDaemon(runtime: AgentRuntime) {
	run("emacsclient", ["-s", runtime.socket, "--eval", "(kill-emacs)"])
}

function emacsEval(runtime: AgentRuntime, expr: string) {
	const result = run("emacsclient", ["-s", runtime.socket, "--eval", expr])
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || "emacsclient eval failed")
	}
	return (result.stdout || "").trim()
}

function readSkillText() {
	const skillPath = path.join(PI_AGENT_DIR, "skills", "agent-roam", "SKILL.md")
	if (!existsSync(skillPath))
		return ""
	return readFileSync(skillPath, "utf8")
}

function parseJsonStringArray(raw: string) {
	let parsed: unknown = JSON.parse(raw)
	if (typeof parsed === "string")
		parsed = JSON.parse(parsed)
	if (!Array.isArray(parsed))
		return [] as string[]
	return parsed.filter((x): x is string => typeof x === "string")
}

function readSystemTaggedNotes(runtime: AgentRuntime) {
	const out = emacsEval(runtime, "(princ (json-encode (agent-memory-find-by-tag \"system\")))")
	const files = parseJsonStringArray(out)
	const notes: string[] = []
	for (const file of files) {
		if (!existsSync(file))
			continue
		const text = readFileSync(file, "utf8")
		notes.push(`### ${path.basename(file)}\n${text.slice(0, MAX_NOTE_BYTES)}`)
	}
	return notes
}

function readTagList(runtime: AgentRuntime) {
	const out = emacsEval(runtime, "(princ (json-encode (agent-memory-list-tags)))")
	return parseJsonStringArray(out)
}

function launchReflectionSubagent(
	runtime: AgentRuntime,
	ctx: ExtensionContext,
	sourceSessionName: string,
	sourceSessionFile: string | undefined,
	modelId?: string,
) {
	const reflectionPromptPath = path.join(PI_AGENT_DIR, "skills", "agent-roam", "reflection.md")
	if (!existsSync(reflectionPromptPath))
		return { status: "skipped", message: `missing reflection prompt: ${reflectionPromptPath}` } as const
	const reflectionPrompt = readFileSync(reflectionPromptPath, "utf8").trim()
	if (!reflectionPrompt)
		return { status: "skipped", message: "empty reflection prompt" } as const
	if (!sourceSessionFile)
		return { status: "skipped", message: "source session file unavailable" } as const

	const safeSource = sanitizeAgentName(sourceSessionName || "session")
	const runName = `agent-roam-reflection-${runtime.agent}-from-${safeSource}-${Date.now()}`
	const forkedSession = SessionManager.forkFrom(
		sourceSessionFile,
		ctx.sessionManager.getCwd(),
		ctx.sessionManager.getSessionDir(),
	)
	forkedSession.appendSessionInfo(runName)
	const reflectionSessionFile = forkedSession.getSessionFile()
	if (!reflectionSessionFile)
		return { status: "skipped", message: "failed to create reflection session" } as const

	const env = {
		...process.env,
		AGENT_ROAM_KB_DIR: runtime.kbDir,
		AGENT_ROAM_STATE_DIR: runtime.stateDir,
		AGENT_EMACS_SOCKET: runtime.socket,
		AGENT_ROAM_REFLECTION_CHILD: "1",
	}
	const instruction = [
		reflectionPrompt,
		"",
		"Reflect now over inherited session context and update durable memory with tools.",
	].join("\n")
	const args = ["-p", "--session", reflectionSessionFile, instruction]
	if (modelId)
		args.push("--model", modelId)
	const child = spawn("pi", args, {
		env,
		stdio: "ignore",
	})
	child.on("error", (error) => {
		ctx.ui.notify(`reflection failed to launch (${runName}): ${error.message}`, "warning")
	})
	child.on("exit", (code) => {
		if (code === 0)
			ctx.ui.notify(`reflection completed (${runName})`, "info")
		else
			ctx.ui.notify(`reflection failed (${runName}), exit=${code ?? "signal"}`, "warning")
	})
	return { status: "launched", message: `reflection launched (${runName})` } as const
}

const agentRoamSettingsSchema = z.object({
	reflection: z.object({
		onCompaction: z.boolean().default(true),
	}).prefault({}),
})

type AgentRoamSettings = z.infer<typeof agentRoamSettingsSchema>

let cachedSettings: AgentRoamSettings | null = null

function readAgentRoamSettings(): AgentRoamSettings {
	if (cachedSettings)
		return cachedSettings

	const fallback = () => agentRoamSettingsSchema.parse({})

	try {
		const settingsPath = path.join(PI_AGENT_DIR, "settings.json")
		if (!existsSync(settingsPath)) {
			cachedSettings = fallback()
			return cachedSettings
		}

		const raw = JSON.parse(readFileSync(settingsPath, "utf8")) as { agentRoam?: unknown }
		cachedSettings = agentRoamSettingsSchema.parse(raw.agentRoam ?? {})
		return cachedSettings
	} catch {
		cachedSettings = fallback()
		return cachedSettings
	}
}

function getAgentCompletions(prefix: string, currentAgent: string): AutocompleteItem[] | null {
	const p = prefix.trim()
	const items = listAgentNames()
		.filter(name => name.startsWith(p))
		.map(name => ({
			value: name,
			label: name === currentAgent ? `${name} (current)` : name,
		}))
	return items.length > 0 ? items : null
}

export default function (pi: ExtensionAPI) {
	let runtime: AgentRuntime | null = null
	let selectedAgent = readLastSelectedAgent() ?? "default"
	let cachedPatchedPrompt: string | null = null
	let cachedBasePrompt: string | null = null
	let promptCacheDirty = true

	function invalidatePromptCache() {
		cachedPatchedPrompt = null
		cachedBasePrompt = null
		promptCacheDirty = true
	}

	function startSessionRuntime() {
		if (runtime)
			stopDaemon(runtime)
		runtime = buildRuntime(selectedAgent)
		applyEnv(runtime)
		ensureDaemon(runtime)
		return runtime
	}

	function updateRoamAgentStatus(currentAgent: string, ctx: ExtensionContext) {
		ctx.ui.setStatus("agent-roam-agent", ctx.ui.theme.fg("dim", `roam agent: ${currentAgent}`))
	}

	function syncSelectedAgentFromSession(ctx: ExtensionContext) {
		const sessionAgent = getAgentFromSessionEntries(ctx.sessionManager.getEntries())
		const nextAgent = sessionAgent ?? readLastSelectedAgent() ?? selectedAgent
		if (nextAgent !== selectedAgent)
			invalidatePromptCache()
		selectedAgent = nextAgent
		writeLastSelectedAgent(selectedAgent)
		if (!sessionAgent)
			appendSessionAgent(ctx.sessionManager.getSessionFile(), ctx.sessionManager.getSessionDir(), selectedAgent)
	}

	async function buildInjectedContext() {
		const rt = runtime ?? startSessionRuntime()
		const health = await waitForDaemonReady(rt)
		if (!health.ok)
			throw new Error(`emacs daemon not ready (${health.reason}) socket=${rt.socket}`)
		const skill = readSkillText()
		let notes: string[] = []
		let tags: string[] = []
		try {
			notes = readSystemTaggedNotes(rt)
		} catch {}
		try {
			tags = readTagList(rt)
		} catch {}
		return [
			"# Agent-roam injected context",
			skill ? `\n## Skill\n${skill}` : "",
			"\n## KB git repo\nAGENT_ROAM_KB_DIR is always a git repo in this extension. Follow skill \"Git sync (optional)\" steps after memory edits and org-roam DB sync.",
			tags.length ? `\n## Tag list\n${tags.map(tag => `- \`${tag}\``).join("\n")}` : "\n## Tag list\n(none)",
			notes.length ? `\n## System-tagged notes\n${notes.join("\n\n")}` : "\n## System-tagged notes\n(none)",
		].join("\n")
	}

	async function runReflection(ctx: ExtensionContext) {
		const rt = runtime ?? startSessionRuntime()
		const health = await waitForDaemonReady(rt)
		if (!health.ok)
			throw new Error(`emacs daemon not ready (${health.reason}) socket=${rt.socket}`)
		const modelRef = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined
		const result = launchReflectionSubagent(rt, ctx, pi.getSessionName() || "session", ctx.sessionManager.getSessionFile(), modelRef)
		if (result.status === "launched") {
			ctx.ui.notify(result.message, "info")
			return
		}
		ctx.ui.notify(`agent-roam reflection skipped: ${result.message}`, "warning")
	}

	function getRoamStatusLines(ctx: ExtensionContext) {
		const rt = runtime ?? buildRuntime(selectedAgent)
		const daemonCheck = run("emacsclient", ["-s", rt.socket, "--eval", "t"])
		const emacsclientCheck = run("emacsclient", ["--version"])
		const sessionFile = ctx.sessionManager.getSessionFile()
		const sessionAgent = getAgentFromSessionEntries(ctx.sessionManager.getEntries()) ?? "(none)"
		const lastAgent = readLastSelectedAgent() ?? "(none)"
		return [
			`agent=${selectedAgent}`,
			`runtime.agent=${rt.agent}`,
			`session.agent=${sessionAgent}`,
			`last-agent=${lastAgent}`,
			`daemon.ready=${daemonCheck.status === 0 ? "yes" : "no"}`,
			`emacsclient=${emacsclientCheck.status === 0 ? "ok" : "missing"}`,
			`kb.dir=${rt.kbDir} (${existsSync(rt.kbDir) ? "ok" : "missing"})`,
			`state.dir=${rt.stateDir} (${existsSync(rt.stateDir) ? "ok" : "missing"})`,
			`socket=${rt.socket}`,
			`session.name=${ctx.sessionManager.getSessionName() ?? "(none)"}`,
			`session.id=${ctx.sessionManager.getSessionId()}`,
			`session.file=${sessionFile ?? "(none)"}`,
		]
	}

	pi.on("session_start", async (_event, ctx) => {
		invalidatePromptCache()
		try {
			syncSelectedAgentFromSession(ctx)
			const rt = startSessionRuntime()
			ctx.ui.notify(`agent-roam bootstrapping | agent=${rt.agent} | socket=${rt.socket}`, "info")
			updateRoamAgentStatus(rt.agent, ctx)
		} catch (error) {
			ctx.ui.notify(`agent-roam bootstrap failed: ${(error as Error).message}`, "error")
		}
	})

	pi.on("before_agent_start", async (event, ctx) => {
		try {
			syncSelectedAgentFromSession(ctx)
			if (!promptCacheDirty && cachedPatchedPrompt && cachedBasePrompt === event.systemPrompt)
				return { systemPrompt: cachedPatchedPrompt }
			const injectedContext = await buildInjectedContext()
			cachedBasePrompt = event.systemPrompt
			cachedPatchedPrompt = `${event.systemPrompt}\n\n${injectedContext}`
			promptCacheDirty = false
			return {
				systemPrompt: cachedPatchedPrompt,
			}
		} catch (error) {
			ctx.ui.notify(`agent-roam inject failed: ${(error as Error).message}`, "error")
		}
	})

	pi.on("session_compact", async () => {
		invalidatePromptCache()
	})

	pi.on("session_before_compact", async (_event, ctx) => {
		if (process.env.AGENT_ROAM_REFLECTION_CHILD === "1")
			return { cancel: true }
		const settings = readAgentRoamSettings()
		if (!settings.reflection.onCompaction)
			return
		try {
			await runReflection(ctx)
		} catch (error) {
			ctx.ui.notify(`agent-roam reflection failed: ${(error as Error).message}`, "warning")
		}
	})

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("agent-roam-agent", undefined)
		if (!runtime)
			return
		stopDaemon(runtime)
		runtime = null
		invalidatePromptCache()
	})

	pi.registerCommand("agent", {
		description: "Switch agent-roam memory agent: /agent <name>",
		getArgumentCompletions: prefix => getAgentCompletions(prefix, selectedAgent),
		handler: async (args, ctx) => {
			invalidatePromptCache()
			selectedAgent = sanitizeAgentName(args || "default")
			writeLastSelectedAgent(selectedAgent)
			appendSessionAgent(ctx.sessionManager.getSessionFile(), ctx.sessionManager.getSessionDir(), selectedAgent)
			runtime = startSessionRuntime()
			ctx.ui.notify(`agent-roam switched to ${runtime.agent} | socket=${runtime.socket}`, "info")
			updateRoamAgentStatus(runtime.agent, ctx)
		},
	})

	pi.registerCommand("roam-status", {
		description: "Show agent-roam runtime and health status",
		handler: async (_args, ctx) => {
			try {
				syncSelectedAgentFromSession(ctx)
				const lines = getRoamStatusLines(ctx)
				ctx.ui.notify(`agent-roam status\n${lines.join("\n")}`, "info")
			} catch (error) {
				ctx.ui.notify(`agent-roam status failed: ${(error as Error).message}`, "error")
			}
		},
	})

	pi.registerCommand("reflect", {
		description: "Launch background memory reflection subagent",
		handler: async (_args, ctx) => {
			try {
				await runReflection(ctx)
			} catch (error) {
				ctx.ui.notify(`agent-roam reflect failed: ${(error as Error).message}`, "error")
			}
		},
	})
}
