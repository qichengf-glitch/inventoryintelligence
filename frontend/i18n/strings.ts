// frontend/i18n/strings.ts
import type { Lang } from "@/components/LanguageProvider";

type MultiLangString = {
  [key in Lang]: string;
};

export const strings = {
  navHome: {
    zh: "首页",
    en: "Home",
  } as MultiLangString,
  navInventory: {
    zh: "库存管理",
    en: "Inventory",
  } as MultiLangString,
  navDataset: {
    zh: "数据概览",
    en: "Dataset",
  } as MultiLangString,

  homeTitle: {
    zh: "Inventory Intelligence",
    en: "Inventory Intelligence",
  } as MultiLangString,
  homeWelcome: {
    zh: "欢迎使用！",
    en: "Welcome!",
  } as MultiLangString,
  homeQuestionLabel: {
    zh: "请问今天想问些什么？",
    en: "What would you like to ask today?",
  } as MultiLangString,
  homeInputPlaceholder: {
    zh: "请输入问题",
    en: "Enter your question",
  } as MultiLangString,

  btnUploadInventory: {
    zh: "上传库存数据",
    en: "Upload Inventory",
  } as MultiLangString,
  btnDatabase: {
    zh: "数据库",
    en: "Database",
  } as MultiLangString,
  btnForecast: {
    zh: "需求预测",
    en: "Demand Forecast",
  } as MultiLangString,
};
