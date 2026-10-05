/**
 * 创作流程 · 单一事实来源 (Single Source of Truth)
 *
 * 此前项目里存在三套互相冲突的导航定义：
 *   ① Layout.navGroups侧边栏分组
 *   ② PipelineSteps 顶部流水线
 *   ③ WorkContext STAGES 作品栏阶段
 * 三者对「评审 / 配图」的先后顺序说法不一，用户在不同位置看到相反的流程。
 *
 * 现在统一由本文件派生：侧边栏分组、顶部流水线、作品栏阶段全部从这里生成，
 * 顺序与命名从此只有一处可改。改流程只需改本文件。
 */

export type RouteId =
  | 'home'
  | 'accounts'
  | 'hotspots'
  | 'topics'
  | 'frameworks'
  | 'articles'
  | 'reviews'
  | 'visuals'
  | 'layouts'
  | 'publishing'
  | 'materials'
  | 'providers'
  | 'prompts'
  | 'data'

/** 侧边栏分组名 */
export type NavGroupTitle = '总览' | '准备' | '创作' | '发布'

/**
 * 创作主链路。顺序即用户实际创作顺序，三处导航全部按此顺序渲染。
 *
 * 阶段 id 与 RouteId 一致，便于直接 onNavigate(stage.id)。
 * sidebar:是否出现在侧边栏主链路中（素材库是资源区，不属于创作阶段）
 * workBar: 是否出现在「当前作品」阶段切换器中（只包含成稿之后的阶段）
 */
export interface FlowStage {
  id: RouteId
  /** 顶部流水线用的短标签 */
  label: string
  /** 侧边栏用的完整标签 */
  sidebarLabel: string
  /** 作品栏用的标签；缺省时复用 label */
  workBarLabel?: string
  group: NavGroupTitle
  /** 素材库是资源区，不属于创作阶段，因此不进入流水线 */
  inPipeline: boolean
  /** 作品栏只关心成稿之后的推进阶段 */
  inWorkBar: boolean
}

/**
 * 创作主链路。
 *
 * 关于「素材库」：它是选题与框架阶段的输入来源，不是一个创作阶段，
 * 因此不出现在顶部流水线里（避免用户以为要走完九步才能写文章），
 * 而是作为独立资源区放在侧边栏底部。
 */
export const CREATION_FLOW: readonly FlowStage[] = [
  { id: 'accounts',   label: '账号',   sidebarLabel: '账号定位', group: '准备', inPipeline: true,  inWorkBar: false },
  { id: 'hotspots',   label: '热点',   sidebarLabel: '热点洞察', group: '准备', inPipeline: true,  inWorkBar: false },
  { id: 'topics',     label: '选题',   sidebarLabel: '选题生成', group: '创作', inPipeline: true,  inWorkBar: false },
  { id: 'frameworks', label: '框架',   sidebarLabel: '内容框架', group: '创作', inPipeline: true,  inWorkBar: false },
  { id: 'articles',   label: '文章',   sidebarLabel: '文章创作', workBarLabel: '正文', group: '创作', inPipeline: true, inWorkBar: true },
  { id: 'reviews',    label: '评审',   sidebarLabel: '内容评审', group: '创作', inPipeline: true,  inWorkBar: true  },
  { id: 'visuals',    label: '配图',   sidebarLabel: '智能配图', group: '创作', inPipeline: true,  inWorkBar: true  },
  { id: 'layouts',    label: '排版',   sidebarLabel: '文章排版', group: '创作', inPipeline: true,  inWorkBar: true  },
  { id: 'publishing', label: '发布',   sidebarLabel: '发布管理', group: '发布', inPipeline: true,  inWorkBar: true  }
] as const

/** 侧边栏分组渲染顺序 */
export const NAV_GROUP_ORDER: readonly NavGroupTitle[] = ['总览', '准备', '创作', '发布'] as const

/** 顶部流水线：只取创作主链路 */
export const PIPELINE_STAGES = CREATION_FLOW.filter((stage) => stage.inPipeline)

/** 作品栏阶段：只取成稿之后的推进阶段 */
export const WORKBAR_STAGES = CREATION_FLOW.filter((stage) => stage.inWorkBar)

/** 总览（创作台）是入口，不属于创作阶段 */
export const HOME_STAGE = { id: 'home' as RouteId, label: '创作台', sidebarLabel: '创作台', group: '总览' as NavGroupTitle }

/**
 * 资源区：不属于创作链路，但在创作过程中会被反复访问。
 * 放在侧边栏独立分区，避免与创作阶段混在一起造成顺序误读。
 */
export const RESOURCE_ROUTES: readonly RouteId[] = ['materials'] as const

/** 全部可路由的 RouteId（用于路径合法性校验，避免再维护一份手写清单） */
export const ALL_ROUTE_IDS: readonly RouteId[] = [
  HOME_STAGE.id,
  ...CREATION_FLOW.map((stage) => stage.id),
  ...RESOURCE_ROUTES,
  'providers',
  'prompts',
  'data'
] as const

/** 面包屑分组名（系统页归入「系统」） */
export const SYSTEM_GROUP = '系统'

/** 非创作链路的页面（资源区与系统设置）标签与分组 */
const EXTRA_ROUTES = {
  materials: { label: '素材库', group: '资源' },
  data: { label: '数据与备份', group: SYSTEM_GROUP },
  providers: { label: 'AI 服务', group: SYSTEM_GROUP },
  prompts: { label: '提示词', group: SYSTEM_GROUP }
} as const satisfies Record<string, { label: string; group: string }>

/**
 * 路由 → 面包屑标签 / 分组。
 * 由 CREATION_FLOW + EXTRA_ROUTES + HOME 合并而成。
 * 刻意用显式循环而非 Object.fromEntries —— 后者返回 index signature，
 * 无法通过 Record<RouteId, string> 的完整性检查（TS2740）。
 */
export const ROUTE_LABELS = {} as Record<RouteId, string>
export const ROUTE_GROUPS = {} as Record<RouteId, string>

ROUTE_LABELS[HOME_STAGE.id] = HOME_STAGE.sidebarLabel
ROUTE_GROUPS[HOME_STAGE.id] = HOME_STAGE.group
for (const stage of CREATION_FLOW) {
  ROUTE_LABELS[stage.id] = stage.sidebarLabel
  ROUTE_GROUPS[stage.id] = stage.group
}
for (const [id, meta] of Object.entries(EXTRA_ROUTES)) {
  ROUTE_LABELS[id as RouteId] = meta.label
  ROUTE_GROUPS[id as RouteId] = meta.group
}

/** 生成侧边栏主链路分组（不含总览与资源区） */
export function buildSidebarGroups(): Array<{ title: NavGroupTitle; items: FlowStage[] }> {
  return NAV_GROUP_ORDER
    .filter((title) => title !== '总览')
    .map((title) => ({
      title,
      items: CREATION_FLOW.filter((stage) => stage.group === title)
    }))
    .filter((group) => group.items.length > 0)
}
