import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setImmediate as nextTick } from "node:timers/promises";
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createAgentSession, createEventBus, discoverAndLoadExtensions, ModelRegistry, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import titleExtension from "../extensions/title.ts";

const model = {
  id: "title-model", name: "Test model", provider: "title-test", api: "title-test-api",
  baseUrl: "https://invalid.example", reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024,
};
const response = (text = "Generated title", extra = {}) => ({
  role: "assistant", content: [{ type: "text", text }], api: model.api,
  provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(),
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, ...extra,
});
const flush = async () => { await nextTick(); await nextTick(); };

function harness(t, options = {}) {
  // Never read or write the user's ORGM config or credentials.
  const home = mkdtempSync(join(tmpdir(), "pi-title-test-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  t.mock.method(globalThis, "fetch", () => { throw new Error("Network is forbidden in title tests"); });
  const events = new EventEmitter();
  const handlers = new Map();
  const commands = new Map();
  const states = [];
  const notifications = [];
  const writes = [];
  const names = [];
  const calls = [];
  let manager = options.manager ?? SessionManager.inMemory(home);
  const registry = options.registry ?? {
    // Deliberately no getApiKeyAndHeaders/complete/find: only host-neutral dispatch is allowed.
    streamSimple(selected, context, streamOptions) {
      let resolve, reject;
      const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
      calls.push({ selected, context, options: streamOptions, resolve, reject });
      return { result: () => pending };
    },
  };
  const ctx = {
    hasUI: true, mode: "tui", model, signal: undefined, modelRegistry: registry,
    get sessionManager() { return manager; },
    ui: { notify(message, kind) {
      assert.ok(["info", "warning", "error"].includes(kind), `Invalid Pi notification: ${kind}`);
      notifications.push({ message, kind });
    } },
  };
  events.on("title:state-changed", state => states.push(structuredClone(state)));
  const pi = {
    events,
    on(name, handler) { handlers.set(name, handler); },
    registerCommand(name, command) { commands.set(name, command); },
    appendEntry(type, data) { writes.push({ manager, type, data }); manager.appendCustomEntry(type, data); },
    setSessionName(name) { names.push({ manager, name }); manager.appendSessionInfo(name); },
  };
  titleExtension(pi);
  const emit = async (type, event = {}, context = ctx) => handlers.get(type)?.({ type, ...event }, context);
  t.after(async () => {
    await emit("session_shutdown", { reason: "quit" });
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });
  return {
    ctx, home, calls, states, notifications, writes, names, registry, emit,
    get manager() { return manager; }, set manager(value) { manager = value; },
    get state() { return states.at(-1); },
    command: args => commands.get("orgm-title").handler(args, ctx),
    async user(prompt = "Fix session titles") {
      // Real Pi has no operation signal until agent_start, even for abortable runs.
      await emit("before_agent_start", { messageType: "user", prompt }, { ...ctx, signal: undefined });
      await emit("agent_start", {}, { ...ctx, signal: ctx.signal ?? new AbortController().signal });
    },
  };
}

test("Pi 1.3.0 discovers and loads the TypeScript entry through its real extension loader", async t => {
  const h = harness(t);
  const path = fileURLToPath(new URL("../extensions/title.ts", import.meta.url));
  const result = await discoverAndLoadExtensions([path], h.home, join(h.home, ".pi/agent"));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings ?? [], []);
  assert.equal(result.extensions.length, 1);
  const extension = result.extensions[0];
  assert.ok(extension.commands.has("orgm-title"));
  for (const event of ["session_start", "session_tree", "session_shutdown", "before_agent_start", "agent_start"]) {
    assert.equal(extension.handlers.get(event)?.length, 1, event);
  }
});

test("before_agent_start only captures the prompt; agent_start owns automatic generation", async t => {
  const h = harness(t);
  await h.emit("before_agent_start", { messageType: "user", prompt: "Captured prompt" });
  assert.equal(h.calls.length, 0, "pre-run context has no cancellation signal");
  const turn = new AbortController();
  await h.emit("agent_start", {}, { ...h.ctx, signal: turn.signal });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].context.messages[0].content[0].text, "Captured prompt");
  turn.abort();
  assert.equal(h.calls[0].options.signal.aborted, true);
  assert.deepEqual(h.state, { state: "idle" });
});

test("auto title uses selected host model, neutral options, sanitized text, and runs once", async t => {
  const h = harness(t);
  await h.emit("session_start", { reason: "startup" });
  await h.user();
  assert.equal(h.calls.length, 1);
  const call = h.calls[0];
  assert.equal(call.selected, model);
  assert.match(call.context.systemPrompt, /Maximum 6 words/);
  assert.equal(call.context.messages[0].content[0].text, "Fix session titles");
  assert.deepEqual(Object.keys(call.options).sort(), ["cacheRetention", "signal"]);
  call.resolve(response(" \"Useful\n title\" ", { content: [
    { type: "thinking", thinking: "not a title" }, { type: "text", text: ' "Useful\n title" ' },
  ] }));
  await flush();
  assert.deepEqual(h.state, { state: "ready", title: "Useful title" });
  assert.equal(h.names.at(-1).name, "Useful title");
  assert.equal(h.writes.at(-1).data.source, "initial");
  await h.user("Another request");
  assert.equal(h.calls.length, 1);
});

test("custom-message runs do not consume the automatic user-title attempt", async t => {
  const h = harness(t);
  await h.emit("before_agent_start", { messageType: "user", prompt: "Superseded prompt" });
  await h.emit("before_agent_start", { messageType: "custom", message: { role: "custom", content: "not a user request" } });
  await h.emit("agent_start", {}, { ...h.ctx, signal: new AbortController().signal });
  assert.equal(h.calls.length, 0);
  await h.user();
  assert.equal(h.calls.length, 1);
});

test("shutdown and session restoration discard a captured prompt before agent_start", async t => {
  const h = harness(t);
  const context = { ...h.ctx, signal: new AbortController().signal };
  for (const boundary of ["session_shutdown", "session_start", "session_tree"]) {
    await h.emit("before_agent_start", { messageType: "user", prompt: "Stale session prompt" });
    await h.emit(boundary);
    await h.emit("agent_start", {}, context);
    assert.equal(h.calls.length, 0, boundary);
  }
  await h.user("Fresh prompt");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].context.messages[0].content[0].text, "Fresh prompt");
});

test("missing model, headless mode, and already-aborted turns do not call or consume auto attempt", async t => {
  const h = harness(t);
  h.ctx.model = undefined;
  await h.user();
  await h.command("regen");
  assert.equal(h.notifications.at(-1).kind, "warning");
  h.ctx.model = model;
  h.ctx.hasUI = false;
  h.ctx.mode = "json";
  await h.user();
  h.ctx.hasUI = true;
  h.ctx.mode = "rpc";
  h.ctx.signal = AbortSignal.abort();
  await h.user();
  assert.equal(h.calls.length, 0);
  h.ctx.signal = undefined;
  await h.user();
  assert.equal(h.calls.length, 1, "RPC has supported UI and can generate titles");
});

test("provider dispatch throwing synchronously becomes a title error without escaping the event", async t => {
  const h = harness(t, { registry: { streamSimple() { throw new Error("Synchronous auth failure"); } } });
  await h.user();
  await flush();
  assert.equal(h.state.state, "error");
  assert.equal(h.state.error, "Synchronous auth failure");
  assert.equal(h.names.length, 0);
});

test("abort without a previous title returns idle and ignores a late provider rejection", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const h = harness(t);
  const turn = new AbortController();
  h.ctx.signal = turn.signal;
  await h.user();
  turn.abort();
  assert.deepEqual(h.state, { state: "idle" });
  const count = h.states.length;
  t.mock.timers.tick(1000);
  assert.equal(h.states.length, count);
  h.calls[0].reject(new Error("Late cancellation error"));
  await flush();
  assert.equal(h.writes.length, 0);
  assert.equal(h.names.length, 0);
});

test("model changes affect the next generation, not an already-started request", async t => {
  const h = harness(t);
  await h.user();
  const other = { ...model, id: "new-selection", provider: "another-provider" };
  h.ctx.model = other;
  assert.equal(h.calls[0].selected, model);
  await h.command("regen");
  assert.equal(h.calls[1].selected, other);
  assert.equal(h.calls[0].options.signal.aborted, true);
  h.calls[0].resolve(response("Stale model result"));
  h.calls[1].resolve(response("New model title"));
  await flush();
  assert.equal(h.state.title, "New model title");
  assert.equal(h.writes.length, 1);
});

test("turn abort immediately stops spinner and ignores a provider that completes late", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const h = harness(t);
  await h.command("name Existing title");
  const turn = new AbortController();
  h.ctx.signal = turn.signal;
  await h.command("regen");
  t.mock.timers.tick(100);
  assert.equal(h.state.state, "generating");
  turn.abort();
  assert.equal(h.calls[0].options.signal.aborted, true);
  assert.deepEqual(h.state, { state: "ready", title: "Existing title" });
  const count = h.states.length;
  t.mock.timers.tick(1000);
  assert.equal(h.states.length, count);
  h.calls[0].resolve(response("Must not be applied"));
  await flush();
  assert.equal(h.writes.length, 1, "cancelled work writes neither title nor error");
});

for (const action of ["clear", "name Manual replacement"]) {
  test(`${action} invalidates pending work even if provider ignores abort`, async t => {
    const h = harness(t);
    await h.user();
    await h.command(action);
    assert.equal(h.calls[0].options.signal.aborted, true);
    const expected = structuredClone(h.state);
    h.calls[0].resolve(response("Late title"));
    await flush();
    assert.deepEqual(h.state, expected);
    assert.equal(h.writes.length, 1);
    if (action === "clear") assert.equal(h.names.length, 0);
  });
}

for (const kind of ["error", "aborted", "toolUse", "empty", "throw"]) {
  test(`failed ${kind} generation never saves partial title as successful`, async t => {
    const h = harness(t);
    await h.user();
    if (kind === "throw") h.calls[0].reject(new Error("Provider threw"));
    else if (kind === "empty") h.calls[0].resolve(response(" \n "));
    else h.calls[0].resolve(response("Partial must not be saved", { stopReason: kind, errorMessage: "Provider failed" }));
    await flush();
    assert.equal(h.state.state, "error");
    assert.equal(h.names.length, 0);
    assert.equal(h.writes.length, 1);
    assert.ok(h.writes[0].data.error);
    assert.equal(h.writes[0].data.title, undefined);
  });
}

for (const reason of ["reload", "new", "resume", "fork"]) {
  test(`session ${reason} cancels old work and restores only the destination title`, async t => {
    const h = harness(t);
    await h.user();
    const oldCall = h.calls[0];
    await h.emit("session_shutdown", { reason });
    await h.emit("session_shutdown", { reason }); // Idempotent cleanup.
    assert.equal(oldCall.options.signal.aborted, true);
    h.manager = SessionManager.inMemory(h.home);
    h.manager.appendCustomEntry("session-title", { title: "Destination" });
    await h.emit("session_start", { reason });
    oldCall.resolve(response("Wrong session"));
    await flush();
    assert.deepEqual(h.state, { state: "ready", title: "Destination" });
    assert.equal(h.writes.length, 0);
    assert.equal(h.names.at(-1).manager, h.manager);
  });
}

test("session_start defensively aborts pending work even without a prior shutdown", async t => {
  const h = harness(t);
  await h.user();
  h.manager = SessionManager.inMemory(h.home);
  await h.emit("session_start", { reason: "resume" });
  assert.equal(h.calls[0].options.signal.aborted, true);
  h.calls[0].resolve(response("Old session"));
  await flush();
  assert.deepEqual(h.state, { state: "idle" });
  await h.user();
  assert.equal(h.calls.length, 2, "auto attempt resets in new session");
});

test("branch restoration excludes abandoned titles and respects a clear entry", async t => {
  const h = harness(t);
  const root = h.manager.appendMessage({ role: "user", content: "Root", timestamp: Date.now() });
  await h.command("name Abandoned title");
  h.manager.branch(root);
  await h.emit("session_start", { reason: "resume" });
  assert.deepEqual(h.state, { state: "idle" });
  await h.user();
  await h.command("name Branch title");
  const titledLeaf = h.manager.getLeafId();
  await h.command("clear");
  await h.emit("session_start", { reason: "reload" });
  assert.deepEqual(h.state, { state: "idle" });
  h.manager.branch(titledLeaf);
  await h.emit("session_tree");
  assert.deepEqual(h.state, { state: "ready", title: "Branch title" });
  await h.command("regen");
  const pending = h.calls.at(-1);
  h.manager.branch(root);
  await h.emit("session_tree");
  assert.equal(pending.options.signal.aborted, true);
  pending.resolve(response("Wrong branch"));
  await flush();
  assert.deepEqual(h.state, { state: "idle" });
});

test("regen uses compacted, context-edited active projection rather than raw history", async t => {
  const h = harness(t);
  const obsolete = h.manager.appendMessage({ role: "user", content: "OBSOLETE SECRET", timestamp: Date.now() });
  const kept = h.manager.appendMessage({ role: "user", content: "PRIVATE ORIGINAL", timestamp: Date.now() });
  h.manager.appendCompaction("Compacted task summary", kept, 1000);
  h.manager.appendContextEdit(kept, { content: "Redacted current task" });
  await h.command("regen");
  const prompt = h.calls[0].context.messages[0].content[0].text;
  assert.match(prompt, /Compacted task summary/);
  assert.match(prompt, /Redacted current task/);
  assert.doesNotMatch(prompt, /OBSOLETE SECRET|PRIVATE ORIGINAL/);
  assert.ok(obsolete);
});

test("auto off persists only to isolated HOME and is reloaded at session start", async t => {
  const h = harness(t);
  await h.command("auto off");
  const config = JSON.parse(readFileSync(join(h.home, ".pi/agent/orgm.json"), "utf8"));
  assert.equal(config.title.autoGenerate, false);
  await h.emit("session_start", { reason: "reload" });
  await h.user();
  assert.equal(h.calls.length, 0);
  await h.command("auto toggle");
  await h.user();
  assert.equal(h.calls.length, 1);
});

test("real AgentSession abort cancels automatic title and rejects a late provider success", { timeout: 10000 }, async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const h = harness(t);
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
  });
  const calls = [];
  runtime.registerNativeProvider({
    id: model.provider, name: "Session test provider", getModels: () => [model],
    auth: { apiKey: {
      name: "In-memory auth", check: async () => ({ type: "api_key", source: "test" }),
      resolve: async () => ({ auth: {} }),
    } },
    stream() { throw new Error("Unexpected API-specific dispatch"); },
    streamSimple(_selected, context, options) {
      const stream = createAssistantMessageEventStream();
      const title = JSON.stringify(context.messages).includes("Generate a concise title");
      calls.push({ title, stream, signal: options.signal });
      stream.push({ type: "start", partial: response("", { stopReason: "pending" }) });
      if (!title) {
        const abort = () => {
          stream.push({ type: "error", reason: "aborted", error: response("", { stopReason: "aborted", errorMessage: "Cancelled" }) });
          stream.end();
        };
        options.signal.addEventListener("abort", abort, { once: true });
        if (options.signal.aborted) abort();
      }
      // Title stream deliberately ignores cancellation until the test completes it.
      return stream;
    },
  });
  await runtime.refresh({ providers: [model.provider], allowNetwork: false });
  const bus = createEventBus();
  const states = [];
  bus.on("title:state-changed", state => states.push(structuredClone(state)));
  const loaded = await discoverAndLoadExtensions(
    [fileURLToPath(new URL("../extensions/title.ts", import.meta.url))], h.home, join(h.home, ".pi/agent"), bus,
  );
  assert.deepEqual(loaded.errors, []);
  const signals = {};
  for (const name of ["before_agent_start", "agent_start"]) {
    const handlers = loaded.extensions[0].handlers;
    if (!handlers.has(name)) handlers.set(name, []);
    handlers.get(name).push(async (_event, ctx) => { signals[name] = ctx.signal; });
  }
  const manager = SessionManager.inMemory(h.home);
  const resourceLoader = {
    getExtensions: () => loaded,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "In-memory session test", getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources() {}, async reload() {},
  };
  const { session } = await createAgentSession({
    cwd: h.home, agentDir: join(h.home, ".pi/agent"), modelRuntime: runtime, model,
    thinkingLevel: "off", tools: [], resourceLoader, sessionManager: manager,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
  });
  const errors = [];
  let run;
  try {
    await session.bindExtensions({ mode: "tui", uiContext: { notify() {} }, onError: error => errors.push(error) });
    run = session.prompt("Fix real session cancellation");
    for (let i = 0; i < 30 && calls.length < 2; i++) await flush();
    assert.equal(calls.length, 2, "both title and main agent reach the in-memory provider");
    assert.equal(signals.before_agent_start, undefined, "actual Pi pre-run signal, not a synthetic one");
    assert.ok(signals.agent_start instanceof AbortSignal);
    const title = calls.find(call => call.title);
    assert.ok(title);
    assert.equal(states.at(-1).state, "generating");
    await session.abort();
    await run;
    assert.equal(signals.agent_start.aborted, true);
    assert.equal(title.signal.aborted, true, "session.abort reaches the nested title request");
    assert.deepEqual(states.at(-1), { state: "idle" });
    const count = states.length;
    t.mock.timers.tick(1000);
    assert.equal(states.length, count, "aborted title spinner is stopped");
    const entries = manager.getEntries().length;
    title.stream.push({ type: "done", reason: "stop", message: response("Late forbidden title") });
    title.stream.end();
    await flush();
    assert.equal(manager.getSessionName(), undefined, "late title cannot rename the real session");
    assert.equal(manager.getEntries().length, entries, "late title writes neither name nor title/error entry");
    assert.equal(manager.getEntries().filter(entry => entry.type === "custom" && entry.customType === "session-title").length, 0);
    assert.deepEqual(errors, []);
  } finally {
    await session.abort();
    await run;
    session.dispose();
  }
});

test("Pi 1.3.0 real runtime routes a virtual selection through keyless provider auth", async t => {
  const h = harness(t);
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
  });
  const received = [];
  let authSignal;
  const provider = {
    id: model.provider, name: "In-process test provider", getModels: () => [model],
    auth: { apiKey: {
      name: "Ambient test auth",
      check: async () => ({ type: "api_key", source: "test" }),
      resolve: async ({ signal }) => {
        authSignal = signal;
        return { auth: { headers: { "x-title-test": "resolved" }, baseUrl: "https://resolved.invalid" }, env: { TITLE_TEST: "scoped" } };
      },
    } },
    stream() { throw new Error("API-specific dispatch must not be used"); },
    streamSimple(selected, context, options) {
      received.push({ selected, context, options });
      const stream = createAssistantMessageEventStream();
      const message = response("Host routed title");
      stream.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
      stream.push({ type: "done", reason: "stop", message });
      stream.end();
      return stream;
    },
  };
  runtime.registerNativeProvider(provider);
  await runtime.refresh({ providers: [model.provider], allowNetwork: false });
  let routeRequest;
  runtime.registerVirtualModel({
    provider: "title-router", id: "auto", name: "Test router",
    route(request) { routeRequest = request; return { model, thinkingLevel: "off" }; },
  });
  h.ctx.modelRegistry = new ModelRegistry(runtime);
  h.ctx.model = runtime.getModel("title-router", "auto");
  assert.ok(h.ctx.model);
  await h.command("regen");
  await flush();
  assert.deepEqual(h.state, { state: "ready", title: "Host routed title" });
  assert.equal(routeRequest.reason, "direct");
  assert.equal(received.length, 1);
  const request = received[0];
  assert.equal(request.selected.provider, model.provider);
  assert.equal(request.selected.baseUrl, "https://resolved.invalid");
  assert.equal(request.options.apiKey, undefined, "keyless auth is valid");
  assert.equal(request.options.headers["x-title-test"], "resolved");
  assert.equal(request.options.env.TITLE_TEST, "scoped");
  assert.equal(request.options.signal, authSignal);
  assert.equal(request.context.messages[0].role, "system", "host normalizes system prompt");
});
