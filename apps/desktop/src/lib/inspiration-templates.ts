// Inspiration Plaza (灵感广场) content: a gallery of preset use-cases. Clicking a
// card behaves like a skill: it prefills the composer with `prompt` in a fresh
// chat AND binds a skill-grade role (inspirationSystemPrompt) to the session so
// the assistant works with the right expertise + method for the whole
// conversation. Pure content — edit freely, order doesn't matter.

export type InspirationCategory = '办公提效' | '娱乐游戏' | '研究学习' | '自律生活'

export interface InspirationCard {
  id: string
  category: InspirationCategory
  emoji: string
  title: string
  desc: string
  prompt: string
  /** Featured cards surface as the large hero banners at the top. */
  featured?: boolean
}

export const INSPIRATION_CATEGORIES: InspirationCategory[] = ['办公提效', '研究学习', '娱乐游戏', '自律生活']

// The skill-grade role each inspiration category takes on, so a clicked card
// runs with the right expertise instead of a bare prompt.
const INSPIRATION_ROLE: Record<InspirationCategory, string> = {
  办公提效: '高效办公助手,擅长把杂乱信息结构化、提炼要点、产出可直接使用的成果',
  研究学习: '学习教练与研究助手,擅长拆解知识、由浅入深地讲解、制定可执行的学习计划',
  娱乐游戏: '娱乐生活玩伴,擅长游戏攻略、影视与书籍推荐,轻松而实用',
  自律生活: '生活管家与自律教练,擅长规划日程、拆解目标、督促打卡与生活安排'
}

// Persistent system-prompt overlay bound to a chat started from an inspiration
// card (option "B"). Kept lightweight — a category role plus a shared working
// method — since cards are use-case starters rather than full personas.
export function inspirationSystemPrompt(card: InspirationCard): string {
  return [
    `你是一位${INSPIRATION_ROLE[card.category]}。`,
    '',
    '请在本次对话全程遵循以下工作方式:',
    '1. 先厘清我的真实目标与关键前提,信息不足时主动追问,再动手;',
    '2. 分步骤推进,给出具体、可执行的建议和成果,而非空泛结论;',
    '3. 主动指出注意事项与常见误区;不确定的地方如实说明,绝不编造。',
    '',
    '回答使用中文,力求简洁、结构清晰、重点突出。'
  ].join('\n')
}

export const INSPIRATION_CARDS: InspirationCard[] = [
  {
    id: 'daily-news-digest',
    category: '办公提效',
    emoji: '⏰',
    title: '创建定时任务:热点资讯自动汇总',
    desc: '不用每天到处找,自动整理每日热点,一条条推给你。',
    prompt:
      '帮我创建一个每天早上 8 点运行的定时任务:自动搜集昨天到今天的科技、财经、行业热点资讯,去重后整理成简洁的要点清单发给我。请先和我确认关注的领域和推送时间。',
    featured: true
  },
  {
    id: 'lazy-trip-plan',
    category: '自律生活',
    emoji: '🚌',
    title: '懒人出游规划',
    desc: '周末不知道去哪玩?直接喂到你嘴边。',
    prompt:
      '我想周末出去玩但懒得做攻略。请根据我的城市和偏好,给我一份两天一夜的出游方案:目的地、交通、每天的行程时间线、吃住推荐和预算。先问我出发城市和喜好。',
    featured: true
  },
  {
    id: 'invoice-filing',
    category: '办公提效',
    emoji: '🧾',
    title: '发票/单据智能归档',
    desc: '一到月末报销就火急火燎?把你乱七八糟的单据整理好。',
    prompt:
      '我有一堆发票和报销单据(图片/PDF),帮我逐张识别关键信息(日期、金额、类别、开票方),整理成一张可导出的报销表格,并按月汇总金额。'
  },
  {
    id: 'schedule-reminder',
    category: '办公提效',
    emoji: '📅',
    title: '日程安排/任务跟踪与提醒',
    desc: '每天任务太多,安排不过来怎么办?帮你管日程、盯进度、到点提醒。',
    prompt: '帮我梳理今天/本周的待办事项,按优先级排好日程,并为关键任务设置到点提醒。先让我把要做的事情列给你。'
  },
  {
    id: 'light-study-plan',
    category: '研究学习',
    emoji: '📗',
    title: '制定轻量学习规划',
    desc: '一到备考就头大?把你的学习计划安排得明明白白。',
    prompt:
      '我要在有限时间内学会某个主题/备考。请帮我制定一份轻量、可执行的学习计划:阶段目标、每天任务量、复习节点。先问我学习目标和可用时间。'
  },
  {
    id: 'goal-checkin',
    category: '自律生活',
    emoji: '✅',
    title: '拆解学习目标与督促打卡',
    desc: '立下的目标总忘?每天帮你盯进度,到点提醒你打卡。',
    prompt:
      '帮我把一个大目标拆解成每天/每周的小任务,并设计一个打卡督促机制,到点提醒我完成并记录进度。先问我目标是什么、截止时间。'
  },
  {
    id: 'knowledge-framework',
    category: '研究学习',
    emoji: '🧠',
    title: '知识点框架梳理',
    desc: '看了半天还是乱?帮你把知识点整理成一张清晰的框架图。',
    prompt: '帮我把某个主题的知识点梳理成结构化的框架(大纲/思维导图式的层级),标出重点和易混点。先问我是什么主题。'
  },
  {
    id: 'deep-explainer',
    category: '研究学习',
    emoji: '📖',
    title: '深度内容讲解',
    desc: '遇到难懂的点卡住了?帮你拆解卡点,找到破局之路。',
    prompt: '我有一段看不懂的内容/概念,请用通俗的方式深入浅出讲清楚,配例子和类比,并指出常见误区。我把内容发给你。'
  },
  {
    id: 'docs-structuring',
    category: '办公提效',
    emoji: '🗂️',
    title: '把一堆资料整理成结构化文档',
    desc: '收集来的资料乱成一团?把它们整理成一份有用的文档。',
    prompt:
      '我有一堆零散的资料(笔记/网页/片段),帮我去重、归类,整理成一份条理清晰、可直接使用的结构化文档,并给出目录。我把资料发给你。'
  },
  {
    id: 'meeting-notes',
    category: '办公提效',
    emoji: '📝',
    title: '会议纪要与待办提取',
    desc: '开完会一团乱?自动整理纪要,揪出每个人的待办。',
    prompt:
      '我把会议记录/录音转写发给你,帮我整理成规范的会议纪要:议题、结论、决议,并单独列出每个负责人的待办事项和截止时间。'
  },
  {
    id: 'writing-polish',
    category: '办公提效',
    emoji: '✍️',
    title: '文案润色与改写',
    desc: '写得不顺?帮你润色成更专业、更地道的表达。',
    prompt: '帮我润色下面这段文字,让它更清晰、专业、地道,同时保留原意。如果有更好的结构建议也一并给出。我把原文发给你。'
  },
  {
    id: 'trip-packing',
    category: '自律生活',
    emoji: '🎒',
    title: '出行打包清单',
    desc: '总怕漏带东西?按目的地和天数给你一份打包清单。',
    prompt:
      '我要出门旅行,帮我根据目的地、天数、天气和活动,生成一份分类清晰的打包清单(证件、衣物、电子、洗漱、药品等)。先问我目的地和天数。'
  },
  {
    id: 'game-guide',
    category: '娱乐游戏',
    emoji: '🎮',
    title: '游戏攻略/上手指南',
    desc: '新游戏无从下手?给你一份新手快速上手攻略。',
    prompt: '我想快速上手某款游戏,帮我整理一份新手指南:核心机制、开局思路、必备技巧和常见坑。先问我是什么游戏。'
  },
  {
    id: 'movie-recommend',
    category: '娱乐游戏',
    emoji: '🍿',
    title: '影视/书籍推荐',
    desc: '不知道看什么?根据口味给你精准安利。',
    prompt: '根据我的口味帮我推荐几部影视剧/几本书,说明推荐理由和适合的场景。先问我喜欢的类型和最近看过觉得不错的作品。'
  },
  {
    id: 'recipe-plan',
    category: '自律生活',
    emoji: '🍳',
    title: '一周食谱与采购清单',
    desc: '每天纠结吃什么?帮你排好一周食谱和买菜清单。',
    prompt: '帮我规划一周的家常食谱(营养均衡、好上手),并汇总成一份按品类分好的采购清单。先问我几口人、忌口和口味偏好。'
  }
]
