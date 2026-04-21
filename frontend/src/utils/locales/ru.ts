export const ru = {
  // Header
  myTube: "MyTube",
  manage: "Управление",
  settings: "Настройки",
  logout: "Выйти",
  pleaseEnterUrlOrSearchTerm:
    "Пожалуйста, введите URL видео или поисковый запрос",
  unexpectedErrorOccurred:
    "Произошла непредвиденная ошибка. Пожалуйста, попробуйте снова.",
  uploadVideo: "Загрузить видео",
  enterUrlOrSearchTerm: "Введите URL видео или поисковый запрос",
  enterSearchTerm: "Введите поисковый запрос",
  manageVideos: "Управление видео",
  instruction: "Инструкция",


  // Home
  pasteUrl: "Вставьте URL видео или коллекции",
  download: "Скачать",
  search: "Поиск",
  recentDownloads: "Недавние загрузки",
  noDownloads: "Загрузок пока нет",
  downloadStarted: "Загрузка началась",
  downloadFailed: "Ошибка загрузки",
  downloadSuccess: "Загрузка успешно началась",
  confirmDownloadAllPlaylists:
    "Скачать все плейлисты с этого канала? Для каждого плейлиста будет создана коллекция.",
  downloadAll: "Скачать все",
  loadingVideos: "Загрузка видео...",
  searchResultsFor: "Результаты поиска для",
  fromYourLibrary: "Из вашей библиотеки",
  noMatchingVideos: "В вашей библиотеке нет подходящих видео.",
  fromYouTube: "С YouTube",
  loadingYouTubeResults: "Загрузка результатов YouTube...",
  noYouTubeResults: "Результаты YouTube не найдены",
  noVideosYet: "Видео пока нет. Отправьте URL видео, чтобы скачать первое!",
  views: "просмотров",


  // Settings
  general: "Общие",
  security: "Безопасность",
  videoDefaults: "Настройки плеера по умолчанию",
  downloadSettings: "Настройки загрузки",

  // Settings Categories
  basicSettings: "Основные настройки",
  interfaceDisplay: "Интерфейс и отображение",
  securityAccess: "Безопасность и доступ",
  videoPlayback: "Воспроизведение видео",
  downloadStorage: "Загрузка и хранение",
  contentManagement: "Управление контентом",
  dataManagement: "Управление данными",
  advanced: "Дополнительно",
  language: "Язык",
  websiteName: "Название веб-сайта",
  websiteNameHelper: "{current}/{max} символов (По умолчанию: {default})",
  theme: "Тема",
  themeLight: "Всегда светлая",
  themeDark: "Всегда темная",
  themeSystem: "Как в системе",
  showThemeButtonInHeader: "Показывать кнопку темы в заголовке",
  tmdbApiKey: "Ключ API TMDB",
  tmdbApiKeyHelper:
    "Ключ API TheMovieDB для получения метаданных и постеров фильмов/сериалов. Получите свой ключ на https://www.themoviedb.org/settings/api",
  testTmdbCredential: "Проверить учетные данные",
  tmdbCredentialMissing: "Сначала введите учетные данные TMDB.",
  tmdbCredentialValid: "Учетные данные TMDB действительны.",
  tmdbCredentialTestFailed: "Не удалось проверить учетные данные TMDB.",
  tmdbCredentialValidApiKey: "Ключ API TMDB действителен.",
  tmdbCredentialValidReadAccessToken:
    "Read Access Token TMDB действителен.",
  tmdbCredentialInvalid:
    "Учетные данные TMDB недействительны. Проверьте, что это действительный API-ключ или Read Access Token.",
  tmdbCredentialRequestFailed:
    "Не удалось подключиться к TMDB. Повторите попытку.",
  mountDirectories: "Подключенные директории",
  mountDirectoriesPlaceholder:
    "Введите подключенные директории (по одной на строку)\nПример:\n/mnt/media1\n/mnt/media2",
  mountDirectoriesHelper:
    "Введите директории, где хранятся видеофайлы, по одной директории на строку",
  mountDirectoriesEmptyError:
    "Пожалуйста, введите хотя бы одну подключенную директорию",
  infiniteScroll: "Бесконечная прокрутка",
  infiniteScrollDisabled: "Отключено, когда включена бесконечная прокрутка",
  maxVideoColumns: "Максимальное количество колонок видео (Главная страница)",
  videoColumns: "Колонки видео (Главная страница)",
  columnsCount: "{count} колонок",
  enableLogin: "Включить защиту входа",
  allowPasswordLogin: "Разрешить вход по паролю",
  allowPasswordLoginHelper:
    "При отключении вход по паролю недоступен. Для отключения входа по паролю необходимо иметь хотя бы один ключ доступа.",
  allowResetPassword: "Разрешить сброс пароля",
  allowResetPasswordHelper:
    "При отключении кнопка сброса пароля не будет отображаться на странице входа, а API сброса пароля будет заблокирована.",
  enableApiKeyAuth: "Включить аутентификацию по API-ключу",
  apiKeyAuthHelper:
    "При включении API-запросы могут быть авторизованы с помощью X-API-Key без сеанса входа.",
  apiKey: "API-ключ",
  refreshApiKey: "Обновить",
  refreshApiKeyTitle: "Обновить API-ключ",
  refreshApiKeyConfirm: "Генерация нового API-ключа сделает текущий недействительным. Все клиенты, использующие старый ключ, должны быть обновлены после сохранения.",
  copyApiKey: "Копировать",
  apiKeySaveHint: "Сохраните настройки, чтобы активировать изменения API-ключа.",
  apiKeyCopied: "API-ключ скопирован в буфер обмена",
  apiKeyCopyFailed: "Не удалось скопировать API-ключ. Пожалуйста, скопируйте его вручную.",
  password: "Пароль",
  enterPassword: "Введите пароль",
  togglePasswordVisibility: "Показать/скрыть пароль",
  passwordHelper:
    "Оставьте пустым, чтобы сохранить текущий пароль, или введите новый для изменения",
  passwordSetHelper: "Установите пароль для доступа к приложению",
  autoPlay: "Автовоспроизведение видео при загрузке",
  autoLoop: "Автоповтор видео",
  maxConcurrent: "Макс. одновременных загрузок",
  maxConcurrentDescription:
    "Ограничивает количество одновременных загрузок, включая обычные загрузки и задачи непрерывной подписки.",
  dontSkipDeletedVideo: "Не пропускать удаленные видео",
  dontSkipDeletedVideoDescription:
    "При включении видео со статусом удалено будут автоматически перезагружены вместо пропуска.",
  preferredAudioLanguage: "Предпочитаемый язык аудио",
  preferredAudioLanguageDescription:
    "При наличии мультиаудио на YouTube будет предпочитаться эта языковая дорожка.",
  preferredAudioLanguageDefault: "По умолчанию",
  preferredAudioLanguage_en: "Английский",
  preferredAudioLanguage_zh: "Китайский",
  preferredAudioLanguage_ja: "Японский",
  preferredAudioLanguage_ko: "Корейский",
  preferredAudioLanguage_es: "Испанский",
  preferredAudioLanguage_fr: "Французский",
  preferredAudioLanguage_de: "Немецкий",
  preferredAudioLanguage_pt: "Португальский",
  preferredAudioLanguage_ru: "Русский",
  preferredAudioLanguage_ar: "Арабский",
  preferredAudioLanguage_hi: "Хинди",
  preferredAudioLanguage_it: "Итальянский",
  preferredAudioLanguage_nl: "Голландский",
  preferredAudioLanguage_pl: "Польский",
  preferredAudioLanguage_tr: "Турецкий",
  preferredAudioLanguage_vi: "Вьетнамский",
  defaultVideoCodec: "Предпочтительный видеокодек",
  defaultVideoCodecDescription:
    "Предпочитать определённый видеокодек при скачивании. yt-dlp попытается выбрать этот кодек, если он доступен, и переключится на другие кодеки в противном случае. Переопределяется пользовательской конфигурацией yt-dlp.",
  defaultVideoCodecDefault: "По умолчанию",
  defaultVideoCodec_h264: "H.264 (AVC)",
  defaultVideoCodec_h265: "H.265 (HEVC)",
  defaultVideoCodec_av1: "AV1",
  defaultVideoCodec_vp9: "VP9",
  saveSettings: "Сохранить настройки",
  saving: "Сохранение...",
  backToManage: "Назад к управлению",
  settingsSaved: "Настройки успешно сохранены",
  settingsFailed: "Не удалось сохранить настройки",
  debugMode: "Режим отладки",
  debugModeDescription:
    "Показать или скрыть сообщения консоли (требуется обновление)",
  telegramNotifications: "Уведомления Telegram",
  telegramNotificationsDescription: "Получайте уведомления через Telegram при завершении задач загрузки.",
  telegramEnabled: "Включить уведомления Telegram",
  telegramBotToken: "Токен бота",
  telegramBotTokenHelper: "Создайте бота через @BotFather в Telegram, чтобы получить токен.",
  telegramChatId: "ID чата",
  telegramChatIdHelper: "Отправьте сообщение @RawDataBot в Telegram, чтобы узнать ваш ID чата.",
  telegramNotifyOnSuccess: "Уведомлять при успехе",
  telegramNotifyOnFail: "Уведомлять при ошибке",
  twitchSubscriptions: "Подписки Twitch",
  twitchClientId: "Идентификатор клиента Twitch",
  twitchClientSecret: "Секрет клиента Twitch",
  twitchSubscriptionCredentialsHelper:
    "Клиентские данные Twitch необязательны. Без них MyTube переключается на опрос через yt-dlp в best-effort режиме, но с ними определение канала работает надежнее.",
  twitchSubscriptionDescription:
    "MyTube будет проверять этот канал Twitch на наличие новых VOD и загружать их после публикации на Twitch.",
  twitchSubscriptionCredentialsMissing:
    "Не удалось оформить подписку Twitch. Клиентские данные необязательны, но рекомендуются для более надежных подписок на каналы.",
  twitchSubscriptionVodsOnly:
    "MyTube загружает VOD Twitch после их публикации. Захват прямых эфиров в этой версии не поддерживается.",
  twitchClientHelpLink: "Как получить Twitch Client ID и Secret",
  twitchClientHelpTitle: "Получить Twitch Client ID и Secret",
  twitchClientHelpIntro:
    "Сначала нужно создать приложение Twitch в консоли разработчика Twitch.",
  twitchClientHelpStep1:
    "Откройте консоль разработчика Twitch и войдите под своей учетной записью Twitch.",
  twitchClientHelpStep2: "Создайте новое приложение для MyTube.",
  twitchClientHelpStep3:
    "Укажите OAuth Redirect URL. Если вы используете только серверные подписки, достаточно значения вроде http://localhost.",
  twitchClientHelpStep4:
    "После создания приложения скопируйте Client ID со страницы сведений о приложении.",
  twitchClientHelpStep5:
    "Создайте или отобразите Client Secret, затем вставьте оба значения в настройки MyTube.",
  twitchClientHelpSecurity:
    "Храните Client Secret в секрете и не публикуйте его в скриншотах или на публичных страницах.",
  twitchDeveloperConsole: "Консоль разработчика Twitch",
  twitchDeveloperDocs: "Документация для разработчиков Twitch",
  telegramTestButton: "Отправить тестовое сообщение",
  telegramTestSuccess: "Тестовое сообщение успешно отправлено!",
  telegramTestFailed: "Тест не пройден: {error}",
  telegramTestMissingFields: "Пожалуйста, сначала введите токен бота и ID чата.",
  pauseOnFocusLoss: "Пауза при потере фокуса окном",
  playFromBeginning: "Всегда перезапускать видео с начала",
  tagsManagement: "Управление тегами",
  newTag: "Новый тег",
  selectTags: "Выбрать теги",
  tags: "Теги",
  noTagsAvailable: "Нет доступных тегов",
  addTag: "Добавить тег",
  addTags: "Добавить теги",
  failedToSaveTags: "Не удалось сохранить теги",
  renameTag: "Переименовать тег",
  confirmRenameTag: "Переименовать",
  tagRenamedSuccess: "Тег успешно переименован",
  tagRenameFailed: "Не удалось переименовать тег",
  tagConflictCaseInsensitive:
    "Тег с таким именем уже существует (регистр не учитывается).",
  renameTagDescription:
    "Переименование тега приведет к проверке и обновлению всех видео, которые в настоящее время используют этот тег.",
  enterNewTagName: "Введите новое имя для тега '{tag}'",

  // Database
  database: "База данных",
  migrateDataDescription:
    "Перенос данных из устаревших файлов JSON в новую базу данных SQLite. Это действие безопасно запускать несколько раз (дубликаты будут пропущены).",
  migrateDataButton: "Перенести данные из JSON",
  scanFiles: "Сканировать файлы",
  scanFilesSuccess: "Сканирование завершено. Добавлено {count} новых видео.",
  scanFilesDeleted: " Удалено {count} отсутствующих файлов.",
  scanFilesFailed: "Сканирование не удалось",
  scanMountDirectoriesSuccess:
    "Сканирование смонтированных директорий завершено. Добавлено {addedCount} новых видео. Удалено {deletedCount} отсутствующих видео.",
  subscribePlaylistsSuccess: "Успешно подписано на {count} плейлист{plural}.",
  subscribePlaylistsSkipped:
    "{count} плейлист{plural} {wasWere} уже подписаны.",
  subscribePlaylistsErrors: "Произошло {count} ошибок{plural}.",
  subscribePlaylistsNoNew: "Новые плейлисты не были подписаны.",
  playlistsWatcher: "Монитор плейлистов",
  scanFilesConfirmMessage:
    "Система просканирует корневую папку с видео. Новые файлы будут добавлены, а отсутствующие видеофайлы будут удалены из системы.",
  scanning: "Сканирование...",
  migrateConfirmation:
    "Вы уверены, что хотите перенести данные? Это может занять некоторое время.",
  migrationResults: "Результаты миграции",
  migrationReport: "Отчет о миграции",
  migrationSuccess: "Миграция завершена. Подробности см. в оповещении.",
  migrationNoData: "Миграция завершена, но данные не найдены.",
  migrationFailed: "Ошибка миграции",
  migrationWarnings: "ПРЕДУПРЕЖДЕНИЯ",
  migrationErrors: "ОШИБКИ",
  itemsMigrated: "элементов перенесено",
  fileNotFound: "Файл не найден в",
  noDataFilesFound:
    "Файлы данных для миграции не найдены. Пожалуйста, проверьте сопоставления томов.",
  removeLegacyData: "Удалить устаревшие данные",
  removeLegacyDataDescription:
    "Удалите старые файлы JSON (videos.json, collections.json и т.д.), чтобы освободить место на диске. Делайте это только после проверки успешной миграции ваших данных.",
  removeLegacyDataConfirmTitle: "Удалить устаревшие данные?",
  removeLegacyDataConfirmMessage:
    "Вы уверены, что хотите удалить устаревшие файлы данных JSON? Это действие нельзя отменить.",
  legacyDataDeleted: "Устаревшие данные успешно удалены.",
  legacyDataDeleteFailed: "Не удалось удалить устаревшие данные",
  formatLegacyFilenames: "Форматировать старые имена файлов",
  formatLegacyFilenamesDescription:
    "Пакетное переименование всех видеофайлов, миниатюр и субтитров в новый стандартный формат: Название-Автор-ГГГГ. Эта операция изменит имена файлов на диске и обновит логику базы данных.",
  formatLegacyFilenamesButton: "Форматировать имена файлов",
  deleteLegacyDataButton: "Удалить устаревшие данные",
  cleanupTempFiles: "Очистить временные файлы",
  cleanupTempFilesDescription:
    "Удалить все временные файлы загрузки (.ytdl, .part) из каталога загрузок. Это помогает освободить место на диске от незавершенных или отмененных загрузок.",
  cleanupTempFilesConfirmTitle: "Очистить временные файлы?",
  cleanupTempFilesConfirmMessage:
    "Это навсегда удалит все файлы .ytdl и .part в каталоге загрузок. Убедитесь, что нет активных загрузок перед продолжением.",


  // Task Hooks
  taskHooks: "Хуки Задач",
  taskHooksDescription:
    "Выполняйте пользовательские shell-команды в определенные моменты жизненного цикла задачи. Доступные переменные окружения: MYTUBE_TASK_ID, MYTUBE_TASK_TITLE, MYTUBE_SOURCE_URL, MYTUBE_VIDEO_PATH.",
  taskHooksWarning:
    "Предупреждение: Команды выполняются с правами сервера. Используйте с осторожностью.",
  deploymentSecurityTitle: "Модель безопасности развертывания",
  deploymentSecurityLoading:
    "Политика безопасности развертывания загружается. Ограниченные функции останутся скрытыми, пока политика не станет доступна.",
  deploymentSecurityDetails: "Подробнее",
  deploymentSecurityDetailsTitle: "Подробности безопасности развертывания",
  deploymentSecurityCapabilityFeature: "Возможность / Функция",
  deploymentSecurityClose: "Закрыть",
  adminTrustLevelLabel: "Уровень доверия администратора",
  adminTrustLevelApplication: "Приложение",
  adminTrustLevelContainer: "Контейнер",
  adminTrustLevelHost: "Хост",
  adminTrustLevelApplicationDescription:
    "Администратор считается доверенным только на уровне приложения.",
  adminTrustLevelContainerDescription:
    "Администратор считается доверенным для действий на уровне backend или процесса контейнера.",
  adminTrustLevelHostDescription:
    "Администратор считается доверенным для административных действий на уровне хоста.",
  deploymentSecurityStandardAppManagement:
    "Стандартное управление приложением (видео, коллекции, теги, вход, резервные копии)",
  deploymentSecurityTaskHooksCapability:
    "Загрузка / удаление / выполнение хуков задач",
  deploymentSecurityRawYtDlpConfigTextArea:
    "Текстовое поле сырой конфигурации yt-dlp",
  deploymentSecurityFullRawYtDlpFlagPassthrough:
    "Полная передача сырых флагов yt-dlp",
  deploymentSecurityMountDirectorySettingsPersistence:
    "Сохранение настроек подключенных директорий",
  deploymentSecurityScanMountDirectories:
    "Сканирование файлов из настроенных подключенных директорий",
  deploymentSecurityFutureHostPathMaintenanceFeatures:
    "Будущие функции обслуживания путей хоста",
  deploymentSecurityConfigurationTitle: "Как настроить",
  deploymentSecurityConfigurationValuesNote:
    "Используйте MYTUBE_ADMIN_TRUST_LEVEL со значением application, container или host. При отсутствии или некорректном значении MyTube возвращается к container.",
  deploymentSecurityDockerConfigTitle: "Docker / Docker Compose",
  deploymentSecurityDockerConfigDescription:
    "Задайте MYTUBE_ADMIN_TRUST_LEVEL в environment сервиса. При необходимости замените application на container или host.",
  deploymentSecurityDockerPermissionsNote:
    "Если вы обновляете установку с bind mounts, созданную до версии 1.9.0, убедитесь, что каталоги uploads и data на хосте доступны на запись для uid/gid 1000 (`node`). Это также исправит каталоги uploads/images-small, принадлежащие root, из-за которых генерация миниатюр или сканирование могут завершаться с EACCES.",
  deploymentSecurityLocalConfigTitle: "Локальный запуск из исходников",
  deploymentSecurityLocalConfigDescription:
    "Экспортируйте MYTUBE_ADMIN_TRUST_LEVEL перед запуском MyTube или передайте переменную inline при запуске npm run dev.",
  deploymentSecurityLocalEnvFileNote:
    "Ту же строку можно добавить и в backend/.env.",
  taskHooksPolicyNotice:
    "Хуки задач отключены политикой безопасности развертывания в режиме доверия application.",
  hookTaskBeforeStart: "Перед Началом Задачи",
  hookTaskBeforeStartHelper: "Выполняется перед началом загрузки.",
  hookTaskSuccess: "Успех Задачи",
  hookTaskSuccessHelper:
    "Выполняется после успешной загрузки, перед облачной загрузкой/удалением (ожидает завершения).",
  hookTaskFail: "Сбой Задачи",
  hookTaskFailHelper: "Выполняется при сбое задачи.",
  hookTaskCancel: "Задача Отменена",
  hookTaskCancelHelper: "Выполняется при ручной отмене задачи.",
  found: "Найдено",
  notFound: "Не Задано",
  deleteHook: "Удалить Скрипт Хука",
  confirmDeleteHook: "Вы уверены, что хотите удалить этот скрипт хука?",
  uploadHook: "Загрузить .sh",
  enterPasswordToUploadHook:
    "Пожалуйста, введите пароль для загрузки этого Hook-скрипта.",
  riskCommandDetected:
    "Обнаружена опасная команда: {command}. Загрузка отклонена.",
  cleanupTempFilesActiveDownloads:
    "Невозможно очистить, пока активны загрузки. Пожалуйста, дождитесь завершения всех загрузок или сначала отмените их.",
  formatFilenamesSuccess:
    "Обработано: {processed}\nПереименовано: {renamed}\nОшибки: {errors}",
  formatFilenamesDetails: "Подробности:",
  formatFilenamesMore: "...и еще {count}",
  formatFilenamesError: "Не удалось отформатировать имена файлов: {error}",
  itemsPerPage: "Элементов на странице",
  itemsPerPageHelper: "Количество видео на странице (По умолчанию: 12)",
  showYoutubeSearch: "Показать результаты поиска YouTube",
  defaultSort: "Сортировка по умолчанию",
  showTagsOnThumbnail: "Показывать теги на миниатюре",
  playSoundOnTaskComplete: "Воспроизводить звук при завершении задачи",
  soundSuccess: "Звук успеха",
  visitorModeReadOnly: "Режим посетителя: Только чтение",
  visitorModeUrlRestricted: "Посетители не могут обрабатывать URL-адреса",
  visitorUser: "Посетитель",
  enableVisitorUser: "Включить пользователя-посетителя",
  visitorUserHelper:
    "Включите отдельную учетную запись посетителя с доступом только для чтения. Посетители могут просматривать контент, но не могут вносить изменения.",
  visitorPassword: "Пароль посетителя",
  visitorPasswordHelper: "Установите пароль для учетной записи посетителя.",
  visitorPasswordSetHelper:
    "Пароль установлен. Оставьте пустым, чтобы сохранить его.",
  cleanupTempFilesSuccess: "Успешно удалено {count} временных файлов.",
  cleanupTempFilesFailed: "Не удалось очистить временные файлы",


  // Cookie Settings
  cookieSettings: "Настройки Cookie",
  cookieUploadDescription:
    'Загрузите cookies.txt, чтобы пройти проверку ботов YouTube и включить скачивание субтитров Bilibili. Файл будет автоматически переименован в cookies.txt. (Пример: используйте расширение "Get cookies.txt LOCALLY" для экспорта cookie)',
  uploadCookies: "Загрузить Cookie",
  onlyTxtFilesAllowed: "Разрешены только файлы .txt",
  cookiesUploadedSuccess: "Cookie успешно загружены",
  cookiesUploadFailed: "Не удалось загрузить cookie",
  cookiesFound: "cookies.txt найден",
  cookiesNotFound: "cookies.txt не найден",
  deleteCookies: "Удалить Cookie",
  confirmDeleteCookies:
    "Вы уверены, что хотите удалить файл cookie? Это повлияет на возможность скачивания видео с возрастными ограничениями или только для участников.",
  cookiesDeletedSuccess: "Cookie успешно удалены",
  cookiesDeleteFailed: "Не удалось удалить cookie",


  // Cloud Drive
  cloudDriveSettings: "Облачное хранилище (OpenList)",
  cloudDriveDescription:
    "Автоматически загружать видео в облачное хранилище (Alist) и сканировать новые файлы в облаке. Локальные файлы будут удалены после успешной загрузки.",
  enableAutoSave: "Включить облачную синхронизацию",
  apiUrl: "URL API",
  apiUrlHelper: "напр. https://your-alist-instance.com/api/fs/put",
  token: "Токен",
  publicUrl: "Публичный URL",
  publicUrlHelper:
    "Публичный домен для доступа к файлам (напр. https://your-cloudflare-tunnel-domain.com). Если установлен, будет использоваться вместо URL API для доступа к файлам.",
  uploadPath: "Путь загрузки",
  cloudDrivePathHelper: "Путь к каталогу в облаке, напр. /mytube-uploads",
  scanPaths: "Пути сканирования",
  scanPathsHelper:
    "Один путь в строке. Видео будут сканироваться из этих путей. Если пусто, будет использоваться путь загрузки. Пример:\n/a/Фильмы\n/b/Документальные",
  cloudDriveNote:
    "После включения этой функции недавно загруженные видео будут автоматически загружены в облачное хранилище, а локальные файлы будут удалены. Видео будут воспроизводиться из облачного хранилища через прокси.",
  cloudScanAdded: "Добавлено из облака",
  testing: "Тестирование...",
  testConnection: "Тестировать соединение",
  sync: "Синхронизировать",
  syncToCloud: "Двусторонняя синхронизация",
  syncWarning:
    "Эта операция загрузит локальные видео в облако и просканирует облачное хранилище на наличие новых файлов. Локальные файлы будут удалены после загрузки.",
  syncing: "Синхронизация...",
  syncCompleted: "Синхронизация завершена",
  syncFailed: "Ошибка синхронизации",
  syncReport: "Всего: {total} | Загружено: {uploaded} | Ошибок: {failed}",
  syncErrors: "Ошибки:",
  fillApiUrlToken: "Пожалуйста, сначала заполните URL API и токен",
  connectionTestSuccess: "Тест соединения прошел успешно! Настройки верны.",
  connectionFailedStatus: "Ошибка соединения: Сервер вернул статус {status}",
  connectionFailedUrl:
    "Невозможно подключиться к серверу. Пожалуйста, проверьте URL API.",
  authFailed: "Ошибка аутентификации. Пожалуйста, проверьте ваш токен.",
  connectionTestFailed: "Тест соединения не удался: {error}",
  syncFailedMessage: "Ошибка синхронизации. Пожалуйста, попробуйте снова.",
  foundVideosToSync:
    "Найдено {count} видео с локальными файлами для синхронизации",
  uploadingVideo: "Загрузка: {title}",
  clearThumbnailCache: "Очистить локальный кэш миниатюр",
  clearing: "Очистка...",
  clearThumbnailCacheSuccess:
    "Кэш миниатюр успешно очищен. Миниатюры будут сгенерированы заново при следующем доступе.",
  clearThumbnailCacheError: "Не удалось очистить кэш миниатюр",
  clearThumbnailCacheConfirmMessage:
    "Это удалит все локально кэшированные миниатюры для облачных видео. Миниатюры будут сгенерированы заново из облачного хранилища при следующем доступе. Продолжить?",


  // Manage
  manageContent: "Управление контентом",
  videos: "Видео",
  collections: "Коллекции",
  allVideos: "Все видео",
  delete: "Удалить",
  backToHome: "Назад на главную",
  confirmDelete: "Вы уверены, что хотите удалить это?",
  deleteSuccess: "Успешно удалено",
  deleteFailed: "Не удалось удалить",
  noVideos: "Видео не найдено",
  noCollectionsFound: "Коллекции не найдены",
  noCollections: "Коллекции не найдены",
  searchVideos: "Поиск видео...",
  thumbnail: "Миниатюра",
  title: "Название",
  author: "Автор",
  authors: "Авторы",
  created: "Создано",
  name: "Имя",
  size: "Размер",
  actions: "Действия",
  deleteCollection: "Удалить коллекцию",
  deleteVideo: "Удалить видео",
  redownloadVideo: "Скачать видео заново",
  refreshFileSizesSuccess: "Размеры файлов обновлены. Обновлено {count} видео.",
  refreshFileSizesFailed: " {count} не удалось.",
  refreshFileSizesSkipped: " {count} без изменений или недоступно.",
  refreshFileSizesError: "Не удалось обновить размеры файлов: {error}",
  noVideosFoundMatching: "Видео, соответствующие вашему поиску, не найдены.",
  refreshThumbnail: "Обновить миниатюру",
  selected: "Выбрано",
  moveCollection: "Переместить в коллекцию",
  confirmBulkDelete:
    "Вы уверены, что хотите удалить эти видео? Это действие нельзя отменить.",


  // Video Player
  playing: "Воспроизведение",
  paused: "Пауза",
  next: "Следующее",
  previous: "Предыдущее",
  loop: "Повтор",
  autoPlayOn: "Автовоспроизведение вкл.",
  autoPlayOff: "Автовоспроизведение выкл.",
  autoPlayNext: "Автовоспроизведение следующего",
  videoNotFound: "Видео не найдено",
  videoNotFoundOrLoaded: "Видео не найдено или не может быть загружено.",
  deleting: "Удаление...",
  addToCollection: "Добавить в коллекцию",
  originalLink: "Оригинальная ссылка",
  source: "Источник:",
  addedDate: "Дата добавления:",
  hideComments: "Скрыть комментарии",
  showComments: "Показать комментарии",
  latestComments: "Последние комментарии",
  noComments: "Комментарии недоступны.",
  upNext: "Далее",
  noOtherVideos: "Других видео нет",
  currentlyIn: "Сейчас в:",
  collectionWarning: "Добавление в другую коллекцию удалит его из текущей.",
  addToExistingCollection: "Добавить в существующую коллекцию:",
  selectCollection: "Выберите коллекцию",
  add: "Добавить",
  createNewCollection: "Создать новую коллекцию:",
  collectionName: "Название коллекции",
  create: "Создать",
  removeFromCollection: "Удалить из коллекции",
  confirmRemoveFromCollection:
    "Вы уверены, что хотите удалить это видео из коллекции?",
  remove: "Удалить",
  loadingVideo: "Загрузка видео...",
  current: "(Текущее)",
  rateThisVideo: "Оценить это видео",
  enterFullscreen: "На весь экран",
  exitFullscreen: "Выйти из полноэкранного режима",
  enterCinemaMode: "Кинорежим",
  exitCinemaMode: "Выйти из кинорежима",
  share: "Поделиться",
  editTitle: "Редактировать название",
  hideVideo: "Скрыть видео для режима посетителя",
  showVideo: "Сделать видео видимым для режима посетителя",
  toggleVisibility: "Переключить видимость",
  titleUpdated: "Название успешно обновлено",
  titleUpdateFailed: "Не удалось обновить название",
  thumbnailRefreshed: "Миниатюра успешно обновлена",
  thumbnailRefreshFailed: "Не удалось обновить миниатюру",
  videoUpdated: "Видео успешно обновлено",
  videoUpdateFailed: "Не удалось обновить видео",
  failedToLoadVideos:
    "Не удалось загрузить видео. Пожалуйста, попробуйте позже.",
  videoRemovedSuccessfully: "Видео успешно удалено",
  failedToDeleteVideo: "Не удалось удалить видео",
  pleaseEnterSearchTerm: "Пожалуйста, введите поисковый запрос",
  failedToSearch: "Поиск не удался. Пожалуйста, попробуйте снова.",
  searchCancelled: "Поиск отменен",
  openInExternalPlayer: "Открыть во внешнем плеере",
  playWith: "Воспроизвести с помощью...",
  deleteAllFilteredVideos: "Удалить все отфильтрованные видео",
  confirmDeleteFilteredVideos:
    "Вы уверены, что хотите удалить {count} видео, отфильтрованных по выбранным тегам?",
  deleteFilteredVideosSuccess: "Успешно удалено {count} видео.",
  deletingVideos: "Удаление видео...",


  // Login
  signIn: "Войти",
  admin: "Администратор",
  visitorSignIn: "Вход для посетителей",
  orVisitor: "ИЛИ ГОСТЬ",
  verifying: "Проверка...",
  incorrectPassword: "Неверный пароль",
  loginFailed: "Ошибка проверки пароля",
  defaultPasswordHint: "Используйте пароль администратора, настроенный в разделе настроек.",
  checkingConnection: "Проверка соединения...",
  connectionError: "Ошибка соединения",
  backendConnectionFailed:
    "Не удалось подключиться к серверу. Убедитесь, что сервер запущен и порт открыт, затем повторите попытку.",
  retry: "Повторить",
  resetPassword: "Сбросить пароль",
  resetPasswordTitle: "Сбросить пароль",
  resetPasswordMessage:
    "Восстановление пароля должно выполняться из среды бэкенда. Используйте команду бэкенда, чтобы явно задать новый пароль.",
  resetPasswordConfirm: "Сбросить",
  resetPasswordSuccess:
    "Ниже показаны инструкции по восстановлению пароля. Используйте команду бэкенда, чтобы задать новый пароль.",
  resetPasswordRecoveryMessage:
    "Восстановление пароля должно выполняться из среды бэкенда. Задайте новый пароль явно, а не полагайтесь на сгенерированные учетные данные в логах.",
  resetPasswordRecoveryGuide:
    "Выберите команду, соответствующую вашей среде:\n\nОболочка бэкенда\n  node dist/scripts/reset-password.js <new-password>\n\nХост Docker\n  docker exec -it mytube-backend node /app/dist/scripts/reset-password.js <new-password>\n\nИспользуйте каталог или контейнер бэкенда, у которого есть доступ к постоянным данным приложения.",
  resetPasswordDisabledInfo:
    "Сброс пароля отключён в веб-интерфейсе. Чтобы сбросить пароль, выполните одну из следующих команд из среды бэкенда:\n\nОболочка бэкенда\n  node dist/scripts/reset-password.js <new-password>\n\nХост Docker\n  docker exec -it mytube-backend node /app/dist/scripts/reset-password.js <new-password>\n\nИспользуйте каталог или контейнер бэкенда, у которого есть доступ к постоянным данным приложения.",
  resetPasswordScriptGuide:
    "Чтобы вручную сбросить пароль, выполните одну из следующих команд и явно укажите новый пароль:\n\nОболочка бэкенда\n  node dist/scripts/reset-password.js <new-password>\n\nХост Docker\n  docker exec -it mytube-backend node /app/dist/scripts/reset-password.js <new-password>\n\nСкрипт не генерирует и не показывает случайные пароли.",
  waitTimeMessage: "Пожалуйста, подождите {time} перед повторной попыткой.",
  tooManyAttempts: "Слишком много неудачных попыток.",

  // Passkeys
  createPasskey: "Создать ключ доступа",
  creatingPasskey: "Создание...",
  passkeyCreated: "Ключ доступа успешно создан",
  passkeyCreationFailed:
    "Не удалось создать ключ доступа. Пожалуйста, попробуйте снова.",
  passkeyWebAuthnNotSupported:
    "WebAuthn не поддерживается в этом браузере. Пожалуйста, используйте современный браузер с поддержкой WebAuthn.",
  passkeyRequiresHttps:
    "WebAuthn требует HTTPS или localhost. Пожалуйста, войдите в приложение через HTTPS или используйте localhost вместо IP-адреса.",
  removePasskeys: "Удалить все ключи доступа",
  removePasskeysTitle: "Удалить все ключи доступа",
  removePasskeysMessage:
    "Вы уверены, что хотите удалить все ключи доступа? Это действие нельзя отменить.",
  passkeysRemoved: "Все ключи доступа удалены",
  passkeysRemoveFailed:
    "Не удалось удалить ключи доступа. Пожалуйста, попробуйте снова.",
  loginWithPasskey: "Войти с помощью ключа доступа",
  authenticating: "Аутентификация...",
  passkeyLoginFailed:
    "Ошибка аутентификации с помощью ключа доступа. Пожалуйста, попробуйте снова.",
  passkeyErrorPermissionDenied:
    "Запрос не разрешен пользовательским агентом или платформой в текущем контексте, возможно, потому что пользователь отклонил разрешение.",
  passkeyErrorAlreadyRegistered: "Аутентификатор был ранее зарегистрирован.",
  linkCopied: "Ссылка скопирована в буфер обмена",
  copyFailed: "Не удалось скопировать ссылку",
  copyUrl: "Копировать URL",


  // Collection Page
  loadingCollection: "Загрузка коллекции...",
  collectionNotFound: "Коллекция не найдена",
  noVideosInCollection: "В этой коллекции нет видео.",
  back: "Назад",


  // Author Videos
  loadVideosError: "Не удалось загрузить видео. Пожалуйста, попробуйте позже.",
  unknownAuthor: "Неизвестно",
  noVideosForAuthor: "Видео этого автора не найдены.",
  deleteAuthor: "Удалить автора",
  deleteAuthorConfirmation:
    "Вы уверены, что хотите удалить автора {author}? Это удалит все видео, связанные с этим автором.",
  authorDeletedSuccessfully: "Автор успешно удален",
  failedToDeleteAuthor: "Не удалось удалить автора",
  createCollectionFromAuthor: "Создать коллекцию от автора",
  createCollectionFromAuthorTooltip:
    "Переместить все видео этого автора в коллекцию",
  creatingCollection: "Создание коллекции...",
  collectionCreatedFromAuthor:
    "Коллекция создана, все видео успешно перемещены",
  failedToCreateCollectionFromAuthor: "Не удалось создать коллекцию от автора",
  collectionAlreadyExists: "Коллекция с таким именем уже существует",
  createCollectionFromAuthorConfirmation:
    'Будет создана коллекция с именем "{author}", и все видео этого автора будут перемещены в нее. Продолжить?',
  createCollectionFromAuthorConfirmationWithMove:
    'Будет создана коллекция с именем "{author}", и все видео этого автора будут перемещены в нее. {count} видео, находящиеся в других коллекциях, будут перемещены в эту новую коллекцию. Продолжить?',
  addVideosToCollection: "Добавить видео в коллекцию",
  addVideosToExistingCollectionConfirmation:
    'Добавить {count} видео автора "{author}" в существующую коллекцию "{author}". Продолжить?',
  addVideosToExistingCollectionConfirmationWithMove:
    'Добавить {count} видео автора "{author}" в существующую коллекцию "{author}". {moveCount} видео, находящиеся в других коллекциях, будут перемещены в эту коллекцию. Продолжить?',


  // Delete Collection Modal
  deleteCollectionTitle: "Удалить коллекцию",
  deleteCollectionConfirmation: "Вы уверены, что хотите удалить коллекцию",
  collectionContains: "Эта коллекция содержит",
  deleteCollectionOnly: "Удалить только коллекцию",
  deleteCollectionAndVideos: "Удалить коллекцию и все видео",


  // Common
  loading: "Загрузка...",
  error: "Ошибка",
  success: "Успех",
  cancel: "Отмена",
  close: "Закрыть",
  ok: "ОК",
  confirm: "Подтвердить",
  save: "Сохранить",
  note: "Примечание",
  on: "Вкл.",
  off: "Выкл",
  continue: "Продолжить",
  expand: "Развернуть",
  collapse: "Свернуть",


  // Video Card
  unknownDate: "Неизвестная дата",
  part: "Часть",
  collection: "Коллекция",
  new: "НОВЫЙ",
  justNow: "Только что",
  hoursAgo: "{hours} часов назад",
  today: "Сегодня",
  thisWeek: "На этой неделе",
  weeksAgo: "{weeks} недель назад",


  // Upload Modal
  selectVideoFile: "Выберите видеофайл",
  selectVideoFolder: "Выберите папку",
  uploadFileLimitHint:
    "За один раз можно загрузить не более {count} файлов и {size} ГБ суммарно. При загрузке папки каждое видео и его размер учитываются в этих лимитах.",
  pleaseSelectVideo: "Пожалуйста, выберите видеофайл",
  noSupportedVideosFound:
    "В выбранном наборе не найдено поддерживаемых видеофайлов",
  tooManyFilesSelected:
    "За один раз можно загрузить не более {count} файлов. Уменьшите выбор и попробуйте снова.",
  totalUploadSizeExceeded:
    "Выбранные файлы превышают общий лимит загрузки в {size} ГБ. Уменьшите выбор и попробуйте снова.",
  uploadFailed: "Ошибка загрузки",
  failedToUpload: "Не удалось загрузить видео",
  uploading: "Загрузка...",
  upload: "Загрузить",
  uploadSummary:
    "Загружено {uploaded}, дубликатов {duplicates}, ошибок {failed}",
  unsupportedFilesSkipped:
    "Пропущено неподдерживаемых файлов: {count}",
  multipleUploadUsesFilename:
    "При множественной загрузке имя каждого файла используется как заголовок",
  uploadThumbnail: "Загрузить миниатюру",
  clickToSelectImage: "Нажмите, чтобы выбрать изображение",
  changeImage: "Изменить изображение",
  selectImage: "Выбрать изображение",
  thumbnailUploaded: "Миниатюра загружена",


  // Bilibili Modal
  bilibiliCollectionDetected: "Обнаружена коллекция Bilibili",
  bilibiliSeriesDetected: "Обнаружена серия Bilibili",
  multiPartVideoDetected: "Обнаружено многочастное видео",
  authorOrPlaylist: "Автор / Плейлист",
  playlistDetected: "Обнаружен плейлист",
  playlistHasVideos: "В этом плейлисте {count} видео.",
  downloadPlaylistAndCreateCollection:
    "Скачать видео из плейлиста и создать для него коллекцию?",
  playlistDownloadStarted: "Скачивание плейлиста началось",
  collectionHasVideos: "В этой коллекции Bilibili {count} видео.",
  seriesHasVideos: "В этой серии Bilibili {count} видео.",
  videoHasParts: "В этом видео Bilibili {count} частей.",
  downloadAllVideos: "Скачать все {count} видео",
  downloadAllParts: "Скачать все {count} частей",
  downloadThisVideoOnly: "Скачать только это видео",
  downloadCurrentPartOnly: "Скачать только текущую часть",
  processing: "Обработка...",
  wouldYouLikeToDownloadAllParts: "Хотите скачать все части?",
  wouldYouLikeToDownloadAllVideos: "Хотите скачать все видео?",
  allPartsAddedToCollection: "Все части будут добавлены в эту коллекцию",
  allVideosAddedToCollection: "Все видео будут добавлены в эту коллекцию",
  queued: "В очереди",
  waitingInQueue: "Ожидание в очереди",


  // Downloads
  downloads: "Загрузки",
  activeDownloads: "Активные загрузки",
  manageDownloads: "Управление загрузками",
  queuedDownloads: "Загрузки в очереди",
  downloadHistory: "История загрузок",
  clearQueue: "Очистить очередь",
  clearHistory: "Очистить историю",
  noActiveDownloads: "Нет активных загрузок",
  noQueuedDownloads: "Нет загрузок в очереди",
  noDownloadHistory: "История загрузок пуста",
  downloadCancelled: "Загрузка отменена",
  queueCleared: "Очередь очищена",
  historyCleared: "История очищена",
  removedFromQueue: "Удалено из очереди",
  removedFromHistory: "Удалено из истории",
  status: "Статус",
  progress: "Прогресс",
  speed: "Скорость",
  finishedAt: "Завершено в",
  failed: "Ошибка",


  // Snackbar Messages
  videoDownloading: "Видео скачивается",
  downloadStartedSuccessfully: "Загрузка успешно началась",
  collectionCreatedSuccessfully: "Коллекция успешно создана",
  videoAddedToCollection: "Видео добавлено в коллекцию",
  videosAddedToCollection: "Видео добавлены в коллекцию",
  videoRemovedFromCollection: "Видео удалено из коллекции",
  collectionDeletedSuccessfully: "Коллекция успешно удалена",
  failedToDeleteCollection: "Не удалось удалить коллекцию",

  collectionUpdatedSuccessfully: "Коллекция успешно обновлена",
  failedToUpdateCollection:
    "Не удалось обновить коллекцию, используйте другое имя",
  collectionNameRequired: "Требуется название коллекции",
  collectionNameTooLong:
    "Название коллекции должно содержать не более 200 символов",
  collectionNameInvalidChars:
    "Название коллекции содержит недопустимые символы",
  collectionNameReserved: "Название коллекции зарезервировано",
  updateCollectionFailed: "Не удалось обновить коллекцию",
  uploadSubtitle: "Загрузить субтитры",
  subtitleUploaded: "Субтитры успешно загружены",
  confirmDeleteSubtitle: "Удалить этот субтитр?",
  subtitleDeleted: "Субтитр удалён",

  // Batch Download
  batchDownload: "Пакетная загрузка",
  batchDownloadDescription: "Вставьте несколько URL ниже, по одному в строке.",
  urls: "URL",
  addToQueue: "Добавить в очередь",
  batchTasksAdded: "Добавлено задач: {count}",
  addBatchTasks: "Добавить пакетные задачи",


  // Subscriptions
  subscribeToAuthor: "Подписаться на автора",
  subscribeToChannel: "Подписаться на канал",
  subscribeConfirmationMessage: "Вы хотите подписаться на {author}?",
  subscribeChannelChoiceMessage: "Как вы хотите подписаться на этот канал?",
  subscribeChannelChoiceDescription:
    "Выберите подписку на все видео или все плейлисты этого канала. Подписка на все плейлисты также подпишет вас на будущие плейлисты, созданные автором.",
  subscribeAllVideos: "Подписаться на все видео",
  subscribeAllPlaylists: "Подписаться на все плейлисты",
  subscribeAllPlaylistsDescription:
    "Это подпишет вас на все плейлисты на этом канале.",
  subscribeDescription:
    "Система будет автоматически проверять новые видео от этого автора и скачивать их.",
  checkIntervalMinutes: "Интервал проверки (минуты)",
  subscribe: "Подписаться",
  subscriptions: "Подписки",
  interval: "Интервал",
  lastCheck: "Последняя проверка",
  nextCheck: "Следующая проверка",
  editInterval: "Изменить интервал",
  platform: "Платформа",
  unsubscribe: "Отписаться",
  confirmUnsubscribe: "Вы уверены, что хотите отписаться от {author}?",
  subscribedSuccessfully: "Успешно подписаны",
  unsubscribedSuccessfully: "Успешно отписаны",
  subscriptionUpdated: "Подписка успешно обновлена",
  subscriptionUpdateFailed: "Не удалось обновить подписку",
  subscriptionAlreadyExists: "Вы уже подписаны на этого автора.",
  minutes: "минут",
  never: "Никогда",
  downloadAllPreviousVideos: "Скачать все предыдущие видео этого автора",
  downloadShorts: "Скачать Shorts",
  downloadOrder: "Порядок загрузки",
  downloadOrderDateDesc: "Дата (сначала новые)",
  downloadOrderDateAsc: "Дата (сначала старые)",
  downloadOrderViewsDesc: "Просмотры (сначала больше)",
  downloadOrderViewsAsc: "Просмотры (сначала меньше)",
  downloadOrderLargeChannelHint:
    "Для крупных каналов может потребоваться больше времени на получение метаданных перед началом загрузки.",
  downloadOrderShortsHint:
    "Будут созданы две задачи загрузки: одна для основных видео и одна для Shorts.",
  downloadAllPreviousWarning:
    "Предупреждение: Это скачает все предыдущие видео этого автора. Это может потребовать значительного объема хранилища и может вызвать механизмы обнаружения ботов, что может привести к временным или постоянным запретам на платформе. Используйте на свой риск.",
  downloadAllPreviousVideosInPlaylists: "Скачать предыдущие видео в плейлистах",
  downloadAllPlaylistsWarning:
    "Предупреждение: Это скачает все видео из всех плейлистов на этом канале. Это может быть большое количество видео и потребовать значительного объема хранилища.",
  continuousDownloadTasks: "Задачи непрерывной загрузки",
  taskStatusActive: "Активна",
  taskStatusPaused: "Приостановлена",
  taskStatusCompleted: "Завершена",
  taskStatusCancelled: "Отменена",
  downloaded: "Скачано",
  cancelTask: "Отменить задачу",
  confirmCancelTask:
    "Вы уверены, что хотите отменить задачу загрузки для {author}?",
  taskCancelled: "Задача успешно отменена",
  deleteTask: "Удалить задачу",
  confirmDeleteTask:
    "Вы уверены, что хотите удалить запись задачи для {author}? Это действие нельзя отменить.",
  taskDeleted: "Задача успешно удалена",
  clearFinishedTasks: "Очистить завершенные задачи",
  tasksCleared: "Завершенные задачи успешно очищены",
  confirmClearFinishedTasks:
    "Вы уверены, что хотите очистить все завершенные задачи (завершенные, отмененные)? Это удалит их из списка, но не удалит загруженные файлы.",
  clear: "Очистить",


  // Subscription Pause/Resume
  pause: "Пауза",
  resume: "Возобновить",
  pauseSubscription: "Приостановить подписку",
  resumeSubscription: "Возобновить подписку",
  pauseTask: "Приостановить задачу",
  resumeTask: "Возобновить задачу",
  subscriptionPaused: "Подписка приостановлена",
  subscriptionResumed: "Подписка возобновлена",
  taskPaused: "Задача приостановлена",
  taskResumed: "Задача возобновлена",
  viaSubscription: "через подписку",
  viaContinuousDownload: "через непрерывную загрузку",


  // Playlist Subscription
  subscribeToPlaylist: "Подписаться на этот плейлист",
  subscribePlaylistDescription:
    "Автоматически проверять новые видео, добавленные в этот плейлист",
  playlistSubscribedSuccessfully: "Успешная подписка на плейлист",
  downloadAndSubscribe: "Скачать все и подписаться",
  playlistSubscription: "Плейлист",


  // Instruction Page
  instructionSection1Title: "1. Загрузка и управление задачами",
  instructionSection1Desc:
    "Этот модуль включает функции получения видео, пакетных задач и импорта файлов.",
  instructionSection1Sub1: "Загрузка по ссылке:",
  instructionSection1Item1Label: "Базовая загрузка:",
  instructionSection1Item1Text:
    "Вставьте ссылки с различных видеосайтов в поле ввода для прямой загрузки.",
  instructionSection1Item2Label: "Разрешения:",
  instructionSection1Item2Text:
    "Для сайтов, требующих членства или входа в систему, пожалуйста, сначала войдите в соответствующую учетную запись на новой вкладке браузера, чтобы получить разрешения на загрузку.",
  instructionSection1Sub2: "Умное распознавание:",
  instructionSection1Item3Label: "Подписка на автора YouTube:",
  instructionSection1Item3Text:
    "Когда вставленная ссылка является каналом автора, система спросит, хотите ли вы подписаться. После подписки система может автоматически сканировать и загружать обновления автора через заданные интервалы.",
  instructionSection1Item4Label: "Загрузка коллекции Bilibili:",
  instructionSection1Item4Text:
    "Когда вставленная ссылка является избранным/коллекцией Bilibili, система спросит, хотите ли вы загрузить все содержимое коллекции.",
  instructionSection1Sub3:
    "Расширенные инструменты (Страница управления загрузками):",
  instructionSection1Item5Label: "Пакетное добавление задач:",
  instructionSection1Item5Text:
    "Поддерживает вставку нескольких ссылок для загрузки одновременно (по одной в строке) для пакетного добавления.",
  instructionSection1Item6Label: "Сканировать файлы:",
  instructionSection1Item6Text:
    "Автоматически ищет все файлы в корневом каталоге хранения видео и папках первого уровня. Эта функция подходит для синхронизации файлов с системой после того, как администраторы вручную поместили их на сервер.",
  instructionSection1Item7Label: "Загрузить видео:",
  instructionSection1Item7Text:
    "Поддерживает загрузку локальных видеофайлов непосредственно с клиента на сервер.",

  instructionSection2Title: "2. Управление видеотекой",
  instructionSection2Desc:
    "Обслуживание и редактирование загруженных или импортированных видеоресурсов.",
  instructionSection2Sub1: "Удаление коллекции/видео:",
  instructionSection2Text1:
    "При удалении коллекции на странице управления система предлагает два варианта: удалить только элемент списка коллекции (сохранить файлы) или полностью удалить физические файлы внутри коллекции.",
  instructionSection2Sub2: "Восстановление миниатюры:",
  instructionSection2Text2:
    "Если у видео нет обложки после загрузки, нажмите кнопку обновления на миниатюре видео, и система повторно захватит первый кадр видео в качестве новой миниатюры.",

  instructionSection3Title: "3. Настройки системы",
  instructionSection3Desc:
    "Настройка параметров системы, обслуживание данных и расширение функций.",
  instructionSection3Sub1: "Настройки безопасности:",
  instructionSection3Text1:
    "Задайте пароль входа в систему до включения авторизации. Если доступ потерян, сбросьте его через backend-скрипт reset-password.",
  instructionSection3Sub2: "Управление тегами:",
  instructionSection3Text2:
    "Поддерживает добавление или удаление тегов классификации видео. Примечание: Вы должны нажать кнопку «Сохранить» внизу страницы, чтобы изменения вступили в силу.",
  instructionSection3Sub3: "Обслуживание системы:",
  instructionSection3Item1Label: "Очистить временные файлы:",
  instructionSection3Item1Text:
    "Используется для очистки остаточных временных файлов загрузки, вызванных случайными сбоями бэкенда, для освобождения места.",
  instructionSection3Item2Label: "Миграция базы данных:",
  instructionSection3Item2Text:
    "Предназначено для пользователей ранних версий. Используйте эту функцию для миграции данных из JSON в новую базу данных SQLite. После успешной миграции нажмите кнопку удаления, чтобы очистить старые исторические данные.",
  instructionSection3Sub4: "Расширенные сервисы:",
  instructionSection3Item3Label: "Облачный диск OpenList:",
  instructionSection3Item3Text:
    "(В разработке) Поддерживает подключение к развернутым пользователем сервисам OpenList. Добавьте конфигурацию здесь, чтобы включить интеграцию с облачным диском.",


  // Disclaimer
  disclaimerTitle: "Отказ от ответственности",
  disclaimerText:
    "1. Цель и Ограничения\nЭто программное обеспечение (включая код и документацию) предназначено исключительно для личного обучения, исследований и технического обмена. Строго запрещено использовать это программное обеспечение в коммерческих целях или для любой незаконной деятельности, нарушающей местные законы и правила.\n\n2. Ответственность\nРазработчик не знает и не контролирует, как пользователи используют это программное обеспечение. Любая юридическая ответственность, споры или ущерб, возникающие в результате незаконного или ненадлежащего использования этого программного обеспечения (включая, помимо прочего, нарушение авторских прав), возлагаются исключительно на пользователя. Разработчик не несет никакой прямой, косвенной или солидарной ответственности.\n\n3. Модификации и Распространение\nЭтот проект с открытым исходным кодом. Любое физическое лицо или организация, изменяющая или создающая форк этого кода, должна соблюдать лицензию с открытым исходным кодом. Важно: Если третья сторона изменяет код для обхода или удаления оригинальных механизмов аутентификации/безопасности пользователей и распространяет такие версии, модификатор/распространитель несет полную ответственность за любые последствия. Мы настоятельно не рекомендуем обходить или вмешиваться в любые механизмы проверки безопасности.\n\n4. Некоммерческое Заявление\nЭто полностью бесплатный проект с открытым исходным кодом. Разработчик не принимает пожертвования и никогда не публиковал страницы для пожертвований. Сама программа не предусматривает взимания платы и не предлагает платных услуг. Пожалуйста, будьте бдительны и остерегайтесь мошенничества или вводящей в заблуждение информации, утверждающей о сборе средств от имени этого проекта.",
  history: "История",


  // Existing Video Detection
  existingVideoDetected: "Обнаружено существующее видео",
  videoAlreadyDownloaded: "Это видео уже загружено.",
  viewVideo: "Посмотреть видео",
  previouslyDeletedVideo: "Ранее удаленное видео",
  previouslyDeleted: "Ранее удалено",
  videoWasDeleted: "Это видео было ранее загружено, но удалено.",
  downloadAgain: "Скачать снова",
  downloadedOn: "Скачано",
  deletedOn: "Удалено",
  existingVideo: "Существующее видео",
  skipped: "Пропущено",
  videoSkippedExists: "Видео уже существует, загрузка пропущена",
  videoSkippedDeleted: "Видео было ранее удалено, загрузка пропущена",
  downloading: "Скачивание...",
  poweredBy: "Работает на MyTube",
  changeSettings: "Изменить настройки",


  // Sorting
  sort: "Сортировка",
  sortBy: "Сортировать по",
  dateDesc: "Дата добавления (Сначала новые)",
  dateAsc: "Дата добавления (Сначала старые)",
  viewsDesc: "Просмотры (По убыванию)",
  viewsAsc: "Просмотры (По возрастанию)",
  nameAsc: "Название (А-Я)",
  videoDateDesc: "Дата создания видео (сначала новые)",
  videoDateAsc: "Дата создания видео (сначала старые)",
  random: "Случайно",


  // yt-dlp Configuration
  ytDlpConfiguration: "Конфигурация yt-dlp",
  ytDlpConfigurationDescription: "Настройте параметры загрузки yt-dlp. См.",
  ytDlpConfigurationDocs: "документацию",
  ytDlpConfigurationDescriptionEnd: "для получения дополнительной информации.",
  ytDlpConfigurationPolicyNotice:
    "Сырая конфигурация yt-dlp отключена политикой безопасности развертывания в режиме доверия application.",
  mountDirectoriesPolicyNotice:
    "Подключенные директории требуют доверия администратора на уровне хоста.",
  customize: "Настроить",
  hide: "Скрыть",
  reset: "Сбросить",
  more: "Ещё",
  proxyOnlyApplyToYoutube: "Прокси применяется только к Youtube",
  moveSubtitlesToVideoFolder: "Расположение субтитров",
  moveSubtitlesToVideoFolderOn: "Вместе с видео",
  moveSubtitlesToVideoFolderOff: "В изолированной папке субтитров",
  moveSubtitlesToVideoFolderDescription:
    "Если включено, файлы субтитров будут перемещены в ту же папку, что и видеофайл. Если отключено, они будут перемещены в изолированную папку субтитров.",
  moveThumbnailsToVideoFolder: "Расположение миниатюр",
  moveThumbnailsToVideoFolderOn: "Вместе с видео",
  moveThumbnailsToVideoFolderOff: "В отдельной папке изображений",
  moveThumbnailsToVideoFolderDescription:
    "Если включено, файлы миниатюр будут перемещены в ту же папку, что и видеофайл. Если выключено, они будут перемещены в отдельную папку изображений.",

  saveAuthorFilesToCollection: "Сохранять файлы автора в коллекцию",
  saveAuthorFilesToCollectionOn: "Вкл",
  saveAuthorFilesToCollectionOff: "Выкл",
  saveAuthorFilesToCollectionDescription:
    "Автоматически сохранять файлы автора в отдельную коллекцию.",

  // Cloudflare Tunnel
  cloudflaredTunnel: "Туннель Cloudflare",
  enableCloudflaredTunnel: "Включить Cloudflare Tunnel",
  cloudflaredToken: "Токен туннеля (Необязательно)",
  cloudflaredTokenHelper:
    "Вставьте сюда токен туннеля или оставьте пустым, чтобы использовать случайный быстрый туннель.",
  allowedHosts: "Опубликованные маршруты приложения",
  allowedHostsHelper:
    "Список разрешенных хостов для сервера разработки Vite (разделенные запятыми). Белый список доменов для Cloudflare Tunnel.",
  allowedHostsRequired:
    "Опубликованные маршруты приложения обязательны при предоставлении токена туннеля.",
  waitingForUrl: "Ожидание URL быстрого туннеля...",
  running: "Запущен",
  stopped: "Остановлен",
  tunnelId: "ID туннеля",
  accountTag: "Тег учетной записи",
  copied: "Скопировано!",
  clickToCopy: "Нажмите, чтобы скопировать",
  quickTunnelWarning:
    "URL быстрых туннелей меняются при каждом перезапуске туннеля.",
  managedInDashboard:
    "Публичное имя хоста управляется в панели управления Cloudflare Zero Trust.",


  // Database Export/Import
  exportImportDatabase: "Экспорт/Импорт Базы Данных",
  exportImportDatabaseDescription:
    "Экспортируйте базу данных как файл резервной копии или импортируйте ранее экспортированную резервную копию. Импорт перезапишет существующие данные данными из резервной копии.",
  exportDatabase: "Экспортировать Базу Данных",
  importDatabase: "Импортировать Базу Данных",
  mergeDatabase: "Объединить Базу Данных",
  onlyDbFilesAllowed: "Разрешены только файлы .db",
  importDatabaseWarning:
    "Предупреждение: Импорт базы данных перезапишет все существующие данные. Убедитесь, что вы сначала экспортировали текущую базу данных в качестве резервной копии.",
  mergeDatabaseWarning:
    "Объедините другую резервную копию MyTube с этим экземпляром. Существующие записи сохраняются, а из загруженной базы добавляются только отсутствующие записи.",
  mergeDatabaseContentsVideos:
    "Видео сопоставляются по исходному URL, существующие видео сохраняются.",
  mergeDatabaseContentsCollections:
    "Коллекции и связи видео в них объединяются с коллекциями с таким же именем.",
  mergeDatabaseContentsSubscriptions:
    "Подписки объединяются по URL подписки, существующие подписки сохраняются.",
  mergeDatabaseContentsHistory:
    "История загрузок и отслеживание загрузок добавляются, если совпадающей записи ещё нет.",
  mergeDatabaseContentsTags:
    "Настройки тегов тоже объединяются, чтобы импортированные теги оставались доступными в интерфейсе.",
  mergeDatabaseKeepsCurrentData:
    "Текущие настройки, пароли, активные загрузки и состояние выполнения задач не заменяются.",
  mergeDatabasePreviewScanning: "Сканирование загруженной базы данных...",
  mergeDatabasePreviewResults: "Предпросмотр объединения",
  mergeDatabasePreviewConfirmHint: "Продолжайте, только если эти значения соответствуют ожидаемым.",
  mergeDatabasePreviewFailed: "Не удалось просканировать загруженную базу данных: {error}",
  mergeDatabasePreviewErrorDefault: "Не удалось просканировать загруженную базу данных.",
  mergeDatabaseMergedCount: "Будет объединено: {count}",
  mergeDatabaseSkippedCount: "Пропущено: {count}",
  mergeDatabasePreviewVideos: "Видео",
  mergeDatabasePreviewCollections: "Коллекции",
  mergeDatabasePreviewCollectionLinks: "Связи коллекций",
  mergeDatabasePreviewSubscriptions: "Подписки",
  mergeDatabasePreviewDownloadHistory: "История загрузок",
  mergeDatabasePreviewVideoDownloads: "Отслеживание загрузок",
  mergeDatabasePreviewTags: "Теги",
  selectDatabaseFile: "Выбрать Файл Базы Данных",
  databaseExportedSuccess: "База данных успешно экспортирована",
  databaseExportFailed: "Не удалось экспортировать базу данных",
  databaseImportedSuccess:
    "База данных успешно импортирована. Существующие данные были перезаписаны данными из резервной копии.",
  databaseImportFailed: "Не удалось импортировать базу данных",
  databaseMergedSuccess:
    "База данных успешно объединена. Текущие данные сохранены, а недостающие данные из резервной копии добавлены.",
  databaseMergeFailed: "Не удалось объединить базу данных",
  cleanupBackupDatabases: "Очистить Резервные Копии Базы Данных",
  cleanupBackupDatabasesWarning:
    "Предупреждение: Это навсегда удалит все файлы резервных копий базы данных (mytube-backup-*.db.backup), которые были созданы во время предыдущих импортов. Это действие нельзя отменить. Вы уверены, что хотите продолжить?",
  backupDatabasesCleanedUp: "Резервные копии базы данных успешно очищены",

  // History Filter
  filterAll: "Все",
  backupDatabasesCleanupFailed:
    "Не удалось очистить резервные копии базы данных",
  restoreFromLastBackup: "Восстановить из Последней Резервной Копии",
  restoreFromLastBackupWarning:
    "Предупреждение: Это восстановит базу данных из последнего файла автоматической резервной копии. Все текущие данные будут перезаписаны данными из резервной копии. Это действие нельзя отменить. Вы уверены, что хотите продолжить?",
  restoreFromLastBackupSuccess:
    "База данных успешно восстановлена из резервной копии",
  restoreFromLastBackupFailed: "Не удалось восстановить из резервной копии",
  lastBackupDate: "Дата последней резервной копии",
  noBackupAvailable: "Резервная копия недоступна",
  failedToDownloadVideo:
    "Не удалось скачать видео. Пожалуйста, попробуйте снова.",
  failedToDownload: "Не удалось скачать. Пожалуйста, попробуйте снова.",
  openFolder: "Открыть папку",
  openInNewTab: "Открыть в новой вкладке",
  copyLink: "Копировать ссылку",
  refresh: "Обновить",
  showSensitiveContent: "Показать чувствительный контент",
  hideSensitiveContent: "Скрыть чувствительный контент",
  sensitiveContentWarning:
    "Это видео может содержать чувствительный контент. Нажмите для просмотра.",
  soundNone: "Нет",
  soundBell: "Звонок колокольчика",
  soundMessage: "Входящее сообщение",
  soundMicrowave: "Звонок микроволновки",
  soundNotification: "Новое уведомление",
  soundDrop: "Предмет падает в воду",
  soundWater: "Капля воды на металл",
  videoLoadTimeout:
    "Видео загружается слишком долго. Пожалуйста, попробуйте еще раз или проверьте подключение.",
  failedToLoadVideo: "Не удалось загрузить видео.",
  videoLoadingAborted: "Загрузка видео была прервана.",
  videoLoadNetworkError:
    "Сетевая ошибка при загрузке видео. Пожалуйста, проверьте подключение.",
  safariWebmLimitedSupportError:
    "Safari ограниченно поддерживает кодек WebM/VP9, особенно для видео 4K. Пожалуйста, заново загрузите видео в формате H.264/MP4 для лучшей совместимости с Safari.",
  safariVideoDecodeError:
    "Ошибка декодирования видео. Возможно, Safari не поддерживает этот видеокодек. Попробуйте заново загрузить видео в формате H.264/MP4.",
  videoDecodeError:
    "Ошибка декодирования видео. Файл может быть поврежден или использовать неподдерживаемый кодек.",
  safariVideoFormatNotSupported:
    "Формат видео не поддерживается Safari. Safari лучше всего работает с видео H.264/MP4. Пожалуйста, заново загрузите видео с кодеком H.264.",
  browserVideoFormatNotSupported:
    "Формат видео не поддерживается вашим браузером.",

  // Ошибки промежуточного ПО настроек на основе ролей
  settingsApiKeyForbidden:
    "Аутентификация по API-ключу не может получить доступ к конечным точкам настроек.",
  settingsVisitorAccessRestricted:
    "Роль посетителя: Доступ к этому ресурсу ограничен.",
  settingsVisitorWriteRestricted:
    "Роль посетителя: Разрешено только чтение настроек и обновление настроек CloudFlare.",
  settingsVisitorWriteForbidden:
    "Роль посетителя: Операции записи не разрешены.",
  settingsAuthRequired:
    "Требуется аутентификация. Пожалуйста, войдите в систему для доступа к этому ресурсу.",
};
