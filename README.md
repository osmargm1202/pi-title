# pi-title

ORGM Pi title package.

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

## Development

```bash
npm install
npm test
npm run pack:check
```
