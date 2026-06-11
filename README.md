# pi-title

ORGM Pi extension package for title.

Status: scaffold only. Runtime behavior still lives in `pi-harness` until extraction lands.

## Install

Standalone install:

```bash
pi install git:github.com/osmargm1202/pi-title
```

Recommended ORGM stack install:

```bash
for pkg in pi-mem pi-caveman pi-harness pi-footer; do
  pi install git:github.com/osmargm1202/$pkg
done
```

## ORGM Pi stack

This package is part of the ORGM Pi extension stack.

Packages:

- `pi-mem`: local memory/context index provider.
- `pi-caveman`: caveman runtime and shared state events.
- `pi-harness`: ORGM commands, config, title, ask/todo/banner bridge.
- `pi-footer`: Zentui-based editor/footer UI that displays ORGM status.

## Coupled integrations

Produces:

- Future extracted `title` behavior from `pi-harness`.

Consumes:

- Pi extension APIs.
- ORGM stack events only where required by extracted behavior.

Hard dependencies:

- None planned. Package should load alone.

Soft dependencies:

- `pi-harness` remains compatibility owner until extraction completes.
- `pi-footer` remains editor/footer UI owner.

## Development

```bash
npm test
npm run pack:check
```
