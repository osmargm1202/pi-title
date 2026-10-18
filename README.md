# pi-title

ORGM Pi title package. Audited and locally tested against **Pi 1.3.0**.

See [Pi 1.3.0 compatibility](docs/pi-1.3.0-compatibility.md) for fixes, exact checks, and remaining validation gaps.

## Install

```bash
pi install git:github.com/osmargm1202/pi-title
```

This package is also loaded by the ORGM bundle:

```bash
pi install git:github.com/osmargm1202/pi-harness
```

## Owns

- `/orgm-title`
- session title state entries: `session-title`
- title state event: `title:state-changed`
- title generation/update behavior

## Consumed by

- `pi-footer` displays title state.
- `pi-banner` may display title/context later.

## Rules

- `pi-title` may generate/update titles.
- `pi-footer` must only display title state and must not generate titles.

## Generation behavior

- Uses the currently selected model through Pi's provider-neutral runtime, including virtual models and keyless/ambient authentication. No provider or fallback model is hard-coded.
- Automatic generation captures user prompts in `before_agent_start` and starts in `agent_start`, when Pi 1.3.0 provides the real run cancellation signal. It requires a selected model and `ctx.hasUI` (TUI or UI-capable RPC). Headless runs do not generate titles.
- Turn cancellation, manual replacement/clear, session shutdown/replacement, and tree navigation invalidate pending results and stop the spinner.
- Saved title state follows the active branch. Regeneration uses Pi's compacted, context-edited session projection.
- `clear` hides the title state; it does not erase an existing Pi session name.

## Development

Development requires Node.js 22.6+ with TypeScript stripping (tested on 22.23.3). Host packages remain wildcard runtime peers; development dependencies pin the tested host APIs to exactly `1.3.0`.

```bash
npm ci --ignore-scripts
npm test
npm run typecheck
npm run pack:check
```
