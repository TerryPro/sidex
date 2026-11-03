import { invoke } from '@tauri-apps/api/core';

// ---------------------------------------------------------------------------
// Platform bootstrap / lifecycle
// ---------------------------------------------------------------------------

export interface IExtensionTransportInfo {
  kind: string;
  endpoint: string;
}

export interface INodeRuntimeInfo {
  path: string;
  version?: string;
  source: string;
  bundled: boolean;
}

export interface IExtensionPathsInfo {
  serverScript: string;
  builtinExtensionsDir: string;
  userExtensionsDir: string;
  globalStorageDir: string;
}

export interface IExtensionContributedCommand {
  id: string;
  title: string;
  icon?: string;
}

export interface IExtensionContributedMenuItem {
  command: string;
  when?: string;
  group?: string;
}

export interface IExtensionManifestSummary {
  id: string;
  name: string;
  version: string;
  kind: 'node' | 'wasm';
  activationEvents: string[];
  main?: string;
  browser?: string;
  wasmBinary?: string;
  contributes: string[];
  commands?: IExtensionContributedCommand[];
  menus?: Record<string, IExtensionContributedMenuItem[]>;
  location: string;
}

export interface IExtensionPlatformBootstrap {
  transport: IExtensionTransportInfo;
  runtime: INodeRuntimeInfo;
  paths: IExtensionPathsInfo;
  sessionKind: string;
  extensions: IExtensionManifestSummary[];
  initDataJson: string;
  /** False when no extension declares `main`/`browser`, so no Node host was spawned. */
  nodeHost?: boolean;
}

export interface IWasmCustomEditorAction {
  kind: 'register' | 'create' | 'html' | 'post' | 'command';
  viewType?: string;
  handle?: number;
  uri?: string;
  webviewId?: string;
  html?: string;
  message?: string;
  extensionId?: string;
  displayName?: string;
  filenamePatterns?: string[];
  priority?: string;
  command?: string;
  args?: string;
}

export async function takeWasmCustomEditorActions(): Promise<IWasmCustomEditorAction[]> {
  return invoke<IWasmCustomEditorAction[]>('wasm_take_custom_editor_actions');
}

export async function activateWasmCustomEditor(viewType: string, uri: string, webviewId: string): Promise<void> {
  return invoke<void>('wasm_activate_custom_editor', { viewType, uri, webviewId });
}

export async function sendWasmCustomEditorMessage(handle: number, message: string): Promise<void> {
  return invoke<void>('wasm_custom_editor_message', { handle, message });
}

export async function saveWasmCustomEditor(uri: string): Promise<boolean> {
  return invoke<boolean>('wasm_custom_editor_save', { uri });
}

export interface IExtensionPlatformStatus {
  running: boolean;
  port?: number;
  sessionId?: string;
  uptimeSecs?: number;
  extensionCount?: number;
  restartCount?: number;
  totalCrashes: number;
}

export async function bootstrapExtensionPlatform(): Promise<IExtensionPlatformBootstrap> {
  return invoke<IExtensionPlatformBootstrap>('extension_platform_bootstrap');
}

export async function getExtensionPlatformStatus(): Promise<IExtensionPlatformStatus> {
  return invoke<IExtensionPlatformStatus>('extension_platform_status');
}

export async function restartExtensionPlatform(): Promise<IExtensionPlatformStatus> {
  return invoke<IExtensionPlatformStatus>('extension_platform_restart');
}

export async function stopExtensionPlatform(): Promise<void> {
  return invoke<void>('extension_platform_stop');
}

export async function getExtensionPlatformInitData(): Promise<string> {
  return invoke<string>('extension_platform_init_data');
}

// ---------------------------------------------------------------------------
// Runtime diagnostics — extension activation tracking
// ---------------------------------------------------------------------------

export type ExtensionStatus =
  | 'discovered'
  | 'loading'
  | 'activated'
  | 'failed'
  | 'deactivated'
  | 'disabled';

export interface IExtensionRuntimeRecord {
  id: string;
  status: ExtensionStatus;
  activationTimeMs?: number;
  activatedAt?: string;
  deactivatedAt?: string;
  error?: string;
  errorCount: number;
  isSlow: boolean;
  disabledByBisect: boolean;
  providerCount: number;
  commandCount: number;
}

export interface IExtensionProfileRecord {
  id: string;
  activationTimeMs: number;
  isSlow: boolean;
  totalProviderCalls: number;
  totalProviderTimeMs: number;
  avgProviderTimeMs: number;
  peakProviderTimeMs: number;
  errorCount: number;
}

export interface IExtensionStartupSummary {
  startupComplete: boolean;
  startupTimeMs?: number;
  totalExtensions: number;
  activatedCount: number;
  failedCount: number;
  slowCount: number;
  totalActivationTimeMs: number;
  slowestExtension?: string;
  slowestActivationMs: number;
}

export interface IExtensionActivationReport {
  extensionId: string;
  activationTimeMs: number;
  error?: string;
  providerCount?: number;
  commandCount?: number;
}

export async function reportExtensionActivated(report: IExtensionActivationReport): Promise<void> {
  return invoke<void>('extension_report_activated', { report });
}

export async function reportExtensionProviderCall(extensionId: string, durationMs: number): Promise<void> {
  return invoke<void>('extension_report_provider_call', { extensionId, durationMs });
}

export async function reportExtensionDeactivated(extensionId: string): Promise<void> {
  return invoke<void>('extension_report_deactivated', { extensionId });
}

export async function reportExtensionError(extensionId: string, error: string): Promise<void> {
  return invoke<void>('extension_report_error', { extensionId, error });
}

export async function markStartupComplete(): Promise<number> {
  return invoke<number>('extension_mark_startup_complete');
}

export async function registerExtensionSession(extensionIds: string[]): Promise<void> {
  return invoke<void>('extension_register_session', { extensionIds });
}

export async function getExtensionRuntimeStatus(): Promise<IExtensionRuntimeRecord[]> {
  return invoke<IExtensionRuntimeRecord[]>('extension_runtime_status');
}

export async function getExtensionRuntimeProfile(): Promise<IExtensionProfileRecord[]> {
  return invoke<IExtensionProfileRecord[]>('extension_runtime_profile');
}

export async function getSlowExtensions(): Promise<IExtensionProfileRecord[]> {
  return invoke<IExtensionProfileRecord[]>('extension_slow_extensions');
}

export async function getExtensionStartupSummary(): Promise<IExtensionStartupSummary> {
  return invoke<IExtensionStartupSummary>('extension_startup_summary');
}

// ---------------------------------------------------------------------------
// Extension bisect — binary search for problematic extensions
// ---------------------------------------------------------------------------

export interface IBisectState {
  active: boolean;
  round: number;
  totalRounds: number;
  allExtensionIds: string[];
  enabledIds: string[];
  disabledIds: string[];
  confirmedBad: string[];
  confirmedGood: string[];
}

export async function startExtensionBisect(): Promise<IBisectState> {
  return invoke<IBisectState>('extension_bisect_start');
}

export async function bisectReportGood(): Promise<IBisectState> {
  return invoke<IBisectState>('extension_bisect_good');
}

export async function bisectReportBad(): Promise<IBisectState> {
  return invoke<IBisectState>('extension_bisect_bad');
}

export async function resetExtensionBisect(): Promise<void> {
  return invoke<void>('extension_bisect_reset');
}

export async function getExtensionBisectState(): Promise<IBisectState> {
  return invoke<IBisectState>('extension_bisect_state');
}

// ---------------------------------------------------------------------------
// WASM extension management
// ---------------------------------------------------------------------------

export async function loadWasmExtension(extensionId: string, wasmPath: string): Promise<void> {
  return invoke<void>('wasm_load_extension', { extensionId, wasmPath });
}

export async function unloadWasmExtension(extensionId: string): Promise<void> {
  return invoke<void>('wasm_unload_extension', { extensionId });
}

export async function listWasmExtensions(): Promise<string[]> {
  return invoke<string[]>('wasm_list_extensions');
}

/** Activate every WASM extension that declared `onLanguage:<languageId>`. */
export async function activateWasmExtensionsForLanguage(languageId: string): Promise<string[]> {
  return invoke<string[]>('wasm_activate_language', { languageId });
}

export interface IWasmCommandInfo {
  extensionId: string;
  id: string;
  title: string;
}

export interface IWasmCommandResult {
  extensionId: string;
  result: string;
}

/** Commands declared by the currently loaded WASM extensions. */
export async function listWasmCommands(): Promise<IWasmCommandInfo[]> {
  return invoke<IWasmCommandInfo[]>('wasm_list_commands');
}

/** Run a command in every loaded WASM extension; each returns a JSON string. */
export async function executeWasmCommandAll(commandId: string, args: string): Promise<IWasmCommandResult[]> {
  return invoke<IWasmCommandResult[]>('wasm_execute_command_all', { commandId, args });
}

// ---------------------------------------------------------------------------
// WASM document sync — keep WASM host state in sync with open editors
// ---------------------------------------------------------------------------

export async function wasmSyncDocument(uri: string, languageId: string, text: string): Promise<void> {
  return invoke<void>('wasm_sync_document', { uri, languageId, text });
}

export async function wasmCloseDocument(uri: string): Promise<void> {
  return invoke<void>('wasm_close_document', { uri });
}

export async function wasmSyncWorkspaceFolders(folders: string[]): Promise<void> {
  return invoke<void>('wasm_sync_workspace_folders', { folders });
}

// ---------------------------------------------------------------------------
// WASM provider calls — direct Rust invocation, no WebSocket round-trip
// ---------------------------------------------------------------------------

export interface IWasmProviderParams {
  extensionId: string;
  uri: string;
  languageId: string;
  version: number;
  line: number;
  character: number;
}

export async function wasmProvideCompletion(params: IWasmProviderParams): Promise<any> {
  return invoke<any>('wasm_provide_completion', { params });
}

export async function wasmProvideHover(params: IWasmProviderParams): Promise<any> {
  return invoke<any>('wasm_provide_hover', { params });
}

export async function wasmProvideDefinition(params: IWasmProviderParams): Promise<any> {
  return invoke<any>('wasm_provide_definition', { params });
}

export async function wasmProvideReferences(params: IWasmProviderParams): Promise<any> {
  return invoke<any>('wasm_provide_references', { params });
}

export async function wasmProvideDocumentSymbols(params: IWasmProviderParams): Promise<any> {
  return invoke<any>('wasm_provide_document_symbols', { params });
}

export async function wasmProvideFormatting(
  params: IWasmProviderParams,
  tabSize: number,
  insertSpaces: boolean,
): Promise<any> {
  return invoke<any>('wasm_provide_formatting', { params, tabSize, insertSpaces });
}

// ---------------------------------------------------------------------------
// WASM broadcast providers — fan out to all loaded WASM extensions
// ---------------------------------------------------------------------------

export async function wasmProvideCompletionAll(
  uri: string, languageId: string, version: number, line: number, character: number,
): Promise<any> {
  return invoke<any>('wasm_provide_completion_all', { uri, languageId, version, line, character });
}

export async function wasmProvideHoverAll(
  uri: string, languageId: string, version: number, line: number, character: number,
): Promise<any> {
  return invoke<any>('wasm_provide_hover_all', { uri, languageId, version, line, character });
}

export async function wasmProvideDefinitionAll(
  uri: string, languageId: string, version: number, line: number, character: number,
): Promise<any> {
  return invoke<any>('wasm_provide_definition_all', { uri, languageId, version, line, character });
}

export async function wasmProvideDocumentSymbolsAll(
  uri: string, languageId: string, version: number,
): Promise<any> {
  return invoke<any>('wasm_provide_document_symbols_all', { uri, languageId, version });
}

export async function wasmProvideFormattingAll(
  uri: string, languageId: string, version: number, tabSize: number, insertSpaces: boolean,
): Promise<any> {
  return invoke<any>('wasm_provide_formatting_all', { uri, languageId, version, tabSize, insertSpaces });
}

export async function wasmProvideDocumentLinksAll(
  uri: string, languageId: string, version: number,
): Promise<any> {
  return invoke<any>('wasm_provide_document_links_all', { uri, languageId, version });
}

export async function wasmProvideReferencesAll(
  uri: string, languageId: string, version: number, line: number, character: number,
): Promise<any> {
  return invoke<any>('wasm_provide_references_all', { uri, languageId, version, line, character });
}

export async function wasmProvideTypeDefinitionAll(
  uri: string, languageId: string, version: number, line: number, character: number,
): Promise<any> {
  return invoke<any>('wasm_provide_type_definition_all', { uri, languageId, version, line, character });
}

export async function wasmProvideImplementationAll(
  uri: string, languageId: string, version: number, line: number, character: number,
): Promise<any> {
  return invoke<any>('wasm_provide_implementation_all', { uri, languageId, version, line, character });
}

export async function wasmProvideDeclarationAll(
  uri: string, languageId: string, version: number, line: number, character: number,
): Promise<any> {
  return invoke<any>('wasm_provide_declaration_all', { uri, languageId, version, line, character });
}

export async function wasmProvideCodeActionsAll(
  uri: string, languageId: string, version: number,
  startLine: number, startCharacter: number, endLine: number, endCharacter: number,
): Promise<any> {
  return invoke<any>('wasm_provide_code_actions_all', {
    uri, languageId, version, startLine, startCharacter, endLine, endCharacter,
  });
}

export async function wasmProvideSignatureHelpAll(
  uri: string, languageId: string, version: number, line: number, character: number,
): Promise<any> {
  return invoke<any>('wasm_provide_signature_help_all', { uri, languageId, version, line, character });
}

export async function wasmProvideDocumentHighlightsAll(
  uri: string, languageId: string, version: number, line: number, character: number,
): Promise<any> {
  return invoke<any>('wasm_provide_document_highlights_all', { uri, languageId, version, line, character });
}

export async function wasmProvideRenameAll(
  uri: string, languageId: string, version: number, line: number, character: number, newName: string,
): Promise<any> {
  return invoke<any>('wasm_provide_rename_all', { uri, languageId, version, line, character, newName });
}

export async function wasmProvideFoldingRangesAll(
  uri: string, languageId: string, version: number,
): Promise<any> {
  return invoke<any>('wasm_provide_folding_ranges_all', { uri, languageId, version });
}

export async function wasmProvideSelectionRangesAll(
  uri: string, languageId: string, version: number, positions: [number, number][],
): Promise<any> {
  return invoke<any>('wasm_provide_selection_ranges_all', { uri, languageId, version, positions });
}

export async function wasmProvideInlayHintsAll(
  uri: string, languageId: string, version: number,
  startLine: number, startCharacter: number, endLine: number, endCharacter: number,
): Promise<any> {
  return invoke<any>('wasm_provide_inlay_hints_all', {
    uri, languageId, version, startLine, startCharacter, endLine, endCharacter,
  });
}

export async function wasmProvideRangeFormattingAll(
  uri: string, languageId: string, version: number,
  startLine: number, startCharacter: number, endLine: number, endCharacter: number,
  tabSize: number, insertSpaces: boolean,
): Promise<any> {
  return invoke<any>('wasm_provide_range_formatting_all', {
    uri, languageId, version, startLine, startCharacter, endLine, endCharacter, tabSize, insertSpaces,
  });
}

export interface IWasmDiagnostic {
  extensionId: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  message: string;
  severity: 'error' | 'warning' | 'information' | 'hint';
  source?: string;
  code?: string;
}

export async function getWasmDiagnostics(uri: string): Promise<IWasmDiagnostic[]> {
  return invoke<IWasmDiagnostic[]>('wasm_get_diagnostics', { uri });
}
