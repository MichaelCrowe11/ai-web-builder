// Re-export the renderer from the shared package so server code can import
// from either location. The canonical implementation lives in @shared/renderer.
export {
  renderDocumentCss,
  renderDocumentBody,
  renderDocumentFull,
} from "@shared/renderer";
