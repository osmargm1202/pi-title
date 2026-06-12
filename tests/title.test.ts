import assert from "node:assert/strict";
import { parseTitleCommand, renderTitleContextLine, renderTitleLine, sanitizeTitle, visibleWidth } from "../extensions/lib/minimal-title.ts";

assert.equal(sanitizeTitle("  Diseño   extensión title.ts!!  "), "Diseño extensión title.ts!!");
assert.equal(sanitizeTitle(""), "");
assert.equal(sanitizeTitle("a".repeat(100), 20), `${"a".repeat(19)}…`);

assert.deepEqual(parseTitleCommand(""), { action: "show" });
assert.deepEqual(parseTitleCommand("regen"), { action: "regen" });
assert.deepEqual(parseTitleCommand("name Sesión manual"), { action: "name", title: "Sesión manual" });
assert.deepEqual(parseTitleCommand('name "Sesión manual"'), { action: "name", title: "Sesión manual" });
assert.deepEqual(parseTitleCommand("clear"), { action: "clear" });
assert.deepEqual(parseTitleCommand("auto off"), { action: "auto", enabled: false });
assert.deepEqual(parseTitleCommand("auto on"), { action: "auto", enabled: true });
assert.deepEqual(parseTitleCommand("auto toggle"), { action: "auto", toggle: true });
assert.equal(parseTitleCommand("wat").action, "unknown");

const ready = renderTitleLine({ state: "ready", title: "Mi sesión" }, 31, (kind, text) => text);
assert.equal(ready.length, 31, "ready title line should fill the full footer width");
assert(ready.includes("Mi sesión"), "ready title line should include the title");
assert.equal(ready.trim(), "Mi sesión", "ready title should be centered with surrounding space only");

const generating = renderTitleLine({ state: "generating", frame: "⠋" }, 24, (kind, text) => text);
assert.equal(generating.length, 24, "generating line should fill width");
assert(generating.includes("Generando título"), "generating line should show spinner message");

const error = renderTitleLine({ state: "error", error: "boom" }, 30, (kind, text) => text);
assert.equal(error.length, 30, "error line should fill width");
assert(error.includes("/orgm-title regen"), "error line should suggest regeneration command");

const contextualReady = renderTitleContextLine(
	{ state: "ready", title: "Mi sesión larga" },
	40,
	" pi-harness",
	"PLAN",
	(kind, text) => text,
);
assert.equal(visibleWidth(contextualReady), 40, "contextual ready line should fill width");
assert(contextualReady.includes(" pi-harness"), "contextual ready line should include folder at left");
assert(contextualReady.includes("PLAN"), "contextual ready line should include centered mode");
assert(contextualReady.includes("Mi sesión larga"), "contextual ready line should include title at right");
assert(contextualReady.indexOf(" pi-harness") < contextualReady.indexOf("PLAN"));
assert(contextualReady.indexOf("PLAN") < contextualReady.indexOf("Mi sesión larga"));

const contextualIdleKinds: string[] = [];
const contextualIdle = renderTitleContextLine(
	{ state: "idle" },
	32,
	" pi-harness",
	"PLAN",
	(kind, text) => {
		contextualIdleKinds.push(`${kind}:${text}`);
		return text;
	},
);
assert.equal(visibleWidth(contextualIdle), 32, "idle contextual line should fill width");
assert(contextualIdle.includes(" pi-harness"), "idle contextual line should show folder before a title exists");
assert(contextualIdle.includes("PLAN"), "idle contextual line should show mode before a title exists");
assert(contextualIdleKinds.includes("mode:PLAN"), "contextual line should expose mode as its own style kind");

const contextualNarrow = renderTitleContextLine(
	{ state: "ready", title: "Título muy largo" },
	18,
	" pi-harness",
	"PLAN",
	(kind, text) => text,
);
assert.equal(visibleWidth(contextualNarrow), 18, "narrow contextual line should fill width");
assert(contextualNarrow.includes("PLAN"), "narrow contextual line should preserve mode");
assert(contextualNarrow.trim().length > "PLAN".length, "narrow contextual line should keep context around mode");

const contextualGenerating = renderTitleContextLine(
	{ state: "generating", frame: "⠋" },
	48,
	" app",
	"BUILD",
	(kind, text) => text,
);
assert.equal(visibleWidth(contextualGenerating), 48, "generating contextual line should fill width");
assert(contextualGenerating.includes("⠋ Generando título"), "generating contextual line should show title generation state");
assert(contextualGenerating.includes("BUILD"), "generating contextual line should show mode");

const contextualError = renderTitleContextLine(
	{ state: "error", error: "boom" },
	48,
	" app",
	"PLAN",
	(kind, text) => text,
);
assert.equal(visibleWidth(contextualError), 48, "error contextual line should fill width");
assert(contextualError.includes("/orgm-title regen"), "error contextual line should suggest regeneration command");

const ansiContextualReady = renderTitleContextLine(
	{ state: "ready", title: "Mi sesión larga" },
	40,
	" pi-harness",
	"PLAN",
	(kind, text) => `\u001b[31m${text}\u001b[0m`,
);
assert.equal(visibleWidth(ansiContextualReady), 40, "styled contextual line should fill visible width");
assert(ansiContextualReady.length > 40, "styled contextual line should include ANSI bytes beyond visible width");
