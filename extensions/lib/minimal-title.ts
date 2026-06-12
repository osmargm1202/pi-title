export const SESSION_TITLE_ENTRY_TYPE = "session-title";
export const TITLE_STATE_EVENT = "title:state-changed";
export const MAX_TITLE_WIDTH = 80;

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function visibleWidth(text: string): number {
	return Array.from(text.replace(ANSI_PATTERN, "")).length;
}

export function truncateToWidth(text: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	const chars = Array.from(text.replace(ANSI_PATTERN, ""));
	if (width === 1) return "…";
	return `${chars.slice(0, width - 1).join("")}…`;
}

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export type TitleStatus =
	| { state: "idle"; title?: string }
	| { state: "generating"; title?: string; frame?: string }
	| { state: "ready"; title: string }
	| { state: "error"; title?: string; error?: string };

export type TitleCommand =
	| { action: "show" }
	| { action: "regen" }
	| { action: "name"; title: string }
	| { action: "auto"; enabled?: boolean; toggle?: boolean }
	| { action: "clear" }
	| { action: "unknown"; message: string };

export function sanitizeTitle(input: string, maxWidth = MAX_TITLE_WIDTH): string {
	const normalized = input
		.replace(/[\r\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
		.trim();
	if (!normalized) return "";
	return truncateToWidth(normalized, maxWidth);
}

export function parseTitleCommand(args: string): TitleCommand {
	const trimmed = args.trim();
	if (!trimmed) return { action: "show" };
	const [rawAction = "", ...rest] = trimmed.split(/\s+/);
	const action = rawAction.toLowerCase();
	if (action === "regen" || action === "regenerate") return { action: "regen" };
	if (action === "clear" || action === "reset") return { action: "clear" };
	if (action === "auto") {
		const value = rest.join(" ").trim().toLowerCase();
		if (value === "on" || value === "enable" || value === "enabled") return { action: "auto", enabled: true };
		if (value === "off" || value === "disable" || value === "disabled") return { action: "auto", enabled: false };
		if (value === "toggle") return { action: "auto", toggle: true };
		return { action: "unknown", message: "Usage: /orgm-title auto <on|off|toggle>" };
	}
	if (action === "name" || action === "set") {
		const title = sanitizeTitle(rest.join(" "));
		if (!title) return { action: "unknown", message: "Usage: /orgm-title name <nombre del título>" };
		return { action: "name", title };
	}
	return { action: "unknown", message: "Usage: /orgm-title [regen|name <título>|clear]" };
}

export function padToWidth(text: string, width: number): string {
	const clipped = truncateToWidth(text, Math.max(0, width));
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export function centerToWidth(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = truncateToWidth(text, width);
	const left = Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2));
	return padToWidth(`${" ".repeat(left)}${clipped}`, width);
}

function formatTitleStatusText(status: TitleStatus, width: number): { kind: "accent" | "dim" | "warning" | "error"; text: string } {
	if (status.state === "generating") {
		return { kind: "warning", text: `${status.frame ?? SPINNER_FRAMES[0]} Generando título…` };
	}
	if (status.state === "error") {
		const fallback = status.title ? `⚠ ${status.title} · /orgm-title regen` : "⚠ Error generando título · /orgm-title regen";
		return { kind: "error", text: visibleWidth(fallback) > width && width >= 14 ? "⚠ /orgm-title regen" : fallback };
	}
	if (status.state === "ready") {
		return { kind: "accent", text: status.title };
	}
	return { kind: "dim", text: status.title ?? "" };
}

export function renderTitleLine(
	status: TitleStatus,
	width: number,
	style: (kind: "accent" | "dim" | "warning" | "error", text: string) => string,
): string {
	if (width <= 0) return "";
	const formatted = formatTitleStatusText(status, width);
	if (!formatted.text) return "".padEnd(width);
	return centerToWidth(style(formatted.kind, formatted.text), width);
}

export function renderTitleContextLine(
	status: TitleStatus,
	width: number,
	leftText: string,
	centerText: string,
	style: (kind: "accent" | "dim" | "warning" | "error" | "mode", text: string) => string,
): string {
	if (width <= 0) return "";

	const center = truncateToWidth(centerText, width);
	const centerWidth = visibleWidth(center);
	if (width <= centerWidth + 1) return centerToWidth(style("mode", center), width);

	const centerStart = Math.max(0, Math.floor((width - centerWidth) / 2));
	const leftWidth = Math.max(0, centerStart - 1);
	const rightSlotWidth = Math.max(0, width - centerStart - centerWidth);
	const rightWidth = Math.max(0, rightSlotWidth - 1);
	const formatted = formatTitleStatusText(status, rightWidth);

	const left = truncateToWidth(leftText, leftWidth);
	const right = truncateToWidth(formatted.text, rightWidth);
	const gapBeforeCenter = " ".repeat(Math.max(0, centerStart - visibleWidth(left)));
	const gapBeforeRight = " ".repeat(Math.max(0, width - centerStart - centerWidth - visibleWidth(right)));

	return style("dim", left) + gapBeforeCenter + style("mode", center) + gapBeforeRight + style(formatted.kind, right);
}
