import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
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

function getAgentCompletions(prefix: string): AutocompleteItem[] | null {
	const p = prefix.trim()
	const items = listAgentNames()
		.filter(name => name.startsWith(p))
		.map(name => ({ value: name, label: name }))
	if (p.length > 0 && !items.some(i => i.value === p)) {
		items.unshift({ value: p, label: `${p} (new)` })
	}
	return items.length > 0 ? items : (p ? [{ value: p, label: `${p} (new)` }] : null)
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

	pi.on("resources_discover", async (event) => {
		return {
			skillPaths: [path.join(event.cwd, "skills")],
		}
	})

	pi.on("session_start", async (_event, ctx) => {
		try {
			const rt = startSessionRuntime(ctx.cwd)
			ctx.ui.notify(`agent-roam ready | agent=${rt.agent} | socket=${rt.socket}`, "info")
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

	pi.on("session_shutdown", async () => {
		if (!runtime)
			return
		stopDaemon(runtime)
		runtime = null
	})

	pi.registerCommand("agent", {
		description: "Switch agent-roam memory agent: /agent <name>",
		getArgumentCompletions: prefix => getAgentCompletions(prefix),
		handler: async (args, ctx) => {
			selectedAgent = sanitizeAgentName(args || "default")
			runtime = startSessionRuntime(ctx.cwd)
			ctx.ui.notify(`agent-roam switched to ${runtime.agent} | socket=${runtime.socket}`, "info")
		},
	})
}
