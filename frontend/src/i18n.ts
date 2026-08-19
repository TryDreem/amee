import { EDIT_MAX_CHARS_PER_SEGMENT, EDIT_MAX_WORDS_PER_SEGMENT } from "./lib/ecsEdit";
import type { Lang } from "./theme";

export interface Strings {
  themeLabel: string;
  languageLabel: string;
  appearanceLabel: string;
  dark: string;
  light: string;

  accountButtonLabel: string;
  notRegisteredYet: string;
  signIn: string;
  continueAsGuest: string;
  continueWithGoogle: string;
  projectsUploadedLabel: (used: number, cap: number) => string;
  logOut: string;
  changePhotoLabel: string;
  photoUploadError: string;

  myProjects: string;
  createProject: string;
  createFirst: string;
  emptyTitle: string;
  emptyText: string;
  projectWord: (n: number) => string;
  thumbLabel: string;
  searchPlaceholder: string;
  sortByLabel: string;
  sortLabels: Record<"newest" | "oldest" | "updated" | "az" | "za" | "opened", string>;
  pageOf: (page: number, totalPages: number) => string;
  shownOf: (shown: number, total: number) => string;
  deleteTitle: string;
  confirmDeleteTitle: string;
  deleteFailedActiveJob: string;
  exportedBadgeLabel: string;

  backToProjects: string;
  openInEditor: string;
  newProject: string;
  newProjectSub: string;
  dragHere: string;
  orClick: string;
  upTo4k: string;
  // Match the backend's real enforced limits (services/projects.py::_MAX_UPLOAD_BYTES,
  // workers/tasks.py::_MAX_VIDEO_DURATION_SECONDS, api-contract.md §15) -- these used to say
  // "2GB"/"10 min", which contradicted the actual 100MB/1min caps the backend now rejects
  // uploads against. See lib/limits.ts for the matching project-count cap.
  upTo100mb: string;
  upTo1min: string;

  videoLanguageLabel: string;
  autoDetect: string;

  procQueued: string;
  procPreparing: string;
  procTranscribing: string;
  procGeneratingPreview: string;
  procDone: string;
  procDoneSub: string;
  procFailed: string;
  procKeepsRunning: string;
  transcribeReadyToast: string;
  transcribeFailedToast: string;
  retry: string;

  addWord: string;
  addWordLeft: string;
  addWordRight: string;
  splitSegment: string;
  removeWord: string;
  editSegmentStyle: string;
  deleteSegment: string;
  deleteSegmentConfirm: string;
  sceneDuration: string;
  close: string;
  range: string;
  yes: string;
  no: string;
  noticeMaxWords: string;
  noticeMaxChars: string;
  noticeNoRoom: string;

  save: string;
  saving: string;
  saved: string;
  saveFailed: string;
  export: string;
  undo: string;
  redo: string;
  downloadSrt: string;
  exportSubsOnly: string;
  exporting: string;
  exportFailed: string;
  notAvailableYet: string;
  downloadLastExport: string;
  projectSaved: string;
  exportDone: string;
  exportCancelled: string;
  exportCancel: string;
  returnToMenu: string;
  continueEditing: string;
  returnToEditor: string;
  exportOpen: string;
  exportDownload: string;
  exportsInProgress: (n: number) => string;

  captionsStyleLabel: string;
  captionsLabel: string;
  editCaptionsLabel: string;
  stylePanelPlaceholder: string;
  styleSameForAll: string;
  styleEachPhrase: string;

  presetsLabel: string;
  styleSectionLabel: string;
  fontSizeLabel: string;
  captionPositionLabel: string;
  highlightColorsLabel: string;
  fontWeightLabel: string;
  uppercaseLabel: string;
  italicLabel: string;
  glowLabel: string;
  showPunctuationLabel: string;
  outlineLabel: string;
  shadowLabel: string;
  sizeNone: string;
  sizeSmall: string;
  sizeMedium: string;
  sizeLarge: string;
  mainColorLabel: string;
  secondColorLabel: string;
  thirdColorLabel: string;
  moreOptions: string;
  lessOptions: string;
  shadowColorLabel: string;
  outlineColorLabel: string;

  captionAnimationLabel: string;
  revealModeLabel: string;
  revealModeProgressive: string;
  revealModeSingleWord: string;
  chips: {
    All: string;
    Favorites: string;
    Cyrillic: string;
    Latin: string;
    Bold: string;
    Minimal: string;
    Colorful: string;
    Script: string;
  };
}

export const STR: Record<Lang, Strings> = {
  ru: {
    themeLabel: "Тема",
    languageLabel: "Язык",
    appearanceLabel: "Оформление",
    dark: "Тёмная",
    light: "Светлая",

    accountButtonLabel: "Аккаунт",
    notRegisteredYet: "Вы ещё не зарегистрированы",
    signIn: "Войти",
    continueAsGuest: "Продолжить как гость",
    continueWithGoogle: "Продолжить через Google",
    projectsUploadedLabel: (used, cap) => `${used}/${cap} проектов загружено`,
    logOut: "Выйти",
    changePhotoLabel: "Сменить фото",
    photoUploadError: "Не удалось обновить фото. Попробуйте ещё раз.",

    myProjects: "Мои проекты",
    createProject: "Создать проект",
    createFirst: "Создать первый проект",
    emptyTitle: "У вас пока нет проектов",
    emptyText:
      "Загрузите видео — мы автоматически сгенерируем субтитры, а вы сможете оформить их по своему вкусу",
    projectWord: (n) => (n === 1 ? "проект" : "проекта"),
    thumbLabel: "кадр видео",
    searchPlaceholder: "Поиск...",
    sortByLabel: "Сортировка",
    sortLabels: {
      newest: "Новые",
      oldest: "Старые",
      updated: "По обновлению",
      az: "А-Я",
      za: "Я-А",
      opened: "Недавно открытые",
    },
    pageOf: (p, t) => `Страница ${p} из ${t}`,
    shownOf: (n, total) => `Показано ${n} из ${total}`,
    deleteTitle: "Удалить проект",
    confirmDeleteTitle: "Удалить проект?",
    deleteFailedActiveJob: "Нельзя удалить — идёт распознавание речи. Дождитесь завершения.",
    exportedBadgeLabel: "Экспортировано",

    backToProjects: "К проектам",
    openInEditor: "Открыть в редакторе",
    newProject: "Новый проект",
    newProjectSub: "Загрузите видео, чтобы начать работу с субтитрами",
    dragHere: "Перетащите видео сюда",
    orClick: "или нажмите, чтобы выбрать файл",
    upTo4k: "до 4K",
    upTo100mb: "до 100 МБ",
    upTo1min: "до 1 минуты",

    videoLanguageLabel: "Язык видео",
    autoDetect: "Автоопределение",

    procQueued: "Ждём очереди…",
    procPreparing: "Готовим ваше видео…",
    procTranscribing: "Распознаём речь…",
    procGeneratingPreview: "Собираем превью…",
    procDone: "Всё готово!",
    procDoneSub: "Черновые субтитры готовы",
    procKeepsRunning: "Обработка продолжится в фоне — мы сообщим, когда будет готово",
    transcribeReadyToast: "Субтитры готовы",
    transcribeFailedToast: "Не удалось обработать видео",
    procFailed: "Не получилось обработать видео",
    retry: "Повторить",

    addWord: "Добавить слово",
    addWordLeft: "Добавить слово слева",
    addWordRight: "Добавить слово справа",
    splitSegment: "Разбить сегмент",
    removeWord: "Удалить слово",
    editSegmentStyle: "Стиль этого сегмента",
    deleteSegment: "Удалить сегмент",
    deleteSegmentConfirm: "Удалить этот сегмент?",
    sceneDuration: "Длительность сцены",
    close: "Закрыть",
    range: "Диапазон",
    yes: "Да",
    no: "Нет",
    noticeMaxWords: `Максимум ${EDIT_MAX_WORDS_PER_SEGMENT} слов в сегменте`,
    noticeMaxChars: `Максимум ${EDIT_MAX_CHARS_PER_SEGMENT} символов в сегменте`,
    noticeNoRoom: "Недостаточно места для нового слова",

    save: "Сохранить",
    saving: "Сохраняем…",
    saved: "Сохранено",
    saveFailed: "Не удалось сохранить",
    export: "Экспорт",
    undo: "Отменить",
    redo: "Повторить",
    downloadSrt: "Скачать файл .srt",
    exportSubsOnly: "Экспортировать только субтитры (зелёный фон)",
    exporting: "Экспортируем…",
    exportFailed: "Не удалось экспортировать",
    notAvailableYet: "Пока недоступно",
    downloadLastExport: "Скачать последний экспорт",
    projectSaved: "Проект сохранён",
    exportDone: "Экспорт завершён",
    exportCancelled: "Экспорт отменён",
    exportCancel: "Отмена",
    returnToMenu: "Вернуться в главное меню",
    continueEditing: "Продолжить редактирование",
    returnToEditor: "Вернуться в редактор",
    exportOpen: "Открыть",
    exportDownload: "Скачать",
    exportsInProgress: (n) => `${n} ${n === 1 ? "экспорт" : "экспорта"} в процессе`,

    captionsStyleLabel: "Стиль субтитров",
    captionsLabel: "Субтитры",
    editCaptionsLabel: "Редактировать субтитры",
    stylePanelPlaceholder: "Панель стилей появится здесь",
    styleSameForAll: "Стиль: единый",
    styleEachPhrase: "Стиль: для каждой фразы",

    presetsLabel: "Пресеты",
    styleSectionLabel: "Стиль",
    fontSizeLabel: "Размер шрифта",
    captionPositionLabel: "Позиция субтитров",
    highlightColorsLabel: "Цвета выделения",
    fontWeightLabel: "Насыщенность шрифта",
    uppercaseLabel: "Заглавные буквы",
    italicLabel: "Курсив",
    glowLabel: "Свечение",
    showPunctuationLabel: "Показывать пунктуацию",
    outlineLabel: "Обводка",
    shadowLabel: "Тень",
    sizeNone: "Нет",
    sizeSmall: "Малая",
    sizeMedium: "Средняя",
    sizeLarge: "Крупная",
    mainColorLabel: "Основной",
    secondColorLabel: "Второй",
    thirdColorLabel: "Третий",
    moreOptions: "Больше опций",
    lessOptions: "Меньше опций",
    shadowColorLabel: "Цвет тени",
    outlineColorLabel: "Цвет обводки",

    captionAnimationLabel: "Анимация",
    revealModeLabel: "Как показывать",
    revealModeProgressive: "По словам",
    revealModeSingleWord: "Одно слово",
    chips: {
      All: "Все",
      Favorites: "Избранное",
      Cyrillic: "Кириллица",
      Latin: "Латиница",
      Bold: "Жирный",
      Minimal: "Минимал",
      Colorful: "Цветной",
      Script: "Скрипт",
    },
  },
  en: {
    themeLabel: "Theme",
    languageLabel: "Language",
    appearanceLabel: "Appearance",
    dark: "Dark",
    light: "Light",

    accountButtonLabel: "Account",
    notRegisteredYet: "You haven't registered yet",
    signIn: "Sign in",
    continueAsGuest: "Continue as guest",
    continueWithGoogle: "Continue with Google",
    projectsUploadedLabel: (used, cap) => `${used}/${cap} projects uploaded`,
    logOut: "Log out",
    changePhotoLabel: "Change photo",
    photoUploadError: "Couldn't update your photo. Try again.",

    myProjects: "My projects",
    createProject: "Create project",
    createFirst: "Create first project",
    emptyTitle: "You don't have any projects yet",
    emptyText: "Upload a video — we'll auto-generate subtitles you can then style to your taste",
    projectWord: (n) => (n === 1 ? "project" : "projects"),
    thumbLabel: "video frame",
    searchPlaceholder: "Search...",
    sortByLabel: "Sort by",
    sortLabels: {
      newest: "Newest",
      oldest: "Oldest",
      updated: "Last updated",
      az: "A-Z",
      za: "Z-A",
      opened: "Recently opened",
    },
    pageOf: (p, t) => `Page ${p} of ${t}`,
    shownOf: (n, total) => `Showing ${n} of ${total}`,
    deleteTitle: "Delete project",
    confirmDeleteTitle: "Delete project?",
    deleteFailedActiveJob: "Can't delete — transcription is still running. Wait for it to finish.",
    exportedBadgeLabel: "Exported",

    backToProjects: "Back to projects",
    openInEditor: "Open in editor",
    newProject: "New project",
    newProjectSub: "Upload a video to start working with subtitles",
    dragHere: "Drag video here",
    orClick: "or click to choose a file",
    upTo4k: "up to 4K",
    upTo100mb: "up to 100MB",
    upTo1min: "up to 1 min",

    videoLanguageLabel: "Video language",
    autoDetect: "Auto detect",

    procQueued: "Waiting in queue…",
    procPreparing: "Preparing your video…",
    procTranscribing: "Transcribing speech…",
    procGeneratingPreview: "Building the preview…",
    procDone: "All done!",
    procDoneSub: "Draft captions are ready",
    procKeepsRunning: "Processing keeps running in the background — we'll let you know when it's done",
    transcribeReadyToast: "Captions are ready",
    transcribeFailedToast: "Could not process the video",
    procFailed: "Something went wrong processing your video",
    retry: "Retry",

    addWord: "Add word",
    addWordLeft: "Add word left",
    addWordRight: "Add word right",
    splitSegment: "Split segment",
    removeWord: "Remove word",
    editSegmentStyle: "Style this segment",
    deleteSegment: "Delete segment",
    deleteSegmentConfirm: "Delete this segment?",
    sceneDuration: "Scene Duration",
    close: "Close",
    range: "Range",
    yes: "Yes",
    no: "No",
    noticeMaxWords: `Max ${EDIT_MAX_WORDS_PER_SEGMENT} words per segment`,
    noticeMaxChars: `Max ${EDIT_MAX_CHARS_PER_SEGMENT} characters per segment`,
    noticeNoRoom: "Not enough room for a new word",

    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    saveFailed: "Failed to save",
    export: "Export",
    undo: "Undo",
    redo: "Redo",
    downloadSrt: "Download srt file",
    exportSubsOnly: "Export only subtitles (green background)",
    exporting: "Exporting…",
    exportFailed: "Export failed",
    notAvailableYet: "Not available yet",
    downloadLastExport: "Download last export",
    projectSaved: "Project saved",
    exportDone: "Export complete",
    exportCancelled: "Export cancelled",
    exportCancel: "Cancel",
    returnToMenu: "Return to main menu",
    continueEditing: "Continue editing",
    returnToEditor: "Return to editor",
    exportOpen: "Open",
    exportDownload: "Download",
    exportsInProgress: (n) => `${n} export${n === 1 ? "" : "s"} in progress`,

    captionsStyleLabel: "Captions Style",
    captionsLabel: "Captions",
    editCaptionsLabel: "Edit Captions",
    stylePanelPlaceholder: "Style panel coming here",
    styleSameForAll: "Style: same for all",
    styleEachPhrase: "Style: each phrase",

    presetsLabel: "Presets",
    styleSectionLabel: "Style",
    fontSizeLabel: "Font size",
    captionPositionLabel: "Caption position",
    highlightColorsLabel: "Highlight colors",
    fontWeightLabel: "Font weight",
    uppercaseLabel: "Uppercase",
    italicLabel: "Italic",
    glowLabel: "Glow",
    showPunctuationLabel: "Show punctuation",
    outlineLabel: "Outline",
    shadowLabel: "Shadow",
    sizeNone: "None",
    sizeSmall: "Small",
    sizeMedium: "Medium",
    sizeLarge: "Large",
    mainColorLabel: "Main",
    secondColorLabel: "Second",
    thirdColorLabel: "Third",
    moreOptions: "More options",
    lessOptions: "Less options",
    shadowColorLabel: "Shadow Color",
    outlineColorLabel: "Outline Color",

    captionAnimationLabel: "Animation",
    revealModeLabel: "Reveal",
    revealModeProgressive: "Word by word",
    revealModeSingleWord: "One word",
    chips: {
      All: "All",
      Favorites: "Favorites",
      Cyrillic: "Cyrillic",
      Latin: "Latin",
      Bold: "Bold",
      Minimal: "Minimal",
      Colorful: "Colorful",
      Script: "Script",
    },
  },
};
