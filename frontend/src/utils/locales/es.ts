export const es = {
  // Header
  myTube: "MyTube",
  manage: "Gestionar",
  settings: "Configuración",
  logout: "Cerrar sesión",
  pleaseEnterUrlOrSearchTerm:
    "Por favor ingrese una URL de video o término de búsqueda",
  unexpectedErrorOccurred:
    "Ocurrió un error inesperado. Por favor, inténtelo de nuevo.",
  uploadVideo: "Subir Video",
  enterUrlOrSearchTerm: "Introducir URL de video o término de búsqueda",
  enterSearchTerm: "Introducir término de búsqueda",
  manageVideos: "Gestionar Videos",
  instruction: "Instrucciones",


  // Home
  pasteUrl: "Pegar URL de video o colección",
  download: "Descargar",
  search: "Buscar",
  recentDownloads: "Descargas Recientes",
  noDownloads: "Sin descargas aún",
  downloadStarted: "Descarga iniciada",
  downloadFailed: "Descarga fallida",
  downloadSuccess: "La descarga comenzó exitosamente",
  confirmDownloadAllPlaylists:
    "¿Descargar todas las listas de reproducción de este canal? Esto creará una colección para cada lista de reproducción.",
  downloadAll: "Descargar todo",
  loadingVideos: "Cargando videos...",
  searchResultsFor: "Resultados de búsqueda para",
  fromYourLibrary: "De tu Biblioteca",
  noMatchingVideos: "No hay videos coincidentes en tu biblioteca.",
  fromYouTube: "De YouTube",
  loadingYouTubeResults: "Cargando resultados de YouTube...",
  noYouTubeResults: "No se encontraron resultados de YouTube",
  noVideosYet:
    "Aún no hay videos. ¡Envía una URL de video para descargar el primero!",
  views: "vistas",


  // Settings
  general: "General",
  security: "Seguridad",
  videoDefaults: "Predeterminados del Reproductor",
  downloadSettings: "Configuración de Descarga",

  // Settings Categories
  basicSettings: "Configuración Básica",
  interfaceDisplay: "Interfaz y Visualización",
  securityAccess: "Seguridad y Acceso",
  videoPlayback: "Reproducción de Video",
  downloadStorage: "Descarga y Almacenamiento",
  contentManagement: "Gestión de Contenido",
  dataManagement: "Gestión de Datos",
  advanced: "Avanzado",
  language: "Idioma",
  websiteName: "Nombre del sitio web",
  websiteNameHelper: "{current}/{max} caracteres (Predeterminado: {default})",
  theme: "Tema",
  themeLight: "Siempre Claro",
  themeDark: "Siempre Oscuro",
  themeSystem: "Sistema",
  showThemeButtonInHeader: "Mostrar botón de tema en el encabezado",
  tmdbApiKey: "Clave API de TMDB",
  tmdbApiKeyHelper:
    "Clave API de TheMovieDB para obtener metadatos y pósters de películas/series. Obtenga su clave en https://www.themoviedb.org/settings/api",
  testTmdbCredential: "Probar credencial",
  tmdbCredentialMissing: "Primero ingrese una credencial de TMDB.",
  tmdbCredentialValid: "La credencial de TMDB es válida.",
  tmdbCredentialTestFailed: "No se pudo probar la credencial de TMDB.",
  tmdbCredentialValidApiKey: "La API Key de TMDB es válida.",
  tmdbCredentialValidReadAccessToken:
    "El Read Access Token de TMDB es válido.",
  tmdbCredentialInvalid:
    "La credencial de TMDB no es válida. Verifique si es una API Key o un Read Access Token válidos.",
  tmdbCredentialRequestFailed:
    "No se pudo conectar con TMDB. Inténtelo de nuevo.",
  mountDirectories: "Directorios de montaje",
  mountDirectoriesPlaceholder:
    "Ingrese los directorios de montaje (uno por línea)\nEjemplo:\n/mnt/media1\n/mnt/media2",
  mountDirectoriesHelper:
    "Ingrese los directorios de montaje donde se almacenan los archivos de video, un directorio por línea",
  mountDirectoriesEmptyError:
    "Por favor, ingrese al menos un directorio de montaje",
  infiniteScroll: "Desplazamiento infinito",
  infiniteScrollDisabled:
    "Desactivado cuando el desplazamiento infinito está habilitado",
  maxVideoColumns: "Columnas de video máximas (Página de inicio)",
  videoColumns: "Columnas de video (Página de inicio)",
  columnsCount: "{count} Columnas",
  enableLogin: "Habilitar Protección de Inicio de Sesión",
  allowPasswordLogin: "Permitir Inicio de Sesión con Contraseña",
  allowPasswordLoginHelper:
    "Cuando está deshabilitado, el inicio de sesión con contraseña no está disponible. Debe tener al menos una clave de acceso para deshabilitar el inicio de sesión con contraseña.",
  allowResetPassword: "Permitir Restablecer Contraseña",
  allowResetPasswordHelper:
    "Cuando está deshabilitado, el botón de restablecer contraseña no se mostrará en la página de inicio de sesión y la API de restablecer contraseña será bloqueada.",
  enableApiKeyAuth: "Habilitar autenticación con clave API",
  apiKeyAuthHelper:
    "Cuando se habilita, las solicitudes a la API se pueden autorizar con X-API-Key sin iniciar sesión.",
  apiKey: "Clave API",
  refreshApiKey: "Actualizar",
  refreshApiKeyTitle: "Actualizar clave API",
  refreshApiKeyConfirm: "Generar una nueva clave API invalidará la actual. Todos los clientes que usen la clave antigua deberán actualizarse después de guardar.",
  copyApiKey: "Copiar",
  apiKeySaveHint: "Guarde la configuración para aplicar los cambios a la clave API.",
  apiKeyCopied: "Clave API copiada al portapapeles",
  apiKeyCopyFailed: "Error al copiar la clave API. Cópiela manualmente.",
  password: "Contraseña",
  enterPassword: "Introducir contraseña",
  togglePasswordVisibility: "Alternar visibilidad de contraseña",
  passwordHelper:
    "Dejar vacío para mantener la contraseña actual, o escribir para cambiar",
  passwordSetHelper: "Establecer una contraseña para acceder a la aplicación",
  autoPlay: "Reproducir videos automáticamente al cargar",
  autoLoop: "Repetición Automática",
  maxConcurrent: "Descargas Simultáneas Máximas",
  maxConcurrentDescription:
    "Limita el número de descargas simultáneas, incluidas las descargas regulares y las tareas de suscripción continua.",
  dontSkipDeletedVideo: "No omitir videos eliminados",
  dontSkipDeletedVideoDescription:
    "Cuando está habilitado, los videos con estado eliminado se volverán a descargar automáticamente en lugar de omitirse.",
  preferredAudioLanguage: "Idioma de audio preferido",
  preferredAudioLanguageDescription:
    "Cuando esté disponible, se preferirá el audio multistream de YouTube en este idioma para las descargas.",
  preferredAudioLanguageDefault: "Predeterminado",
  preferredAudioLanguage_en: "Inglés",
  preferredAudioLanguage_zh: "Chino",
  preferredAudioLanguage_ja: "Japonés",
  preferredAudioLanguage_ko: "Coreano",
  preferredAudioLanguage_es: "Español",
  preferredAudioLanguage_fr: "Francés",
  preferredAudioLanguage_de: "Alemán",
  preferredAudioLanguage_pt: "Portugués",
  preferredAudioLanguage_ru: "Ruso",
  preferredAudioLanguage_ar: "Árabe",
  preferredAudioLanguage_hi: "Hindi",
  preferredAudioLanguage_it: "Italiano",
  preferredAudioLanguage_nl: "Neerlandés",
  preferredAudioLanguage_pl: "Polaco",
  preferredAudioLanguage_tr: "Turco",
  preferredAudioLanguage_vi: "Vietnamita",
  defaultVideoCodec: "Códec de vídeo preferido",
  defaultVideoCodecDescription:
    "Preferir un códec de vídeo específico al descargar. yt-dlp intentará seleccionar este códec cuando esté disponible, recurriendo a otros códecs si no lo está. Se anula con la configuración personalizada de yt-dlp.",
  defaultVideoCodecDefault: "Predeterminado",
  defaultVideoCodec_h264: "H.264 (AVC)",
  defaultVideoCodec_h265: "H.265 (HEVC)",
  defaultVideoCodec_av1: "AV1",
  defaultVideoCodec_vp9: "VP9",
  saveSettings: "Guardar Configuración",
  saving: "Guardando...",
  backToManage: "Volver a Gestionar",
  settingsSaved: "Configuración guardada exitosamente",
  settingsFailed: "Error al guardar la configuración",
  debugMode: "Modo de Depuración",
  debugModeDescription:
    "Mostrar u ocultar mensajes de consola (requiere actualización)",
  telegramNotifications: "Notificaciones de Telegram",
  telegramNotificationsDescription: "Reciba notificaciones a través de Telegram cuando las tareas de descarga se completen.",
  telegramEnabled: "Activar notificaciones de Telegram",
  telegramBotToken: "Token del bot",
  telegramBotTokenHelper: "Cree un bot a través de @BotFather en Telegram para obtener su token.",
  telegramChatId: "ID de chat",
  telegramChatIdHelper: "Envíe un mensaje a @RawDataBot en Telegram para obtener su ID de chat.",
  telegramNotifyOnSuccess: "Notificar en caso de éxito",
  telegramNotifyOnFail: "Notificar en caso de fallo",
  twitchSubscriptions: "Suscripciones de Twitch",
  twitchClientId: "ID de cliente de Twitch",
  twitchClientSecret: "Secreto del cliente de Twitch",
  twitchSubscriptionCredentialsHelper:
    "Las credenciales de cliente de Twitch son opcionales. Sin ellas, MyTube usa un sondeo con yt-dlp en modo best-effort, pero añadirlas hace más fiable la detección del canal.",
  twitchSubscriptionDescription:
    "MyTube comprobará este canal de Twitch en busca de nuevos VOD y los descargará después de que Twitch los publique.",
  twitchSubscriptionCredentialsMissing:
    "La suscripción de Twitch falló. Las credenciales de cliente son opcionales, pero se recomiendan para una suscripción de canal más fiable.",
  twitchSubscriptionVodsOnly:
    "MyTube descarga los VOD de Twitch después de que se publican. La captura de transmisiones en vivo no está incluida en esta versión.",
  twitchClientHelpLink: "Cómo obtener el ID y el secreto de cliente de Twitch",
  twitchClientHelpTitle: "Obtener el ID y el secreto de cliente de Twitch",
  twitchClientHelpIntro:
    "Primero debes crear una aplicación de Twitch en la consola para desarrolladores de Twitch.",
  twitchClientHelpStep1:
    "Abre la consola para desarrolladores de Twitch e inicia sesión con tu cuenta de Twitch.",
  twitchClientHelpStep2: "Crea una nueva aplicación para MyTube.",
  twitchClientHelpStep3:
    "Configura una URL de redirección OAuth. Si solo usas suscripciones del lado del servidor, un valor como http://localhost es suficiente.",
  twitchClientHelpStep4:
    "Cuando la aplicación esté creada, copia el Client ID desde la página de detalles de la aplicación.",
  twitchClientHelpStep5:
    "Genera o muestra un Client Secret y luego pega ambos valores en la configuración de MyTube.",
  twitchClientHelpSecurity:
    "Mantén el Client Secret en privado y no lo compartas en capturas de pantalla ni en páginas públicas.",
  twitchDeveloperConsole: "Consola para desarrolladores de Twitch",
  twitchDeveloperDocs: "Documentación para desarrolladores de Twitch",
  telegramTestButton: "Enviar mensaje de prueba",
  telegramTestSuccess: "¡Mensaje de prueba enviado con éxito!",
  telegramTestFailed: "Prueba fallida: {error}",
  telegramTestMissingFields: "Por favor, introduzca primero el token del bot y el ID de chat.",
  pauseOnFocusLoss: "Pausar video cuando la ventana pierde el foco",
  playFromBeginning: "Reiniciar siempre los videos desde el principio",
  tagsManagement: "Gestión de Etiquetas",
  newTag: "Nueva Etiqueta",
  selectTags: "Seleccionar Etiquetas",
  tags: "Etiquetas",
  noTagsAvailable: "No hay etiquetas disponibles",
  addTag: "Añadir Etiqueta",
  addTags: "Añadir Etiquetas",
  failedToSaveTags: "Error al guardar etiquetas",
  renameTag: "Renombrar etiqueta",
  confirmRenameTag: "Renombrar",
  tagRenamedSuccess: "Etiqueta renombrada con éxito",
  tagRenameFailed: "Error al renombrar etiqueta",
  tagConflictCaseInsensitive:
    "Ya existe una etiqueta con el mismo nombre (las etiquetas no distinguen mayúsculas de minúsculas).",
  renameTagDescription:
    "Renombrar una etiqueta verificará y actualizará todos los videos que usan actualmente esta etiqueta.",
  enterNewTagName: "Ingrese el nuevo nombre para la etiqueta '{tag}'",

  // Database
  database: "Base de Datos",
  migrateDataDescription:
    "Migrar datos de archivos JSON heredados a la nueva base de datos SQLite. Esta acción es segura para ejecutar varias veces (se omitirán duplicados).",
  migrateDataButton: "Migrar Datos desde JSON",
  scanFiles: "Escanear Archivos",
  scanFilesSuccess: "Escaneo completo. Se añadieron {count} videos nuevos.",
  scanFilesDeleted: " Se eliminaron {count} archivos faltantes.",
  scanFilesFailed: "Escaneo fallido",
  scanMountDirectoriesSuccess:
    "Escaneo de directorios montados completado. Se añadieron {addedCount} videos nuevos. Se eliminaron {deletedCount} videos faltantes.",
  subscribePlaylistsSuccess:
    "Suscripción exitosa a {count} lista{plural} de reproducción.",
  subscribePlaylistsSkipped:
    "{count} lista{plural} de reproducción {wasWere} ya suscrita{plural}.",
  subscribePlaylistsErrors: "Ocurrió {count} error{plural}.",
  subscribePlaylistsNoNew: "No se suscribieron nuevas listas de reproducción.",
  playlistsWatcher: "Monitor de listas de reproducción",
  scanFilesConfirmMessage:
    "El sistema escaneará la carpeta raíz de la ruta de video. Se añadirán los archivos nuevos y se eliminarán del sistema los archivos de video que falten.",
  scanning: "Escaneando...",
  migrateConfirmation:
    "¿Está seguro de que desea migrar los datos? Esto puede tardar unos momentos.",
  migrationResults: "Resultados de Migración",
  migrationReport: "Informe de Migración",
  migrationSuccess: "Migración completada. Ver detalles en la alerta.",
  migrationNoData: "Migración finalizada pero no se encontraron datos.",
  migrationFailed: "Migración fallida",
  migrationWarnings: "ADVERTENCIAS",
  migrationErrors: "ERRORES",
  itemsMigrated: "elementos migrados",
  fileNotFound: "Archivo no encontrado en",
  noDataFilesFound:
    "No se encontraron archivos de datos para migrar. Por favor, verifique sus asignaciones de volumen.",
  removeLegacyData: "Eliminar Datos Heredados",
  removeLegacyDataDescription:
    "Eliminar los archivos JSON antiguos para liberar espacio en disco. Solo haga esto después de verificar que sus datos se hayan migrado exitosamente.",
  removeLegacyDataConfirmTitle: "¿Eliminar Datos Heredados?",
  removeLegacyDataConfirmMessage:
    "¿Está seguro de que desea eliminar los archivos de datos JSON heredados? Esta acción no se puede deshacer.",
  legacyDataDeleted: "Datos heredados eliminados exitosamente.",
  legacyDataDeleteFailed: "No se pudieron eliminar los datos heredados",
  formatLegacyFilenames: "Formatear Nombres de Archivo Heredados",
  formatLegacyFilenamesDescription:
    "Renombrar por lotes todos los archivos de video, miniaturas y subtítulos al nuevo formato estándar: Título-Autor-AAAA. Esta operación modificará los nombres de archivo en el disco y actualizará la lógica de la base de datos.",
  formatLegacyFilenamesButton: "Formatear Nombres de Archivos",
  deleteLegacyDataButton: "Eliminar Datos Legados",
  cleanupTempFiles: "Limpiar Archivos Temporales",
  cleanupTempFilesDescription:
    "Eliminar todos los archivos temporales de descarga (.ytdl, .part) del directorio de cargas. Esto ayuda a liberar espacio en disco de descargas incompletas o canceladas.",
  cleanupTempFilesConfirmTitle: "¿Limpiar Archivos Temporales?",
  cleanupTempFilesConfirmMessage:
    "Esto eliminará permanentemente todos los archivos .ytdl y .part en el directorio de cargas. Asegúrate de que no haya descargas activas antes de continuar.",


  // Task Hooks
  taskHooks: "Ganchos de Tarea",
  taskHooksDescription:
    "Ejecute comandos de shell personalizados en puntos específicos del ciclo de vida de la tarea. Variables de entorno disponibles: MYTUBE_TASK_ID, MYTUBE_TASK_TITLE, MYTUBE_SOURCE_URL, MYTUBE_VIDEO_PATH.",
  taskHooksWarning:
    "Advertencia: Los comandos se ejecutan con los permisos del servidor. Úselo con precaución.",
  deploymentSecurityTitle: "Modelo de seguridad del despliegue",
  deploymentSecurityLoading:
    "La política de seguridad del despliegue se está cargando. Las funciones restringidas permanecerán ocultas hasta que la política esté disponible.",
  deploymentSecurityDetails: "Detalles",
  deploymentSecurityDetailsTitle: "Detalles de seguridad del despliegue",
  deploymentSecurityCapabilityFeature: "Capacidad / Función",
  deploymentSecurityClose: "Cerrar",
  adminTrustLevelLabel: "Nivel de confianza del administrador",
  adminTrustLevelApplication: "Aplicación",
  adminTrustLevelContainer: "Contenedor",
  adminTrustLevelHost: "Host",
  adminTrustLevelApplicationDescription:
    "Se confía en el administrador solo a nivel de la aplicación.",
  adminTrustLevelContainerDescription:
    "Se confía en el administrador para acciones del backend o del proceso del contenedor.",
  adminTrustLevelHostDescription:
    "Se confía en el administrador para acciones administrativas con alcance de host.",
  deploymentSecurityStandardAppManagement:
    "Gestión estándar de la app (videos, colecciones, etiquetas, inicio de sesión, copias de seguridad)",
  deploymentSecurityTaskHooksCapability:
    "Carga/eliminación/ejecución de hooks de tarea",
  deploymentSecurityRawYtDlpConfigTextArea:
    "Área de texto de configuración sin procesar de yt-dlp",
  deploymentSecurityFullRawYtDlpFlagPassthrough:
    "Paso completo de flags sin procesar de yt-dlp",
  deploymentSecurityMountDirectorySettingsPersistence:
    "Persistencia de configuración de directorios montados",
  deploymentSecurityScanMountDirectories:
    "Escanear archivos de los directorios montados configurados",
  deploymentSecurityFutureHostPathMaintenanceFeatures:
    "Futuras funciones de mantenimiento de rutas del host",
  deploymentSecurityConfigurationTitle: "Cómo configurarlo",
  deploymentSecurityConfigurationValuesNote:
    "Use MYTUBE_ADMIN_TRUST_LEVEL con application, container o host. Si falta o el valor es inválido, se usará container.",
  deploymentSecurityDockerConfigTitle: "Docker / Docker Compose",
  deploymentSecurityDockerConfigDescription:
    "Configure MYTUBE_ADMIN_TRUST_LEVEL en el entorno del servicio. Sustituya application por container o host según sea necesario.",
  deploymentSecurityDockerPermissionsNote:
    "Si está actualizando una instalación con bind mounts creada antes de la versión 1.9.0, asegúrese de que las carpetas uploads y data del host sean escribibles por uid/gid 1000 (`node`). Esto también corrige directorios uploads/images-small propiedad de root que pueden hacer fallar la generación de miniaturas o los escaneos con EACCES.",
  deploymentSecurityLocalConfigTitle: "Ejecución local desde código fuente",
  deploymentSecurityLocalConfigDescription:
    "Exporte MYTUBE_ADMIN_TRUST_LEVEL antes de iniciar MyTube o páselo en línea al ejecutar npm run dev.",
  deploymentSecurityLocalEnvFileNote:
    "También puede colocar la misma línea en backend/.env.",
  taskHooksPolicyNotice:
    "Los hooks de tarea están deshabilitados por la política de seguridad del despliegue en el modo de confianza application.",
  hookTaskBeforeStart: "Antes del Inicio de la Tarea",
  hookTaskBeforeStartHelper: "Se ejecuta antes de que comience la descarga.",
  hookTaskSuccess: "Tarea Exitosa",
  hookTaskSuccessHelper:
    "Se ejecuta después de una descarga exitosa, antes de la carga/eliminación en la nube (espera finalización).",
  hookTaskFail: "Tarea Fallida",
  hookTaskFailHelper: "Se ejecuta cuando falla una tarea.",
  hookTaskCancel: "Tarea Cancelada",
  hookTaskCancelHelper: "Se ejecuta cuando una tarea se cancela manualmente.",
  found: "Encontrado",
  notFound: "No Establecido",
  deleteHook: "Eliminar Script de Gancho",
  confirmDeleteHook:
    "¿Está seguro de que desea eliminar este script de gancho?",
  uploadHook: "Subir .sh",
  enterPasswordToUploadHook:
    "Por favor ingrese su contraseña para subir este script de gancho.",
  riskCommandDetected:
    "Comando de riesgo detectado: {command}. Carga rechazada.",
  cleanupTempFilesActiveDownloads:
    "No se puede limpiar mientras hay descargas activas. Espera a que todas las descargas terminen o cancélalas primero.",
  formatFilenamesSuccess:
    "Procesados: {processed}\nRenombrados: {renamed}\nErrores: {errors}",
  formatFilenamesDetails: "Detalles:",
  formatFilenamesMore: "...y {count} más",
  formatFilenamesError: "Error al formatear nombres de archivos: {error}",
  itemsPerPage: "Elementos por página",
  itemsPerPageHelper:
    "Número de videos para mostrar por página (Predeterminado: 12)",
  showYoutubeSearch: "Mostrar resultados de búsqueda de YouTube",
  defaultSort: "Orden por defecto",
  showTagsOnThumbnail: "Mostrar etiquetas en la miniatura",
  playSoundOnTaskComplete: "Reproducir sonido al completar tarea",
  soundSuccess: "Sonido de éxito",
  visitorModeReadOnly: "Modo visitante: Solo lectura",
  visitorModeUrlRestricted: "Los visitantes no pueden procesar URLs",
  visitorUser: "Usuario Visitante",
  enableVisitorUser: "Habilitar Usuario Visitante",
  visitorUserHelper:
    "Habilite una cuenta de visitante separada con acceso de solo lectura. Los visitantes pueden ver el contenido pero no pueden realizar cambios.",
  visitorPassword: "Contraseña de Visitante",
  visitorPasswordHelper:
    "Establezca la contraseña para la cuenta de visitante.",
  visitorPasswordSetHelper:
    "La contraseña está establecida. Déjelo en blanco para mantenerla.",
  cleanupTempFilesSuccess:
    "Se eliminaron exitosamente {count} archivo(s) temporal(es).",
  cleanupTempFilesFailed: "Error al limpiar archivos temporales",


  // Cookie Settings
  cookieSettings: "Configuración de Cookies",
  cookieUploadDescription:
    'Sube cookies.txt para pasar las comprobaciones de bots de YouTube y habilitar la descarga de subtítulos de Bilibili. El archivo se renombrará automáticamente a cookies.txt. (Ejemplo: use la extensión "Get cookies.txt LOCALLY" para exportar cookies)',
  uploadCookies: "Subir Cookies",
  onlyTxtFilesAllowed: "Solo se permiten archivos .txt",
  cookiesUploadedSuccess: "Cookies subidas con éxito",
  cookiesUploadFailed: "Error al cargar cookies",
  cookiesFound: "cookies.txt encontrado",
  cookiesNotFound: "cookies.txt no encontrado",
  deleteCookies: "Eliminar Cookies",
  confirmDeleteCookies:
    "¿Estás seguro de que deseas eliminar el archivo de cookies? Esto afectará tu capacidad para descargar videos con restricción de edad o solo para miembros.",
  cookiesDeletedSuccess: "Cookies eliminadas con éxito",
  cookiesDeleteFailed: "Error al eliminar cookies",


  // Cloud Drive
  cloudDriveSettings: "Almacenamiento en la Nube (OpenList)",
  cloudDriveDescription:
    "Sube automáticamente videos al almacenamiento en la nube (Alist) y busca nuevos archivos en la nube. Los archivos locales se eliminarán después de una carga exitosa.",
  enableAutoSave: "Habilitar sincronización en la nube",
  apiUrl: "URL de la API",
  apiUrlHelper: "ej. https://your-alist-instance.com/api/fs/put",
  token: "Token",
  publicUrl: "URL Público",
  publicUrlHelper:
    "Dominio público para acceder a archivos (ej. https://your-cloudflare-tunnel-domain.com). Si se establece, se usará en lugar de la URL de la API para acceder a archivos.",
  uploadPath: "Ruta de carga",
  cloudDrivePathHelper: "Ruta del directorio en la nube, ej. /mytube-uploads",
  scanPaths: "Rutas de escaneo",
  scanPathsHelper:
    "Una ruta por línea. Se escanearán videos de estas rutas. Si está vacío, se usará la ruta de carga. Ejemplo:\n/a/Peliculas\n/b/Documentales",
  cloudDriveNote:
    "Después de habilitar esta función, los videos recién descargados se subirán automáticamente al almacenamiento en la nube y se eliminarán los archivos locales. Los videos se reproducirán desde el almacenamiento en la nube a través de un proxy.",
  cloudScanAdded: "Añadido desde la nube",
  testing: "Probando...",
  testConnection: "Probar Conexión",
  sync: "Sincronizar",
  syncToCloud: "Sincronización bidireccional",
  syncWarning:
    "Esta operación subirá videos locales a la nube y buscará nuevos archivos en el almacenamiento en la nube. Los archivos locales se eliminarán después de la carga.",
  syncing: "Sincronizando...",
  syncCompleted: "Sincronización Completada",
  syncFailed: "Sincronización Fallida",
  syncReport: "Total: {total} | Cargados: {uploaded} | Fallidos: {failed}",
  syncErrors: "Errores:",
  fillApiUrlToken: "Por favor complete primero la URL de la API y el Token",
  connectionTestSuccess:
    "¡Prueba de conexión exitosa! La configuración es válida.",
  connectionFailedStatus:
    "Conexión fallida: El servidor devolvió el estado {status}",
  connectionFailedUrl:
    "No se puede conectar al servidor. Por favor verifique la URL de la API.",
  authFailed: "Autentiación fallida. Por favor verifique su token.",
  connectionTestFailed: "Prueba de conexión fallida: {error}",
  syncFailedMessage: "Sincronización fallida. Por favor intente de nuevo.",
  foundVideosToSync:
    "Se encontraron {count} videos con archivos locales para sincronizar",
  uploadingVideo: "Subiendo: {title}",
  clearThumbnailCache: "Borrar caché local de miniaturas",
  clearing: "Borrando...",
  clearThumbnailCacheSuccess:
    "Caché de miniaturas borrado con éxito. Las miniaturas se regenerarán la próxima vez que se acceda a ellas.",
  clearThumbnailCacheError: "Error al borrar el caché de miniaturas",
  clearThumbnailCacheConfirmMessage:
    "Esto borrará todas las miniaturas almacenadas en caché localmente para videos en la nube. Las miniaturas se regenerarán desde el almacenamiento en la nube la próxima vez que se acceda a ellas. ¿Continuar?",


  // Manage
  manageContent: "Gestionar Contenido",
  videos: "Videos",
  collections: "Colecciones",
  allVideos: "Todos los Videos",
  delete: "Eliminar",
  backToHome: "Volver a Inicio",
  confirmDelete: "¿Está seguro de que desea eliminar esto?",
  deleteSuccess: "Eliminado exitosamente",
  deleteFailed: "Error al eliminar",
  noVideos: "No se encontraron videos",
  noCollectionsFound: "No se encontraron colecciones",
  noCollections: "No se encontraron colecciones",
  searchVideos: "Buscar videos...",
  thumbnail: "Miniatura",
  title: "Título",
  author: "Autor",
  authors: "Autores",
  created: "Creado",
  name: "Nombre",
  size: "Tamaño",
  actions: "Acciones",
  deleteCollection: "Eliminar Colección",
  deleteVideo: "Eliminar Video",
  redownloadVideo: "Volver a descargar video",
  refreshFileSizesSuccess: "Tamaños de archivo actualizados. {count} videos actualizados.",
  refreshFileSizesFailed: " {count} fallidos.",
  refreshFileSizesSkipped: " {count} sin cambios o no disponibles.",
  refreshFileSizesError: "Error al actualizar los tamaños de archivo: {error}",
  noVideosFoundMatching:
    "No se encontraron videos que coincidan con su búsqueda.",
  refreshThumbnail: "Actualizar miniatura",
  selected: "Seleccionado",
  moveCollection: "Mover a la colección",
  confirmBulkDelete:
    "¿Está seguro de que desea eliminar estos videos? Esta acción no se puede deshacer.",


  // Video Player
  playing: "Reproducir",
  paused: "Pausar",
  next: "Siguiente",
  previous: "Anterior",
  loop: "Repetir",
  autoPlayOn: "Reproducción Automática Activada",
  autoPlayOff: "Reproducción Automática Desactivada",
  autoPlayNext: "Reproducción Automática Siguiente",
  videoNotFound: "Video no encontrado",
  videoNotFoundOrLoaded: "Video no encontrado o no se pudo cargar.",
  deleting: "Eliminando...",
  addToCollection: "Agregar a Colección",
  originalLink: "Enlace Original",
  source: "Fuente:",
  addedDate: "Fecha de Agregado:",
  hideComments: "Ocultar comentarios",
  showComments: "Mostrar comentarios",
  latestComments: "Últimos Comentarios",
  noComments: "No hay comentarios disponibles.",
  upNext: "A Continuación",
  noOtherVideos: "No hay otros videos disponibles",
  currentlyIn: "Actualmente en:",
  collectionWarning:
    "Agregar a una colección diferente lo eliminará de la actual.",
  addToExistingCollection: "Agregar a colección existente:",
  selectCollection: "Seleccionar una colección",
  add: "Agregar",
  createNewCollection: "Crear nueva colección:",
  collectionName: "Nombre de la colección",
  create: "Crear",
  removeFromCollection: "Eliminar de la Colección",
  confirmRemoveFromCollection:
    "¿Está seguro de que desea eliminar este video de la colección?",
  remove: "Eliminar",
  loadingVideo: "Cargando video...",
  current: "(Actual)",
  rateThisVideo: "Calificar este video",
  enterFullscreen: "Pantalla Completa",
  exitFullscreen: "Salir de Pantalla Completa",
  enterCinemaMode: "Modo Cine",
  exitCinemaMode: "Salir del Modo Cine",
  share: "Compartir",
  editTitle: "Editar Título",
  hideVideo: "Hacer Video Oculto para Modo Visitante",
  showVideo: "Hacer Video Visible para Modo Visitante",
  toggleVisibility: "Alternar Visibilidad",
  titleUpdated: "Título actualizado exitosamente",
  titleUpdateFailed: "Error al actualizar el título",
  thumbnailRefreshed: "Miniatura actualizada con éxito",
  thumbnailRefreshFailed: "Error al actualizar la miniatura",
  videoUpdated: "Video actualizado con éxito",
  videoUpdateFailed: "Error al actualizar el video",
  failedToLoadVideos:
    "Error al cargar videos. Por favor, inténtelo de nuevo más tarde.",
  videoRemovedSuccessfully: "Video eliminado correctamente",
  failedToDeleteVideo: "Error al eliminar el video",
  pleaseEnterSearchTerm: "Por favor, introduzca un término de búsqueda",
  failedToSearch: "Error en la búsqueda. Por favor, inténtelo de nuevo.",
  searchCancelled: "Búsqueda cancelada",
  openInExternalPlayer: "Abrir en reproductor externo",
  playWith: "Reproducir con...",
  deleteAllFilteredVideos: "Eliminar todos los videos filtrados",
  confirmDeleteFilteredVideos:
    "¿Está seguro de que desea eliminar {count} videos filtrados por las etiquetas seleccionadas?",
  deleteFilteredVideosSuccess: "Se han eliminado {count} videos con éxito.",
  deletingVideos: "Eliminando videos...",


  // Login
  signIn: "Iniciar Sesión",
  admin: "Administrador",
  visitorSignIn: "Inicio de Sesión de Visitante",
  orVisitor: "O VISITANTE",
  verifying: "Verificando...",
  incorrectPassword: "Contraseña incorrecta",
  loginFailed: "Error al verificar la contraseña",
  defaultPasswordHint: "Contraseña predeterminada: 123",
  checkingConnection: "Comprobando conexión...",
  connectionError: "Error de Conexión",
  backendConnectionFailed:
    "No se puede conectar al servidor. Por favor, verifique si el backend está en ejecución y el puerto está abierto, luego intente nuevamente.",
  retry: "Reintentar",
  resetPassword: "Restablecer Contraseña",
  resetPasswordTitle: "Restablecer Contraseña",
  resetPasswordMessage:
    "La recuperación de la contraseña debe realizarse desde el entorno del backend. Utilice un comando del backend para establecer explícitamente una nueva contraseña.",
  resetPasswordConfirm: "Restablecer",
  resetPasswordSuccess:
    "A continuación se muestran las instrucciones de recuperación de contraseña. Utilice un comando del backend para establecer la nueva contraseña.",
  resetPasswordRecoveryMessage:
    "La recuperación de la contraseña debe realizarse desde el entorno del backend. Establezca una nueva contraseña explícitamente en lugar de depender de credenciales generadas en los registros.",
  resetPasswordRecoveryGuide:
    "Elija el comando que corresponda a su entorno:\n\nShell del backend\n  node dist/scripts/reset-password.js <new-password>\n\nHost de Docker\n  docker exec -it mytube-backend node /app/dist/scripts/reset-password.js <new-password>\n\nUtilice el directorio o contenedor del backend que tenga acceso a los datos persistentes de la aplicación.",
  resetPasswordDisabledInfo:
    "El restablecimiento de contraseña está deshabilitado en la interfaz web. Para restablecer su contraseña, ejecute uno de los siguientes comandos desde el entorno del backend:\n\nShell del backend\n  node dist/scripts/reset-password.js <new-password>\n\nHost de Docker\n  docker exec -it mytube-backend node /app/dist/scripts/reset-password.js <new-password>\n\nUtilice el directorio o contenedor del backend que tenga acceso a los datos persistentes de la aplicación.",
  resetPasswordScriptGuide:
    "Para restablecer la contraseña manualmente, ejecute uno de los siguientes comandos y proporcione explícitamente la nueva contraseña:\n\nShell del backend\n  node dist/scripts/reset-password.js <new-password>\n\nHost de Docker\n  docker exec -it mytube-backend node /app/dist/scripts/reset-password.js <new-password>\n\nEl script no genera ni muestra contraseñas aleatorias.",
  waitTimeMessage: "Por favor espere {time} antes de intentar nuevamente.",
  tooManyAttempts: "Demasiados intentos fallidos.",

  // Passkeys
  createPasskey: "Crear clave de acceso",
  creatingPasskey: "Creando...",
  passkeyCreated: "Clave de acceso creada exitosamente",
  passkeyCreationFailed:
    "Error al crear la clave de acceso. Por favor, inténtelo de nuevo.",
  passkeyWebAuthnNotSupported:
    "WebAuthn no es compatible con este navegador. Por favor, utilice un navegador moderno que sea compatible con WebAuthn.",
  passkeyRequiresHttps:
    "WebAuthn requiere HTTPS o localhost. Por favor, acceda a la aplicación a través de HTTPS o utilice localhost en lugar de una dirección IP.",
  removePasskeys: "Eliminar todas las claves de acceso",
  removePasskeysTitle: "Eliminar todas las claves de acceso",
  removePasskeysMessage:
    "¿Está seguro de que desea eliminar todas las claves de acceso? Esta acción no se puede deshacer.",
  passkeysRemoved: "Todas las claves de acceso han sido eliminadas",
  passkeysRemoveFailed:
    "Error al eliminar las claves de acceso. Por favor, inténtelo de nuevo.",
  loginWithPasskey: "Iniciar sesión con clave de acceso",
  authenticating: "Autenticando...",
  passkeyLoginFailed:
    "Error en la autenticación con clave de acceso. Por favor, inténtelo de nuevo.",
  passkeyErrorPermissionDenied:
    "La solicitud no está permitida por el agente de usuario o la plataforma en el contexto actual, posiblemente porque el usuario denegó el permiso.",
  passkeyErrorAlreadyRegistered:
    "El autenticador ya estaba registrado previamente.",
  linkCopied: "Enlace copiado al portapapeles",
  copyFailed: "Error al copiar enlace",
  copyUrl: "Copiar URL",


  // Collection Page
  loadingCollection: "Cargando colección...",
  collectionNotFound: "Colección no encontrada",
  noVideosInCollection: "No hay videos en esta colección.",
  back: "Volver",


  // Author Videos
  loadVideosError:
    "Error al cargar los videos. Por favor, inténtelo más tarde.",
  unknownAuthor: "Desconocido",
  noVideosForAuthor: "No se encontraron videos para este autor.",
  deleteAuthor: "Eliminar Autor",
  deleteAuthorConfirmation:
    "¿Está seguro de que desea eliminar al autor {author}? Esto eliminará todos los videos asociados con este autor.",
  authorDeletedSuccessfully: "Autor eliminado con éxito",
  failedToDeleteAuthor: "Error al eliminar autor",
  createCollectionFromAuthor: "Crear colección del autor",
  createCollectionFromAuthorTooltip:
    "Mover todos los videos de este autor a una colección",
  creatingCollection: "Creando colección...",
  collectionCreatedFromAuthor:
    "Colección creada y todos los videos movidos con éxito",
  failedToCreateCollectionFromAuthor:
    "Error al crear la colección desde el autor",
  collectionAlreadyExists: "Ya existe una colección con este nombre",
  createCollectionFromAuthorConfirmation:
    'Se creará una colección llamada "{author}" y todos los videos de este autor se moverán a ella. ¿Continuar?',
  createCollectionFromAuthorConfirmationWithMove:
    'Se creará una colección llamada "{author}" y todos los videos de este autor se moverán a ella. {count} video(s) que actualmente están en otras colecciones se moverán a esta nueva colección. ¿Continuar?',
  addVideosToCollection: "Añadir videos a la colección",
  addVideosToExistingCollectionConfirmation:
    'Añadir {count} video(s) del autor "{author}" a la colección existente "{author}". ¿Continuar?',
  addVideosToExistingCollectionConfirmationWithMove:
    'Añadir {count} video(s) del autor "{author}" a la colección existente "{author}". {moveCount} video(s) que actualmente están en otras colecciones se moverán a esta colección. ¿Continuar?',


  // Delete Collection Modal
  deleteCollectionTitle: "Eliminar Colección",
  deleteCollectionConfirmation:
    "¿Está seguro de que desea eliminar la colección",
  collectionContains: "Esta colección contiene",
  deleteCollectionOnly: "Eliminar Solo Colección",
  deleteCollectionAndVideos: "Eliminar Colección y Todos los Videos",


  // Common
  loading: "Cargando...",
  error: "Error",
  success: "Éxito",
  cancel: "Cancelar",
  close: "Cerrar",
  ok: "OK",
  confirm: "Confirmar",
  save: "Guardar",
  note: "Nota",
  on: "Activado",
  off: "Desactivado",
  continue: "Continuar",
  expand: "Expandir",
  collapse: "Contraer",


  // Video Card
  unknownDate: "Fecha desconocida",
  part: "Parte",
  collection: "Colección",
  new: "NUEVO",
  justNow: "Ahora mismo",
  hoursAgo: "Hace {hours} horas",
  today: "Hoy",
  thisWeek: "Esta semana",
  weeksAgo: "Hace {weeks} semanas",


  // Upload Modal
  selectVideoFile: "Seleccionar Archivo de Video",
  selectVideoFolder: "Seleccionar Carpeta",
  uploadFileLimitHint:
    "Puedes subir hasta {count} archivos y {size} GB en total por vez. En las subidas de carpetas, cada video y su tamaño cuentan para estos límites.",
  pleaseSelectVideo: "Por favor seleccione un archivo de video",
  noSupportedVideosFound:
    "No se encontraron archivos de video compatibles en tu selección",
  tooManyFilesSelected:
    "Puedes subir hasta {count} archivos por vez. Reduce tu selección e inténtalo de nuevo.",
  totalUploadSizeExceeded:
    "Los archivos seleccionados superan el límite total de carga de {size} GB. Reduce tu selección e inténtalo de nuevo.",
  uploadFailed: "Carga fallida",
  failedToUpload: "Error al cargar el video",
  uploading: "Cargando...",
  upload: "Subir",
  uploadSummary:
    "Subidos {uploaded}, duplicados {duplicates}, fallidos {failed}",
  unsupportedFilesSkipped: "Se omitieron {count} archivos no compatibles",
  multipleUploadUsesFilename:
    "Las cargas múltiples usan cada nombre de archivo como título",
  uploadThumbnail: "Subir miniatura",
  clickToSelectImage: "Haz clic para seleccionar una imagen",
  changeImage: "Cambiar imagen",
  selectImage: "Seleccionar imagen",
  thumbnailUploaded: "Miniatura subida",


  // Bilibili Modal
  bilibiliCollectionDetected: "Colección de Bilibili Detectada",
  bilibiliSeriesDetected: "Serie de Bilibili Detectada",
  multiPartVideoDetected: "Video Multiparte Detectado",
  authorOrPlaylist: "Autor / Lista de reproducción",
  playlistDetected: "Lista de reproducción detectada",
  playlistHasVideos: "Esta lista de reproducción tiene {count} videos.",
  downloadPlaylistAndCreateCollection:
    "¿Descargar videos de la lista de reproducción y crear una colección para ella?",
  playlistDownloadStarted: "Descarga de lista de reproducción iniciada",
  collectionHasVideos: "Esta colección de Bilibili tiene {count} videos.",
  seriesHasVideos: "Esta serie de Bilibili tiene {count} videos.",
  videoHasParts: "Este video de Bilibili tiene {count} partes.",
  downloadAllVideos: "Descargar Todos los {count} Videos",
  downloadAllParts: "Descargar Todas las {count} Partes",
  downloadThisVideoOnly: "Descargar Solo Este Video",
  downloadCurrentPartOnly: "Descargar Solo Parte Actual",
  processing: "Procesando...",
  wouldYouLikeToDownloadAllParts: "¿Le gustaría descargar todas las partes?",
  wouldYouLikeToDownloadAllVideos: "¿Le gustaría descargar todos los videos?",
  allPartsAddedToCollection: "Todas las partes se agregarán a esta colección",
  allVideosAddedToCollection: "Todos los videos se agregarán a esta colección",
  queued: "En cola",
  waitingInQueue: "Esperando en cola",


  // Downloads
  downloads: "Descargas",
  activeDownloads: "Descargas Activas",
  manageDownloads: "Gestionar Descargas",
  queuedDownloads: "Descargas en Cola",
  downloadHistory: "Historial de Descargas",
  clearQueue: "Limpiar Cola",
  clearHistory: "Limpiar Historial",
  noActiveDownloads: "No hay descargas activas",
  noQueuedDownloads: "No hay descargas en cola",
  noDownloadHistory: "No hay historial de descargas",
  downloadCancelled: "Descarga cancelada",
  queueCleared: "Cola limpiada",
  historyCleared: "Historial limpiado",
  removedFromQueue: "Eliminado de la cola",
  removedFromHistory: "Eliminado del historial",
  status: "Estado",
  progress: "Progreso",
  speed: "Velocidad",
  finishedAt: "Finalizado en",
  failed: "Fallido",


  // Snackbar Messages
  videoDownloading: "Descargando video",
  downloadStartedSuccessfully: "Descarga iniciada exitosamente",
  collectionCreatedSuccessfully: "Colección creada exitosamente",
  videoAddedToCollection: "Video agregado a la colección",
  videosAddedToCollection: "Videos añadidos a la colección",
  videoRemovedFromCollection: "Video eliminado de la colección",
  collectionDeletedSuccessfully: "Colección eliminada exitosamente",
  failedToDeleteCollection: "Error al eliminar la colección",

  collectionUpdatedSuccessfully: "Colección actualizada con éxito",
  failedToUpdateCollection:
    "Error al actualizar la colección, use un nombre diferente",
  collectionNameRequired: "El nombre de la colección es obligatorio",
  collectionNameTooLong:
    "El nombre de la colección debe tener 200 caracteres o menos",
  collectionNameInvalidChars:
    "El nombre de la colección contiene caracteres no válidos",
  collectionNameReserved: "El nombre de la colección está reservado",
  updateCollectionFailed: "Error al actualizar la colección",
  uploadSubtitle: "Subir subtítulo",
  subtitleUploaded: "Subtítulo subido correctamente",
  confirmDeleteSubtitle: "¿Eliminar este subtítulo?",
  subtitleDeleted: "Subtítulo eliminado",

  // Batch Download
  batchDownload: "Descarga por lotes",
  batchDownloadDescription: "Pegue varias URL a continuación, una por línea.",
  urls: "URLs",
  addToQueue: "Añadir a la cola",
  batchTasksAdded: "{count} tareas añadidas",
  addBatchTasks: "Añadir tareas por lotes",


  // Subscriptions
  subscribeToAuthor: "Suscribirse al autor",
  subscribeToChannel: "Suscribirse al canal",
  subscribeConfirmationMessage: "¿Quieres suscribirte a {author}?",
  subscribeChannelChoiceMessage: "¿Cómo te gustaría suscribirte a este canal?",
  subscribeChannelChoiceDescription:
    "Elige suscribirte a todos los vídeos o a todas las listas de reproducción de este canal. Suscribirse a todas las listas de reproducción también suscribirá a las futuras listas de reproducción creadas por el autor.",
  subscribeAllVideos: "Suscribirse a todos los vídeos",
  subscribeAllPlaylists: "Suscribirse a todas las listas de reproducción",
  subscribeAllPlaylistsDescription:
    "Esto se suscribirá a todas las listas de reproducción de este canal.",
  subscribeDescription:
    "El sistema comprobará automáticamente si hay nuevos vídeos de este autor y los descargará.",
  checkIntervalMinutes: "Intervalo de comprobación (minutos)",
  subscribe: "Suscribirse",
  subscriptions: "Suscripciones",
  interval: "Intervalo",
  lastCheck: "Última comprobación",
  nextCheck: "Próxima comprobación",
  editInterval: "Editar intervalo",
  platform: "Plataforma",
  unsubscribe: "Darse de baja",
  confirmUnsubscribe: "¿Estás seguro de que quieres darte de baja de {author}?",
  subscribedSuccessfully: "Suscrito con éxito",
  unsubscribedSuccessfully: "Dado de baja con éxito",
  subscriptionUpdated: "Suscripción actualizada correctamente",
  subscriptionUpdateFailed: "No se pudo actualizar la suscripción",
  subscriptionAlreadyExists: "Ya estás suscrito a este autor.",
  minutes: "minutos",
  never: "Nunca",
  downloadAllPreviousVideos:
    "Descargar todos los videos anteriores de este autor",
  downloadShorts: "Descargar Shorts",
  downloadOrder: "Orden de descarga",
  downloadOrderDateDesc: "Fecha (más reciente primero)",
  downloadOrderDateAsc: "Fecha (más antiguo primero)",
  downloadOrderViewsDesc: "Vistas (más primero)",
  downloadOrderViewsAsc: "Vistas (menos primero)",
  downloadOrderLargeChannelHint:
    "Los canales grandes pueden tardar más en obtener metadatos antes de que comience la descarga.",
  downloadOrderShortsHint:
    "Se crearán dos tareas de descarga: una para los videos principales y otra para los Shorts.",
  downloadAllPreviousWarning:
    "Advertencia: Esto descargará todos los videos anteriores de este autor. Esto puede consumir un espacio de almacenamiento significativo y podría activar mecanismos de detección de bots que pueden resultar en prohibiciones temporales o permanentes de la plataforma. Úselo bajo su propio riesgo.",
  downloadAllPreviousVideosInPlaylists:
    "Descargar videos anteriores en listas de reproducción",
  downloadAllPlaylistsWarning:
    "Advertencia: Esto descargará todos los videos de todas las listas de reproducción en este canal. Esto puede ser una gran cantidad de videos y consumir un espacio de almacenamiento significativo.",
  continuousDownloadTasks: "Tareas de descarga continua",
  taskStatusActive: "Activo",
  taskStatusPaused: "Pausado",
  taskStatusCompleted: "Completado",
  taskStatusCancelled: "Cancelado",
  downloaded: "Descargado",
  cancelTask: "Cancelar tarea",
  confirmCancelTask:
    "¿Estás seguro de que quieres cancelar la tarea de descarga para {author}?",
  taskCancelled: "Tarea cancelada exitosamente",
  deleteTask: "Eliminar tarea",
  confirmDeleteTask:
    "¿Estás seguro de que quieres eliminar el registro de tarea para {author}? Esta acción no se puede deshacer.",
  taskDeleted: "Tarea eliminada exitosamente",
  clearFinishedTasks: "Borrar tareas finalizadas",
  tasksCleared: "Tareas finalizadas borradas con éxito",
  confirmClearFinishedTasks:
    "¿Está seguro de que desea borrar todas las tareas finalizadas (completadas, canceladas)? Esto las eliminará de la lista pero no borrará ningún archivo descargado.",
  clear: "Borrar",


  // Subscription Pause/Resume
  pause: "Pausar",
  resume: "Reanudar",
  pauseSubscription: "Pausar suscripción",
  resumeSubscription: "Reanudar suscripción",
  pauseTask: "Pausar tarea",
  resumeTask: "Reanudar tarea",
  subscriptionPaused: "Suscripción pausada",
  subscriptionResumed: "Suscripción reanudada",
  taskPaused: "Tarea pausada",
  taskResumed: "Tarea reanudada",
  viaSubscription: "vía suscripción",
  viaContinuousDownload: "vía descarga continua",


  // Playlist Subscription
  subscribeToPlaylist: "Suscribirse a esta lista de reproducción",
  subscribePlaylistDescription:
    "Verificar automáticamente nuevos videos en esta lista de reproducción",
  playlistSubscribedSuccessfully:
    "Suscrito a la lista de reproducción con éxito",
  downloadAndSubscribe: "Descargar todo y suscribirse",
  playlistSubscription: "Lista de reproducción",


  // Instruction Page
  instructionSection1Title: "1. Descarga y Gestión de Tareas",
  instructionSection1Desc:
    "Este módulo incluye adquisición de video, tareas por lotes y funciones de importación de archivos.",
  instructionSection1Sub1: "Descarga de Enlace:",
  instructionSection1Item1Label: "Descarga Básica:",
  instructionSection1Item1Text:
    "Pegue enlaces de varios sitios de video en el cuadro de entrada para descargar directamente.",
  instructionSection1Item2Label: "Permisos:",
  instructionSection1Item2Text:
    "Para sitios que requieren membresía o inicio de sesión, inicie sesión en la cuenta correspondiente en una nueva pestaña del navegador primero para adquirir permisos de descarga.",
  instructionSection1Sub2: "Reconocimiento Inteligente:",
  instructionSection1Item3Label: "Suscripción de Autor de YouTube:",
  instructionSection1Item3Text:
    "Cuando el enlace pegado es el canal de un autor, el sistema preguntará si desea suscribirse. Después de suscribirse, el sistema puede escanear y descargar automáticamente las actualizaciones del autor en intervalos establecidos.",
  instructionSection1Item4Label: "Descarga de Colección de Bilibili:",
  instructionSection1Item4Text:
    "Cuando el enlace pegado es un favorito/colección de Bilibili, el sistema preguntará si desea descargar todo el contenido de la colección.",
  instructionSection1Sub3:
    "Herramientas Avanzadas (Página de Gestión de Descargas):",
  instructionSection1Item5Label: "Añadir Tareas por Lotes:",
  instructionSection1Item5Text:
    "Admite pegar múltiples enlaces de descarga a la vez (uno por línea) para la adición por lotes.",
  instructionSection1Item6Label: "Escanear Archivos:",
  instructionSection1Item6Text:
    "Busca automáticamente todos los archivos en el directorio raíz de almacenamiento de video y carpetas de primer nivel. Esta función es adecuada para sincronizar archivos con el sistema después de que los administradores los depositen manualmente en el backend del servidor.",
  instructionSection1Item7Label: "Subir Video:",
  instructionSection1Item7Text:
    "Admite subir archivos de video locales directamente desde el cliente al servidor.",

  instructionSection2Title: "2. Gestión de Biblioteca de Video",
  instructionSection2Desc:
    "Mantener y editar recursos de video descargados o importados.",
  instructionSection2Sub1: "Eliminación de Colección/Video:",
  instructionSection2Text1:
    "Al eliminar una colección en la página de gestión, el sistema ofrece dos opciones: eliminar solo el elemento de la lista de colección (mantener archivos), o eliminar completamente los archivos físicos dentro de la colección.",
  instructionSection2Sub2: "Reparación de Miniatura:",
  instructionSection2Text2:
    "Si un video no tiene portada después de la descarga, haga clic en el botón de actualización en la miniatura del video, y el sistema volverá a capturar el primer fotograma del video como la nueva miniatura.",

  instructionSection3Title: "3. Configuración del Sistema",
  instructionSection3Desc:
    "Configurar parámetros del sistema, mantener datos y extender funciones.",
  instructionSection3Sub1: "Configuración de Seguridad:",
  instructionSection3Text1:
    "Establezca la contraseña de inicio de sesión del sistema (la contraseña inicial predeterminada es 123, se recomienda cambiar después del primer inicio de sesión).",
  instructionSection3Sub2: "Gestión de Etiquetas:",
  instructionSection3Text2:
    'Admite agregar o eliminar etiquetas de clasificación de video. Nota: Debe hacer clic en el botón "Guardar" en la parte inferior de la página para que los cambios surtan efecto.',
  instructionSection3Sub3: "Mantenimiento del Sistema:",
  instructionSection3Item1Label: "Limpiar Archivos Temporales:",
  instructionSection3Item1Text:
    "Se utiliza para borrar archivos de descarga temporales residuales causados por fallas ocasionales del backend para liberar espacio.",
  instructionSection3Item2Label: "Migración de Base de Datos:",
  instructionSection3Item2Text:
    "Diseñado para usuarios de versiones anteriores. Use esta función para migrar datos de JSON a la nueva base de datos SQLite. Después de una migración exitosa, haga clic en el botón de eliminar para limpiar los datos históricos antiguos.",
  instructionSection3Sub4: "Servicios Extendidos:",
  instructionSection3Item3Label: "Nube OpenList:",
  instructionSection3Item3Text:
    "(En Desarrollo) Admite conectar servicios OpenList implementados por el usuario. Agregue configuración aquí para habilitar la integración de la unidad en la nube.",


  // Disclaimer
  disclaimerTitle: "Descargo de responsabilidad",
  disclaimerText:
    "1. Propósito y Restricciones\nEste software (incluyendo código y documentación) está destinado únicamente para aprendizaje personal, investigación e intercambio técnico. Está estrictamente prohibido utilizar este software para fines comerciales o actividades ilegales que violen las leyes y regulaciones locales.\n\n2. Responsabilidad\nEl desarrollador desconoce y no tiene control sobre cómo los usuarios utilizan este software. Cualquier responsabilidad legal, disputa o daño derivado del uso ilegal o indebido de este software (incluyendo, entre otros, la infracción de derechos de autor) recaerá únicamente en el usuario. El desarrollador no asume ninguna responsabilidad directa, indirecta o conjunta.\n\n3. Modificaciones y Distribución\nEste proyecto es de código abierto. Cualquier individuo u organización que modifique o bifurque este código debe cumplir con la licencia de código abierto. Importante: Si un tercero modifica el código para eludir o eliminar los mecanismos originales de autenticación/seguridad del usuario y distribuye dichas versiones, el modificador/distribuidor asume toda la responsabilidad por cualquier consecuencia. Desaconsejamos encarecidamente eludir o manipular cualquier mecanismo de verificación de seguridad.\n\n4. Declaración Sin Fines de Lucro\nEste es un proyecto de código abierto completamente gratuito. El desarrollador no acepta donaciones y nunca ha publicado páginas de donación. El software en sí no permite cargos y no ofrece servicios pagos. Por favor, esté atento y tenga cuidado con cualquier estafa o información engañosa que reclame cobrar tarifas en nombre de este proyecto.",
  history: "Historial",


  // Existing Video Detection
  existingVideoDetected: "Video existente detectado",
  videoAlreadyDownloaded: "Este video ya ha sido descargado.",
  viewVideo: "Ver video",
  previouslyDeletedVideo: "Video Eliminado Previamente",
  previouslyDeleted: "Previamente eliminado",
  videoWasDeleted:
    "Este video fue descargado previamente pero ha sido eliminado.",
  downloadAgain: "Descargar de nuevo",
  downloadedOn: "Descargado el",
  deletedOn: "Eliminado el",
  existingVideo: "Video existente",
  skipped: "Omitido",
  videoSkippedExists: "El video ya existe, descarga omitida",
  videoSkippedDeleted: "El video fue eliminado anteriormente, descarga omitida",
  downloading: "Descargando...",
  poweredBy: "Con tecnología de MyTube",
  changeSettings: "Cambiar configuración",


  // Sorting
  sort: "Ordenar",
  sortBy: "Ordenar por",
  dateDesc: "Fecha de adición (Más reciente)",
  dateAsc: "Fecha de adición (Más antiguo)",
  viewsDesc: "Vistas (De más a menos)",
  viewsAsc: "Vistas (De menos a más)",
  nameAsc: "Nombre (A-Z)",
  videoDateDesc: "Fecha de creación del video (más reciente)",
  videoDateAsc: "Fecha de creación del video (más antiguo)",
  random: "Aleatorio",


  // yt-dlp Configuration
  ytDlpConfiguration: "Configuración de yt-dlp",
  ytDlpConfigurationDescription:
    "Configura las opciones de descarga de yt-dlp. Ver",
  ytDlpConfigurationDocs: "documentación",
  ytDlpConfigurationDescriptionEnd: "para más información.",
  ytDlpConfigurationPolicyNotice:
    "La configuración sin procesar de yt-dlp está deshabilitada por la política de seguridad del despliegue en el modo de confianza application.",
  mountDirectoriesPolicyNotice:
    "Los directorios montados requieren confianza de administrador a nivel de host.",
  customize: "Personalizar",
  hide: "Ocultar",
  reset: "Restablecer",
  more: "Más",
  proxyOnlyApplyToYoutube: "Proxy solo se aplica a Youtube",
  moveSubtitlesToVideoFolder: "Ubicación de subtítulos",
  moveSubtitlesToVideoFolderOn: "Junto al video",
  moveSubtitlesToVideoFolderOff: "En carpeta de subtítulos aislada",
  moveSubtitlesToVideoFolderDescription:
    "Cuando está habilitado, los archivos de subtítulos se moverán a la misma carpeta que el archivo de video. Cuando está deshabilitado, se moverán a la carpeta de subtítulos aislada.",
  moveThumbnailsToVideoFolder: "Ubicación de miniaturas",
  moveThumbnailsToVideoFolderOn: "Junto con el video",
  moveThumbnailsToVideoFolderOff: "En carpeta de imágenes aislada",

  moveThumbnailsToVideoFolderDescription:
    "Cuando está habilitado, los archivos de miniaturas se moverán a la misma carpeta que el archivo de video. Cuando está deshabilitado, se moverán a la carpeta de imágenes aislada.",
  saveAuthorFilesToCollection: "Guardar archivos del autor en colección",
  saveAuthorFilesToCollectionOn: "Activado",
  saveAuthorFilesToCollectionOff: "Desactivado",
  saveAuthorFilesToCollectionDescription:
    "Guardar automáticamente los archivos del autor en una colección separada.",


  // Cloudflare Tunnel
  cloudflaredTunnel: "Túnel Cloudflare",
  enableCloudflaredTunnel: "Habilitar túnel Cloudflare",
  cloudflaredToken: "Token del túnel (Opcional)",
  cloudflaredTokenHelper:
    "Pegue su token de túnel aquí, o déjelo vacío para usar un Quick Tunnel aleatorio.",
  allowedHosts: "Rutas de Aplicación Publicadas",
  allowedHostsHelper:
    "Lista de hosts permitidos para el servidor de desarrollo Vite (separados por comas). Lista blanca de dominios para Cloudflare Tunnel.",
  allowedHostsRequired:
    "Las Rutas de Aplicación Publicadas son obligatorias cuando se proporciona un token de túnel.",
  waitingForUrl: "Esperando URL de Quick Tunnel...",
  running: "Ejecutando",
  stopped: "Detenido",
  tunnelId: "ID del Túnel",
  accountTag: "Etiqueta de cuenta",
  copied: "¡Copiado!",
  clickToCopy: "Clic para copiar",
  quickTunnelWarning:
    "Las URL de Quick Tunnel cambian cada vez que se reinicia el túnel.",
  managedInDashboard:
    "El nombre de host público se gestiona en su panel de control de Cloudflare Zero Trust.",


  // Database Export/Import
  exportImportDatabase: "Exportar/Importar Base de Datos",
  exportImportDatabaseDescription:
    "Exporte su base de datos como archivo de respaldo o importe una copia de seguridad previamente exportada. La importación sobrescribirá los datos existentes con los datos de respaldo.",
  exportDatabase: "Exportar Base de Datos",
  importDatabase: "Importar Base de Datos",
  mergeDatabase: "Fusionar Base de Datos",
  onlyDbFilesAllowed: "Solo se permiten archivos .db",
  importDatabaseWarning:
    "Advertencia: Importar una base de datos sobrescribirá todos los datos existentes. Asegúrese de exportar primero su base de datos actual como respaldo.",
  mergeDatabaseWarning:
    "Fusiona otro respaldo de MyTube en esta instancia. Los registros existentes se conservan y solo se agregan los registros faltantes del respaldo cargado.",
  mergeDatabaseContentsVideos:
    "Los videos se comparan por URL de origen y se conservan los videos existentes.",
  mergeDatabaseContentsCollections:
    "Las colecciones y sus vínculos de videos se fusionan en colecciones con el mismo nombre.",
  mergeDatabaseContentsSubscriptions:
    "Las suscripciones se fusionan por URL de suscripción y se conservan las existentes.",
  mergeDatabaseContentsHistory:
    "El historial de descargas y el seguimiento de descargas se agregan cuando aún no existe una entrada equivalente.",
  mergeDatabaseContentsTags:
    "La configuración de etiquetas también se fusiona para que las etiquetas importadas sigan disponibles en la interfaz.",
  mergeDatabaseKeepsCurrentData:
    "La configuración actual, las contraseñas, las descargas activas y el estado de ejecución de tareas no se reemplazan.",
  mergeDatabasePreviewScanning: "Escaneando la base de datos cargada...",
  mergeDatabasePreviewResults: "Vista previa de la fusión",
  mergeDatabasePreviewConfirmHint: "Continúe solo si estas cantidades coinciden con lo esperado.",
  mergeDatabasePreviewFailed: "No se pudo escanear la base de datos cargada: {error}",
  mergeDatabasePreviewErrorDefault: "No se pudo escanear la base de datos cargada.",
  mergeDatabaseMergedCount: "Fusionados: {count}",
  mergeDatabaseSkippedCount: "Omitidos: {count}",
  mergeDatabasePreviewVideos: "Videos",
  mergeDatabasePreviewCollections: "Colecciones",
  mergeDatabasePreviewCollectionLinks: "Vínculos de colecciones",
  mergeDatabasePreviewSubscriptions: "Suscripciones",
  mergeDatabasePreviewDownloadHistory: "Historial de descargas",
  mergeDatabasePreviewVideoDownloads: "Seguimiento de descargas",
  mergeDatabasePreviewTags: "Etiquetas",
  selectDatabaseFile: "Seleccionar Archivo de Base de Datos",
  databaseExportedSuccess: "Base de datos exportada exitosamente",
  databaseExportFailed: "Error al exportar la base de datos",
  databaseImportedSuccess:
    "Base de datos importada exitosamente. Los datos existentes han sido sobrescritos con los datos de respaldo.",
  databaseImportFailed: "Error al importar la base de datos",
  databaseMergedSuccess:
    "Base de datos fusionada exitosamente. Se conservaron los datos existentes y se agregaron los datos faltantes del respaldo.",
  databaseMergeFailed: "Error al fusionar la base de datos",
  cleanupBackupDatabases: "Limpiar Bases de Datos de Respaldo",
  cleanupBackupDatabasesWarning:
    "Advertencia: Esto eliminará permanentemente todos los archivos de base de datos de respaldo (mytube-backup-*.db.backup) que se crearon durante importaciones anteriores. Esta acción no se puede deshacer. ¿Está seguro de que desea continuar?",
  backupDatabasesCleanedUp: "Bases de datos de respaldo limpiadas exitosamente",

  // History Filter
  filterAll: "Todos",
  backupDatabasesCleanupFailed:
    "Error al limpiar las bases de datos de respaldo",
  restoreFromLastBackup: "Restaurar desde Última Copia de Respaldo",
  restoreFromLastBackupWarning:
    "Advertencia: Esto restaurará la base de datos desde el último archivo de respaldo automático. Todos los datos actuales serán sobrescritos con los datos de respaldo. Esta acción no se puede deshacer. ¿Está seguro de que desea continuar?",
  restoreFromLastBackupSuccess:
    "Base de datos restaurada exitosamente desde la copia de respaldo",
  restoreFromLastBackupFailed: "Error al restaurar desde la copia de respaldo",
  lastBackupDate: "Fecha de última copia de respaldo",
  noBackupAvailable: "No hay copia de respaldo disponible",
  failedToDownloadVideo: "Error al descargar el video. Inténtalo de nuevo.",
  failedToDownload: "Error al descargar. Inténtalo de nuevo.",
  openFolder: "Abrir carpeta",
  openInNewTab: "Abrir en nueva pestaña",
  copyLink: "Copiar enlace",
  refresh: "Actualizar",
  showSensitiveContent: "Mostrar contenido sensible",
  hideSensitiveContent: "Ocultar contenido sensible",
  sensitiveContentWarning:
    "Este video puede contener contenido sensible. Haz clic para ver.",
  soundNone: "Ninguno",
  soundBell: "Timbre",
  soundMessage: "Mensaje entrante",
  soundMicrowave: "Timbre de microondas",
  soundNotification: "Nueva notificación",
  soundDrop: "Objeto cayendo al agua",
  soundWater: "Gota de agua en metal",
  videoLoadTimeout:
    "El video está tardando demasiado en cargar. Inténtelo de nuevo o revise su conexión.",
  failedToLoadVideo: "No se pudo cargar el video.",
  videoLoadingAborted: "La carga del video fue cancelada.",
  videoLoadNetworkError:
    "Error de red al cargar el video. Revise su conexión.",
  safariWebmLimitedSupportError:
    "Safari tiene compatibilidad limitada con el códec WebM/VP9, especialmente para videos 4K. Vuelva a descargar el video en formato H.264/MP4 para una mejor compatibilidad con Safari.",
  safariVideoDecodeError:
    "Error al decodificar el video. Es posible que Safari no admita este códec de video. Intente volver a descargarlo en formato H.264/MP4.",
  videoDecodeError:
    "Error al decodificar el video. El archivo puede estar dañado o usar un códec no compatible.",
  safariVideoFormatNotSupported:
    "Safari no admite este formato de video. Safari funciona mejor con videos H.264/MP4. Vuelva a descargarlo con códec H.264.",
  browserVideoFormatNotSupported:
    "El formato de video no es compatible con su navegador.",

  // Errores del middleware de configuración basado en roles
  settingsApiKeyForbidden:
    "La autenticación por clave API no puede acceder a los endpoints de configuración.",
  settingsVisitorAccessRestricted:
    "Rol de visitante: El acceso a este recurso está restringido.",
  settingsVisitorWriteRestricted:
    "Rol de visitante: Solo se permite leer la configuración y actualizar la configuración de CloudFlare.",
  settingsVisitorWriteForbidden:
    "Rol de visitante: Las operaciones de escritura no están permitidas.",
  settingsAuthRequired:
    "Se requiere autenticación. Inicie sesión para acceder a este recurso.",
};
