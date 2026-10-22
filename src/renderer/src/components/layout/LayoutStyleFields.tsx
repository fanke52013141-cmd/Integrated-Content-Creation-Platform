import type { Dispatch, SetStateAction } from 'react'
import type { LayoutPlatform, LayoutStyleConfig, LayoutThemeInfo } from '../../../../shared/contracts'

export function LayoutStyleFields({ value, onChange, disabled = false, platform, themes, themeId }: {
  value: LayoutStyleConfig
  onChange: Dispatch<SetStateAction<LayoutStyleConfig>>
  disabled?: boolean
  platform: LayoutPlatform
  themes: LayoutThemeInfo[]
  themeId: string
}): React.JSX.Element {
  return (
    <div className="layout-style-fields">
      <label className="field"><span>正文字号</span><input type="number" min={13} max={20} value={value.bodyFontSize ?? 16} disabled={disabled} onChange={(event) => { const value = event.currentTarget.valueAsNumber; onChange((current) => ({ ...current, bodyFontSize: Number.isFinite(value) ? value : undefined })) }} /></label>
      <label className="field"><span>行高</span><input type="number" min={1.4} max={2.2} step={0.05} value={value.bodyLineHeight ?? 1.8} disabled={disabled} onChange={(event) => { const value = event.currentTarget.valueAsNumber; onChange((current) => ({ ...current, bodyLineHeight: Number.isFinite(value) ? value : undefined })) }} /></label>
      <label className="field"><span>段落间距（px）</span><input type="number" min={8} max={32} step={1} value={value.paragraphSpacing ?? 16} disabled={disabled} onChange={(event) => { const value = event.currentTarget.valueAsNumber; onChange((current) => ({ ...current, paragraphSpacing: Number.isFinite(value) ? value : undefined })) }} /></label>
      <label className="field"><span>正文字体</span><select value={value.bodyFontFamily ?? 'system'} disabled={disabled} onChange={(event) => onChange((current) => ({ ...current, bodyFontFamily: event.target.value as NonNullable<LayoutStyleConfig['bodyFontFamily']> }))}><option value="system">系统黑体</option><option value="serif">宋体风格</option></select></label>
      <label className="field"><span>二级标题字号</span><input type="number" min={16} max={26} value={value.heading2FontSize ?? 20} disabled={disabled} onChange={(event) => { const value = event.currentTarget.valueAsNumber; onChange((current) => ({ ...current, heading2FontSize: Number.isFinite(value) ? value : undefined })) }} /></label>
      <label className="field"><span>三级标题字号</span><input type="number" min={14} max={22} value={value.heading3FontSize ?? 17} disabled={disabled} onChange={(event) => { const value = event.currentTarget.valueAsNumber; onChange((current) => ({ ...current, heading3FontSize: Number.isFinite(value) ? value : undefined })) }} /></label>
      <label className="field"><span>二级标题样式</span><select value={value.heading2Variant ?? 'accent-bar'} disabled={disabled} onChange={(event) => onChange((current) => ({ ...current, heading2Variant: event.target.value as NonNullable<LayoutStyleConfig['heading2Variant']> }))}><option value="accent-bar">品牌色边线</option><option value="underline">底部分隔线</option><option value="filled">浅色底纹</option></select></label>
      <label className="field"><span>引用样式</span><select value={value.quoteVariant ?? 'bar'} disabled={disabled} onChange={(event) => onChange((current) => ({ ...current, quoteVariant: event.target.value as NonNullable<LayoutStyleConfig['quoteVariant']> }))}><option value="bar">品牌边线</option><option value="card">浅底卡片</option><option value="plain">简洁留白</option></select></label>
      <label className="field"><span>图片圆角（px）</span><input type="number" min={0} max={24} value={value.imageRadius ?? 6} disabled={disabled} onChange={(event) => { const value = event.currentTarget.valueAsNumber; onChange((current) => ({ ...current, imageRadius: Number.isFinite(value) ? value : undefined })) }} /></label>
      <label className="field"><span>图片说明字号</span><input type="number" min={10} max={16} value={value.imageCaptionFontSize ?? 12} disabled={disabled} onChange={(event) => { const value = event.currentTarget.valueAsNumber; onChange((current) => ({ ...current, imageCaptionFontSize: Number.isFinite(value) ? value : undefined })) }} /></label>
      <label className="field"><span>品牌强调色</span><input type="color" value={value.accentColor ?? themes.find((theme) => theme.id === themeId)?.accent ?? '#07c160'} disabled={disabled} onChange={(event) => onChange((current) => ({ ...current, accentColor: event.target.value }))} /></label>
      <label className="field"><span>正文文字色</span><input type="color" value={value.textColor ?? '#2b2b2b'} disabled={disabled} onChange={(event) => onChange((current) => ({ ...current, textColor: event.target.value }))} /></label>
      <label className="layout-checkbox-field"><input type="checkbox" checked={value.paragraphFirstLineIndent ?? false} disabled={disabled} onChange={(event) => onChange((current) => ({ ...current, paragraphFirstLineIndent: event.target.checked }))} /><span>段首缩进两个字</span></label>
      {platform === 'wechat' && <label className="layout-checkbox-field"><input type="checkbox" checked={value.showTitleInBody ?? false} disabled={disabled} onChange={(event) => onChange((current) => ({ ...current, showTitleInBody: event.target.checked }))} /><span>在正文中重复显示公众号标题</span></label>}
      <label className="field layout-brand-field"><span>固定开篇说明</span><textarea rows={2} maxLength={1200} value={value.brandHeaderText ?? ''} disabled={disabled} placeholder="例如：栏目定位、作者说明或内容提示" onChange={(event) => onChange((current) => ({ ...current, brandHeaderText: event.target.value }))} /></label>
      <label className="field layout-brand-field"><span>固定文末署名</span><textarea rows={2} maxLength={1200} value={value.brandFooterText ?? ''} disabled={disabled} placeholder="例如：关注提示、版权说明或品牌落款" onChange={(event) => onChange((current) => ({ ...current, brandFooterText: event.target.value }))} /></label>
    </div>
  )
}
