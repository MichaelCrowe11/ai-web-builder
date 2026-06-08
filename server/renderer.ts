// The renderer now lives in @shared so the browser can render locally (instant
// theme changes, optimistic edits). This shim keeps server imports stable.
export * from "@shared/renderer";
