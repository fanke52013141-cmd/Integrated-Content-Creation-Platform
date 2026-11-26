export { lintHtml } from './lib/linter.mjs';
export {
  DEFAULT_MATRIX_PATH,
  SUPPORTED_TARGETS,
  getTargetPolicy,
  loadMatrix,
  resolveRule,
  validateMatrix,
} from './lib/matrix.mjs';
export { classifyUrl, srcsetUrls } from './lib/url.mjs';
export { findCssUrls, hasFunction, parseInlineStyle } from './lib/css.mjs';

export const LINTER_VERSION = '0.1.0';
