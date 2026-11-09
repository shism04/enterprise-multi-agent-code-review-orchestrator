---
name: typescript-patterns
description: Reviews TypeScript code for type safety, strictness, async/error typing and idiomatic patterns. Use when analyzing .ts or .tsx files.
---

# TypeScript Patterns Analyzer

Use this checklist when reviewing TypeScript. Report only what you can point to in the code.

## 1. Type safety (most common real bugs)
- `any` (explicit or implicit) on function params, API responses, catch variables. Prefer `unknown` + narrowing or a Zod schema at boundaries.
- Non-null assertions (`value!`) and `as Foo` casts that silence the compiler instead of proving the type.
- `as unknown as T` double casts: almost always a design smell.
- `@ts-ignore` / `@ts-expect-error` without a reason comment.
- Missing return types on exported functions; functions that can return `undefined` but are typed as always returning a value.
- Optional fields used without checks (`user.address.street` when `address?` is optional).

## 2. Modeling
- Boolean flags that should be a discriminated union (`{status:'ok',data}` | `{status:'error',error}`).
- Repeated string literals that should be a union type or `as const` object.
- Large inline object types repeated in several places: extract an `interface`/`type`.
- Enums where a string-literal union is enough (and safer for tree-shaking).
- Use utility types (`Pick`, `Omit`, `Partial`, `Readonly`, `Record`, `ReturnType`) instead of copy-pasted shapes.
- Prefer `readonly` arrays/properties for data that must not mutate.

## 3. Async and errors
- Floating promises (no `await`, no `.catch`) and `async` callbacks passed to `forEach`.
- `catch (e)` using `e.message` without narrowing (`e instanceof Error`).
- Sequential `await` in a loop where `Promise.all` is safe.
- Throwing strings or plain objects instead of `Error` subclasses.

## 4. Runtime vs compile-time
- External data (HTTP, JSON.parse, env vars, DB rows) typed by assertion instead of validated at runtime.
- `process.env.X` used as `string` without checking it exists.

## 5. Config smells (mention only if visible in the diff)
- `strict` disabled, `skipLibCheck` hiding real errors, `noImplicitAny: false`.

## Severity guidance
- high: unchecked external data driving logic, `any` in security-relevant or money-related paths, floating promises on writes.
- medium: unsafe casts, missing discriminated unions, swallowed errors.
- low: missing return types, enum-vs-union, utility-type opportunities.

## Output
For each issue give: line, description (what and why it breaks type safety), a fixed code snippet, severity.
