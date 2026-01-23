/**
 * i18n 타입 정의 (자동 생성)
 *
 * 이 파일은 scripts/generate-i18n-types.mjs에 의해 자동 생성됩니다.
 * 직접 수정하지 마세요.
 *
 * 생성 명령: pnpm run generate:i18n-types
 * 생성 시간: 2026-01-23T18:39:49.947Z
 * 총 키 개수: 743
 */

/**
 * 모든 번역 키의 유니온 타입
 */
export type TranslationKey =
  | 'common.appDescription'
  | 'common.appName'
  | 'common.back'
  | 'common.cancel'
  | 'common.close'
  | 'common.copied'
  | 'common.copy'
  | 'common.delete'
  | 'common.edit'
  | 'common.error.copyError'
  | 'common.error.info'
  | 'common.error.report'
  | 'common.error.showDetails'
  | 'common.error.solution'
  | 'common.error.sorry'
  | 'common.error.unexpected'
  | 'common.error.updateCheckFailed'
  | 'common.error.updateInstallFailed'
  | 'common.errorOccurred'
  | 'common.help'
  | 'common.hooks.githubApiError'
  | 'common.hooks.noProjectSelected'
  | 'common.hooks.projectSummaryLoadFailed'
  | 'common.hooks.recentEditsLoadFailed'
  | 'common.hooks.releaseInfoFetchFailed'
  | 'common.hooks.sessionComparisonLoadFailed'
  | 'common.hooks.updateCheckFailed'
  | 'common.hooks.updateInstallFailed'
  | 'common.loading'
  | 'common.ok'
  | 'common.refresh'
  | 'common.restartApp'
  | 'common.retry'
  | 'common.save'
  | 'common.selectFolder'
  | 'common.settings.changeFolder'
  | 'common.settings.checking'
  | 'common.settings.checkUpdate'
  | 'common.settings.filter.showSystemMessages'
  | 'common.settings.filter.title'
  | 'common.settings.language.description'
  | 'common.settings.language.title'
  | 'common.settings.theme.dark'
  | 'common.settings.theme.light'
  | 'common.settings.theme.system'
  | 'common.settings.theme.title'
  | 'common.settings.title'
  | 'common.settings.updateSettings'
  | 'common.time.daysAgo'
  | 'common.time.duration'
  | 'common.time.end'
  | 'common.time.endTime'
  | 'common.time.hoursAgo'
  | 'common.time.justNow'
  | 'common.time.minutesAgo'
  | 'common.time.sessionTime'
  | 'common.time.start'
  | 'common.time.startTime'
  | 'common.update.available'
  | 'common.update.changes'
  | 'common.update.current'
  | 'common.update.deadline'
  | 'common.update.deadline_plural'
  | 'common.update.download'
  | 'common.update.later'
  | 'common.update.now'
  | 'common.update.skip'
  | 'common.update.upToDate'
  | 'common.view'
  | 'analytics.aboveAverage'
  | 'analytics.activeTime'
  | 'analytics.activityHeatmap'
  | 'analytics.activityHeatmapTitle'
  | 'analytics.activityPeriod'
  | 'analytics.activityTooltip'
  | 'analytics.Analytics Dashboard'
  | 'analytics.andMoreSessions'
  | 'analytics.remaining'
  | 'analytics.showMoreSessions'
  | 'analytics.Avg Session Time'
  | 'analytics.avgSession'
  | 'analytics.avgSessionTime'
  | 'analytics.avgTokensPerMessage'
  | 'analytics.belowAverage'
  | 'analytics.Cache Creation'
  | 'analytics.Cache Read'
  | 'analytics.cacheCreation'
  | 'analytics.cacheRead'
  | 'analytics.count'
  | 'analytics.currentSession'
  | 'analytics.currentSessionTokens'
  | 'analytics.dailyActivity'
  | 'analytics.dailyAvgMessages'
  | 'analytics.dailyAvgTokens'
  | 'analytics.dashboard'
  | 'analytics.days'
  | 'analytics.daysSpan'
  | 'analytics.duration'
  | 'analytics.durationMinutes'
  | 'analytics.endTime'
  | 'analytics.firstMessage'
  | 'analytics.globalOverview'
  | 'analytics.globalOverviewDescription'
  | 'analytics.heatmapTooltip'
  | 'analytics.highActivity'
  | 'analytics.hourSuffix'
  | 'analytics.input'
  | 'analytics.Input'
  | 'analytics.inputTokens'
  | 'analytics.lastMessage'
  | 'analytics.legend.less'
  | 'analytics.legend.more'
  | 'analytics.Less'
  | 'analytics.loading'
  | 'analytics.loadingGlobalStats'
  | 'analytics.loadingGlobalStatsDescription'
  | 'analytics.messages'
  | 'analytics.min'
  | 'analytics.minutesUnit'
  | 'analytics.modelDistribution'
  | 'analytics.More'
  | 'analytics.mostUsedTools'
  | 'analytics.mostUsedToolsTitle'
  | 'analytics.No activity data available'
  | 'analytics.No tool usage data available'
  | 'analytics.noActivity'
  | 'analytics.noData'
  | 'analytics.noDataAvailable'
  | 'analytics.noSessions'
  | 'analytics.noTokenData'
  | 'analytics.output'
  | 'analytics.Output'
  | 'analytics.outputTokens'
  | 'analytics.performanceInsights'
  | 'analytics.projectOverallAnalysis'
  | 'analytics.projectOverview'
  | 'analytics.projectSessionAnalysis'
  | 'analytics.projectShare'
  | 'analytics.projectStats'
  | 'analytics.projectTokens'
  | 'analytics.rank'
  | 'analytics.recentActivity'
  | 'analytics.recentActivityTrend'
  | 'analytics.select'
  | 'analytics.Select a project to view analytics'
  | 'analytics.selectSessionOrLoad'
  | 'analytics.Session Analysis'
  | 'analytics.sessionCount'
  | 'analytics.sessionDetails'
  | 'analytics.sessionId'
  | 'analytics.sessionIdLabel'
  | 'analytics.sessionNumber'
  | 'analytics.sessionOverview'
  | 'analytics.sessionRank'
  | 'analytics.sessionStatsDetail'
  | 'analytics.sessionsUnit'
  | 'analytics.sessionTime'
  | 'analytics.sessionTimeline'
  | 'analytics.startTime'
  | 'analytics.successRate'
  | 'analytics.today'
  | 'analytics.tokenAnalysis'
  | 'analytics.tokenDistribution'
  | 'analytics.tokenDistributionByType'
  | 'analytics.tokenRank'
  | 'analytics.tokens'
  | 'analytics.tokensPerMessage'
  | 'analytics.tokenTypeDistribution'
  | 'analytics.tokenUsage'
  | 'analytics.tokenUsageDetailed'
  | 'analytics.Tools Used'
  | 'analytics.toolsUsed'
  | 'analytics.tooltipMessages'
  | 'analytics.tooltipSessions'
  | 'analytics.tooltipTokens'
  | 'analytics.toolUsageCount'
  | 'analytics.toolUsageError'
  | 'analytics.toolUsageName'
  | 'analytics.toolUsagePercent'
  | 'analytics.toolUsageRank'
  | 'analytics.toolUsageRate'
  | 'analytics.toolUsageStats'
  | 'analytics.toolUsageTime'
  | 'analytics.topPercent'
  | 'analytics.topProjects'
  | 'analytics.totalLabel'
  | 'analytics.totalMessages'
  | 'analytics.totalMessagesCount'
  | 'analytics.totalProjects'
  | 'analytics.totalSessions'
  | 'analytics.totalSessionTime'
  | 'analytics.totalTokens'
  | 'analytics.totalTokensUsage'
  | 'analytics.totalTokenUsage'
  | 'analytics.totalTokenUsageLabel'
  | 'analytics.totalUses'
  | 'analytics.units'
  | 'analytics.viewDetails'
  | 'analytics.weekdayNames'
  | 'analytics.weekend'
  | 'analytics.weeklyActiveDays'
  | 'analytics.weeklyActivity'
  | 'session.actualId'
  | 'session.count'
  | 'session.id'
  | 'session.loading'
  | 'session.refresh'
  | 'session.scanning'
  | 'session.select'
  | 'session.selectDescription'
  | 'session.summaryNotFound'
  | 'session.title'
  | 'project.count'
  | 'project.globalStats'
  | 'project.globalStatsDescription'
  | 'project.notFound'
  | 'project.selectToView'
  | 'project.title'
  | 'message.allLoaded'
  | 'message.branch'
  | 'message.checkConsole'
  | 'message.claude'
  | 'message.conversation'
  | 'message.copy'
  | 'message.count'
  | 'message.count_plural'
  | 'message.countWithTotal'
  | 'message.loading'
  | 'message.loadMore'
  | 'message.loadMore_plural'
  | 'message.none'
  | 'message.previous'
  | 'message.renderError'
  | 'message.reply'
  | 'message.scrollToBottom'
  | 'message.system'
  | 'message.user'
  | 'message.view'
  | 'messageViewer.allMessagesLoaded'
  | 'messageViewer.branch'
  | 'messageViewer.checkConsole'
  | 'messageViewer.claude'
  | 'messageViewer.debugInfo.file'
  | 'messageViewer.debugInfo.firstMessage'
  | 'messageViewer.debugInfo.hasMore'
  | 'messageViewer.debugInfo.lastMessage'
  | 'messageViewer.debugInfo.loading'
  | 'messageViewer.debugInfo.messages'
  | 'messageViewer.debugInfo.offset'
  | 'messageViewer.debugInfo.session'
  | 'messageViewer.filterContent'
  | 'messageViewer.filterToolId'
  | 'messageViewer.filterType'
  | 'messageViewer.hasErrors'
  | 'messageViewer.loadingMessages'
  | 'messageViewer.loadingPreviousMessages'
  | 'messageViewer.loadMoreMessages'
  | 'messageViewer.messagesShort'
  | 'messageViewer.noMessages'
  | 'messageViewer.noMessagesDescription'
  | 'messageViewer.noSearchResults'
  | 'messageViewer.priorContext'
  | 'messageViewer.refresh'
  | 'messageViewer.renderError'
  | 'messageViewer.reply'
  | 'messageViewer.scrollToBottom'
  | 'messageViewer.scrollToTop'
  | 'messageViewer.searching'
  | 'messageViewer.searchPlaceholder'
  | 'messageViewer.searchResults'
  | 'messageViewer.system'
  | 'messageViewer.time'
  | 'messageViewer.toolsUsed'
  | 'messageViewer.tryDifferentKeyword'
  | 'messageViewer.user'
  | 'tools.addedCode'
  | 'tools.browseDirectory'
  | 'tools.createdContent'
  | 'tools.createFile'
  | 'tools.currentStatus'
  | 'tools.detailedInstructions'
  | 'tools.editFile'
  | 'tools.errorOccurred'
  | 'tools.executeTask'
  | 'tools.exitPlanMode'
  | 'tools.fileCreate'
  | 'tools.fileEdit'
  | 'tools.findFiles'
  | 'tools.generalConversation'
  | 'tools.inputParameters'
  | 'tools.multiEdit'
  | 'tools.notebookEdit'
  | 'tools.notebookRead'
  | 'tools.readFile'
  | 'tools.removedCode'
  | 'tools.searchText'
  | 'tools.taskDescription'
  | 'tools.terminal'
  | 'tools.todoRead'
  | 'tools.todoUpdate'
  | 'tools.todoWrite'
  | 'tools.toolUsed'
  | 'tools.webFetch'
  | 'tools.webSearch'
  | 'toolResult.collapse'
  | 'toolResult.completed'
  | 'toolResult.copyCode'
  | 'toolResult.copyPath'
  | 'toolResult.copyResult'
  | 'toolResult.error'
  | 'toolResult.executionComplete'
  | 'toolResult.executionStatus'
  | 'toolResult.expand'
  | 'toolResult.file'
  | 'toolResult.fileContent'
  | 'toolResult.fileSearchResult'
  | 'toolResult.fileStructure'
  | 'toolResult.imageResult'
  | 'toolResult.included'
  | 'toolResult.interrupted'
  | 'toolResult.lines'
  | 'toolResult.none'
  | 'toolResult.noOutput'
  | 'toolResult.output'
  | 'toolResult.showMore'
  | 'toolResult.toolExecutionResult'
  | 'toolUseRenderer.createdContent'
  | 'toolUseRenderer.detailedInstructions'
  | 'toolUseRenderer.fileCreation'
  | 'toolUseRenderer.task'
  | 'toolUseRenderer.taskDescription'
  | 'toolUseRenderer.toolInputParameters'
  | 'error.apologize'
  | 'error.copied'
  | 'error.copyErrorInfo'
  | 'error.copyTemplate.browserInfo'
  | 'error.copyTemplate.componentStack'
  | 'error.copyTemplate.errorMessage'
  | 'error.copyTemplate.errorStack'
  | 'error.copyTemplate.header'
  | 'error.copyTemplate.separator'
  | 'error.copyTemplate.timestamp'
  | 'error.emailTemplate.additionalInfo'
  | 'error.emailTemplate.description'
  | 'error.emailTemplate.greeting'
  | 'error.emailTemplate.isRepeating'
  | 'error.emailTemplate.otherNotes'
  | 'error.emailTemplate.placeholder'
  | 'error.emailTemplate.subject'
  | 'error.emailTemplate.thanks'
  | 'error.emailTemplate.whatWereDoing'
  | 'error.errorInfo'
  | 'error.reportDescription'
  | 'error.reportError'
  | 'error.restartApp'
  | 'error.toolExecutionError'
  | 'error.troubleshooting'
  | 'error.troubleshootingSteps.reportPersistent'
  | 'error.troubleshootingSteps.restart'
  | 'error.troubleshootingSteps.tryOtherProject'
  | 'error.troubleshootingSteps.updateVersion'
  | 'error.unexpectedError'
  | 'error.viewDetails'
  | 'status.checking'
  | 'status.initializing'
  | 'status.loadingMessages'
  | 'status.loadingSessions'
  | 'status.loadingStats'
  | 'status.scanning'
  | 'updateModal.currentToNew'
  | 'updateModal.downloading'
  | 'updateModal.downloadProgress'
  | 'updateModal.downloadUpdate'
  | 'updateModal.installing'
  | 'updateModal.majorChanges'
  | 'updateModal.newVersionAvailable'
  | 'updateModal.postpone'
  | 'updateModal.readyToInstall'
  | 'updateModal.skipThisVersion'
  | 'updateModal.updateAvailable'
  | 'updateModal.updateDeadline'
  | 'updateModal.updateNow'
  | 'updateModal.viewOnGitHub'
  | 'updateSettingsModal.allowCriticalUpdates'
  | 'updateSettingsModal.autoCheck'
  | 'updateSettingsModal.cacheCleared'
  | 'updateSettingsModal.checking'
  | 'updateSettingsModal.checkInterval'
  | 'updateSettingsModal.checkNow'
  | 'updateSettingsModal.clearAll'
  | 'updateSettingsModal.clearCache'
  | 'updateSettingsModal.close'
  | 'updateSettingsModal.intervalDaily'
  | 'updateSettingsModal.intervalStartup'
  | 'updateSettingsModal.intervalWeekly'
  | 'updateSettingsModal.respectOfflineStatus'
  | 'updateSettingsModal.save'
  | 'updateSettingsModal.skippedVersions'
  | 'updateSettingsModal.title'
  | 'updateIntroModal.benefits1'
  | 'updateIntroModal.benefits2'
  | 'updateIntroModal.benefits3'
  | 'updateIntroModal.benefits4'
  | 'updateIntroModal.benefitsTitle'
  | 'updateIntroModal.description'
  | 'updateIntroModal.disableAutoCheck'
  | 'updateIntroModal.howItWorks1'
  | 'updateIntroModal.howItWorks2'
  | 'updateIntroModal.howItWorks3'
  | 'updateIntroModal.howItWorks4'
  | 'updateIntroModal.howItWorksTitle'
  | 'updateIntroModal.tip'
  | 'updateIntroModal.title'
  | 'updateIntroModal.understood'
  | 'feedback.appVersion'
  | 'feedback.architecture'
  | 'feedback.close'
  | 'feedback.content'
  | 'feedback.contentRequired'
  | 'feedback.includeSystemInfo'
  | 'feedback.openGitHub'
  | 'feedback.openGitHubError'
  | 'feedback.os'
  | 'feedback.placeholders.bug'
  | 'feedback.placeholders.default'
  | 'feedback.placeholders.feature'
  | 'feedback.preview'
  | 'feedback.sendEmail'
  | 'feedback.sendError'
  | 'feedback.sendingEmail'
  | 'feedback.subject'
  | 'feedback.subjectPlaceholder'
  | 'feedback.subjectRequired'
  | 'feedback.systemInfoError'
  | 'feedback.systemInfoPreview'
  | 'feedback.tipBugReport'
  | 'feedback.tipFeatureRequest'
  | 'feedback.tips'
  | 'feedback.tipScreenshot'
  | 'feedback.title'
  | 'feedback.type'
  | 'feedback.types.bug'
  | 'feedback.types.feature'
  | 'feedback.types.improvement'
  | 'feedback.types.other'
  | 'time.day'
  | 'time.days'
  | 'time.end'
  | 'time.hour'
  | 'time.hours'
  | 'time.lessThanMinute'
  | 'time.minute'
  | 'time.minutes'
  | 'time.start'
  | 'folderPicker.backButton'
  | 'folderPicker.change'
  | 'folderPicker.folderSelectError'
  | 'folderPicker.folderSelectErrorDetails'
  | 'folderPicker.help'
  | 'folderPicker.helpDetails'
  | 'folderPicker.homeNotFound'
  | 'folderPicker.invalidFolder'
  | 'folderPicker.newFolder'
  | 'folderPicker.notFound'
  | 'folderPicker.select'
  | 'folderPicker.selectButton'
  | 'folderPicker.selectedPath'
  | 'folderPicker.selectFolderTitle'
  | 'folderPicker.validating'
  | 'folderPicker.validationError'
  | 'diffViewer.advancedAnalysis'
  | 'diffViewer.advancedTextAnalysis'
  | 'diffViewer.after'
  | 'diffViewer.before'
  | 'diffViewer.changes'
  | 'diffViewer.copyAfterCode'
  | 'diffViewer.split'
  | 'diffViewer.switchToSplit'
  | 'diffViewer.switchToUnified'
  | 'diffViewer.unified'
  | 'diffViewer.visualView'
  | 'advancedTextDiff.added'
  | 'advancedTextDiff.additions'
  | 'advancedTextDiff.changeSummary'
  | 'advancedTextDiff.collapse'
  | 'advancedTextDiff.comparisonMethod'
  | 'advancedTextDiff.deletions'
  | 'advancedTextDiff.expand'
  | 'advancedTextDiff.manyChanges'
  | 'advancedTextDiff.modes.chars'
  | 'advancedTextDiff.modes.lines'
  | 'advancedTextDiff.modes.sentences'
  | 'advancedTextDiff.modes.trimmedLines'
  | 'advancedTextDiff.modes.words'
  | 'advancedTextDiff.modes.wordsWithSpace'
  | 'advancedTextDiff.removed'
  | 'advancedTextDiff.same'
  | 'advancedTextDiff.textChanges'
  | 'advancedTextDiff.unchanged'
  | 'structuredPatch.areasChanged'
  | 'structuredPatch.changeStats'
  | 'structuredPatch.fileChanges'
  | 'structuredPatch.filePath'
  | 'structuredPatch.updatedFile'
  | 'structuredPatch.updatedFileContent'
  | 'contentArray.cacheCreation'
  | 'contentArray.cacheRead'
  | 'contentArray.claudeApiResponse'
  | 'contentArray.completed'
  | 'contentArray.content'
  | 'contentArray.executionTime'
  | 'contentArray.input'
  | 'contentArray.interrupted'
  | 'contentArray.interruptionStatus'
  | 'contentArray.output'
  | 'contentArray.seconds'
  | 'contentArray.tokenUsage'
  | 'contentArray.toolUseCount'
  | 'contentArray.totalTokens'
  | 'contentArray.type'
  | 'contentArray.typeUnknown'
  | 'fileContent.collapse'
  | 'fileContent.content'
  | 'fileContent.copyFileContent'
  | 'fileContent.expand'
  | 'fileContent.filePath'
  | 'fileContent.lines'
  | 'fileContent.showingLines'
  | 'fileContent.showMoreLines'
  | 'fileContent.startLine'
  | 'fileEditRenderer.copyChangedResult'
  | 'fileEditRenderer.copyFileAfterChange'
  | 'fileEditRenderer.copyOriginalFile'
  | 'fileEditRenderer.editType'
  | 'fileEditRenderer.fileEditResult'
  | 'fileEditRenderer.filePath'
  | 'fileEditRenderer.fullReplace'
  | 'fileEditRenderer.no'
  | 'fileEditRenderer.originalFileContent'
  | 'fileEditRenderer.partialReplace'
  | 'fileEditRenderer.userModified'
  | 'fileEditRenderer.yes'
  | 'messageContentDisplay.copyMessage'
  | 'messageContentDisplay.showLess'
  | 'messageContentDisplay.showMore'
  | 'codebaseContextRenderer.analyzedFiles'
  | 'codebaseContextRenderer.andMoreFiles'
  | 'codebaseContextRenderer.codebaseContext'
  | 'codebaseContextRenderer.contextWindow'
  | 'codebaseContextRenderer.filesCount'
  | 'codebaseContextRenderer.relevantFiles'
  | 'fileListRenderer.fileList'
  | 'mcpRenderer.error'
  | 'mcpRenderer.executionResult'
  | 'mcpRenderer.mcpToolCall'
  | 'mcpRenderer.parameters'
  | 'gitWorkflowRenderer.changedFiles'
  | 'gitWorkflowRenderer.gitWorkflow'
  | 'gitWorkflowRenderer.status'
  | 'gitWorkflowRenderer.viewDiff'
  | 'assistantMessageDetails.cacheCreation'
  | 'assistantMessageDetails.cacheRead'
  | 'assistantMessageDetails.input'
  | 'assistantMessageDetails.model'
  | 'assistantMessageDetails.output'
  | 'assistantMessageDetails.tier'
  | 'assistantMessageDetails.tokenUsage'
  | 'claudeSessionHistoryRenderer.claude'
  | 'claudeSessionHistoryRenderer.messageCount'
  | 'claudeSessionHistoryRenderer.model'
  | 'claudeSessionHistoryRenderer.noContent'
  | 'claudeSessionHistoryRenderer.noValidMessages'
  | 'claudeSessionHistoryRenderer.parsingError'
  | 'claudeSessionHistoryRenderer.parsingErrorDescription'
  | 'claudeSessionHistoryRenderer.title'
  | 'claudeSessionHistoryRenderer.tokenUsage'
  | 'claudeSessionHistoryRenderer.user'
  | 'claudeSessionHistoryRenderer.viewOriginalData'
  | 'terminalStreamRenderer.exitCode'
  | 'terminalStreamRenderer.title'
  | 'webSearchRenderer.duration'
  | 'webSearchRenderer.query'
  | 'webSearchRenderer.results'
  | 'webSearchRenderer.seconds'
  | 'webSearchRenderer.title'
  | 'webSearchRenderer.unknownResultFormat'
  | 'thinkingRenderer.title'
  | 'copyButton.copied'
  | 'copyButton.copy'
  | 'copyButton.copying'
  | 'copyButton.error'
  | 'imageRenderer.cannotLoadImage'
  | 'imageRenderer.close'
  | 'imageRenderer.downloadImage'
  | 'imageRenderer.image'
  | 'imageRenderer.viewFullscreen'
  | 'upToDateNotification.currentVersionLatest'
  | 'upToDateNotification.upToDate'
  | 'commandRenderer.arguments'
  | 'commandRenderer.command'
  | 'commandRenderer.commandExecution'
  | 'commandRenderer.errorOutput'
  | 'commandRenderer.executionResult'
  | 'commandRenderer.status'
  | 'commandRenderer.systemNote'
  | 'commandRenderer.unknownContentType'
  | 'taskNotification.agentTask'
  | 'taskNotification.agentTasks'
  | 'taskNotification.details'
  | 'taskNotification.result'
  | 'taskNotification.showMore'
  | 'taskNotification.status.completed'
  | 'taskNotification.status.failed'
  | 'taskNotification.status.running'
  | 'taskNotification.summary'
  | 'recentEdits.cancel'
  | 'recentEdits.confirmRestore'
  | 'recentEdits.confirmRestoreMessage'
  | 'recentEdits.confirmRestoreTitle'
  | 'recentEdits.copyContent'
  | 'recentEdits.created'
  | 'recentEdits.description'
  | 'recentEdits.edited'
  | 'recentEdits.footerInfo'
  | 'recentEdits.lines'
  | 'recentEdits.loading'
  | 'recentEdits.noEdits'
  | 'recentEdits.noEditsDescription'
  | 'recentEdits.noSearchResults'
  | 'recentEdits.restoreError'
  | 'recentEdits.restoreFile'
  | 'recentEdits.searchPlaceholder'
  | 'recentEdits.stats'
  | 'recentEdits.title'
  | 'recentEdits.showMore'
  | 'messages.hasMore'
  | 'messages.messageInfo'
  | 'messages.noMessages'
  | 'messages.offset'
  | 'messages.tokenStats.existing'
  | 'messages.tokenStats.title'
  | 'agentProgressGroup.agent'
  | 'agentProgressGroup.steps'
  | 'agentTaskGroup.agent'
  | 'agentTaskGroup.completed'
  | 'agentTaskGroup.copyPath'
  | 'agentTaskGroup.parallelTasks'
  | 'agentTaskGroup.prompt'
  | 'agentTaskGroup.transcript'
  | 'bashCodeExecutionToolResultRenderer.error'
  | 'bashCodeExecutionToolResultRenderer.noOutput'
  | 'bashCodeExecutionToolResultRenderer.title'
  | 'claudeToolUseDisplay.unknownTool'
  | 'codeExecutionToolResultRenderer.error'
  | 'codeExecutionToolResultRenderer.noOutput'
  | 'codeExecutionToolResultRenderer.title'
  | 'collapsibleToolResult.editsCount'
  | 'collapsibleToolResult.noOutput'
  | 'collapsibleToolResult.result'
  | 'collapsibleToolResult.terminalOutput'
  | 'collapsibleToolResult.todoListUpdated'
  | 'fileHistorySnapshotRenderer.files'
  | 'fileHistorySnapshotRenderer.noFiles'
  | 'fileHistorySnapshotRenderer.snapshot'
  | 'fileHistorySnapshotRenderer.trackedFiles'
  | 'fileHistorySnapshotRenderer.update'
  | 'progressRenderer.status.completed'
  | 'progressRenderer.status.error'
  | 'progressRenderer.status.running'
  | 'progressRenderer.status.started'
  | 'progressRenderer.types.agent'
  | 'progressRenderer.types.bash'
  | 'progressRenderer.types.hook'
  | 'progressRenderer.types.mcp'
  | 'progressRenderer.types.query'
  | 'progressRenderer.types.search'
  | 'progressRenderer.types.waiting'
  | 'queueOperationRenderer.descriptions.dequeue'
  | 'queueOperationRenderer.descriptions.enqueue'
  | 'queueOperationRenderer.descriptions.popAll'
  | 'queueOperationRenderer.descriptions.remove'
  | 'queueOperationRenderer.operations.dequeue'
  | 'queueOperationRenderer.operations.enqueue'
  | 'queueOperationRenderer.operations.popAll'
  | 'queueOperationRenderer.operations.remove'
  | 'queueOperationRenderer.title'
  | 'simpleUpdateModal.changes'
  | 'simpleUpdateModal.close'
  | 'simpleUpdateModal.currentVersion'
  | 'simpleUpdateModal.downloadAndInstall'
  | 'simpleUpdateModal.downloading'
  | 'simpleUpdateModal.downloadingShort'
  | 'simpleUpdateModal.errorOccurred'
  | 'simpleUpdateModal.hideDetails'
  | 'simpleUpdateModal.important'
  | 'simpleUpdateModal.installing'
  | 'simpleUpdateModal.installingShort'
  | 'simpleUpdateModal.newUpdateAvailable'
  | 'simpleUpdateModal.newVersion'
  | 'simpleUpdateModal.releaseName'
  | 'simpleUpdateModal.remindLater'
  | 'simpleUpdateModal.showDetails'
  | 'simpleUpdateModal.skipVersion'
  | 'simpleUpdateModal.viewOnGitHub'
  | 'summaryMessageRenderer.title'
  | 'systemMessageRenderer.empty'
  | 'systemMessageRenderer.hooks'
  | 'systemMessageRenderer.prevented'
  | 'systemMessageRenderer.subtypes.compactBoundary'
  | 'systemMessageRenderer.subtypes.localCommand'
  | 'systemMessageRenderer.subtypes.microcompactBoundary'
  | 'systemMessageRenderer.subtypes.stopHook'
  | 'systemMessageRenderer.subtypes.turnDuration'
  | 'systemMessageRenderer.title'
  | 'systemMessageRenderer.trigger'
  | 'textEditorCodeExecutionToolResultRenderer.create'
  | 'textEditorCodeExecutionToolResultRenderer.delete'
  | 'textEditorCodeExecutionToolResultRenderer.edit'
  | 'textEditorCodeExecutionToolResultRenderer.error'
  | 'textEditorCodeExecutionToolResultRenderer.showContent'
  | 'textEditorCodeExecutionToolResultRenderer.view'
  | 'toolSearchToolResultRenderer.error'
  | 'toolSearchToolResultRenderer.found'
  | 'toolSearchToolResultRenderer.noResults'
  | 'toolSearchToolResultRenderer.title'
  | 'webFetchToolResultRenderer.error'
  | 'webFetchToolResultRenderer.retrievedAt'
  | 'webFetchToolResultRenderer.showContent'
  | 'webFetchToolResultRenderer.title'
  | 'citationRenderer.charLocation'
  | 'citationRenderer.singlePage'
  | 'citationRenderer.pageRange'
  | 'citationRenderer.blockLocation'
  | 'citationRenderer.title'
  | 'claudeContentArrayRenderer.systemReminder'
  | 'claudeContentArrayRenderer.unknownContentType'
  | 'commandOutputDisplay.jsonOutput'
  | 'commandOutputDisplay.testResults'
  | 'commandOutputDisplay.buildOutput'
  | 'commandOutputDisplay.packageManagement'
  | 'commandOutputDisplay.tableOutput'
  | 'commandOutputDisplay.terminalOutput'
  | 'common.noDataAvailable';

/**
 * 사용 가능한 접두사 목록
 */
export type TranslationPrefix =
  | 'advancedTextDiff'
  | 'agentProgressGroup'
  | 'agentTaskGroup'
  | 'analytics'
  | 'assistantMessageDetails'
  | 'bashCodeExecutionToolResultRenderer'
  | 'citationRenderer'
  | 'claudeContentArrayRenderer'
  | 'claudeSessionHistoryRenderer'
  | 'claudeToolUseDisplay'
  | 'codeExecutionToolResultRenderer'
  | 'codebaseContextRenderer'
  | 'collapsibleToolResult'
  | 'commandOutputDisplay'
  | 'commandRenderer'
  | 'common'
  | 'contentArray'
  | 'copyButton'
  | 'diffViewer'
  | 'error'
  | 'feedback'
  | 'fileContent'
  | 'fileEditRenderer'
  | 'fileHistorySnapshotRenderer'
  | 'fileListRenderer'
  | 'folderPicker'
  | 'gitWorkflowRenderer'
  | 'imageRenderer'
  | 'mcpRenderer'
  | 'message'
  | 'messageContentDisplay'
  | 'messageViewer'
  | 'messages'
  | 'progressRenderer'
  | 'project'
  | 'queueOperationRenderer'
  | 'recentEdits'
  | 'session'
  | 'simpleUpdateModal'
  | 'status'
  | 'structuredPatch'
  | 'summaryMessageRenderer'
  | 'systemMessageRenderer'
  | 'taskNotification'
  | 'terminalStreamRenderer'
  | 'textEditorCodeExecutionToolResultRenderer'
  | 'thinkingRenderer'
  | 'time'
  | 'toolResult'
  | 'toolSearchToolResultRenderer'
  | 'toolUseRenderer'
  | 'tools'
  | 'upToDateNotification'
  | 'updateIntroModal'
  | 'updateModal'
  | 'updateSettingsModal'
  | 'webFetchToolResultRenderer'
  | 'webSearchRenderer';

/**
 * common 네임스페이스 키
 */
export type CommonKeys =
  | 'appDescription'
  | 'appName'
  | 'back'
  | 'cancel'
  | 'close'
  | 'copied'
  | 'copy'
  | 'delete'
  | 'edit'
  | 'error.copyError'
  | 'error.info'
  | 'error.report'
  | 'error.showDetails'
  | 'error.solution'
  | 'error.sorry'
  | 'error.unexpected'
  | 'error.updateCheckFailed'
  | 'error.updateInstallFailed'
  | 'errorOccurred'
  | 'help'
  | 'hooks.githubApiError'
  | 'hooks.noProjectSelected'
  | 'hooks.projectSummaryLoadFailed'
  | 'hooks.recentEditsLoadFailed'
  | 'hooks.releaseInfoFetchFailed'
  | 'hooks.sessionComparisonLoadFailed'
  | 'hooks.updateCheckFailed'
  | 'hooks.updateInstallFailed'
  | 'loading'
  | 'ok'
  | 'refresh'
  | 'restartApp'
  | 'retry'
  | 'save'
  | 'selectFolder'
  | 'settings.changeFolder'
  | 'settings.checking'
  | 'settings.checkUpdate'
  | 'settings.filter.showSystemMessages'
  | 'settings.filter.title'
  | 'settings.language.description'
  | 'settings.language.title'
  | 'settings.theme.dark'
  | 'settings.theme.light'
  | 'settings.theme.system'
  | 'settings.theme.title'
  | 'settings.title'
  | 'settings.updateSettings'
  | 'time.daysAgo'
  | 'time.duration'
  | 'time.end'
  | 'time.endTime'
  | 'time.hoursAgo'
  | 'time.justNow'
  | 'time.minutesAgo'
  | 'time.sessionTime'
  | 'time.start'
  | 'time.startTime'
  | 'update.available'
  | 'update.changes'
  | 'update.current'
  | 'update.deadline'
  | 'update.deadline_plural'
  | 'update.download'
  | 'update.later'
  | 'update.now'
  | 'update.skip'
  | 'update.upToDate'
  | 'view'
  | 'noDataAvailable';

/**
 * analytics 네임스페이스 키
 */
export type AnalyticsKeys =
  | 'aboveAverage'
  | 'activeTime'
  | 'activityHeatmap'
  | 'activityHeatmapTitle'
  | 'activityPeriod'
  | 'activityTooltip'
  | 'Analytics Dashboard'
  | 'andMoreSessions'
  | 'remaining'
  | 'showMoreSessions'
  | 'Avg Session Time'
  | 'avgSession'
  | 'avgSessionTime'
  | 'avgTokensPerMessage'
  | 'belowAverage'
  | 'Cache Creation'
  | 'Cache Read'
  | 'cacheCreation'
  | 'cacheRead'
  | 'count'
  | 'currentSession'
  | 'currentSessionTokens'
  | 'dailyActivity'
  | 'dailyAvgMessages'
  | 'dailyAvgTokens'
  | 'dashboard'
  | 'days'
  | 'daysSpan'
  | 'duration'
  | 'durationMinutes'
  | 'endTime'
  | 'firstMessage'
  | 'globalOverview'
  | 'globalOverviewDescription'
  | 'heatmapTooltip'
  | 'highActivity'
  | 'hourSuffix'
  | 'input'
  | 'Input'
  | 'inputTokens'
  | 'lastMessage'
  | 'legend.less'
  | 'legend.more'
  | 'Less'
  | 'loading'
  | 'loadingGlobalStats'
  | 'loadingGlobalStatsDescription'
  | 'messages'
  | 'min'
  | 'minutesUnit'
  | 'modelDistribution'
  | 'More'
  | 'mostUsedTools'
  | 'mostUsedToolsTitle'
  | 'No activity data available'
  | 'No tool usage data available'
  | 'noActivity'
  | 'noData'
  | 'noDataAvailable'
  | 'noSessions'
  | 'noTokenData'
  | 'output'
  | 'Output'
  | 'outputTokens'
  | 'performanceInsights'
  | 'projectOverallAnalysis'
  | 'projectOverview'
  | 'projectSessionAnalysis'
  | 'projectShare'
  | 'projectStats'
  | 'projectTokens'
  | 'rank'
  | 'recentActivity'
  | 'recentActivityTrend'
  | 'select'
  | 'Select a project to view analytics'
  | 'selectSessionOrLoad'
  | 'Session Analysis'
  | 'sessionCount'
  | 'sessionDetails'
  | 'sessionId'
  | 'sessionIdLabel'
  | 'sessionNumber'
  | 'sessionOverview'
  | 'sessionRank'
  | 'sessionStatsDetail'
  | 'sessionsUnit'
  | 'sessionTime'
  | 'sessionTimeline'
  | 'startTime'
  | 'successRate'
  | 'today'
  | 'tokenAnalysis'
  | 'tokenDistribution'
  | 'tokenDistributionByType'
  | 'tokenRank'
  | 'tokens'
  | 'tokensPerMessage'
  | 'tokenTypeDistribution'
  | 'tokenUsage'
  | 'tokenUsageDetailed'
  | 'Tools Used'
  | 'toolsUsed'
  | 'tooltipMessages'
  | 'tooltipSessions'
  | 'tooltipTokens'
  | 'toolUsageCount'
  | 'toolUsageError'
  | 'toolUsageName'
  | 'toolUsagePercent'
  | 'toolUsageRank'
  | 'toolUsageRate'
  | 'toolUsageStats'
  | 'toolUsageTime'
  | 'topPercent'
  | 'topProjects'
  | 'totalLabel'
  | 'totalMessages'
  | 'totalMessagesCount'
  | 'totalProjects'
  | 'totalSessions'
  | 'totalSessionTime'
  | 'totalTokens'
  | 'totalTokensUsage'
  | 'totalTokenUsage'
  | 'totalTokenUsageLabel'
  | 'totalUses'
  | 'units'
  | 'viewDetails'
  | 'weekdayNames'
  | 'weekend'
  | 'weeklyActiveDays'
  | 'weeklyActivity';

/**
 * session 네임스페이스 키
 */
export type SessionKeys =
  | 'actualId'
  | 'count'
  | 'id'
  | 'loading'
  | 'refresh'
  | 'scanning'
  | 'select'
  | 'selectDescription'
  | 'summaryNotFound'
  | 'title';

/**
 * project 네임스페이스 키
 */
export type ProjectKeys =
  | 'count'
  | 'globalStats'
  | 'globalStatsDescription'
  | 'notFound'
  | 'selectToView'
  | 'title';

/**
 * message 네임스페이스 키
 */
export type MessageKeys =
  | 'allLoaded'
  | 'branch'
  | 'checkConsole'
  | 'claude'
  | 'conversation'
  | 'copy'
  | 'count'
  | 'count_plural'
  | 'countWithTotal'
  | 'loading'
  | 'loadMore'
  | 'loadMore_plural'
  | 'none'
  | 'previous'
  | 'renderError'
  | 'reply'
  | 'scrollToBottom'
  | 'system'
  | 'user'
  | 'view';

/**
 * messageViewer 네임스페이스 키
 */
export type MessageViewerKeys =
  | 'allMessagesLoaded'
  | 'branch'
  | 'checkConsole'
  | 'claude'
  | 'debugInfo.file'
  | 'debugInfo.firstMessage'
  | 'debugInfo.hasMore'
  | 'debugInfo.lastMessage'
  | 'debugInfo.loading'
  | 'debugInfo.messages'
  | 'debugInfo.offset'
  | 'debugInfo.session'
  | 'filterContent'
  | 'filterToolId'
  | 'filterType'
  | 'hasErrors'
  | 'loadingMessages'
  | 'loadingPreviousMessages'
  | 'loadMoreMessages'
  | 'messagesShort'
  | 'noMessages'
  | 'noMessagesDescription'
  | 'noSearchResults'
  | 'priorContext'
  | 'refresh'
  | 'renderError'
  | 'reply'
  | 'scrollToBottom'
  | 'scrollToTop'
  | 'searching'
  | 'searchPlaceholder'
  | 'searchResults'
  | 'system'
  | 'time'
  | 'toolsUsed'
  | 'tryDifferentKeyword'
  | 'user';

/**
 * tools 네임스페이스 키
 */
export type ToolsKeys =
  | 'addedCode'
  | 'browseDirectory'
  | 'createdContent'
  | 'createFile'
  | 'currentStatus'
  | 'detailedInstructions'
  | 'editFile'
  | 'errorOccurred'
  | 'executeTask'
  | 'exitPlanMode'
  | 'fileCreate'
  | 'fileEdit'
  | 'findFiles'
  | 'generalConversation'
  | 'inputParameters'
  | 'multiEdit'
  | 'notebookEdit'
  | 'notebookRead'
  | 'readFile'
  | 'removedCode'
  | 'searchText'
  | 'taskDescription'
  | 'terminal'
  | 'todoRead'
  | 'todoUpdate'
  | 'todoWrite'
  | 'toolUsed'
  | 'webFetch'
  | 'webSearch';

/**
 * toolResult 네임스페이스 키
 */
export type ToolResultKeys =
  | 'collapse'
  | 'completed'
  | 'copyCode'
  | 'copyPath'
  | 'copyResult'
  | 'error'
  | 'executionComplete'
  | 'executionStatus'
  | 'expand'
  | 'file'
  | 'fileContent'
  | 'fileSearchResult'
  | 'fileStructure'
  | 'imageResult'
  | 'included'
  | 'interrupted'
  | 'lines'
  | 'none'
  | 'noOutput'
  | 'output'
  | 'showMore'
  | 'toolExecutionResult';

/**
 * toolUseRenderer 네임스페이스 키
 */
export type ToolUseRendererKeys =
  | 'createdContent'
  | 'detailedInstructions'
  | 'fileCreation'
  | 'task'
  | 'taskDescription'
  | 'toolInputParameters';

/**
 * error 네임스페이스 키
 */
export type ErrorKeys =
  | 'apologize'
  | 'copied'
  | 'copyErrorInfo'
  | 'copyTemplate.browserInfo'
  | 'copyTemplate.componentStack'
  | 'copyTemplate.errorMessage'
  | 'copyTemplate.errorStack'
  | 'copyTemplate.header'
  | 'copyTemplate.separator'
  | 'copyTemplate.timestamp'
  | 'emailTemplate.additionalInfo'
  | 'emailTemplate.description'
  | 'emailTemplate.greeting'
  | 'emailTemplate.isRepeating'
  | 'emailTemplate.otherNotes'
  | 'emailTemplate.placeholder'
  | 'emailTemplate.subject'
  | 'emailTemplate.thanks'
  | 'emailTemplate.whatWereDoing'
  | 'errorInfo'
  | 'reportDescription'
  | 'reportError'
  | 'restartApp'
  | 'toolExecutionError'
  | 'troubleshooting'
  | 'troubleshootingSteps.reportPersistent'
  | 'troubleshootingSteps.restart'
  | 'troubleshootingSteps.tryOtherProject'
  | 'troubleshootingSteps.updateVersion'
  | 'unexpectedError'
  | 'viewDetails';

/**
 * status 네임스페이스 키
 */
export type StatusKeys =
  | 'checking'
  | 'initializing'
  | 'loadingMessages'
  | 'loadingSessions'
  | 'loadingStats'
  | 'scanning';

/**
 * updateModal 네임스페이스 키
 */
export type UpdateModalKeys =
  | 'currentToNew'
  | 'downloading'
  | 'downloadProgress'
  | 'downloadUpdate'
  | 'installing'
  | 'majorChanges'
  | 'newVersionAvailable'
  | 'postpone'
  | 'readyToInstall'
  | 'skipThisVersion'
  | 'updateAvailable'
  | 'updateDeadline'
  | 'updateNow'
  | 'viewOnGitHub';

/**
 * updateSettingsModal 네임스페이스 키
 */
export type UpdateSettingsModalKeys =
  | 'allowCriticalUpdates'
  | 'autoCheck'
  | 'cacheCleared'
  | 'checking'
  | 'checkInterval'
  | 'checkNow'
  | 'clearAll'
  | 'clearCache'
  | 'close'
  | 'intervalDaily'
  | 'intervalStartup'
  | 'intervalWeekly'
  | 'respectOfflineStatus'
  | 'save'
  | 'skippedVersions'
  | 'title';

/**
 * updateIntroModal 네임스페이스 키
 */
export type UpdateIntroModalKeys =
  | 'benefits1'
  | 'benefits2'
  | 'benefits3'
  | 'benefits4'
  | 'benefitsTitle'
  | 'description'
  | 'disableAutoCheck'
  | 'howItWorks1'
  | 'howItWorks2'
  | 'howItWorks3'
  | 'howItWorks4'
  | 'howItWorksTitle'
  | 'tip'
  | 'title'
  | 'understood';

/**
 * feedback 네임스페이스 키
 */
export type FeedbackKeys =
  | 'appVersion'
  | 'architecture'
  | 'close'
  | 'content'
  | 'contentRequired'
  | 'includeSystemInfo'
  | 'openGitHub'
  | 'openGitHubError'
  | 'os'
  | 'placeholders.bug'
  | 'placeholders.default'
  | 'placeholders.feature'
  | 'preview'
  | 'sendEmail'
  | 'sendError'
  | 'sendingEmail'
  | 'subject'
  | 'subjectPlaceholder'
  | 'subjectRequired'
  | 'systemInfoError'
  | 'systemInfoPreview'
  | 'tipBugReport'
  | 'tipFeatureRequest'
  | 'tips'
  | 'tipScreenshot'
  | 'title'
  | 'type'
  | 'types.bug'
  | 'types.feature'
  | 'types.improvement'
  | 'types.other';

/**
 * time 네임스페이스 키
 */
export type TimeKeys =
  | 'day'
  | 'days'
  | 'end'
  | 'hour'
  | 'hours'
  | 'lessThanMinute'
  | 'minute'
  | 'minutes'
  | 'start';

/**
 * folderPicker 네임스페이스 키
 */
export type FolderPickerKeys =
  | 'backButton'
  | 'change'
  | 'folderSelectError'
  | 'folderSelectErrorDetails'
  | 'help'
  | 'helpDetails'
  | 'homeNotFound'
  | 'invalidFolder'
  | 'newFolder'
  | 'notFound'
  | 'select'
  | 'selectButton'
  | 'selectedPath'
  | 'selectFolderTitle'
  | 'validating'
  | 'validationError';

/**
 * diffViewer 네임스페이스 키
 */
export type DiffViewerKeys =
  | 'advancedAnalysis'
  | 'advancedTextAnalysis'
  | 'after'
  | 'before'
  | 'changes'
  | 'copyAfterCode'
  | 'split'
  | 'switchToSplit'
  | 'switchToUnified'
  | 'unified'
  | 'visualView';

/**
 * advancedTextDiff 네임스페이스 키
 */
export type AdvancedTextDiffKeys =
  | 'added'
  | 'additions'
  | 'changeSummary'
  | 'collapse'
  | 'comparisonMethod'
  | 'deletions'
  | 'expand'
  | 'manyChanges'
  | 'modes.chars'
  | 'modes.lines'
  | 'modes.sentences'
  | 'modes.trimmedLines'
  | 'modes.words'
  | 'modes.wordsWithSpace'
  | 'removed'
  | 'same'
  | 'textChanges'
  | 'unchanged';

/**
 * structuredPatch 네임스페이스 키
 */
export type StructuredPatchKeys =
  | 'areasChanged'
  | 'changeStats'
  | 'fileChanges'
  | 'filePath'
  | 'updatedFile'
  | 'updatedFileContent';

/**
 * contentArray 네임스페이스 키
 */
export type ContentArrayKeys =
  | 'cacheCreation'
  | 'cacheRead'
  | 'claudeApiResponse'
  | 'completed'
  | 'content'
  | 'executionTime'
  | 'input'
  | 'interrupted'
  | 'interruptionStatus'
  | 'output'
  | 'seconds'
  | 'tokenUsage'
  | 'toolUseCount'
  | 'totalTokens'
  | 'type'
  | 'typeUnknown';

/**
 * fileContent 네임스페이스 키
 */
export type FileContentKeys =
  | 'collapse'
  | 'content'
  | 'copyFileContent'
  | 'expand'
  | 'filePath'
  | 'lines'
  | 'showingLines'
  | 'showMoreLines'
  | 'startLine';

/**
 * fileEditRenderer 네임스페이스 키
 */
export type FileEditRendererKeys =
  | 'copyChangedResult'
  | 'copyFileAfterChange'
  | 'copyOriginalFile'
  | 'editType'
  | 'fileEditResult'
  | 'filePath'
  | 'fullReplace'
  | 'no'
  | 'originalFileContent'
  | 'partialReplace'
  | 'userModified'
  | 'yes';

/**
 * messageContentDisplay 네임스페이스 키
 */
export type MessageContentDisplayKeys =
  | 'copyMessage'
  | 'showLess'
  | 'showMore';

/**
 * codebaseContextRenderer 네임스페이스 키
 */
export type CodebaseContextRendererKeys =
  | 'analyzedFiles'
  | 'andMoreFiles'
  | 'codebaseContext'
  | 'contextWindow'
  | 'filesCount'
  | 'relevantFiles';

/**
 * fileListRenderer 네임스페이스 키
 */
export type FileListRendererKeys =
  | 'fileList';

/**
 * mcpRenderer 네임스페이스 키
 */
export type McpRendererKeys =
  | 'error'
  | 'executionResult'
  | 'mcpToolCall'
  | 'parameters';

/**
 * gitWorkflowRenderer 네임스페이스 키
 */
export type GitWorkflowRendererKeys =
  | 'changedFiles'
  | 'gitWorkflow'
  | 'status'
  | 'viewDiff';

/**
 * assistantMessageDetails 네임스페이스 키
 */
export type AssistantMessageDetailsKeys =
  | 'cacheCreation'
  | 'cacheRead'
  | 'input'
  | 'model'
  | 'output'
  | 'tier'
  | 'tokenUsage';

/**
 * claudeSessionHistoryRenderer 네임스페이스 키
 */
export type ClaudeSessionHistoryRendererKeys =
  | 'claude'
  | 'messageCount'
  | 'model'
  | 'noContent'
  | 'noValidMessages'
  | 'parsingError'
  | 'parsingErrorDescription'
  | 'title'
  | 'tokenUsage'
  | 'user'
  | 'viewOriginalData';

/**
 * terminalStreamRenderer 네임스페이스 키
 */
export type TerminalStreamRendererKeys =
  | 'exitCode'
  | 'title';

/**
 * webSearchRenderer 네임스페이스 키
 */
export type WebSearchRendererKeys =
  | 'duration'
  | 'query'
  | 'results'
  | 'seconds'
  | 'title'
  | 'unknownResultFormat';

/**
 * thinkingRenderer 네임스페이스 키
 */
export type ThinkingRendererKeys =
  | 'title';

/**
 * copyButton 네임스페이스 키
 */
export type CopyButtonKeys =
  | 'copied'
  | 'copy'
  | 'copying'
  | 'error';

/**
 * imageRenderer 네임스페이스 키
 */
export type ImageRendererKeys =
  | 'cannotLoadImage'
  | 'close'
  | 'downloadImage'
  | 'image'
  | 'viewFullscreen';

/**
 * upToDateNotification 네임스페이스 키
 */
export type UpToDateNotificationKeys =
  | 'currentVersionLatest'
  | 'upToDate';

/**
 * commandRenderer 네임스페이스 키
 */
export type CommandRendererKeys =
  | 'arguments'
  | 'command'
  | 'commandExecution'
  | 'errorOutput'
  | 'executionResult'
  | 'status'
  | 'systemNote'
  | 'unknownContentType';

/**
 * taskNotification 네임스페이스 키
 */
export type TaskNotificationKeys =
  | 'agentTask'
  | 'agentTasks'
  | 'details'
  | 'result'
  | 'showMore'
  | 'status.completed'
  | 'status.failed'
  | 'status.running'
  | 'summary';

/**
 * recentEdits 네임스페이스 키
 */
export type RecentEditsKeys =
  | 'cancel'
  | 'confirmRestore'
  | 'confirmRestoreMessage'
  | 'confirmRestoreTitle'
  | 'copyContent'
  | 'created'
  | 'description'
  | 'edited'
  | 'footerInfo'
  | 'lines'
  | 'loading'
  | 'noEdits'
  | 'noEditsDescription'
  | 'noSearchResults'
  | 'restoreError'
  | 'restoreFile'
  | 'searchPlaceholder'
  | 'stats'
  | 'title'
  | 'showMore';

/**
 * messages 네임스페이스 키
 */
export type MessagesKeys =
  | 'hasMore'
  | 'messageInfo'
  | 'noMessages'
  | 'offset'
  | 'tokenStats.existing'
  | 'tokenStats.title';

/**
 * agentProgressGroup 네임스페이스 키
 */
export type AgentProgressGroupKeys =
  | 'agent'
  | 'steps';

/**
 * agentTaskGroup 네임스페이스 키
 */
export type AgentTaskGroupKeys =
  | 'agent'
  | 'completed'
  | 'copyPath'
  | 'parallelTasks'
  | 'prompt'
  | 'transcript';

/**
 * bashCodeExecutionToolResultRenderer 네임스페이스 키
 */
export type BashCodeExecutionToolResultRendererKeys =
  | 'error'
  | 'noOutput'
  | 'title';

/**
 * claudeToolUseDisplay 네임스페이스 키
 */
export type ClaudeToolUseDisplayKeys =
  | 'unknownTool';

/**
 * codeExecutionToolResultRenderer 네임스페이스 키
 */
export type CodeExecutionToolResultRendererKeys =
  | 'error'
  | 'noOutput'
  | 'title';

/**
 * collapsibleToolResult 네임스페이스 키
 */
export type CollapsibleToolResultKeys =
  | 'editsCount'
  | 'noOutput'
  | 'result'
  | 'terminalOutput'
  | 'todoListUpdated';

/**
 * fileHistorySnapshotRenderer 네임스페이스 키
 */
export type FileHistorySnapshotRendererKeys =
  | 'files'
  | 'noFiles'
  | 'snapshot'
  | 'trackedFiles'
  | 'update';

/**
 * progressRenderer 네임스페이스 키
 */
export type ProgressRendererKeys =
  | 'status.completed'
  | 'status.error'
  | 'status.running'
  | 'status.started'
  | 'types.agent'
  | 'types.bash'
  | 'types.hook'
  | 'types.mcp'
  | 'types.query'
  | 'types.search'
  | 'types.waiting';

/**
 * queueOperationRenderer 네임스페이스 키
 */
export type QueueOperationRendererKeys =
  | 'descriptions.dequeue'
  | 'descriptions.enqueue'
  | 'descriptions.popAll'
  | 'descriptions.remove'
  | 'operations.dequeue'
  | 'operations.enqueue'
  | 'operations.popAll'
  | 'operations.remove'
  | 'title';

/**
 * simpleUpdateModal 네임스페이스 키
 */
export type SimpleUpdateModalKeys =
  | 'changes'
  | 'close'
  | 'currentVersion'
  | 'downloadAndInstall'
  | 'downloading'
  | 'downloadingShort'
  | 'errorOccurred'
  | 'hideDetails'
  | 'important'
  | 'installing'
  | 'installingShort'
  | 'newUpdateAvailable'
  | 'newVersion'
  | 'releaseName'
  | 'remindLater'
  | 'showDetails'
  | 'skipVersion'
  | 'viewOnGitHub';

/**
 * summaryMessageRenderer 네임스페이스 키
 */
export type SummaryMessageRendererKeys =
  | 'title';

/**
 * systemMessageRenderer 네임스페이스 키
 */
export type SystemMessageRendererKeys =
  | 'empty'
  | 'hooks'
  | 'prevented'
  | 'subtypes.compactBoundary'
  | 'subtypes.localCommand'
  | 'subtypes.microcompactBoundary'
  | 'subtypes.stopHook'
  | 'subtypes.turnDuration'
  | 'title'
  | 'trigger';

/**
 * textEditorCodeExecutionToolResultRenderer 네임스페이스 키
 */
export type TextEditorCodeExecutionToolResultRendererKeys =
  | 'create'
  | 'delete'
  | 'edit'
  | 'error'
  | 'showContent'
  | 'view';

/**
 * toolSearchToolResultRenderer 네임스페이스 키
 */
export type ToolSearchToolResultRendererKeys =
  | 'error'
  | 'found'
  | 'noResults'
  | 'title';

/**
 * webFetchToolResultRenderer 네임스페이스 키
 */
export type WebFetchToolResultRendererKeys =
  | 'error'
  | 'retrievedAt'
  | 'showContent'
  | 'title';

/**
 * citationRenderer 네임스페이스 키
 */
export type CitationRendererKeys =
  | 'charLocation'
  | 'singlePage'
  | 'pageRange'
  | 'blockLocation'
  | 'title';

/**
 * claudeContentArrayRenderer 네임스페이스 키
 */
export type ClaudeContentArrayRendererKeys =
  | 'systemReminder'
  | 'unknownContentType';

/**
 * commandOutputDisplay 네임스페이스 키
 */
export type CommandOutputDisplayKeys =
  | 'jsonOutput'
  | 'testResults'
  | 'buildOutput'
  | 'packageManagement'
  | 'tableOutput'
  | 'terminalOutput';

