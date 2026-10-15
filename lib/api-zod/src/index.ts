export * from "./generated/api";
// Orval also emits TypeScript interfaces under ./generated/types. Some names collide
// with Zod schema constants in ./generated/api (same OpenAPI component name).
// Prefer the Zod schemas as the public runtime export; import types from
// `@workspace/api-zod/generated/types/...` only if a distinct interface is required.
