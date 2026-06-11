# pi-title

ORGM Pi extension package for title.

Status: scaffold only. Runtime behavior still lives in \ until extraction lands.

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

- \: local memory/context index provider.
- \: caveman runtime and shared state events.
- \: ORGM commands, config, title, ask/todo/banner bridge.
- \: Zentui-based editor/footer UI that displays ORGM status.

## Coupled integrations

Produces:

- Future extracted \ behavior from \.

Consumes:

- Pi extension APIs.
- ORGM stack events only where required by extracted behavior.

Hard dependencies:

- None planned. Package should load alone.

Soft dependencies:

- \ remains compatibility owner until extraction completes.
- \ remains editor/footer UI owner.

## Development

```bash
npm test
npm run pack:check
```
