import type { LayoutStyleConfig } from './contracts.js'

export const DEFAULT_STYLE_CONFIG: LayoutStyleConfig = {
  bodyFontSize: 16,
  bodyLineHeight: 1.8,
  paragraphSpacing: 16,
  paragraphFirstLineIndent: false,
  bodyFontFamily: 'system',
  heading2FontSize: 20,
  heading3FontSize: 17,
  heading2Variant: 'accent-bar',
  quoteVariant: 'bar',
  imageRadius: 6,
  imageCaptionFontSize: 12,
  showTitleInBody: false,
  brandHeaderText: '',
  brandFooterText: ''
}

export function normalizeStyleConfig(config?: LayoutStyleConfig): LayoutStyleConfig {
  return { ...DEFAULT_STYLE_CONFIG, ...Object.fromEntries(Object.entries(config ?? {}).filter(([, value]) => value !== undefined)) }
}

export function sameStyleConfig(left: LayoutStyleConfig, right: LayoutStyleConfig): boolean {
  const a = normalizeStyleConfig(left)
  const b = normalizeStyleConfig(right)
  return ([
    'bodyFontSize', 'bodyLineHeight', 'paragraphSpacing', 'paragraphFirstLineIndent', 'bodyFontFamily',
    'heading2FontSize', 'heading3FontSize', 'heading2Variant', 'quoteVariant', 'imageRadius',
    'imageCaptionFontSize', 'accentColor', 'textColor', 'showTitleInBody', 'brandHeaderText', 'brandFooterText'
  ] as const)
    .every((key) => a[key] === b[key])
}
