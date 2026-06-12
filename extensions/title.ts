import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { complete, type Message } from "@earendil-works/pi-ai";
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

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "message") return entry.message;
	if (entry.type === "compaction") {
		return {
			role: "compactionSummary",
			summary: entry.summary,
			tokensBefore: entry.tokensBefore,
			timestamp: new Date(entry.timestamp).getTime(),
		};
	}
	return undefined;
}

function extractLastSavedTitle(ctx: ExtensionContext): string | undefined {
	const saved = ctx.sessionManager
		.getEntries()
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
	const messages = ctx.sessionManager.getBranch().map(entryToMessage).filter((message) => message !== undefined);
	if (messages.length === 0) return fallbackPrompt ?? "";
	const serialized = serializeConversation(convertToLlm(messages)).trim();
	return serialized || fallbackPrompt || "";
}

async function generateTitle(ctx: ExtensionContext, promptText: string, signal: AbortSignal): Promise<string> {
	if (!ctx.model) throw new Error("No model selected");
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok || !auth.apiKey) throw new Error(auth.ok ? `No API key for ${ctx.model.provider}` : auth.error);
	const userMessage: Message = {
		role: "user",
		content: [{ type: "text", text: promptText }],
		timestamp: Date.now(),
	};
	const response = await complete(
		ctx.model,
		{ systemPrompt: TITLE_SYSTEM_PROMPT, messages: [userMessage] },
		{ apiKey: auth.apiKey, headers: auth.headers, signal },
	);
	if (response.stopReason === "aborted") throw new Error("Generation aborted");
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


	const setTitle = (ctx: ExtensionContext, title: string, source: TitleSource) => {
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
		if (!ctx.hasUI || !ctx.model) return;
		generation?.abort();
		const controller = new AbortController();
		generation = controller;
		status = { state: "generating", title: status.title, frame: SPINNER_FRAMES[0] };
		startSpinner();
		emitTitleState();
		void generateTitle(ctx, promptText, controller.signal)
			.then((title) => {
				if (generation !== controller) return;
				generation = null;
				setTitle(ctx, title, source);
			})
			.catch((error) => {
				if (generation !== controller) return;
				generation = null;
				const message = error instanceof Error ? error.message : String(error);
				status = { state: "error", title: status.title, error: message };
				stopSpinner();
				pi.appendEntry(ENTRY_TYPE, { title: status.title, source, createdAt: Date.now(), error: message });
				emitTitleState();
			});
	};

	pi.on("session_start", async (_event, ctx) => {
		autoGenerate = loadOrgmConfigSlice("title").autoGenerate;
		autoAttempted = false;
		generation = null;
		stopSpinner();
		const savedTitle = extractLastSavedTitle(ctx);
		status = savedTitle ? { state: "ready", title: savedTitle } : { state: "idle" };
		if (savedTitle) pi.setSessionName(savedTitle);
		emitTitleState();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!autoGenerate || autoAttempted || status.state === "ready") return;
		autoAttempted = true;
		startGeneration(ctx, event.prompt, "initial");
	});

	pi.on("session_shutdown", async () => {
		generation?.abort();
		generation = null;
		stopSpinner();

	});

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
				ctx.ui.notify(`Auto title ${autoGenerate ? "enabled" : "disabled"}`, autoGenerate ? "success" : "warning");
				return;
			}
			if (command.action === "clear") {
				generation?.abort();
				stopSpinner();
				status = { state: "idle" };
				pi.appendEntry(ENTRY_TYPE, { title: "", source: "manual", createdAt: Date.now() });
				emitTitleState();
				ctx.ui.notify("Título ocultado", "info");
				return;
			}
			if (command.action === "name") {
				generation?.abort();
				generation = null;
				if (setTitle(ctx, command.title, "manual")) ctx.ui.notify(`Título aplicado: ${command.title}`, "success");
				return;
			}
			const prompt = buildConversationPrompt(ctx, "Regenerate a title for the current session.");
			startGeneration(ctx, prompt, "regen");
			ctx.ui.notify("Regenerando título…", "info");
		},
	});
}
