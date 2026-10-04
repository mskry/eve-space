# EVE Space Code Standards

## Code Comments

- Keep comments rare. Add one only when it explains a non-obvious invariant, constraint, or rationale that the code cannot express clearly.
- Do not add comments that restate control flow, narrate test setup or mechanics, explain obvious assignments, or duplicate names and assertions. Remove excessive generated comments before finalizing changes.

## Code Style

- Prefer optional chaining over separate nullish guards when reading a property from a nullable value. Use optional chaining for nullable property, element, and method access when it preserves the existing falsy-value semantics.
- Prefer `const name = (...) => ...` or a const-bound function expression over `function name(...)` declarations when writing or materially changing functions. Keep declarations when their hoisting or overload semantics are required; do not migrate untouched code solely for style.

### Sonar Authoring Guardrails

Apply these rules while first writing code or while changing the relevant lines. They are preventive authoring guidance, not a request to scan for, refactor, or rewrite existing code. Do not start a repository-wide cleanup, run Sonar solely to recheck these rules, or enter repeated scan-and-rewrite cycles unless the user explicitly asks. Normal task verification may report a finding in changed code; address that scoped finding without expanding into unrelated cleanup.

- Keep TypeScript unions and intersections meaningful. Do not combine `unknown` or `any` with other union members, add `never` to a union, add `unknown` to an intersection, or include a literal/subtype already covered by a wider constituent.
- Give reusable or non-trivial TypeScript union and intersection types a named type alias instead of repeating them inline in properties or signatures.
- Give every `sort()` and `toSorted()` call an explicit comparator. Use `left.localeCompare(right)` for strings and a numeric comparator for numbers; choose a domain-specific comparator for records.
- Do not nest ternary expressions. Use an early return, an `if` statement, or a named intermediate value when a choice contains another choice.
- Do not nest template literals. Assign the inner interpolated value or tagged-template fragment to a named variable before using it in another template literal.
- Keep each newly authored or materially changed function at or below Sonar's cognitive-complexity limit of 15 by designing flat control flow from the start. Prefer guard clauses, named predicates, and focused helpers over deep nesting or mixed multi-stage branching.
- Merge imports from the same module into one declaration, using inline `type` specifiers when type and value imports share a source.
- Express string-prefix and string-suffix checks with `startsWith()` and `endsWith()` rather than index arithmetic, slicing, or a regular expression.
- Use current standardized CSS rather than deprecated selectors, at-rules, properties, or values. In particular, do not use `word-break: break-word`; use `overflow-wrap: anywhere` when arbitrary wrapping is intended.

### Regular Expressions

- Regular expressions that process untrusted or unbounded input must have linear-time matching behavior.
- Do not use nested quantifiers or consecutive unbounded quantifiers when their character classes can match the same input. Make separators unambiguous by excluding them from adjacent character classes, use bounded quantifiers, or parse structured values with string operations instead.
- Use concise equivalent regex syntax: `\d`/`\D` instead of `[0-9]`/`[^0-9]`, `\w`/`\W` instead of their full ASCII word-character classes, and `?`, `*`, `+`, or `{n}` instead of verbose equivalent quantifiers.
- Keep a regular expression at or below Sonar's complexity limit of 20. Split independent checks into named patterns or move structured validation to string operations when one pattern would exceed that limit.
- Add adversarial near-match tests for non-trivial regular expressions and resolve Sonar slow-regex or regular-expression denial-of-service findings rather than suppressing them.

## Module Organization

These rules apply to every source directory. Keep a directory flat by default, with sibling modules and no `index.ts` barrel. Introduce subdirectories or a facade only when they express a durable boundary within a cohesive subsystem, not to organize one isolated file.

### Dependency Direction

- Give every cohesive subsystem an explicit dependency direction appropriate to its responsibilities. Do not force every directory into one fixed tier vocabulary or infer that an example taxonomy is exhaustive.
- Dependencies point from orchestration and side-effect-owning adapters toward domain contracts, representations, types, and utilities. Lower tiers must not import the higher tiers that coordinate them.
- Keep pure modules independent of databases, sockets, transports, clients, and process state so they remain unit-testable without infrastructure.
- A module that owns a connection, transport, client, or other external side effect must not import the orchestration that uses it. Orchestration depends on adapters, never the reverse.
- Keep recorder-only observability leaves free of orchestration dependencies so any tier can emit through them. Read-model or aggregate observability may inspect higher-tier state when the subsystem explicitly declares that direction, but it must not initiate or own execution.
- Module-level mutable state is a boundary. Give counters, in-process caches, and degraded-mode fallback state their own module rather than interleaving them with the code that reads them, so they can be reset and asserted in isolation.
- Document subsystem-specific tiers and exceptions in the nearest scoped `AGENTS.md`. Keep exact file membership in the mechanical verifier that enforces it, rather than duplicating a current file inventory in prose.
- Enforce dependency boundaries worth preserving through a `scripts/verify-*` check rather than relying on review alone.

### File Composition

- Order every module: imports, module constants, exported types and interfaces, then function expressions in dependency order, keeping the primary export easy to find.
- Define const-bound helpers before their first use. Keep leaf helpers close to their callers rather than relying on declaration hoisting.
- If a file needs a banner or section comment to separate its parts, split it into one file per part instead.

### Shared Helpers

- Promote a helper the moment a second file needs it, and import it from the module that owns it. Do not copy it, and do not re-export it from whichever caller uses it most.
- Promote to the narrowest shared scope: a leaf module in the same directory first, and a repository-level module such as `api/src/type-guards.ts` only when callers span directories.
- A leaf helper module holds one kind of helper and imports nothing from its own directory.
- Treat a helper duplicated across files, or one type declared twice under different names, as a defect to remove rather than a style preference.

### Documentation Location

- Put a platform module's documentation in `features/<module-id>/docs/` when only a change to that module's own code could make it wrong: its UI and interaction behaviour, its API contract, limits, and data semantics.
- Keep documentation in root `docs/`, named `<module-id>-*.md` for module-specific topics, when a core or platform change could invalidate it or operators and reviewers need it across modules: deployment, rollback, and migration order; core migrations; core-data products and SDE ingest; ESI operation reviews; fetching-compliance reviews and other verification records.
- A document that mixes both belongs in root `docs/`. Link between the two locations rather than duplicating content.
