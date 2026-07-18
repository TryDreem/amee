import type { Lang } from "./theme";

export interface Strings {
  themeLabel: string;
  languageLabel: string;
  appearanceLabel: string;
  dark: string;
  light: string;

  myProjects: string;
  createProject: string;
  createFirst: string;
  emptyTitle: string;
  emptyText: string;
  projectWord: (n: number) => string;
  thumbLabel: string;

  backToProjects: string;
  openInEditor: string;
  newProject: string;
  newProjectSub: string;
  dragHere: string;
  orClick: string;
  upTo4k: string;
  upTo2gb: string;
  upTo10min: string;

  procQueued: string;
  procPreparing: string;
  procTranscribing: string;
  procGeneratingPreview: string;
  procDone: string;
  procDoneSub: string;
  procFailed: string;
  retry: string;
}

export const STR: Record<Lang, Strings> = {
  ru: {
    themeLabel: "Тема",
    languageLabel: "Язык",
    appearanceLabel: "Оформление",
    dark: "Тёмная",
    light: "Светлая",

    myProjects: "Мои проекты",
    createProject: "Создать проект",
    createFirst: "Создать первый проект",
    emptyTitle: "У вас пока нет проектов",
    emptyText:
      "Загрузите видео — мы автоматически сгенерируем субтитры, а вы сможете оформить их по своему вкусу",
    projectWord: (n) => (n === 1 ? "проект" : "проекта"),
    thumbLabel: "кадр видео",

    backToProjects: "К проектам",
    openInEditor: "Открыть в редакторе",
    newProject: "Новый проект",
    newProjectSub: "Загрузите видео, чтобы начать работу с субтитрами",
    dragHere: "Перетащите видео сюда",
    orClick: "или нажмите, чтобы выбрать файл",
    upTo4k: "до 4K",
    upTo2gb: "до 2 ГБ",
    upTo10min: "до 10 минут",

    procQueued: "Ждём очереди…",
    procPreparing: "Готовим ваше видео…",
    procTranscribing: "Распознаём речь…",
    procGeneratingPreview: "Собираем превью…",
    procDone: "Всё готово!",
    procDoneSub: "Черновые субтитры готовы",
    procFailed: "Не получилось обработать видео",
    retry: "Повторить",
  },
  en: {
    themeLabel: "Theme",
    languageLabel: "Language",
    appearanceLabel: "Appearance",
    dark: "Dark",
    light: "Light",

    myProjects: "My projects",
    createProject: "Create project",
    createFirst: "Create first project",
    emptyTitle: "You don't have any projects yet",
    emptyText: "Upload a video — we'll auto-generate subtitles you can then style to your taste",
    projectWord: (n) => (n === 1 ? "project" : "projects"),
    thumbLabel: "video frame",

    backToProjects: "Back to projects",
    openInEditor: "Open in editor",
    newProject: "New project",
    newProjectSub: "Upload a video to start working with subtitles",
    dragHere: "Drag video here",
    orClick: "or click to choose a file",
    upTo4k: "up to 4K",
    upTo2gb: "up to 2GB",
    upTo10min: "up to 10 min",

    procQueued: "Waiting in queue…",
    procPreparing: "Preparing your video…",
    procTranscribing: "Transcribing speech…",
    procGeneratingPreview: "Building the preview…",
    procDone: "All done!",
    procDoneSub: "Draft captions are ready",
    procFailed: "Something went wrong processing your video",
    retry: "Retry",
  },
};
