import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { AutocompleteItem } from "@earendil-works/pi-tui"
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { getAgentDir } from "@earendil-works/pi-coding-agent"

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

function buildRuntime(cwd: string, agent: string): AgentRuntime {
	const name = sanitizeAgentName(agent)
	const root = path.join(AGENT_ROOT, name)
	const kbDir = path.join(root, "kb")
	const stateDir = path.join(root, "state")
	const initDir = path.join(cwd, "skills", "agent-roam", "init")
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

async function waitForDaemonReady(runtime: AgentRuntime, tries = 20, delayMs = 100) {
	for (let i = 0; i < tries; i++) {
		const check = run("emacsclient", ["-s", runtime.socket, "--eval", "t"])
		if (check.status === 0)
			return true
		await new Promise(resolve => setTimeout(resolve, delayMs))
	}
	return false
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

function readSystemTaggedNotes(runtime: AgentRuntime) {
	const lisp = "(let ((xs (agent-memory-find-by-tag \"system\"))) (princ (mapconcat #'identity xs \"\\n\")))"
	const out = emacsEval(runtime, lisp).replace(/^"|"$/g, "")
	const files = out.split("\n").map(s => s.trim()).filter(Boolean)
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
	const out = emacsEval(runtime, "(princ (mapconcat #'identity (agent-memory-list-tags) \" \"))").replace(/^"|"$/g, "")
	return out.trim()
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

	const env = {
		...process.env,
		AGENT_ROAM_KB_DIR: runtime.kbDir,
		AGENT_ROAM_STATE_DIR: runtime.stateDir,
		AGENT_EMACS_SOCKET: runtime.socket,
		AGENT_ROAM_REFLECTION_CHILD: "1",
	}
	const safeSource = sanitizeAgentName(sourceSessionName || "session")
	const runName = `agent-roam-reflection-${runtime.agent}-from-${safeSource}-${Date.now()}`
	const instruction = [
		reflectionPrompt,
		"",
		"Reflect now over inherited session context and update durable memory with tools.",
	].join("\n")
	const args = ["-p", "--fork", sourceSessionFile, `/name ${runName}`, instruction]
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
	let selectedAgent = "default"

	function startSessionRuntime(cwd: string) {
		if (runtime)
			stopDaemon(runtime)
		runtime = buildRuntime(cwd, selectedAgent)
		applyEnv(runtime)
		ensureDaemon(runtime)
		return runtime
	}

	function updateRoamAgentStatus(currentAgent: string, ctx: ExtensionContext) {
		ctx.ui.setStatus("agent-roam-agent", ctx.ui.theme.fg("dim", `roam agent: ${currentAgent}`))
	}

	pi.on("resources_discover", async (event) => {
		return {
			skillPaths: [path.join(event.cwd, "skills")],
		}
	})

	pi.on("session_start", async (_event, ctx) => {
		try {
			const rt = startSessionRuntime(ctx.cwd)
			ctx.ui.notify(`agent-roam ready | agent=${rt.agent} | socket=${rt.socket}`, "info")
			updateRoamAgentStatus(rt.agent, ctx)
		} catch (error) {
			ctx.ui.notify(`agent-roam bootstrap failed: ${(error as Error).message}`, "error")
		}
	})

	pi.on("before_agent_start", async (event, ctx) => {
		try {
			const rt = runtime ?? startSessionRuntime(ctx.cwd)
			const ready = await waitForDaemonReady(rt)
			if (!ready)
				throw new Error("emacs daemon not ready")
			const skill = readSkillText()
			const notes = readSystemTaggedNotes(rt)
			const tags = readTagList(rt)
			const content = [
				"# Agent-roam injected context",
				skill ? `\n## Skill\n${skill}` : "",
				"\n## KB git repo\nAGENT_ROAM_KB_DIR is always a git repo in this extension. Follow skill \"Git sync (optional)\" steps after memory edits and org-roam DB sync.",
				tags ? `\n## Tag list\n${tags.split(/\\s+/).filter(Boolean).map(tag => `- \`${tag}\``).join("\\n")}` : "\n## Tag list\n(none)",
				notes.length ? `\n## System-tagged notes\n${notes.join("\n\n")}` : "\n## System-tagged notes\n(none)",
			].join("\n")
			return {
				systemPrompt: `${event.systemPrompt}\n\n${content}`,
			}
		} catch (error) {
			ctx.ui.notify(`agent-roam inject failed: ${(error as Error).message}`, "error")
		}
	})

	pi.on("session_before_compact", async (_event, ctx) => {
		if (process.env.AGENT_ROAM_REFLECTION_CHILD === "1")
			return { cancel: true }
		try {
			const rt = runtime ?? startSessionRuntime(ctx.cwd)
			const ready = await waitForDaemonReady(rt)
			if (!ready)
				throw new Error("emacs daemon not ready")
			const modelRef = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined
			const result = launchReflectionSubagent(rt, ctx, pi.getSessionName() || "session", ctx.sessionManager.getSessionFile(), modelRef)
			if (result.status === "launched")
				ctx.ui.notify(result.message, "info")
			else
				ctx.ui.notify(`agent-roam reflection skipped: ${result.message}`, "warning")
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
	})

	pi.registerCommand("agent", {
		description: "Switch agent-roam memory agent: /agent <name>",
		getArgumentCompletions: prefix => getAgentCompletions(prefix, selectedAgent),
		handler: async (args, ctx) => {
			selectedAgent = sanitizeAgentName(args || "default")
			runtime = startSessionRuntime(ctx.cwd)
			ctx.ui.notify(`agent-roam switched to ${runtime.agent} | socket=${runtime.socket}`, "info")
			updateRoamAgentStatus(runtime.agent, ctx)
		},
	})

	pi.registerCommand("reflect", {
		description: "Launch background memory reflection subagent",
		handler: async (_args, ctx) => {
			try {
				const rt = runtime ?? startSessionRuntime(ctx.cwd)
				const ready = await waitForDaemonReady(rt)
				if (!ready)
					throw new Error("emacs daemon not ready")
				const modelRef = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined
				const result = launchReflectionSubagent(rt, ctx, pi.getSessionName() || "session", ctx.sessionManager.getSessionFile(), modelRef)
				if (result.status === "launched")
					ctx.ui.notify(result.message, "info")
				else
					ctx.ui.notify(`agent-roam reflection skipped: ${result.message}`, "warning")
			} catch (error) {
				ctx.ui.notify(`agent-roam reflect failed: ${(error as Error).message}`, "error")
			}
		},
	})
}
