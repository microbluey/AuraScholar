import {
  RETRIEVAL_EVALUATION_SCHEMA_VERSION,
  type BilingualRetrievalLanguage,
  type RetrievalEvaluationContentUnit,
  type RetrievalEvaluationDataset,
  type RetrievalEvaluationQuery,
} from "./retrieval-evaluation.js";

interface DevelopmentTopic {
  readonly discipline: string;
  readonly en: TopicLanguageText;
  readonly id: string;
  readonly supportTopicId: string;
  readonly zh: TopicLanguageText;
}

interface TopicLanguageText {
  readonly content: string;
  readonly crossLanguageQuery: string;
  readonly sameLanguageQuery: string;
}

const labelProvenance = {
  generator: "aurascholar-bilingual-development-corpus-v1",
  kind: "synthetic",
} as const;

const topics: readonly DevelopmentTopic[] = [
  {
    discipline: "research-methods",
    en: {
      content:
        "Cross-validation rotates training and validation folds to estimate error on observations that were not used for fitting.",
      crossLanguageQuery:
        "Which Chinese-described method rotates held-out portions of a dataset to assess a model's generalization?",
      sameLanguageQuery:
        "What validation arrangement estimates a predictive model's error beyond the examples used for fitting?",
    },
    id: "methods-validation",
    supportTopicId: "methods-resampling",
    zh: {
      content: "交叉验证轮换训练集与验证集，用来估计模型在未参与拟合的观测上的误差。",
      crossLanguageQuery:
        "为了从英文研究材料中找出评估模型泛化的办法，应搜索哪一种轮换留出样本的设计？",
      sameLanguageQuery: "研究者要估计预测模型离开训练数据后会有多大误差，应采用什么验证安排？",
    },
  },
  {
    discipline: "research-methods",
    en: {
      content:
        "Bootstrap resampling repeatedly draws from an observed sample to quantify the stability and uncertainty of an estimate.",
      crossLanguageQuery:
        "What Chinese method repeatedly draws from the collected sample to describe statistical uncertainty?",
      sameLanguageQuery:
        "Which repeated-sampling technique quantifies the stability of an estimate from an observed dataset?",
    },
    id: "methods-resampling",
    supportTopicId: "methods-validation",
    zh: {
      content: "自助法从现有样本反复重采样，可量化估计值的稳定性和不确定性。",
      crossLanguageQuery:
        "英文方法文献中哪种从观测样本反复抽取并重新计算统计量的做法可估计不确定性？",
      sameLanguageQuery: "若想了解统计估计在已有样本上的稳定程度，可使用哪种重复抽样技术？",
    },
  },
  {
    discipline: "public-health",
    en: {
      content:
        "Incidence counts new cases during a period, whereas prevalence describes the proportion of a population living with an existing condition.",
      crossLanguageQuery:
        "Which Chinese epidemiology explanation distinguishes newly occurring cases from the share of people already affected?",
      sameLanguageQuery:
        "Which measures distinguish newly arising cases over time from the proportion of people who already have a condition?",
    },
    id: "health-frequency",
    supportTopicId: "health-contact-tracing",
    zh: {
      content: "发病率统计一段时间内的新病例，患病率表示人群中已有某种状况者的比例。",
      crossLanguageQuery: "在英文流行病学资料里，哪一段解释了新出现病例与已有病例比例的区别？",
      sameLanguageQuery: "如何区分某时期新出现的病例数量和人群中已经患病者所占比例？",
    },
  },
  {
    discipline: "public-health",
    en: {
      content:
        "Contact tracing records close exposures during a case's infectious period so that people can be notified and offered testing or public-health follow-up.",
      crossLanguageQuery:
        "What Chinese public-health process documents close exposures around a case so contacts can be notified?",
      sameLanguageQuery:
        "Which public-health process records close exposures around a case in order to notify and follow up with contacts?",
    },
    id: "health-contact-tracing",
    supportTopicId: "health-frequency",
    zh: {
      content: "接触者追踪记录病例传染期内的近距离接触，以便通知相关人员并安排检测或公共卫生随访。",
      crossLanguageQuery: "英文公共卫生材料中，哪项流程会记录病例周围的密切接触者并进行通知？",
      sameLanguageQuery: "为通知并随访可能暴露的人群，公共卫生工作会采用什么记录接触的流程？",
    },
  },
  {
    discipline: "climate-science",
    en: {
      content:
        "A carbon budget links cumulative carbon-dioxide emissions to a probability of limiting warming; continued emissions consume the remaining budget.",
      crossLanguageQuery:
        "Which Chinese climate concept connects total carbon-dioxide emissions with the chance of staying below a warming limit?",
      sameLanguageQuery:
        "What climate concept relates cumulative carbon-dioxide emissions to the probability of remaining below a temperature limit?",
    },
    id: "climate-carbon-budget",
    supportTopicId: "climate-urban-heat",
    zh: {
      content: "碳预算把累计二氧化碳排放与限制升温的概率联系起来，持续排放会消耗剩余预算。",
      crossLanguageQuery:
        "英文气候资料中，哪一个概念把累计二氧化碳排放和控制升温的可能性联系在一起？",
      sameLanguageQuery: "要讨论持续排放如何减少控制升温的余地，应查找什么气候概念？",
    },
  },
  {
    discipline: "climate-science",
    en: {
      content:
        "Urban heat islands arise when dense buildings, dark pavement, and limited vegetation cause built-up areas to remain warmer than nearby surroundings, especially at night.",
      crossLanguageQuery:
        "What Chinese environmental explanation links dense construction, dark surfaces, and sparse vegetation to warmer city nights?",
      sameLanguageQuery:
        "Which urban-climate effect makes built-up districts warmer than nearby surroundings because of pavement, buildings, and limited vegetation?",
    },
    id: "climate-urban-heat",
    supportTopicId: "climate-carbon-budget",
    zh: {
      content: "城市热岛由密集建筑、深色铺装和较少植被等因素造成，使城区夜间常比周边更暖。",
      crossLanguageQuery: "英文环境研究中，哪种现象说明铺装、建筑密度和植被不足会让城区夜间偏暖？",
      sameLanguageQuery: "为什么有些城市街区在夜晚比周边地区更热，且与铺装和植被有关？",
    },
  },
  {
    discipline: "digital-humanities",
    en: {
      content:
        "Archival provenance preserves the relationship between records, their creator, and their original arrangement so unrelated materials are not merged into one source.",
      crossLanguageQuery:
        "Which Chinese archival principle keeps records connected to their creator and original arrangement?",
      sameLanguageQuery:
        "What archival principle keeps records associated with their creator and original arrangement instead of mixing unrelated materials?",
    },
    id: "humanities-provenance",
    supportTopicId: "humanities-ocr",
    zh: {
      content: "档案来源原则要求保存文件产生者及原有排列的关系，避免把不相干的材料混为同一来源。",
      crossLanguageQuery: "英文档案学资料中，哪项原则强调文件产生者和原有排列应被保留？",
      sameLanguageQuery: "整理档案时，怎样避免把来自不同形成者的材料误当作同一来源？",
    },
  },
  {
    discipline: "digital-humanities",
    en: {
      content:
        "Low optical-character-recognition confidence can result from complex layouts, historical typefaces, or scan noise, so sampled manual checks are needed before analysis.",
      crossLanguageQuery:
        "Which Chinese digitisation note explains why difficult layouts or noisy scans require manual checks of OCR output?",
      sameLanguageQuery:
        "Why should a digitisation project manually sample OCR output when pages have historical typefaces, complex layouts, or scan noise?",
    },
    id: "humanities-ocr",
    supportTopicId: "humanities-provenance",
    zh: {
      content: "复杂版面、旧字体和扫描噪声会降低文字识别置信度，因此分析前需要抽样人工核对。",
      crossLanguageQuery:
        "英文数字人文材料中，哪一段说明旧字体和扫描噪声会让文字识别结果需要人工抽查？",
      sameLanguageQuery: "面对旧字体、复杂排版和扫描噪声，为什么文本识别后仍要抽样人工检查？",
    },
  },
];

/**
 * Visible, original-text calibration corpus for development and pull-request
 * regression checks. Its labels are intentionally marked synthetic: this is
 * not a held-out corpus and must never be presented as human-reviewed evidence
 * for selecting a released embedding profile.
 */
export const BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1: RetrievalEvaluationDataset = {
  contentUnits: topics.flatMap((topic) => [
    contentUnitFor(topic, "zh"),
    contentUnitFor(topic, "en"),
  ]),
  id: "aurascholar-bilingual-development-v1",
  queries: topics.flatMap((topic) => [
    queryFor(topic, "zh", "zh", topic.zh.sameLanguageQuery),
    queryFor(topic, "en", "en", topic.en.sameLanguageQuery),
    queryFor(topic, "zh", "en", topic.zh.crossLanguageQuery),
    queryFor(topic, "en", "zh", topic.en.crossLanguageQuery),
  ]),
  schemaVersion: RETRIEVAL_EVALUATION_SCHEMA_VERSION,
  split: "development",
  version: "1.0.0",
};

function contentUnitFor(
  topic: DevelopmentTopic,
  language: BilingualRetrievalLanguage,
): RetrievalEvaluationContentUnit {
  return {
    id: contentUnitId(topic.id, language),
    language,
    sourceId: `source:development:${topic.id}:${language}`,
    text: topic[language].content,
  };
}

function queryFor(
  topic: DevelopmentTopic,
  language: BilingualRetrievalLanguage,
  targetLanguage: BilingualRetrievalLanguage,
  text: string,
): RetrievalEvaluationQuery {
  return {
    discipline: topic.discipline,
    id: `query:development:${topic.id}:${language}-${targetLanguage}`,
    labelProvenance,
    language,
    relevanceJudgments: [
      { contentUnitId: contentUnitId(topic.id, targetLanguage), relevance: 3 },
      { contentUnitId: contentUnitId(topic.supportTopicId, targetLanguage), relevance: 1 },
    ],
    targetLanguage,
    text,
  };
}

function contentUnitId(topicId: string, language: BilingualRetrievalLanguage): string {
  return `unit:development:${topicId}:${language}`;
}
