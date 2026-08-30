# ADR-0001: No repository layer over Drizzle

Date: 2026-08-20 · Status: accepted

## Decision

Feature modules query D1 through Drizzle's typed builder directly. We do not
wrap tables in repository modules (`AssetRepo`, `GrantRepo`, ...).

## Rationale

A repository layer here fails the deletion test: deleting it would move each
query back to its single call site — complexity relocates, it doesn't
concentrate. The interface of such a repo would be nearly as wide as its
implementation (shallow). Drizzle's builder already is a small, typed
interface, and this boilerplate is read more than it is mocked.

Domain behaviour that spans queries belongs in the feature modules
(`features/grants`, `features/assets`) — that is where depth pays.

## Consequences

- Architecture reviews should not re-suggest repositories; deepen or add
  feature modules instead.
- If a second database adapter ever becomes real (not hypothetical), revisit —
  two adapters would justify a seam.
