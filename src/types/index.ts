export interface WebProject {
  html: string;
  css: string;
  js: string;
  title: string;
}

export type ActiveTab = 'html' | 'css' | 'js';

export type ViewportMode = 'desktop' | 'tablet' | 'mobile';

export interface ConsoleLogItem {
  id: string;
  type: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: string;
}

export interface WebsiteTemplate {
  id: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  category: string;
  badge: string;
  html: string;
  css: string;
  js: string;
}

export interface AiHistoryItem {
  id: string;
  prompt: string;
  timestamp: string;
  action: 'create' | 'update' | 'fix';
  code: WebProject;
}
