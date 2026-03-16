# Locale Key List

Canonical locale key order derived from `frontend/src/utils/locales/en.ts`.

This list is intentionally unnumbered. When new keys are inserted, only the local section order changes.

Total keys: 793

## Summary

| Section | Keys | First Key | Last Key |
| --- | ---: | --- | --- |
| Header | 11 | `myTube` | `instruction` |
| Home | 19 | `pasteUrl` | `views` |
| Settings | 4 | `general` | `downloadSettings` |
| Settings Categories | 119 | `basicSettings` | `enterNewTagName` |
| Database | 39 | `database` | `cleanupTempFilesConfirmMessage` |
| Task Hooks | 40 | `taskHooks` | `cleanupTempFilesFailed` |
| Cookie Settings | 12 | `cookieSettings` | `cookiesDeleteFailed` |
| Cloud Drive | 38 | `cloudDriveSettings` | `clearThumbnailCacheConfirmMessage` |
| Manage | 33 | `manageContent` | `confirmBulkDelete` |
| Video Player | 62 | `playing` | `deletingVideos` |
| Login | 21 | `signIn` | `tooManyAttempts` |
| Passkeys | 19 | `createPasskey` | `copyUrl` |
| Collection Page | 4 | `loadingCollection` | `back` |
| Author Videos | 18 | `loadVideosError` | `addVideosToExistingCollectionConfirmationWithMove` |
| Delete Collection Modal | 5 | `deleteCollectionTitle` | `deleteCollectionAndVideos` |
| Common | 14 | `loading` | `collapse` |
| Video Card | 9 | `unknownDate` | `weeksAgo` |
| Upload Modal | 16 | `selectVideoFile` | `thumbnailUploaded` |
| Bilibili Modal | 22 | `bilibiliCollectionDetected` | `waitingInQueue` |
| Downloads | 20 | `downloads` | `failed` |
| Snackbar Messages | 19 | `videoDownloading` | `subtitleDeleted` |
| Batch Download | 6 | `batchDownload` | `addBatchTasks` |
| Subscriptions | 50 | `subscribeToAuthor` | `clear` |
| Subscription Pause/Resume | 12 | `pause` | `viaContinuousDownload` |
| Playlist Subscription | 5 | `subscribeToPlaylist` | `playlistSubscription` |
| Instruction Page | 39 | `instructionSection1Title` | `instructionSection3Item3Text` |
| Disclaimer | 3 | `disclaimerTitle` | `history` |
| Existing Video Detection | 16 | `existingVideoDetected` | `changeSettings` |
| Sorting | 10 | `sort` | `random` |
| yt-dlp Configuration | 21 | `ytDlpConfiguration` | `saveAuthorFilesToCollectionDescription` |
| Cloudflare Tunnel | 16 | `cloudflaredTunnel` | `managedInDashboard` |
| Database Export/Import | 38 | `exportImportDatabase` | `backupDatabasesCleanedUp` |
| History Filter | 33 | `filterAll` | `browserVideoFormatNotSupported` |

## Details

### Header

| Key |
| --- |
| `myTube` |
| `manage` |
| `settings` |
| `logout` |
| `pleaseEnterUrlOrSearchTerm` |
| `unexpectedErrorOccurred` |
| `uploadVideo` |
| `enterUrlOrSearchTerm` |
| `enterSearchTerm` |
| `manageVideos` |
| `instruction` |

### Home

| Key |
| --- |
| `pasteUrl` |
| `download` |
| `search` |
| `recentDownloads` |
| `noDownloads` |
| `downloadStarted` |
| `downloadFailed` |
| `downloadSuccess` |
| `confirmDownloadAllPlaylists` |
| `downloadAll` |
| `loadingVideos` |
| `searchResultsFor` |
| `fromYourLibrary` |
| `noMatchingVideos` |
| `fromYouTube` |
| `loadingYouTubeResults` |
| `noYouTubeResults` |
| `noVideosYet` |
| `views` |

### Settings

| Key |
| --- |
| `general` |
| `security` |
| `videoDefaults` |
| `downloadSettings` |

### Settings Categories

| Key |
| --- |
| `basicSettings` |
| `interfaceDisplay` |
| `securityAccess` |
| `videoPlayback` |
| `downloadStorage` |
| `contentManagement` |
| `dataManagement` |
| `advanced` |
| `language` |
| `websiteName` |
| `websiteNameHelper` |
| `theme` |
| `themeLight` |
| `themeDark` |
| `themeSystem` |
| `showThemeButtonInHeader` |
| `tmdbApiKey` |
| `tmdbApiKeyHelper` |
| `mountDirectories` |
| `mountDirectoriesPlaceholder` |
| `mountDirectoriesHelper` |
| `mountDirectoriesEmptyError` |
| `infiniteScroll` |
| `infiniteScrollDisabled` |
| `maxVideoColumns` |
| `videoColumns` |
| `columnsCount` |
| `enableLogin` |
| `allowPasswordLogin` |
| `allowPasswordLoginHelper` |
| `allowResetPassword` |
| `fastRetryMode` |
| `fastRetryModeDesc` |
| `normalRetryModeDesc` |
| `allowResetPasswordHelper` |
| `enableApiKeyAuth` |
| `apiKeyAuthHelper` |
| `apiKey` |
| `refreshApiKey` |
| `refreshApiKeyTitle` |
| `refreshApiKeyConfirm` |
| `copyApiKey` |
| `apiKeySaveHint` |
| `apiKeyCopied` |
| `apiKeyCopyFailed` |
| `password` |
| `enterPassword` |
| `togglePasswordVisibility` |
| `passwordHelper` |
| `passwordSetHelper` |
| `autoPlay` |
| `autoLoop` |
| `maxConcurrent` |
| `maxConcurrentDescription` |
| `dontSkipDeletedVideo` |
| `dontSkipDeletedVideoDescription` |
| `preferredAudioLanguage` |
| `preferredAudioLanguageDescription` |
| `preferredAudioLanguageDefault` |
| `preferredAudioLanguage_en` |
| `preferredAudioLanguage_zh` |
| `preferredAudioLanguage_ja` |
| `preferredAudioLanguage_ko` |
| `preferredAudioLanguage_es` |
| `preferredAudioLanguage_fr` |
| `preferredAudioLanguage_de` |
| `preferredAudioLanguage_pt` |
| `preferredAudioLanguage_ru` |
| `preferredAudioLanguage_ar` |
| `preferredAudioLanguage_hi` |
| `preferredAudioLanguage_it` |
| `preferredAudioLanguage_nl` |
| `preferredAudioLanguage_pl` |
| `preferredAudioLanguage_tr` |
| `preferredAudioLanguage_vi` |
| `defaultVideoCodec` |
| `defaultVideoCodecDescription` |
| `defaultVideoCodecDefault` |
| `defaultVideoCodec_h264` |
| `defaultVideoCodec_h265` |
| `defaultVideoCodec_av1` |
| `defaultVideoCodec_vp9` |
| `saveSettings` |
| `saving` |
| `backToManage` |
| `settingsSaved` |
| `settingsFailed` |
| `debugMode` |
| `debugModeDescription` |
| `telegramNotifications` |
| `telegramNotificationsDescription` |
| `telegramEnabled` |
| `telegramBotToken` |
| `telegramBotTokenHelper` |
| `telegramChatId` |
| `telegramChatIdHelper` |
| `telegramNotifyOnSuccess` |
| `telegramNotifyOnFail` |
| `telegramTestButton` |
| `telegramTestSuccess` |
| `telegramTestFailed` |
| `telegramTestMissingFields` |
| `pauseOnFocusLoss` |
| `playFromBeginning` |
| `tagsManagement` |
| `newTag` |
| `selectTags` |
| `tags` |
| `noTagsAvailable` |
| `addTag` |
| `addTags` |
| `failedToSaveTags` |
| `renameTag` |
| `confirmRenameTag` |
| `tagRenamedSuccess` |
| `tagRenameFailed` |
| `tagConflictCaseInsensitive` |
| `renameTagDescription` |
| `enterNewTagName` |

### Database

| Key |
| --- |
| `database` |
| `migrateDataDescription` |
| `migrateDataButton` |
| `scanFiles` |
| `scanFilesSuccess` |
| `scanFilesDeleted` |
| `scanFilesFailed` |
| `scanMountDirectoriesSuccess` |
| `subscribePlaylistsSuccess` |
| `subscribePlaylistsSkipped` |
| `subscribePlaylistsErrors` |
| `subscribePlaylistsNoNew` |
| `playlistsWatcher` |
| `scanFilesConfirmMessage` |
| `scanning` |
| `migrateConfirmation` |
| `migrationResults` |
| `migrationReport` |
| `migrationSuccess` |
| `migrationNoData` |
| `migrationFailed` |
| `migrationWarnings` |
| `migrationErrors` |
| `itemsMigrated` |
| `fileNotFound` |
| `noDataFilesFound` |
| `removeLegacyData` |
| `removeLegacyDataDescription` |
| `removeLegacyDataConfirmTitle` |
| `removeLegacyDataConfirmMessage` |
| `legacyDataDeleted` |
| `formatLegacyFilenames` |
| `formatLegacyFilenamesDescription` |
| `formatLegacyFilenamesButton` |
| `deleteLegacyDataButton` |
| `cleanupTempFiles` |
| `cleanupTempFilesDescription` |
| `cleanupTempFilesConfirmTitle` |
| `cleanupTempFilesConfirmMessage` |

### Task Hooks

| Key |
| --- |
| `taskHooks` |
| `taskHooksDescription` |
| `taskHooksWarning` |
| `hookTaskBeforeStart` |
| `hookTaskBeforeStartHelper` |
| `hookTaskSuccess` |
| `hookTaskSuccessHelper` |
| `hookTaskFail` |
| `hookTaskFailHelper` |
| `hookTaskCancel` |
| `hookTaskCancelHelper` |
| `found` |
| `notFound` |
| `deleteHook` |
| `confirmDeleteHook` |
| `uploadHook` |
| `enterPasswordToUploadHook` |
| `riskCommandDetected` |
| `cleanupTempFilesActiveDownloads` |
| `formatFilenamesSuccess` |
| `formatFilenamesDetails` |
| `formatFilenamesMore` |
| `formatFilenamesError` |
| `itemsPerPage` |
| `itemsPerPageHelper` |
| `showYoutubeSearch` |
| `defaultSort` |
| `showTagsOnThumbnail` |
| `playSoundOnTaskComplete` |
| `soundSuccess` |
| `visitorModeReadOnly` |
| `visitorModeUrlRestricted` |
| `visitorUser` |
| `enableVisitorUser` |
| `visitorUserHelper` |
| `visitorPassword` |
| `visitorPasswordHelper` |
| `visitorPasswordSetHelper` |
| `cleanupTempFilesSuccess` |
| `cleanupTempFilesFailed` |

### Cookie Settings

| Key |
| --- |
| `cookieSettings` |
| `cookieUploadDescription` |
| `uploadCookies` |
| `onlyTxtFilesAllowed` |
| `cookiesUploadedSuccess` |
| `cookiesUploadFailed` |
| `cookiesFound` |
| `cookiesNotFound` |
| `deleteCookies` |
| `confirmDeleteCookies` |
| `cookiesDeletedSuccess` |
| `cookiesDeleteFailed` |

### Cloud Drive

| Key |
| --- |
| `cloudDriveSettings` |
| `cloudDriveDescription` |
| `enableAutoSave` |
| `apiUrl` |
| `apiUrlHelper` |
| `token` |
| `publicUrl` |
| `publicUrlHelper` |
| `uploadPath` |
| `cloudDrivePathHelper` |
| `scanPaths` |
| `scanPathsHelper` |
| `cloudDriveNote` |
| `cloudScanAdded` |
| `testing` |
| `testConnection` |
| `sync` |
| `syncToCloud` |
| `syncWarning` |
| `syncing` |
| `syncCompleted` |
| `syncFailed` |
| `syncReport` |
| `syncErrors` |
| `fillApiUrlToken` |
| `connectionTestSuccess` |
| `connectionFailedStatus` |
| `connectionFailedUrl` |
| `authFailed` |
| `connectionTestFailed` |
| `syncFailedMessage` |
| `foundVideosToSync` |
| `uploadingVideo` |
| `clearThumbnailCache` |
| `clearing` |
| `clearThumbnailCacheSuccess` |
| `clearThumbnailCacheError` |
| `clearThumbnailCacheConfirmMessage` |

### Manage

| Key |
| --- |
| `manageContent` |
| `videos` |
| `collections` |
| `allVideos` |
| `delete` |
| `backToHome` |
| `confirmDelete` |
| `deleteSuccess` |
| `deleteFailed` |
| `noVideos` |
| `noCollectionsFound` |
| `noCollections` |
| `searchVideos` |
| `thumbnail` |
| `title` |
| `author` |
| `authors` |
| `created` |
| `name` |
| `size` |
| `actions` |
| `deleteCollection` |
| `deleteVideo` |
| `redownloadVideo` |
| `refreshFileSizesSuccess` |
| `refreshFileSizesFailed` |
| `refreshFileSizesSkipped` |
| `refreshFileSizesError` |
| `noVideosFoundMatching` |
| `refreshThumbnail` |
| `selected` |
| `moveCollection` |
| `confirmBulkDelete` |

### Video Player

| Key |
| --- |
| `playing` |
| `paused` |
| `next` |
| `previous` |
| `loop` |
| `autoPlayOn` |
| `autoPlayOff` |
| `autoPlayNext` |
| `videoNotFound` |
| `videoNotFoundOrLoaded` |
| `deleting` |
| `addToCollection` |
| `originalLink` |
| `source` |
| `addedDate` |
| `hideComments` |
| `showComments` |
| `latestComments` |
| `noComments` |
| `upNext` |
| `noOtherVideos` |
| `currentlyIn` |
| `collectionWarning` |
| `addToExistingCollection` |
| `selectCollection` |
| `add` |
| `createNewCollection` |
| `collectionName` |
| `create` |
| `removeFromCollection` |
| `confirmRemoveFromCollection` |
| `remove` |
| `loadingVideo` |
| `current` |
| `rateThisVideo` |
| `enterFullscreen` |
| `exitFullscreen` |
| `enterCinemaMode` |
| `exitCinemaMode` |
| `share` |
| `editTitle` |
| `hideVideo` |
| `showVideo` |
| `toggleVisibility` |
| `titleUpdated` |
| `titleUpdateFailed` |
| `thumbnailRefreshed` |
| `thumbnailRefreshFailed` |
| `videoUpdated` |
| `videoUpdateFailed` |
| `failedToLoadVideos` |
| `videoRemovedSuccessfully` |
| `failedToDeleteVideo` |
| `pleaseEnterSearchTerm` |
| `failedToSearch` |
| `searchCancelled` |
| `openInExternalPlayer` |
| `playWith` |
| `deleteAllFilteredVideos` |
| `confirmDeleteFilteredVideos` |
| `deleteFilteredVideosSuccess` |
| `deletingVideos` |

### Login

| Key |
| --- |
| `signIn` |
| `admin` |
| `visitorSignIn` |
| `orVisitor` |
| `verifying` |
| `incorrectPassword` |
| `loginFailed` |
| `defaultPasswordHint` |
| `checkingConnection` |
| `connectionError` |
| `backendConnectionFailed` |
| `retry` |
| `resetPassword` |
| `resetPasswordTitle` |
| `resetPasswordMessage` |
| `resetPasswordConfirm` |
| `resetPasswordSuccess` |
| `resetPasswordDisabledInfo` |
| `resetPasswordScriptGuide` |
| `waitTimeMessage` |
| `tooManyAttempts` |

### Passkeys

| Key |
| --- |
| `createPasskey` |
| `creatingPasskey` |
| `passkeyCreated` |
| `passkeyCreationFailed` |
| `passkeyWebAuthnNotSupported` |
| `passkeyRequiresHttps` |
| `removePasskeys` |
| `removePasskeysTitle` |
| `removePasskeysMessage` |
| `passkeysRemoved` |
| `passkeysRemoveFailed` |
| `loginWithPasskey` |
| `authenticating` |
| `passkeyLoginFailed` |
| `passkeyErrorPermissionDenied` |
| `passkeyErrorAlreadyRegistered` |
| `linkCopied` |
| `copyFailed` |
| `copyUrl` |

### Collection Page

| Key |
| --- |
| `loadingCollection` |
| `collectionNotFound` |
| `noVideosInCollection` |
| `back` |

### Author Videos

| Key |
| --- |
| `loadVideosError` |
| `unknownAuthor` |
| `noVideosForAuthor` |
| `deleteAuthor` |
| `deleteAuthorConfirmation` |
| `authorDeletedSuccessfully` |
| `failedToDeleteAuthor` |
| `createCollectionFromAuthor` |
| `createCollectionFromAuthorTooltip` |
| `creatingCollection` |
| `collectionCreatedFromAuthor` |
| `failedToCreateCollectionFromAuthor` |
| `collectionAlreadyExists` |
| `createCollectionFromAuthorConfirmation` |
| `createCollectionFromAuthorConfirmationWithMove` |
| `addVideosToCollection` |
| `addVideosToExistingCollectionConfirmation` |
| `addVideosToExistingCollectionConfirmationWithMove` |

### Delete Collection Modal

| Key |
| --- |
| `deleteCollectionTitle` |
| `deleteCollectionConfirmation` |
| `collectionContains` |
| `deleteCollectionOnly` |
| `deleteCollectionAndVideos` |

### Common

| Key |
| --- |
| `loading` |
| `error` |
| `success` |
| `cancel` |
| `close` |
| `ok` |
| `confirm` |
| `save` |
| `note` |
| `on` |
| `off` |
| `continue` |
| `expand` |
| `collapse` |

### Video Card

| Key |
| --- |
| `unknownDate` |
| `part` |
| `collection` |
| `new` |
| `justNow` |
| `hoursAgo` |
| `today` |
| `thisWeek` |
| `weeksAgo` |

### Upload Modal

| Key |
| --- |
| `selectVideoFile` |
| `selectVideoFolder` |
| `pleaseSelectVideo` |
| `noSupportedVideosFound` |
| `uploadFailed` |
| `failedToUpload` |
| `uploading` |
| `upload` |
| `uploadSummary` |
| `unsupportedFilesSkipped` |
| `multipleUploadUsesFilename` |
| `uploadThumbnail` |
| `clickToSelectImage` |
| `changeImage` |
| `selectImage` |
| `thumbnailUploaded` |

### Bilibili Modal

| Key |
| --- |
| `bilibiliCollectionDetected` |
| `bilibiliSeriesDetected` |
| `multiPartVideoDetected` |
| `authorOrPlaylist` |
| `playlistDetected` |
| `playlistHasVideos` |
| `downloadPlaylistAndCreateCollection` |
| `playlistDownloadStarted` |
| `collectionHasVideos` |
| `seriesHasVideos` |
| `videoHasParts` |
| `downloadAllVideos` |
| `downloadAllParts` |
| `downloadThisVideoOnly` |
| `downloadCurrentPartOnly` |
| `processing` |
| `wouldYouLikeToDownloadAllParts` |
| `wouldYouLikeToDownloadAllVideos` |
| `allPartsAddedToCollection` |
| `allVideosAddedToCollection` |
| `queued` |
| `waitingInQueue` |

### Downloads

| Key |
| --- |
| `downloads` |
| `activeDownloads` |
| `manageDownloads` |
| `queuedDownloads` |
| `downloadHistory` |
| `clearQueue` |
| `clearHistory` |
| `noActiveDownloads` |
| `noQueuedDownloads` |
| `noDownloadHistory` |
| `downloadCancelled` |
| `queueCleared` |
| `historyCleared` |
| `removedFromQueue` |
| `removedFromHistory` |
| `status` |
| `progress` |
| `speed` |
| `finishedAt` |
| `failed` |

### Snackbar Messages

| Key |
| --- |
| `videoDownloading` |
| `downloadStartedSuccessfully` |
| `collectionCreatedSuccessfully` |
| `videoAddedToCollection` |
| `videosAddedToCollection` |
| `videoRemovedFromCollection` |
| `collectionDeletedSuccessfully` |
| `failedToDeleteCollection` |
| `collectionUpdatedSuccessfully` |
| `failedToUpdateCollection` |
| `collectionNameRequired` |
| `collectionNameTooLong` |
| `collectionNameInvalidChars` |
| `collectionNameReserved` |
| `updateCollectionFailed` |
| `uploadSubtitle` |
| `subtitleUploaded` |
| `confirmDeleteSubtitle` |
| `subtitleDeleted` |

### Batch Download

| Key |
| --- |
| `batchDownload` |
| `batchDownloadDescription` |
| `urls` |
| `addToQueue` |
| `batchTasksAdded` |
| `addBatchTasks` |

### Subscriptions

| Key |
| --- |
| `subscribeToAuthor` |
| `subscribeToChannel` |
| `subscribeConfirmationMessage` |
| `subscribeChannelChoiceMessage` |
| `subscribeChannelChoiceDescription` |
| `subscribeAllVideos` |
| `subscribeAllPlaylists` |
| `subscribeAllPlaylistsDescription` |
| `subscribeDescription` |
| `checkIntervalMinutes` |
| `subscribe` |
| `subscriptions` |
| `interval` |
| `lastCheck` |
| `platform` |
| `unsubscribe` |
| `confirmUnsubscribe` |
| `subscribedSuccessfully` |
| `unsubscribedSuccessfully` |
| `subscriptionAlreadyExists` |
| `minutes` |
| `never` |
| `downloadAllPreviousVideos` |
| `downloadShorts` |
| `downloadOrder` |
| `downloadOrderDateDesc` |
| `downloadOrderDateAsc` |
| `downloadOrderViewsDesc` |
| `downloadOrderViewsAsc` |
| `downloadOrderLargeChannelHint` |
| `downloadOrderShortsHint` |
| `downloadAllPreviousWarning` |
| `downloadAllPreviousVideosInPlaylists` |
| `downloadAllPlaylistsWarning` |
| `continuousDownloadTasks` |
| `taskStatusActive` |
| `taskStatusPaused` |
| `taskStatusCompleted` |
| `taskStatusCancelled` |
| `downloaded` |
| `cancelTask` |
| `confirmCancelTask` |
| `taskCancelled` |
| `deleteTask` |
| `confirmDeleteTask` |
| `taskDeleted` |
| `clearFinishedTasks` |
| `tasksCleared` |
| `confirmClearFinishedTasks` |
| `clear` |

### Subscription Pause/Resume

| Key |
| --- |
| `pause` |
| `resume` |
| `pauseSubscription` |
| `resumeSubscription` |
| `pauseTask` |
| `resumeTask` |
| `subscriptionPaused` |
| `subscriptionResumed` |
| `taskPaused` |
| `taskResumed` |
| `viaSubscription` |
| `viaContinuousDownload` |

### Playlist Subscription

| Key |
| --- |
| `subscribeToPlaylist` |
| `subscribePlaylistDescription` |
| `playlistSubscribedSuccessfully` |
| `downloadAndSubscribe` |
| `playlistSubscription` |

### Instruction Page

| Key |
| --- |
| `instructionSection1Title` |
| `instructionSection1Desc` |
| `instructionSection1Sub1` |
| `instructionSection1Item1Label` |
| `instructionSection1Item1Text` |
| `instructionSection1Item2Label` |
| `instructionSection1Item2Text` |
| `instructionSection1Sub2` |
| `instructionSection1Item3Label` |
| `instructionSection1Item3Text` |
| `instructionSection1Item4Label` |
| `instructionSection1Item4Text` |
| `instructionSection1Sub3` |
| `instructionSection1Item5Label` |
| `instructionSection1Item5Text` |
| `instructionSection1Item6Label` |
| `instructionSection1Item6Text` |
| `instructionSection1Item7Label` |
| `instructionSection1Item7Text` |
| `instructionSection2Title` |
| `instructionSection2Desc` |
| `instructionSection2Sub1` |
| `instructionSection2Text1` |
| `instructionSection2Sub2` |
| `instructionSection2Text2` |
| `instructionSection3Title` |
| `instructionSection3Desc` |
| `instructionSection3Sub1` |
| `instructionSection3Text1` |
| `instructionSection3Sub2` |
| `instructionSection3Text2` |
| `instructionSection3Sub3` |
| `instructionSection3Item1Label` |
| `instructionSection3Item1Text` |
| `instructionSection3Item2Label` |
| `instructionSection3Item2Text` |
| `instructionSection3Sub4` |
| `instructionSection3Item3Label` |
| `instructionSection3Item3Text` |

### Disclaimer

| Key |
| --- |
| `disclaimerTitle` |
| `disclaimerText` |
| `history` |

### Existing Video Detection

| Key |
| --- |
| `existingVideoDetected` |
| `videoAlreadyDownloaded` |
| `viewVideo` |
| `previouslyDeletedVideo` |
| `previouslyDeleted` |
| `videoWasDeleted` |
| `downloadAgain` |
| `downloadedOn` |
| `deletedOn` |
| `existingVideo` |
| `skipped` |
| `videoSkippedExists` |
| `videoSkippedDeleted` |
| `downloading` |
| `poweredBy` |
| `changeSettings` |

### Sorting

| Key |
| --- |
| `sort` |
| `sortBy` |
| `dateDesc` |
| `dateAsc` |
| `viewsDesc` |
| `viewsAsc` |
| `nameAsc` |
| `videoDateDesc` |
| `videoDateAsc` |
| `random` |

### yt-dlp Configuration

| Key |
| --- |
| `ytDlpConfiguration` |
| `ytDlpConfigurationDescription` |
| `ytDlpConfigurationDocs` |
| `ytDlpConfigurationDescriptionEnd` |
| `customize` |
| `hide` |
| `reset` |
| `more` |
| `proxyOnlyApplyToYoutube` |
| `moveSubtitlesToVideoFolder` |
| `moveSubtitlesToVideoFolderOn` |
| `moveSubtitlesToVideoFolderOff` |
| `moveSubtitlesToVideoFolderDescription` |
| `moveThumbnailsToVideoFolder` |
| `moveThumbnailsToVideoFolderOn` |
| `moveThumbnailsToVideoFolderOff` |
| `moveThumbnailsToVideoFolderDescription` |
| `saveAuthorFilesToCollection` |
| `saveAuthorFilesToCollectionOn` |
| `saveAuthorFilesToCollectionOff` |
| `saveAuthorFilesToCollectionDescription` |

### Cloudflare Tunnel

| Key |
| --- |
| `cloudflaredTunnel` |
| `enableCloudflaredTunnel` |
| `cloudflaredToken` |
| `cloudflaredTokenHelper` |
| `allowedHosts` |
| `allowedHostsHelper` |
| `allowedHostsRequired` |
| `waitingForUrl` |
| `running` |
| `stopped` |
| `tunnelId` |
| `accountTag` |
| `copied` |
| `clickToCopy` |
| `quickTunnelWarning` |
| `managedInDashboard` |

### Database Export/Import

| Key |
| --- |
| `exportImportDatabase` |
| `exportImportDatabaseDescription` |
| `exportDatabase` |
| `importDatabase` |
| `mergeDatabase` |
| `onlyDbFilesAllowed` |
| `importDatabaseWarning` |
| `mergeDatabaseWarning` |
| `mergeDatabaseContentsVideos` |
| `mergeDatabaseContentsCollections` |
| `mergeDatabaseContentsSubscriptions` |
| `mergeDatabaseContentsHistory` |
| `mergeDatabaseContentsTags` |
| `mergeDatabaseKeepsCurrentData` |
| `mergeDatabasePreviewScanning` |
| `mergeDatabasePreviewResults` |
| `mergeDatabasePreviewConfirmHint` |
| `mergeDatabasePreviewFailed` |
| `mergeDatabasePreviewErrorDefault` |
| `mergeDatabaseMergedCount` |
| `mergeDatabaseSkippedCount` |
| `mergeDatabasePreviewVideos` |
| `mergeDatabasePreviewCollections` |
| `mergeDatabasePreviewCollectionLinks` |
| `mergeDatabasePreviewSubscriptions` |
| `mergeDatabasePreviewDownloadHistory` |
| `mergeDatabasePreviewVideoDownloads` |
| `mergeDatabasePreviewTags` |
| `selectDatabaseFile` |
| `databaseExportedSuccess` |
| `databaseExportFailed` |
| `databaseImportedSuccess` |
| `databaseImportFailed` |
| `databaseMergedSuccess` |
| `databaseMergeFailed` |
| `cleanupBackupDatabases` |
| `cleanupBackupDatabasesWarning` |
| `backupDatabasesCleanedUp` |

### History Filter

| Key |
| --- |
| `filterAll` |
| `backupDatabasesCleanupFailed` |
| `restoreFromLastBackup` |
| `restoreFromLastBackupWarning` |
| `restoreFromLastBackupSuccess` |
| `restoreFromLastBackupFailed` |
| `lastBackupDate` |
| `noBackupAvailable` |
| `failedToDownloadVideo` |
| `failedToDownload` |
| `openFolder` |
| `openInNewTab` |
| `copyLink` |
| `refresh` |
| `showSensitiveContent` |
| `hideSensitiveContent` |
| `sensitiveContentWarning` |
| `soundNone` |
| `soundBell` |
| `soundMessage` |
| `soundMicrowave` |
| `soundNotification` |
| `soundDrop` |
| `soundWater` |
| `videoLoadTimeout` |
| `failedToLoadVideo` |
| `videoLoadingAborted` |
| `videoLoadNetworkError` |
| `safariWebmLimitedSupportError` |
| `safariVideoDecodeError` |
| `videoDecodeError` |
| `safariVideoFormatNotSupported` |
| `browserVideoFormatNotSupported` |
