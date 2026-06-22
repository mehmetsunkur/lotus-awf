# ADR-0008: Deployable Docker artifact

Date: 2026-06-18

## Status

Accepted

## Context

The platform is moving toward an AI-native business app operating system. Future config agents must
target a running platform artifact, not a source checkout with Vite and file watchers. Before adding
agent-native authoring, the base platform needs a repeatable install gate.

## Taxonomy

- Subsystem: Server, config/runtime, tests
- Domain Area: Deployment / packaging, Offline-first
- Risk Class: Availability, Data integrity
- Runtime Surface: Docker image, Docker Compose, Internal API

## Decision

Package Lotus as a Docker image that installs from `package-lock.json`, builds the Vite client, starts
the Express API with `npm start`, and serves the built client from `dist/`. Keep the root
`docker-compose.yml` as the development topology and add `deploy/compose.yml` as the artifact topology
with no source bind mount. Verify the artifact with `npm run test:deploy`, which drives the deploy
stack externally over HTTP.

## Alternatives Considered

1. Continue using the dev compose bind mount (rejected: does not prove deployability).
2. Build only the client and keep API source-mounted (rejected: still source-checkout dependent).
3. Add a Docker artifact and deploy integration gate (chosen).

## Consequences

- Positive: future AI config agents can target a stable deployed runtime surface; packaging regressions
  get a dedicated gate; Vite/watch stays out of the deploy path.
- Negative: the first image is not size-optimized, and the deploy gate requires Docker API access.

## Follow-Ups

- M17 replaced the packaged Expense sample seed with a JSON template-registry install. `/api/reset`
  still exists for dev/e2e compatibility, but it now loads the same JSON artifacts through
  `seedDocuments()`.
- Consider a multi-stage image if image size matters.
- Add CI runner support with Docker API access for `npm run test:deploy`.
