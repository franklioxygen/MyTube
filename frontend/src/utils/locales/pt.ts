export const pt = {
  // Header
  myTube: "MyTube",
  manage: "Gerenciar",
  settings: "Configurações",
  logout: "Sair",
  pleaseEnterUrlOrSearchTerm:
    "Por favor, insira uma URL de vídeo ou termo de pesquisa",
  unexpectedErrorOccurred:
    "Ocorreu um erro inesperado. Por favor, tente novamente.",
  uploadVideo: "Enviar Vídeo",
  enterUrlOrSearchTerm: "Insira o URL do vídeo ou termo de pesquisa",
  manageVideos: "Gerenciar Vídeos",
  instruction: "Instruções",

  // Home
  pasteUrl: "Colar URL de vídeo ou coleção",
  download: "Baixar",
  search: "Pesquisar",
  recentDownloads: "Downloads Recentes",
  noDownloads: "Nenhum download ainda",
  downloadStarted: "Download iniciado",
  downloadFailed: "Falha no download",
  loadingVideos: "Carregando vídeos...",
  searchResultsFor: "Resultados da pesquisa para",
  fromYourLibrary: "Da sua Biblioteca",
  noMatchingVideos: "Nenhum vídeo correspondente na sua biblioteca.",
  fromYouTube: "Do YouTube",
  loadingYouTubeResults: "Carregando resultados do YouTube...",
  noYouTubeResults: "Nenhum resultado do YouTube encontrado",
  noVideosYet:
    "Ainda sem vídeos. Envie um URL de vídeo para baixar o seu primeiro!",
  views: "visualizações",

  // Settings
  general: "Geral",
  security: "Segurança",
  videoDefaults: "Padrões do Reprodutor de Vídeo",
  downloadSettings: "Configurações de Download",
  // Settings Categories
  basicSettings: "Configurações Básicas",
  interfaceDisplay: "Interface e Exibição",
  securityAccess: "Segurança e Acesso",
  videoPlayback: "Reprodução de Vídeo",
  downloadStorage: "Download e Armazenamento",
  contentManagement: "Gerenciamento de Conteúdo",
  dataManagement: "Gerenciamento de Dados",
  advanced: "Avançado",
  language: "Idioma",
  websiteName: "Nome do site",
  websiteNameHelper: "{current}/{max} caracteres (Padrão: {default})",
  infiniteScroll: "Rolagem infinita",
  infiniteScrollDisabled: "Desativado quando a rolagem infinita está ativada",
  maxVideoColumns: "Máximo de colunas de vídeo (Página inicial)",
  videoColumns: "Colunas de vídeo (Página inicial)",
  columnsCount: "{count} Colunas",
  enableLogin: "Ativar Proteção de Login",
  allowPasswordLogin: "Permitir Login com Senha",
  allowPasswordLoginHelper: "Quando desabilitado, o login com senha não está disponível. Você deve ter pelo menos uma chave de acesso para desabilitar o login com senha.",
  allowResetPassword: "Permitir Redefinir Senha",
  allowResetPasswordHelper: "Quando desabilitado, o botão de redefinir senha não será exibido na página de login e a API de redefinir senha será bloqueada.",
  password: "Senha",
  enterPassword: "Digite a senha",
  togglePasswordVisibility: "Alternar visibilidade da senha",
  passwordHelper:
    "Deixe em branco para manter a senha atual, ou digite para alterar",
  passwordSetHelper: "Definir uma senha para acessar o aplicativo",
  autoPlay: "Reprodução Automática de Vídeos",
  autoLoop: "Repetição Automática de Vídeos",
  maxConcurrent: "Máximo de Downloads Simultâneos",
  saveSettings: "Salvar Configurações",
  saving: "Salvando...",
  backToManage: "Voltar para Gerenciar",
  settingsSaved: "Configurações salvas com sucesso",
  settingsFailed: "Falha ao salvar configurações",
  debugMode: "Modo de Depuração",
  debugModeDescription:
    "Mostrar ou ocultar mensagens do console (requer atualização)",
  pauseOnFocusLoss: "Pausar ao perder o foco",
  tagsManagement: "Gerenciamento de Tags",
  newTag: "Nova Tag",
  tags: "Tags",
  tagsManagementNote:
    'Lembre-se de clicar em "Salvar Configurações" após adicionar ou remover tags para aplicar as alterações.',

  // Database
  database: "Banco de Dados",
  migrateDataDescription:
    "Migrar dados de arquivos JSON legados para o novo banco de dados SQLite. Esta ação é segura para executar várias vezes (duplicatas serão ignoradas).",
  migrateDataButton: "Migrar Dados do JSON",
  scanFiles: "Escanear Arquivos",
  scanFilesSuccess: "Verificação concluída. {count} novos vídeos adicionados.",
  scanFilesDeleted: " {count} arquivos ausentes removidos.",
  scanFilesFailed: "Falha na verificação",
  scanFilesConfirmMessage:
    "O sistema verificará a pasta raiz do caminho do vídeo. Novos arquivos serão adicionados e arquivos de vídeo ausentes serão removidos do sistema.",
  scanning: "Verificando...",
  migrateConfirmation:
    "Tem certeza de que deseja migrar os dados? Isso pode levar alguns instantes.",
  migrationResults: "Resultados da Migração",
  migrationReport: "Relatório de Migração",
  migrationSuccess: "Migração concluída. Veja detalhes no alerta.",
  migrationNoData: "Migração finalizada, mas nenhum dado encontrado.",
  migrationFailed: "Falha na migração",
  migrationWarnings: "AVISOS",
  migrationErrors: "ERROS",
  itemsMigrated: "itens migrados",
  fileNotFound: "Arquivo não encontrado em",
  noDataFilesFound:
    "Nenhum arquivo de dados encontrado para migrar. Verifique seus mapeamentos de volume.",
  removeLegacyData: "Remover Dados Legados",
  removeLegacyDataDescription:
    "Excluir os arquivos JSON antigos (videos.json, collections.json, etc.) para liberar espaço em disco. Faça isso apenas após verificar se seus dados foram migrados com sucesso.",
  removeLegacyDataConfirmTitle: "Excluir Dados Legados?",
  removeLegacyDataConfirmMessage:
    "Tem certeza de que deseja excluir os arquivos de dados JSON legados? Esta ação não pode ser desfeita.",
  legacyDataDeleted: "Dados legados excluídos com sucesso.",
  formatLegacyFilenames: "Formatar Nomes de Arquivos Legados",
  formatLegacyFilenamesDescription:
    "Renomear em lote todos os arquivos de vídeo, miniaturas e legendas para o novo formato padrão: Título-Autor-AAAA. Esta operação modificará os nomes dos arquivos no disco e atualizará a lógica do banco de dados.",
  formatLegacyFilenamesButton: "Formatar Nomes de Arquivos",
  formatFilenamesSuccess:
    "Processado: {processed}\nRenomeado: {renamed}\nErros: {errors}",
  formatFilenamesDetails: "Detalhes:",
  formatFilenamesMore: "...e mais {count}",
  formatFilenamesError: "Falha ao formatar nomes de arquivos: {error}",
  deleteLegacyDataButton: "Excluir dados antigos",
  cleanupTempFiles: "Limpar Arquivos Temporários",
  cleanupTempFilesDescription:
    "Remover todos os arquivos temporários de download (.ytdl, .part) do diretório de uploads. Isto ajuda a liberar espaço em disco de downloads incompletos ou cancelados.",
  cleanupTempFilesConfirmTitle: "Limpar Arquivos Temporários?",
  cleanupTempFilesConfirmMessage:
    "Isto excluirá permanentemente todos os arquivos .ytdl e .part no diretório de uploads. Certifique-se de que não há downloads ativos antes de continuar.",
  cleanupTempFilesActiveDownloads:
    "Não é possível limpar enquanto houver downloads ativos. Aguarde a conclusão de todos os downloads ou cancele-os primeiro.",
  itemsPerPage: "Itens por página",
  itemsPerPageHelper: "Número de vídeos a mostrar por página (Padrão: 12)",
  showYoutubeSearch: "Mostrar resultados de pesquisa do YouTube",
  visitorMode: "Modo Visitante (Somente leitura)",
  visitorModeReadOnly: "Modo visitante: Somente leitura",
  visitorModeDescription:
    "Modo somente leitura. Vídeos ocultos não serão visíveis para visitantes.",
  visitorModePasswordPrompt:
    "Por favor, digite a senha do site para alterar as configurações do modo visitante.",
  cleanupTempFilesSuccess:
    "{count} arquivo(s) temporário(s) excluído(s) com sucesso.",
  cleanupTempFilesFailed: "Falha ao limpar arquivos temporários",

  // Cookie Settings
  cookieSettings: "Configurações de Cookies",
  cookieUploadDescription:
    'Envie cookies.txt para passar nas verificações de bot do YouTube e ativar o download de legendas do Bilibili. O arquivo será renomeado automaticamente para cookies.txt. (Exemplo: use a extensão "Get cookies.txt LOCALLY" para exportar cookies)',
  uploadCookies: "Enviar Cookies",
  onlyTxtFilesAllowed: "Apenas arquivos .txt são permitidos",
  cookiesUploadedSuccess: "Cookies enviados com sucesso",
  cookiesUploadFailed: "Falha ao enviar cookies",
  cookiesFound: "cookies.txt encontrado",
  cookiesNotFound: "cookies.txt não encontrado",
  deleteCookies: "Excluir Cookies",
  confirmDeleteCookies:
    "Tem certeza de que deseja excluir o arquivo de cookies? Isso afetará sua capacidade de baixar vídeos com restrição de idade ou exclusivos para membros.",
  cookiesDeletedSuccess: "Cookies excluídos com sucesso",
  cookiesDeleteFailed: "Falha ao excluir cookies",

  // Cloud Drive
  cloudDriveSettings: "Armazenamento em Nuvem (OpenList)",
  cloudDriveDescription:
    "Faça upload automático de vídeos para o armazenamento em nuvem (Alist) e verifique se há novos arquivos na nuvem. Os arquivos locais serão excluídos após o upload bem-sucedido.",
  enableAutoSave: "Ativar Sincronização na Nuvem",
  apiUrl: "URL da API",
  apiUrlHelper: "ex. https://your-alist-instance.com/api/fs/put",
  token: "Token",
  publicUrl: "URL Público",
  publicUrlHelper:
    "Domínio público para acessar arquivos (ex. https://your-cloudflare-tunnel-domain.com). Se definido, será usado em vez da URL da API para acessar arquivos.",
  uploadPath: "Caminho de upload",
  cloudDrivePathHelper: "Caminho do diretório na nuvem, ex. /mytube-uploads",
  scanPaths: "Caminhos de Varredura",
  scanPathsHelper:
    "Um caminho por linha. Os vídeos serão verificados a partir desses caminhos. Se vazio, usará o caminho de upload. Exemplo:\n/a/Filmes\n/b/Documentários",
  cloudDriveNote:
    "Após habilitar este recurso, os vídeos recém-baixados serão automaticamente enviados para o armazenamento em nuvem e os arquivos locais serão excluídos. Os vídeos serão reproduzidos do armazenamento em nuvem via proxy.",
  cloudScanAdded: "Adicionado da nuvem",
  testing: "Testando...",
  testConnection: "Testar Conexão",
  sync: "Sincronizar",
  syncToCloud: "Sincronização Bidirecional",
  syncWarning:
    "Esta operação fará upload de vídeos locais para a nuvem e verificará se há novos arquivos no armazenamento em nuvem. Os arquivos locais serão excluídos após o upload.",
  syncing: "Sincronizando...",
  syncCompleted: "Sincronização Concluída",
  syncFailed: "Falha na Sincronização",
  syncReport: "Total: {total} | Enviados: {uploaded} | Falhos: {failed}",
  syncErrors: "Erros:",
  fillApiUrlToken: "Por favor, preencha a URL da API e o Token primeiro",
  connectionTestSuccess:
    "Teste de conexão bem-sucedido! As configurações são válidas.",
  connectionFailedStatus:
    "Falha na conexão: O servidor retornou o status {status}",
  connectionFailedUrl:
    "Não é possível conectar ao servidor. Verifique a URL da API.",
  authFailed: "Falha na autenticação. Verifique seu token.",
  connectionTestFailed: "Falha no teste de conexão: {error}",
  syncFailedMessage: "Falha na sincronização. Tente novamente.",
  foundVideosToSync:
    "Encontrados {count} vídeos com arquivos locais para sincronizar",
  uploadingVideo: "Enviando: {title}",
  clearThumbnailCache: "Limpar Cache Local de Miniaturas",
  clearing: "Limpando...",
  clearThumbnailCacheSuccess:
    "Cache de miniaturas limpo com sucesso. As miniaturas serão regeneradas na próxima vez que forem acessadas.",
  clearThumbnailCacheError: "Falha ao limpar cache de miniaturas",
  clearThumbnailCacheConfirmMessage:
    "Isso limpará todas as miniaturas armazenadas localmente para vídeos na nuvem. As miniaturas serão regeneradas do armazenamento em nuvem na próxima vez que forem acessadas. Continuar?",

  // Manage
  manageContent: "Gerenciar Conteúdo",
  videos: "Vídeos",
  collections: "Coleções",
  allVideos: "Todos os Vídeos",
  delete: "Excluir",
  backToHome: "Voltar para Início",
  confirmDelete: "Tem certeza de que deseja excluir isto?",
  deleteSuccess: "Excluído com sucesso",
  deleteFailed: "Falha ao excluir",
  noVideos: "Nenhum vídeo encontrado",
  noCollectionsFound: "Nenhuma coleção encontrada",
  noCollections: "Nenhuma coleção encontrada",
  searchVideos: "Pesquisar vídeos...",
  thumbnail: "Miniatura",
  title: "Título",
  author: "Autor",
  authors: "Autores",
  created: "Criado",
  name: "Nome",
  size: "Tamanho",
  actions: "Ações",
  deleteCollection: "Excluir Coleção",
  deleteVideo: "Excluir Vídeo",
  noVideosFoundMatching:
    "Nenhum vídeo encontrado correspondente à sua pesquisa.",

  // Video Player
  playing: "Reproduzir",
  paused: "Pausar",
  next: "Próximo",
  previous: "Anterior",
  loop: "Repetir",
  autoPlayOn: "Reprodução Automática Ligada",
  autoPlayOff: "Reprodução Automática Desligada",
  autoPlayNext: "Reprodução Automática do Próximo",
  videoNotFound: "Vídeo não encontrado",
  videoNotFoundOrLoaded: "Vídeo não encontrado ou não pôde ser carregado.",
  deleting: "Excluindo...",
  addToCollection: "Adicionar à Coleção",
  originalLink: "Link Original",
  source: "Fonte:",
  addedDate: "Data de Adição:",
  hideComments: "Ocultar comentários",
  showComments: "Mostrar comentários",
  latestComments: "Últimos Comentários",
  noComments: "Nenhum comentário disponível.",
  upNext: "A Seguir",
  noOtherVideos: "Nenhum outro vídeo disponível",
  currentlyIn: "Atualmente em:",
  collectionWarning: "Adicionar a uma coleção diferente removerá da atual.",
  addToExistingCollection: "Adicionar a coleção existente:",
  selectCollection: "Selecionar uma coleção",
  add: "Adicionar",
  createNewCollection: "Criar nova coleção:",
  collectionName: "Nome da coleção",
  create: "Criar",
  removeFromCollection: "Remover da Coleção",
  confirmRemoveFromCollection:
    "Tem certeza de que deseja remover este vídeo da coleção?",
  remove: "Remover",
  loadingVideo: "Carregando vídeo...",
  current: "(Atual)",
  rateThisVideo: "Avaliar este vídeo",
  enterFullscreen: "Tela Cheia",
  exitFullscreen: "Sair da Tela Cheia",
  share: "Compartilhar",
  editTitle: "Editar Título",
  hideVideo: "Tornar Vídeo Oculto para Modo Visitante",
  showVideo: "Tornar Vídeo Visível para Modo Visitante",
  toggleVisibility: "Alternar Visibilidade",
  titleUpdated: "Título atualizado com sucesso",
  titleUpdateFailed: "Falha ao atualizar título",
  refreshThumbnail: "Atualizar miniatura",
  thumbnailRefreshed: "Miniatura atualizada com sucesso",
  thumbnailRefreshFailed: "Falha ao atualizar miniatura",
  videoUpdated: "Vídeo atualizado com sucesso",
  videoUpdateFailed: "Falha ao atualizar vídeo",
  failedToLoadVideos:
    "Falha ao carregar vídeos. Por favor, tente novamente mais tarde.",
  videoRemovedSuccessfully: "Vídeo removido com sucesso",
  failedToDeleteVideo: "Falha ao excluir vídeo",
  // Snackbar Messages
  videoDownloading: "Baixando vídeo",
  downloadStartedSuccessfully: "Download iniciado com sucesso",
  collectionCreatedSuccessfully: "Coleção criada com sucesso",
  videoAddedToCollection: "Vídeo adicionado à coleção",
  videoRemovedFromCollection: "Vídeo removido da coleção",
  collectionDeletedSuccessfully: "Coleção excluída com sucesso",
  failedToDeleteCollection: "Falha ao excluir coleção",
  pleaseEnterSearchTerm: "Por favor, insira um termo de pesquisa",
  failedToSearch: "Falha na pesquisa. Por favor, tente novamente.",
  searchCancelled: "Pesquisa cancelada",
  openInExternalPlayer: "Abrir no player externo",
  playWith: "Reproduzir com...",
  deleteAllFilteredVideos: "Excluir todos os vídeos filtrados",
  confirmDeleteFilteredVideos:
    "Tem certeza de que deseja excluir {count} vídeos filtrados pelas tags selecionadas?",
  deleteFilteredVideosSuccess: "{count} vídeos excluídos com sucesso.",
  deletingVideos: "Excluindo vídeos...",

  // Login
  signIn: "Entrar",
  verifying: "Verificando...",
  incorrectPassword: "Senha incorreta",
  loginFailed: "Falha ao verificar senha",
  defaultPasswordHint: "Senha padrão: 123",
  checkingConnection: "Verificando conexão...",
  connectionError: "Erro de Conexão",
  backendConnectionFailed:
    "Não foi possível conectar ao servidor. Verifique se o backend está em execução e a porta está aberta, depois tente novamente.",
  retry: "Tentar Novamente",
  resetPassword: "Redefinir Senha",
  resetPasswordTitle: "Redefinir Senha",
  resetPasswordMessage:
    "Tem certeza de que deseja redefinir a senha? A senha atual será redefinida para uma string aleatória de 8 caracteres e exibida no log do backend.",
  resetPasswordConfirm: "Redefinir",
  resetPasswordSuccess:
    "A senha foi redefinida. Verifique os logs do backend para a nova senha.",
  resetPasswordDisabledInfo: "A redefinição de senha está desabilitada. Para redefinir sua senha, execute o seguinte comando no diretório do backend:\n\nnpm run reset-password\n\nOu:\n\nts-node scripts/reset-password.ts\n\nIsso gerará uma nova senha aleatória e habilitará o login com senha.",
  resetPasswordScriptGuide: "Para redefinir a senha manualmente, execute o seguinte comando no diretório do backend:\n\nnpm run reset-password\n\nOu:\n\nts-node scripts/reset-password.ts\n\nSe nenhuma senha for fornecida, uma senha aleatória de 8 caracteres será gerada.",
  waitTimeMessage: "Por favor, aguarde {time} antes de tentar novamente.",
  tooManyAttempts: "Muitas tentativas falharam.",
  // Passkeys
  createPasskey: "Criar chave de acesso",
  creatingPasskey: "Criando...",
  passkeyCreated: "Chave de acesso criada com sucesso",
  passkeyCreationFailed:
    "Falha ao criar chave de acesso. Por favor, tente novamente.",
  removePasskeys: "Remover todas as chaves de acesso",
  removePasskeysTitle: "Remover todas as chaves de acesso",
  removePasskeysMessage:
    "Tem certeza de que deseja remover todas as chaves de acesso? Esta ação não pode ser desfeita.",
  passkeysRemoved: "Todas as chaves de acesso foram removidas",
  passkeysRemoveFailed:
    "Falha ao remover chaves de acesso. Por favor, tente novamente.",
  loginWithPasskey: "Entrar com chave de acesso",
  authenticating: "Autenticando...",
  passkeyLoginFailed:
    "Falha na autenticação com chave de acesso. Por favor, tente novamente.",
  passkeyErrorPermissionDenied: "A solicitação não é permitida pelo agente do usuário ou pela plataforma no contexto atual, possivelmente porque o usuário negou a permissão.",
  passkeyErrorAlreadyRegistered: "O autenticador já foi registrado anteriormente.",
  linkCopied: "Link copiado para a área de transferência",
  copyFailed: "Falha ao copiar link",
  passkeyRequiresHttps: "WebAuthn requer HTTPS ou localhost. Por favor, acesse o aplicativo via HTTPS ou use localhost em vez de um endereço IP.",
  passkeyWebAuthnNotSupported: "WebAuthn não é suportado neste navegador. Por favor, use um navegador moderno que suporte WebAuthn.",

  // Collection Page
  loadingCollection: "Carregando coleção...",
  collectionNotFound: "Coleção não encontrada",
  noVideosInCollection: "Nenhum vídeo nesta coleção.",
  back: "Voltar",

  // Author Videos
  loadVideosError:
    "Falha ao carregar vídeos. Por favor, tente novamente mais tarde.",
  unknownAuthor: "Desconhecido",
  noVideosForAuthor: "Nenhum vídeo encontrado para este autor.",
  deleteAuthor: "Excluir Autor",
  deleteAuthorConfirmation:
    "Tem certeza de que deseja excluir o autor {author}? Isso excluirá todos os vídeos associados a este autor.",
  authorDeletedSuccessfully: "Autor excluído com sucesso",
  failedToDeleteAuthor: "Falha ao excluir autor",

  // Delete Collection Modal
  deleteCollectionTitle: "Excluir Coleção",
  deleteCollectionConfirmation: "Tem certeza de que deseja excluir a coleção",
  collectionContains: "Esta coleção contém",
  deleteCollectionOnly: "Excluir Apenas Coleção",
  deleteCollectionAndVideos: "Excluir Coleção e Todos os Vídeos",

  // Common
  loading: "Carregando...",
  error: "Erro",
  success: "Sucesso",
  cancel: "Cancelar",
  close: "Fechar",
  ok: "OK",
  confirm: "Confirmar",
  save: "Salvar",
  note: "Nota",
  on: "Ligado",
  off: "Desligado",
  continue: "Continuar",
  expand: "Expandir",
  collapse: "Recolher",

  // Video Card
  unknownDate: "Data desconhecida",
  part: "Parte",
  collection: "Coleção",
  justNow: "Agora mesmo",
  hoursAgo: "Há {hours} horas",
  today: "Hoje",
  thisWeek: "Esta semana",
  weeksAgo: "Há {weeks} semanas",

  // Upload Modal
  selectVideoFile: "Selecionar Arquivo de Vídeo",
  pleaseSelectVideo: "Por favor, selecione um arquivo de vídeo",
  uploadFailed: "Falha no envio",
  failedToUpload: "Falha ao enviar vídeo",
  uploading: "Enviando...",
  upload: "Enviar",

  // Bilibili Modal
  bilibiliCollectionDetected: "Coleção Bilibili Detectada",
  bilibiliSeriesDetected: "Série Bilibili Detectada",
  multiPartVideoDetected: "Vídeo em Múltiplas Partes Detectado",
  authorOrPlaylist: "Autor / Lista de reprodução",
  playlistDetected: "Lista de reprodução detectada",
  playlistHasVideos: "Esta lista de reprodução tem {count} vídeos.",
  downloadPlaylistAndCreateCollection:
    "Baixar vídeos da lista de reprodução e criar uma coleção para ela?",
  collectionHasVideos: "Esta coleção Bilibili tem {count} vídeos.",
  previouslyDeletedVideo: "Vídeo Anteriormente Excluído",
  previouslyDeleted: "Anteriormente excluído",
  videoWasDeleted: "Este vídeo foi baixado anteriormente, mas foi excluído.",
  seriesHasVideos: "Esta série Bilibili tem {count} vídeos.",
  videoHasParts: "Este vídeo Bilibili tem {count} partes.",
  downloadAllVideos: "Baixar Todos os {count} Vídeos",
  downloadAllParts: "Baixar Todas as {count} Partes",
  downloadThisVideoOnly: "Baixar Apenas Este Vídeo",
  downloadCurrentPartOnly: "Baixar Apenas Parte Atual",
  processing: "Processando...",
  wouldYouLikeToDownloadAllParts: "Gostaria de baixar todas as partes?",
  wouldYouLikeToDownloadAllVideos: "Gostaria de baixar todos os vídeos?",
  allPartsAddedToCollection: "Todas as partes serão adicionadas a esta coleção",
  allVideosAddedToCollection:
    "Todos os vídeos serão adicionados a esta coleção",
  queued: "Na fila",
  waitingInQueue: "Aguardando na fila",
  // Downloads
  downloads: "Downloads",
  activeDownloads: "Downloads Ativos",
  manageDownloads: "Gerenciar Downloads",
  queuedDownloads: "Downloads na Fila",
  downloadHistory: "Histórico de Downloads",
  clearQueue: "Limpar Fila",
  clearHistory: "Limpar Histórico",
  noActiveDownloads: "Nenhum download ativo",
  noQueuedDownloads: "Nenhum download na fila",
  noDownloadHistory: "Nenhum histórico de download",
  downloadCancelled: "Download cancelado",
  queueCleared: "Fila limpa",
  historyCleared: "Histórico limpo",
  removedFromQueue: "Removido da fila",
  removedFromHistory: "Removido do histórico",
  status: "Status",
  progress: "Progresso",
  speed: "Velocidade",
  finishedAt: "Terminado em",
  failed: "Falhou",

  // Batch Download
  batchDownload: "Download em lote",
  batchDownloadDescription: "Cole vários URLs abaixo, um por linha.",
  urls: "URLs",
  addToQueue: "Adicionar à fila",
  batchTasksAdded: "{count} tarefas adicionadas",
  addBatchTasks: "Adicionar tarefas em lote",

  // Subscriptions
  subscribeToAuthor: "Inscrever-se no autor",
  subscribeConfirmationMessage: "Deseja se inscrever em {author}?",
  subscribeDescription:
    "O sistema verificará automaticamente novos vídeos deste autor e os baixará.",
  checkIntervalMinutes: "Intervalo de verificação (minutos)",
  subscribe: "Inscrever-se",
  subscriptions: "Inscrições",
  interval: "Intervalo",
  lastCheck: "Última verificação",
  platform: "Plataforma",
  unsubscribe: "Cancelar inscrição",
  confirmUnsubscribe:
    "Tem certeza de que deseja cancelar a inscrição de {author}?",
  subscribedSuccessfully: "Inscrito com sucesso",
  unsubscribedSuccessfully: "Inscrição cancelada com sucesso",
  subscriptionAlreadyExists: "Você já está inscrito neste autor.",
  minutes: "minutos",
  never: "Nunca",
  downloadAllPreviousVideos: "Baixar todos os vídeos anteriores deste autor",
  downloadAllPreviousWarning:
    "Aviso: Isso baixará todos os vídeos anteriores deste autor. Isso pode consumir um espaço de armazenamento significativo e pode acionar mecanismos de detecção de bots que podem resultar em proibições temporárias ou permanentes da plataforma. Use por sua conta e risco.",
  continuousDownloadTasks: "Tarefas de download contínuo",
  taskStatusActive: "Ativo",
  taskStatusPaused: "Pausado",
  taskStatusCompleted: "Concluído",
  taskStatusCancelled: "Cancelado",
  downloaded: "Baixado",
  cancelTask: "Cancelar tarefa",
  confirmCancelTask:
    "Tem certeza de que deseja cancelar a tarefa de download para {author}?",
  taskCancelled: "Tarefa cancelada com sucesso",
  deleteTask: "Excluir tarefa",
  confirmDeleteTask:
    "Tem certeza de que deseja excluir o registro da tarefa para {author}? Esta ação não pode ser desfeita.",
  taskDeleted: "Tarefa excluída com sucesso",
  clearFinishedTasks: "Limpar tarefas concluídas",
  tasksCleared: "Tarefas concluídas limpas com sucesso",
  confirmClearFinishedTasks:
    "Tem certeza de que deseja limpar todas as tarefas concluídas (concluídas, canceladas)? Isso as removerá da lista, mas não excluirá nenhum arquivo baixado.",
  clear: "Limpar",
  // Instruction Page
  instructionSection1Title: "1. Download e Gerenciamento de Tarefas",
  instructionSection1Desc:
    "Este módulo inclui aquisição de vídeo, tarefas em lote e funções de importação de arquivos.",
  instructionSection1Sub1: "Download de Link:",
  instructionSection1Item1Label: "Download Básico:",
  instructionSection1Item1Text:
    "Cole links de vários sites de vídeo na caixa de entrada para baixar diretamente.",
  instructionSection1Item2Label: "Permissões:",
  instructionSection1Item2Text:
    "Para sites que exigem associação ou login, faça login na conta correspondente em uma nova guia do navegador primeiro para adquirir permissões de download.",
  instructionSection1Sub2: "Reconhecimento Inteligente:",
  instructionSection1Item3Label: "Assinatura de Autor do YouTube:",
  instructionSection1Item3Text:
    "Quando o link colado for o canal de um autor, o sistema perguntará se você deseja se inscrever. Após a inscrição, o sistema pode verificar e baixar automaticamente as atualizações do autor em intervalos definidos.",
  instructionSection1Item4Label: "Download de Coleção Bilibili:",
  instructionSection1Item4Text:
    "Quando o link colado for um favorito/coleção Bilibili, o sistema perguntará se você deseja baixar todo o conteúdo da coleção.",
  instructionSection1Sub3:
    "Ferramentas Avançadas (Página de Gerenciamento de Download):",
  instructionSection1Item5Label: "Adicionar Tarefas em Lote:",
  instructionSection1Item5Text:
    "Suporta colar vários links de download de uma vez (um por linha) para adição em lote.",
  instructionSection1Item6Label: "Verificar Arquivos:",
  instructionSection1Item6Text:
    "Pesquisa automaticamente todos os arquivos no diretório raiz de armazenamento de vídeo e pastas de primeiro nível. Esta função é adequada para sincronizar arquivos com o sistema depois que os administradores os depositam manualmente no backend do servidor.",
  instructionSection1Item7Label: "Enviar Vídeo:",
  instructionSection1Item7Text:
    "Suporta o envio de arquivos de vídeo locais diretamente do cliente para o servidor.",

  instructionSection2Title: "2. Gerenciamento da Biblioteca de Vídeo",
  instructionSection2Desc:
    "Manter e editar recursos de vídeo baixados ou importados.",
  instructionSection2Sub1: "Exclusão de Coleção/Vídeo:",
  instructionSection2Text1:
    "Ao excluir uma coleção na página de gerenciamento, o sistema oferece duas opções: excluir apenas o item da lista de coleção (manter arquivos) ou excluir completamente os arquivos físicos dentro da coleção.",
  instructionSection2Sub2: "Reparo de Miniatura:",
  instructionSection2Text2:
    "Se um vídeo não tiver capa após o download, clique no botão de atualização na miniatura do vídeo e o sistema recapturará o primeiro quadro do vídeo como a nova miniatura.",

  instructionSection3Title: "3. Configurações do Sistema",
  instructionSection3Desc:
    "Configurar parâmetros do sistema, manter dados e estender funções.",
  instructionSection3Sub1: "Configurações de Segurança:",
  instructionSection3Text1:
    "Defina a senha de login do sistema (a senha inicial padrão é 123, recomenda-se alterar após o primeiro login).",
  instructionSection3Sub2: "Gerenciamento de Tags:",
  instructionSection3Text2:
    'Suporta adicionar ou excluir tags de classificação de vídeo. Nota: Você deve clicar no botão "Salvar" na parte inferior da página para que as alterações entrem em vigor.',
  instructionSection3Sub3: "Manutenção do Sistema:",
  instructionSection3Item1Label: "Limpar Arquivos Temporários:",
  instructionSection3Item1Text:
    "Usado para limpar arquivos de download temporários residuais causados por falhas ocasionais de backend para liberar espaço.",
  instructionSection3Item2Label: "Migração de Banco de Dados:",
  instructionSection3Item2Text:
    "Projetado para usuários de versões anteriores. Use esta função para migrar dados de JSON para o novo banco de dados SQLite. Após a migração bem-sucedida, clique no botão excluir para limpar dados históricos antigos.",
  instructionSection3Sub4: "Serviços Estendidos:",
  instructionSection3Item3Label: "OpenList Cloud Drive:",
  instructionSection3Item3Text:
    "(Em Desenvolvimento) Suporta conexão com serviços OpenList implantados pelo usuário. Adicione a configuração aqui para habilitar a integração da unidade de nuvem.",
  history: "Histórico",
  downloading: "Baixando...",
  poweredBy: "Com tecnologia de MyTube",
  existingVideoDetected: "Vídeo existente detectado",
  videoAlreadyDownloaded: "Este vídeo já foi baixado.",
  viewVideo: "Ver vídeo",
  downloadAgain: "Baixar novamente",
  downloadedOn: "Baixado em",
  deletedOn: "Excluído em",
  existingVideo: "Vídeo existente",
  skipped: "Pular",
  videoSkippedExists: "Vídeo já existe, download pulado",
  videoSkippedDeleted: "Vídeo foi excluído anteriormente, download pulado",

  // Sorting
  sort: "Ordenar",
  sortBy: "Ordenar por",
  dateDesc: "Data de adição (Mais recente)",
  dateAsc: "Data de adição (Mais antigo)",
  viewsDesc: "Visualizações (Decrescente)",
  viewsAsc: "Visualizações (Crescente)",
  nameAsc: "Nome (A-Z)",
  random: "Aleatório",

  // yt-dlp Configuration
  ytDlpConfiguration: "Configuração do yt-dlp",
  ytDlpConfigurationDescription:
    "Configure as opções de download do yt-dlp. Veja",
  ytDlpConfigurationDocs: "documentação",
  ytDlpConfigurationDescriptionEnd: "para mais informações.",
  customize: "Personalizar",
  hide: "Ocultar",
  reset: "Redefinir",
  more: "Mais",
  proxyOnlyApplyToYoutube: "Proxy aplica-se apenas ao Youtube",
  moveSubtitlesToVideoFolder: "Localização das legendas",
  moveSubtitlesToVideoFolderOn: "Junto com o vídeo",
  moveSubtitlesToVideoFolderOff: "Na pasta de legendas isolada",
  moveSubtitlesToVideoFolderDescription:
    "Quando ativado, os arquivos de legenda serão movidos para a mesma pasta do arquivo de vídeo. Quando desativado, eles serão movidos para a pasta de legendas isolada.",
  moveThumbnailsToVideoFolder: "Localização da miniatura",
  moveThumbnailsToVideoFolderOn: "Junto com o vídeo",
  moveThumbnailsToVideoFolderOff: "Em pasta de imagens isolada",
  moveThumbnailsToVideoFolderDescription:
    "Quando ativado, os arquivos de miniatura serão movidos para a mesma pasta do arquivo de vídeo. Quando desativado, eles serão movidos para a pasta de imagens isolada.",

  // Database Export/Import
  exportImportDatabase: "Exportar/Importar Banco de Dados",
  exportImportDatabaseDescription:
    "Exporte seu banco de dados como arquivo de backup ou importe um backup previamente exportado. A importação substituirá os dados existentes pelos dados de backup.",
  exportDatabase: "Exportar Banco de Dados",
  importDatabase: "Importar Banco de Dados",
  onlyDbFilesAllowed: "Apenas arquivos .db são permitidos",
  importDatabaseWarning:
    "Aviso: Importar um banco de dados substituirá todos os dados existentes. Certifique-se de exportar primeiro seu banco de dados atual como backup.",
  selectDatabaseFile: "Selecionar Arquivo de Banco de Dados",
  databaseExportedSuccess: "Banco de dados exportado com sucesso",
  databaseExportFailed: "Falha ao exportar banco de dados",
  databaseImportedSuccess:
    "Banco de dados importado com sucesso. Os dados existentes foram substituídos pelos dados de backup.",
  databaseImportFailed: "Falha ao importar banco de dados",
  cleanupBackupDatabases: "Limpar Bancos de Dados de Backup",
  cleanupBackupDatabasesWarning:
    "Aviso: Isso excluirá permanentemente todos os arquivos de banco de dados de backup (mytube-backup-*.db.backup) que foram criados durante importações anteriores. Esta ação não pode ser desfeita. Tem certeza de que deseja continuar?",
  backupDatabasesCleanedUp: "Bancos de dados de backup limpos com sucesso",
  backupDatabasesCleanupFailed: "Falha ao limpar bancos de dados de backup",
  restoreFromLastBackup: "Restaurar do Último Backup",
  restoreFromLastBackupWarning:
    "Aviso: Isso restaurará o banco de dados do último arquivo de backup automático. Todos os dados atuais serão substituídos pelos dados de backup. Esta ação não pode ser desfeita. Tem certeza de que deseja continuar?",
  restoreFromLastBackupSuccess:
    "Banco de dados restaurado com sucesso do backup",
  restoreFromLastBackupFailed: "Falha ao restaurar do backup",
  lastBackupDate: "Data do último backup",
  noBackupAvailable: "Nenhum backup disponível",

  // Cloudflare Tunnel
  cloudflaredTunnel: "Túnel Cloudflare",
  enableCloudflaredTunnel: "Habilitar Túnel Cloudflare",
  cloudflaredToken: "Token do Túnel (Opcional)",
  cloudflaredTokenHelper:
    "Cole o token do túnel aqui, ou deixe em branco para usar um Túnel Rápido aleatório.",
  waitingForUrl: "Aguardando URL do Túnel Rápido...",
  running: "Executando",
  stopped: "Parado",
  tunnelId: "ID do Túnel",
  accountTag: "Tag da Conta",
  copied: "Copiado!",
  clickToCopy: "Clique para copiar",
  quickTunnelWarning:
    "URLs de Túnel Rápido mudam toda vez que o túnel é reiniciado.",
  managedInDashboard:
    "O nome do host público é gerenciado no painel Cloudflare Zero Trust.",
  failedToDownloadVideo: "Falha ao baixar o vídeo. Por favor, tente novamente.",
  failedToDownload: "Falha ao baixar. Por favor, tente novamente.",
  playlistDownloadStarted: "Download da playlist iniciado",
  copyUrl: "Copiar URL",
  new: "NOVO",
  // Task Hooks
  taskHooks: "Ganchos de Tarefa",
  taskHooksDescription:
    "Execute comandos shell personalizados em pontos específicos do ciclo de vida da tarefa. Variáveis de ambiente disponíveis: MYTUBE_TASK_ID, MYTUBE_TASK_TITLE, MYTUBE_SOURCE_URL, MYTUBE_VIDEO_PATH.",
  taskHooksWarning:
    "Aviso: Os comandos são executados com as permissões do servidor. Use com cautela.",
  enterPasswordToUploadHook:
    "Por favor, digite sua senha para fazer upload deste script Hook.",
  riskCommandDetected:
    "Comando de risco detectado: {command}. Upload rejeitado.",
  hookTaskBeforeStart: "Antes do Início da Tarefa",
  hookTaskBeforeStartHelper: "Executa antes do download começar.",
  hookTaskSuccess: "Tarefa com Sucesso",
  hookTaskSuccessHelper:
    "Executa após download bem-sucedido, antes do upload/exclusão na nuvem (aguarda conclusão).",
  hookTaskFail: "Falha na Tarefa",
  hookTaskFailHelper: "Executa quando uma tarefa falha.",
  hookTaskCancel: "Tarefa Cancelada",
  hookTaskCancelHelper: "Executa quando uma tarefa é cancelada manualmente.",
  found: "Encontrado",
  notFound: "Não Definido",
  deleteHook: "Excluir Script de Gancho",
  confirmDeleteHook: "Tem certeza que deseja excluir este script de gancho?",
  uploadHook: "Enviar .sh",
  disclaimerTitle: "Isenção de responsabilidade",
  disclaimerText:
    "1. Objetivo e Restrições\nEste software (incluindo código e documentação) destina-se exclusivamente a aprendizagem pessoal, pesquisa e intercâmbio técnico. É estritamente proibido usar este software para fins comerciais ou para quaisquer atividades ilegais que violem as leis e regulamentos locais.\n\n2. Responsabilidade\nO desenvolvedor desconhece e não tem controle sobre como os usuários utilizam este software. Quaisquer responsabilidades legais, disputas ou danos decorrentes do uso ilegal ou impróprio deste software (incluindo, mas não se limitando a violação de direitos autorais) serão de responsabilidade exclusiva do usuário. O desenvolvedor não assume nenhuma responsabilidade direta, indireta ou conjunta.\n\n3. Modificações e Distribuição\nEste projeto é de código aberto. Qualquer indivíduo ou organização que modifique ou faça fork deste código deve cumprir a licença de código aberto. Importante: Se um terceiro modificar o código para contornar ou remover os mecanismos originais de autenticação/segurança do usuário e distribuir tais versões, o modificador/distribuidor assume total responsabilidade por quaisquer consequências. Desaconselhamos fortemente contornar ou adulterar quaisquer mecanismos de verificação de segurança.\n\n4. Declaração Sem Fins Lucrativos\nEste é um projeto de código aberto totalmente gratuito. O desenvolvedor não aceita doações e nunca publicou páginas de doação. O software em si não permite cobranças e não oferece serviços pagos. Por favor, esteja vigilante e cuidado com quaisquer golpes ou informações enganosas que aleguem cobrar taxas em nome deste projeto.",
};
