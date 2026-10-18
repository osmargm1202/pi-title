import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { isOrgmExtensionEnabled } from "./lib/orgm-extension-config.ts";
import { loadOrgmConfigSlice, saveOrgmConfigSlice } from "./lib/orgm-config.ts";
import {
	parseTitleCommand,
	sanitizeTitle,
	SESSION_TITLE_ENTRY_TYPE,
	SPINNER_FRAMES,
	TITLE_STATE_EVENT,
	type TitleStatus,
} from "./lib/minimal-title.ts";

const ENTRY_TYPE = SESSION_TITLE_ENTRY_TYPE;
const SPINNER_INTERVAL_MS = 100;

const TITLE_SYSTEM_PROMPT = `Generate a concise title for this Pi coding session.

Rules:
- Return only the title, no quotes and no explanation.
- Use the same language as the user's request when obvious.
- Maximum 6 words.
- No trailing punctuation unless it is part of a name.
- Prefer useful task-specific titles over generic titles.`;

type TitleSource = "initial" | "regen" | "manual";
type TitleEntry = {
	title?: string;
	source?: TitleSource;
	createdAt?: number;
	error?: string;
};

function extractLastSavedTitle(ctx: ExtensionContext): string | undefined {
	const saved = ctx.sessionManager
		.getBranch()
		.filter((entry): entry is SessionEntry & { customType: string; data?: TitleEntry } =>
			entry.type === "custom" && entry.customType === ENTRY_TYPE,
		)
		.pop();
	return saved?.data?.title ? sanitizeTitle(saved.data.title) : undefined;
}

function getTextFromResponse(response: { content?: Array<{ type: string; text?: string }> }): string {
	return sanitizeTitle(
		(response.content ?? [])
			.filter((content): content is { type: "text"; text: string } => content.type === "text" && typeof content.text === "string")
			.map((content) => content.text)
			.join(" "),
	);
}

function buildConversationPrompt(ctx: ExtensionContext, fallbackPrompt?: string): string {
	const { messages } = ctx.sessionManager.buildSessionProjection();
	if (messages.length === 0) return fallbackPrompt ?? "";
	const serialized = serializeConversation(convertToLlm(messages)).trim();
	return serialized || fallbackPrompt || "";
}

async function generateTitle(ctx: ExtensionContext, promptText: string, signal: AbortSignal): Promise<string> {
	// Capture the selection before any asynchronous work. The host handles virtual
	// routing, provider authentication (including ambient auth), headers and env.
	const model = ctx.model;
	if (!model) throw new Error("No model selected");
	signal.throwIfAborted();
	const userMessage: Message = {
		role: "user",
		content: [{ type: "text", text: promptText }],
		timestamp: Date.now(),
	};
	const response = await ctx.modelRegistry.streamSimple(
		model,
		{ systemPrompt: TITLE_SYSTEM_PROMPT, messages: [userMessage] },
		{ signal, cacheRetention: "none" },
	).result();
	signal.throwIfAborted();
	if (response.stopReason !== "stop" && response.stopReason !== "length") {
		throw new Error(response.errorMessage || `Title generation ended with ${response.stopReason}`);
	}
	const title = getTextFromResponse(response);
	if (!title) throw new Error("Empty title generated");
	return title;
}

export default function titleExtension(pi: ExtensionAPI) {
	if (!isOrgmExtensionEnabled("title")) return;

	let status: TitleStatus = { state: "idle" };
	let spinnerTimer: ReturnType<typeof setInterval> | undefined;
	let spinnerIndex = 0;
	let generation: AbortController | null = null;
	let autoAttempted = false;
	let pendingAutoPrompt: string | undefined;
	let autoGenerate = loadOrgmConfigSlice("title").autoGenerate;

	const emitTitleState = () => {
		pi.events.emit(TITLE_STATE_EVENT, status);
	};

	const stopSpinner = () => {
		if (spinnerTimer) clearInterval(spinnerTimer);
		spinnerTimer = undefined;
	};

	const startSpinner = () => {
		stopSpinner();
		spinnerIndex = 0;
		spinnerTimer = setInterval(() => {
			spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
			if (status.state === "generating") {
				status = { ...status, frame: SPINNER_FRAMES[spinnerIndex] };
				emitTitleState();
			}
		}, SPINNER_INTERVAL_MS);
	};

	const cancelGeneration = () => {
		pendingAutoPrompt = undefined;
		const controller = generation;
		generation = null;
		controller?.abort();
		stopSpinner();
	};

	const setTitle = (title: string, source: TitleSource) => {
		const clean = sanitizeTitle(title);
		if (!clean) return false;
		status = { state: "ready", title: clean };
		stopSpinner();
		pi.appendEntry(ENTRY_TYPE, { title: clean, source, createdAt: Date.now() });
		pi.setSessionName(clean);
		emitTitleState();
		return true;
	};

	const startGeneration = (ctx: ExtensionContext, promptText: string, source: "initial" | "regen") => {
		if (!ctx.hasUI || !ctx.model || ctx.signal?.aborted) return false;
		cancelGeneration();
		const controller = new AbortController();
		const signal = ctx.signal ? AbortSignal.any([controller.signal, ctx.signal]) : controller.signal;
		generation = controller;
		const onAbort = () => {
			if (generation !== controller) return;
			generation = null;
			stopSpinner();
			status = status.title ? { state: "ready", title: status.title } : { state: "idle" };
			emitTitleState();
		};
		signal.addEventListener("abort", onAbort, { once: true });
		status = { state: "generating", title: status.title, frame: SPINNER_FRAMES[0] };
		startSpinner();
		emitTitleState();
		void generateTitle(ctx, promptText, signal)
			.then((title) => {
				if (generation !== controller) return;
				generation = null;
				setTitle(title, source);
			})
			.catch((error) => {
				if (generation !== controller) return;
				generation = null;
				const message = error instanceof Error ? error.message : String(error);
				status = { state: "error", title: status.title, error: message };
				stopSpinner();
				pi.appendEntry(ENTRY_TYPE, { title: status.title, source, createdAt: Date.now(), error: message });
				emitTitleState();
			})
			.finally(() => signal.removeEventListener("abort", onAbort));
		return true;
	};

	const restoreSession = (ctx: ExtensionContext) => {
		cancelGeneration();
		autoGenerate = loadOrgmConfigSlice("title").autoGenerate;
		autoAttempted = false;
		const savedTitle = extractLastSavedTitle(ctx);
		status = savedTitle ? { state: "ready", title: savedTitle } : { state: "idle" };
		if (savedTitle) pi.setSessionName(savedTitle);
		emitTitleState();
	};

	pi.on("session_start", async (_event, ctx) => restoreSession(ctx));
	pi.on("session_tree", async (_event, ctx) => restoreSession(ctx));

	pi.on("before_agent_start", async (event) => {
		// Pi 1.3 creates the run signal only after this event. Capture plain data,
		// then dispatch from agent_start so session.abort() also cancels the title.
		pendingAutoPrompt = undefined;
		if (event.messageType !== "user" || !autoGenerate || autoAttempted || status.state === "ready") return;
		pendingAutoPrompt = event.prompt;
	});

	pi.on("agent_start", async (_event, ctx) => {
		const prompt = pendingAutoPrompt;
		pendingAutoPrompt = undefined;
		if (prompt === undefined || !ctx.signal || !autoGenerate || autoAttempted || status.state === "ready") return;
		autoAttempted = startGeneration(ctx, prompt, "initial");
	});

	pi.on("session_shutdown", async () => cancelGeneration());

	pi.registerCommand("orgm-title", {
		description: "Manage session title: /orgm-title [regen|name <título>|clear|auto <on|off|toggle>]",
		getArgumentCompletions: (prefix) => {
			const options = [
				{ value: "regen", label: "regen — regenerate title with AI from current context" },
				{ value: "name ", label: "name <title> — set title manually" },
				{ value: "clear", label: "clear — hide current title footer line" },
				{ value: "auto ", label: "auto <on|off|toggle> — persist automatic title generation" },
			];
			const value = prefix.trimStart().toLowerCase();
			return options.filter((option) => option.value.startsWith(value));
		},
		handler: async (args, ctx) => {
			const command = parseTitleCommand(args);
			if (command.action === "show") {
				const title = status.state === "ready" || status.state === "generating" || status.state === "error" ? status.title : undefined;
				ctx.ui.notify(title ? `Título actual: ${title}` : "No hay título todavía. Usa /orgm-title regen o /orgm-title name <título>.", "info");
				return;
			}
			if (command.action === "unknown") {
				ctx.ui.notify(command.message, "warning");
				return;
			}
			if (command.action === "auto") {
				autoGenerate = command.toggle ? !autoGenerate : command.enabled ?? autoGenerate;
				saveOrgmConfigSlice("title", { autoGenerate });
				ctx.ui.notify(`Auto title ${autoGenerate ? "enabled" : "disabled"}`, autoGenerate ? "info" : "warning");
				return;
			}
			if (command.action === "clear") {
				cancelGeneration();
				status = { state: "idle" };
				pi.appendEntry(ENTRY_TYPE, { title: "", source: "manual", createdAt: Date.now() });
				emitTitleState();
				ctx.ui.notify("Título ocultado", "info");
				return;
			}
			if (command.action === "name") {
				cancelGeneration();
				if (setTitle(command.title, "manual")) ctx.ui.notify(`Título aplicado: ${command.title}`, "info");
				return;
			}
			const prompt = buildConversationPrompt(ctx, "Regenerate a title for the current session.");
			if (startGeneration(ctx, prompt, "regen")) ctx.ui.notify("Regenerando título…", "info");
			else ctx.ui.notify("Title generation requires a selected model and UI, with no active cancellation.", "warning");
		},
	});
}
