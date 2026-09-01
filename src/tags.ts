export interface TagGroup {
  name: string;
  color: string;
  tags: string[];
}

export const TAG_GROUPS: TagGroup[] = [
  { name: "频率", color: "#ee0a24", tags: ["高频", "中频", "低频"] },
  { name: "风格", color: "#07c160", tags: ["偏口语", "通用", "偏书面", "正式", "学术"] },
  {
    name: "表达功能",
    color: "#1989fa",
    tags: ["日常动作", "情绪感受", "态度立场", "观点评价", "人际交流", "描述人物", "描述事物", "空间位置", "时间顺序", "数量程度", "变化趋势"]
  },
  {
    name: "逻辑关系",
    color: "#7232dd",
    tags: ["因果", "对比", "转折", "递进", "条件", "让步", "举例", "总结", "强调", "顺序"]
  },
  {
    name: "场景主题",
    color: "#ff976a",
    tags: ["生活", "家庭", "工作", "教育", "科技", "AI", "商业", "经济", "环境", "社会", "新闻", "医疗健康", "自然生物", "交通旅行", "文化艺术"]
  },
  { name: "雅思用途", color: "#0fa5a5", tags: ["雅思口语", "雅思写作", "雅思阅读", "雅思听力"] },
  {
    name: "语言特征",
    color: "#b88230",
    tags: ["固定搭配", "常见介词", "一词多义", "易混词", "词性变化", "短语动词", "习语", "搭配词"]
  }
];

export const TAG_COLOR_MAP: Record<string, string> = {};
TAG_GROUPS.forEach((g) => {
  g.tags.forEach((t) => {
    TAG_COLOR_MAP[t] = g.color;
  });
});
