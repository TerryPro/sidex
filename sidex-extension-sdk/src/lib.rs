//! SideX Extension SDK
//!
//! Build native SideX extensions in Rust. Extensions compile to WASM
//! components via `cargo build --target wasm32-wasip2` and are loaded
//! directly by the SideX runtime — no Node.js required.
//!
//! # Quick Start
//!
//! ```toml
//! [dependencies]
//! sidex-extension-sdk = "0.1"
//! ```
//!
//! ```rust,ignore
//! use sidex_extension_sdk::prelude::*;
//!
//! struct MyExtension;
//!
//! impl SidexExtension for MyExtension {
//!     fn get_name() -> String {
//!         "My Extension".to_string()
//!     }
//!
//!     fn provide_hover(ctx: DocumentContext, pos: Position) -> Option<HoverResult> {
//!         // ...
//!     }
//! }
//!
//! export_extension!(MyExtension);
//! ```
//!
//! Every trait method has a default, so an extension only writes what it really
//! provides. Adding a method to the WIT world therefore only touches this file.

wit_bindgen::generate!({
    world: "sidex-extension",
    path: "wit/world.wit",
    pub_export_macro: true,
});

pub use self::sidex::extension::common_types::*;
pub use self::sidex::extension::host_api as host;

/// The wit-bindgen generated guest trait. Extensions don't implement this
/// directly — they implement [`SidexExtension`], which has defaults for every
/// method, and the blanket implementation below bridges the two.
pub use self::exports::sidex::extension::extension_api::Guest as GeneratedExtension;

/// The trait extensions implement. Everything has a default body, so only the
/// methods an extension actually provides have to be listed.
pub trait SidexExtension {
    fn activate() -> Result<(), String> {
        Ok(())
    }

    fn deactivate() {}

    fn get_name() -> String {
        String::new()
    }

    fn get_display_name() -> String {
        String::new()
    }

    fn get_version() -> String {
        String::new()
    }

    fn get_publisher() -> String {
        String::new()
    }

    fn get_activation_events() -> Vec<String> {
        Vec::new()
    }

    fn get_commands() -> Vec<CommandDefinition> {
        Vec::new()
    }

    fn get_semantic_tokens_legend() -> Option<SemanticTokensLegend> {
        None
    }

    fn get_languages() -> Vec<String> {
        Vec::new()
    }

    fn get_task_types() -> Vec<TaskDefinition> {
        Vec::new()
    }

    fn get_debug_types() -> Vec<String> {
        Vec::new()
    }

    fn get_view_ids() -> Vec<String> {
        Vec::new()
    }

    fn get_notebook_types() -> Vec<String> {
        Vec::new()
    }

    fn get_custom_editor_types() -> Vec<String> {
        Vec::new()
    }

    // -- Language features --
    fn provide_completion(_ctx: DocumentContext, _pos: Position) -> Option<CompletionList> {
        None
    }
    fn provide_completion_item_resolve(
        _label: String,
        _kind: Option<u32>,
        _data: Option<String>,
    ) -> Option<CompletionList> {
        None
    }
    fn provide_hover(_ctx: DocumentContext, _pos: Position) -> Option<HoverResult> {
        None
    }
    fn provide_definition(_ctx: DocumentContext, _pos: Position) -> Vec<Location> {
        Vec::new()
    }
    fn provide_type_definition(_ctx: DocumentContext, _pos: Position) -> Vec<Location> {
        Vec::new()
    }
    fn provide_implementation(_ctx: DocumentContext, _pos: Position) -> Vec<Location> {
        Vec::new()
    }
    fn provide_declaration(_ctx: DocumentContext, _pos: Position) -> Vec<Location> {
        Vec::new()
    }
    fn provide_references(_ctx: DocumentContext, _pos: Position) -> Vec<Location> {
        Vec::new()
    }
    fn provide_document_symbols(_ctx: DocumentContext) -> Vec<DocumentSymbol> {
        Vec::new()
    }
    fn provide_workspace_symbols(_query: String) -> Vec<DocumentSymbol> {
        Vec::new()
    }
    fn provide_workspace_symbol_resolve(
        _symbol_name: String,
        _container_name: Option<String>,
    ) -> Option<DocumentSymbol> {
        None
    }
    fn provide_code_actions(
        _ctx: DocumentContext,
        _range: Range,
        _diagnostics: Vec<Diagnostic>,
    ) -> Vec<CodeAction> {
        Vec::new()
    }
    fn provide_code_action_resolve(
        _title: String,
        _kind: Option<String>,
        _data: Option<String>,
    ) -> Option<CodeAction> {
        None
    }
    fn provide_code_lenses(_ctx: DocumentContext) -> Vec<CodeLens> {
        Vec::new()
    }
    fn provide_code_lens_resolve(
        _range: Range,
        _command_id: Option<String>,
        _data: Option<String>,
    ) -> Option<CodeLens> {
        None
    }
    fn provide_formatting(_ctx: DocumentContext, _tab_size: u32, _insert_spaces: bool) -> Vec<TextEdit> {
        Vec::new()
    }
    fn provide_range_formatting(
        _ctx: DocumentContext,
        _range: Range,
        _tab_size: u32,
        _insert_spaces: bool,
    ) -> Vec<TextEdit> {
        Vec::new()
    }
    fn provide_on_type_formatting(
        _ctx: DocumentContext,
        _pos: Position,
        _ch: String,
        _tab_size: u32,
        _insert_spaces: bool,
    ) -> Vec<TextEdit> {
        Vec::new()
    }
    fn provide_signature_help(_ctx: DocumentContext, _pos: Position) -> Option<SignatureHelpResult> {
        None
    }
    fn provide_document_highlights(_ctx: DocumentContext, _pos: Position) -> Vec<DocumentHighlight> {
        Vec::new()
    }
    fn provide_rename(_ctx: DocumentContext, _pos: Position, _new_name: String) -> Option<RenameResult> {
        None
    }
    fn prepare_rename(_ctx: DocumentContext, _pos: Position) -> Option<RenameLocation> {
        None
    }
    fn provide_folding_ranges(_ctx: DocumentContext) -> Vec<FoldingRange> {
        Vec::new()
    }
    fn provide_inlay_hints(_ctx: DocumentContext, _range: Range) -> Vec<InlayHint> {
        Vec::new()
    }
    fn provide_inlay_hint_resolve(
        _position: Position,
        _label: String,
        _kind: Option<u32>,
    ) -> Option<InlayHint> {
        None
    }
    fn provide_document_links(_ctx: DocumentContext) -> Vec<DocumentLink> {
        Vec::new()
    }
    fn provide_document_link_resolve(_range: Range, _target: Option<String>) -> Option<DocumentLink> {
        None
    }
    fn provide_selection_ranges(_ctx: DocumentContext, _positions: Vec<Position>) -> Vec<SelectionRange> {
        Vec::new()
    }
    fn provide_semantic_tokens(_ctx: DocumentContext) -> Option<SemanticTokens> {
        None
    }
    fn provide_semantic_tokens_range(_ctx: DocumentContext, _range: Range) -> Option<SemanticTokens> {
        None
    }
    fn provide_semantic_tokens_delta(_ctx: DocumentContext, _previous_result_id: String) -> Option<SemanticTokens> {
        None
    }
    fn provide_document_colors(_ctx: DocumentContext) -> Vec<ColorInfo> {
        Vec::new()
    }
    fn provide_color_presentation(_ctx: DocumentContext, _color: ColorInfo, _range: Range) -> Vec<TextEdit> {
        Vec::new()
    }
    fn provide_call_hierarchy_incoming(_ctx: DocumentContext, _pos: Position) -> Vec<DocumentSymbol> {
        Vec::new()
    }
    fn provide_call_hierarchy_outgoing(_ctx: DocumentContext, _pos: Position) -> Vec<DocumentSymbol> {
        Vec::new()
    }
    fn provide_type_hierarchy_subtypes(_ctx: DocumentContext, _pos: Position) -> Vec<DocumentSymbol> {
        Vec::new()
    }
    fn provide_type_hierarchy_supertypes(_ctx: DocumentContext, _pos: Position) -> Vec<DocumentSymbol> {
        Vec::new()
    }
    fn provide_linked_editing_ranges(_ctx: DocumentContext, _pos: Position) -> Vec<Range> {
        Vec::new()
    }

    // -- Commands --
    fn execute_command(id: String, _args: String) -> Result<String, String> {
        Err(format!("unknown command: {id}"))
    }

    // -- Document events --
    fn on_file_event(_events: Vec<FileEvent>) {}
    fn on_document_opened(_ctx: DocumentContext) {}
    fn on_document_closed(_ctx: DocumentContext) {}
    fn on_document_changed(_ctx: DocumentContext, _changes: Vec<TextEdit>) {}
    fn on_document_saved(_ctx: DocumentContext, _reason: u32) {}
    fn on_document_will_save(_ctx: DocumentContext, _reason: u32) -> Vec<TextEdit> {
        Vec::new()
    }
    fn on_document_language_changed(_uri: String, _old_language_id: String, _new_language_id: String) {}

    // -- Workspace events --
    fn on_configuration_changed(_section: String) {}
    fn on_workspace_folders_changed(_added: Vec<String>, _removed: Vec<String>) {}
    fn on_files_created(_uris: Vec<String>) {}
    fn on_files_renamed(_old_uris: Vec<String>, _new_uris: Vec<String>) {}
    fn on_files_deleted(_uris: Vec<String>) {}
    fn on_files_will_create(_uris: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> {
        None
    }
    fn on_files_will_rename(_old_uris: Vec<String>, _new_uris: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> {
        None
    }
    fn on_files_will_delete(_uris: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> {
        None
    }

    // -- Editor events --
    fn on_active_editor_changed(_uri: Option<String>) {}
    fn on_visible_editors_changed(_uris: Vec<String>) {}
    fn on_editor_selections_changed(_uri: String, _selections: Vec<Range>) {}
    fn on_editor_scroll_changed(_uri: String, _visible_ranges: Vec<Range>) {}
    fn on_editor_view_column_changed(_uri: String, _view_column: u32) {}

    // -- Tree view --
    fn get_tree_children(_view_id: String, _element_id: Option<String>) -> Vec<TreeItem> {
        Vec::new()
    }
    fn get_tree_item(_view_id: String, _element_id: String) -> Option<TreeItem> {
        None
    }
    fn on_tree_item_activated(_view_id: String, _element_id: String) {}
    fn on_tree_visibility_changed(_view_id: String, _visible: bool) {}

    // -- Tasks --
    fn provide_tasks(_filter_type: Option<String>) -> Vec<TaskExecution> {
        Vec::new()
    }
    fn resolve_task(_task_id: String, _task_type: String) -> Option<TaskExecution> {
        None
    }
    fn on_task_started(_execution: TaskExecution) {}
    fn on_task_ended(_execution: TaskExecution, _exit_code: Option<i32>) {}
    fn on_task_process_started(_execution: TaskExecution, _pid: u32) {}
    fn on_task_process_ended(_execution: TaskExecution, _exit_code: Option<i32>) {}

    // -- Debug --
    fn create_debug_adapter_descriptor(
        _debug_type: String,
        _executable: String,
        _args: Vec<String>,
    ) -> Result<String, String> {
        Err("not supported".into())
    }
    fn on_debug_session_started(_session_id: String, _session_name: String, _debug_type: String) {}
    fn on_debug_session_stopped(_session_id: String) {}
    fn on_debug_breakpoints_changed(_added: Vec<String>, _removed: Vec<String>, _changed: Vec<String>) {}

    // -- Notebooks --
    fn provide_notebook_serializer_deserialize(
        _notebook_type: String,
        _data: Vec<u8>,
    ) -> Result<Vec<NotebookCell>, String> {
        Err("not supported".into())
    }
    fn provide_notebook_serializer_serialize(
        _notebook_type: String,
        _cells: Vec<NotebookCell>,
    ) -> Result<Vec<u8>, String> {
        Err("not supported".into())
    }
    fn provide_notebook_kernel_execute_all(
        _notebook_uri: String,
        _cells: Vec<NotebookCell>,
    ) -> Vec<NotebookCellOutput> {
        Vec::new()
    }
    fn provide_notebook_kernel_execute_cell(
        _notebook_uri: String,
        _cell_index: u32,
        _cell: NotebookCell,
    ) -> NotebookCellOutput {
        NotebookCellOutput { items: Vec::new() }
    }
    fn provide_notebook_kernel_interrupt(_notebook_uri: String) {}

    // -- Testing --
    fn provide_tests_resolve_children(_controller_id: String, _item_id: Option<String>) -> Vec<TestItem> {
        Vec::new()
    }
    fn provide_tests_run(
        _controller_id: String,
        _run_id: String,
        _items_to_run: Vec<String>,
        _items_to_exclude: Vec<String>,
    ) {
    }
    fn provide_tests_debug(
        _controller_id: String,
        _run_id: String,
        _items_to_run: Vec<String>,
        _items_to_exclude: Vec<String>,
    ) {
    }
    fn provide_tests_cancel_run(_controller_id: String, _run_id: String) {}

    // -- Custom editors --
    fn custom_editor_open(_editor_type: String, _uri: String, _view_column: u32) -> Result<String, String> {
        Err("not supported".into())
    }
    fn custom_editor_update(_editor_id: String, _changes: Vec<TextEdit>) -> Result<(), String> {
        Err("not supported".into())
    }
    fn custom_editor_save(_editor_id: String) -> Result<(), String> {
        Err("not supported".into())
    }
    fn custom_editor_save_as(_editor_id: String, _destination_uri: String) -> Result<(), String> {
        Err("not supported".into())
    }
    fn custom_editor_revert(_editor_id: String) -> Result<(), String> {
        Err("not supported".into())
    }
    fn custom_editor_dispose(_editor_id: String) {}

    // -- Webview --
    fn webview_receive_message(_panel_id: String, _message: String) {}
    fn on_webview_disposed(_panel_id: String) {}
    fn on_webview_visibility_changed(_panel_id: String, _visible: bool) {}
}

impl<T: SidexExtension> GeneratedExtension for T {
    fn activate() -> Result<(), String> {
        T::activate()
    }
    fn deactivate() {
        T::deactivate()
    }
    fn get_name() -> String {
        T::get_name()
    }
    fn get_display_name() -> String {
        T::get_display_name()
    }
    fn get_version() -> String {
        T::get_version()
    }
    fn get_publisher() -> String {
        T::get_publisher()
    }
    fn get_activation_events() -> Vec<String> {
        T::get_activation_events()
    }
    fn get_commands() -> Vec<CommandDefinition> {
        T::get_commands()
    }
    fn get_semantic_tokens_legend() -> Option<SemanticTokensLegend> {
        T::get_semantic_tokens_legend()
    }
    fn get_languages() -> Vec<String> {
        T::get_languages()
    }
    fn get_task_types() -> Vec<TaskDefinition> {
        T::get_task_types()
    }
    fn get_debug_types() -> Vec<String> {
        T::get_debug_types()
    }
    fn get_view_ids() -> Vec<String> {
        T::get_view_ids()
    }
    fn get_notebook_types() -> Vec<String> {
        T::get_notebook_types()
    }
    fn get_custom_editor_types() -> Vec<String> {
        T::get_custom_editor_types()
    }

    fn provide_completion(ctx: DocumentContext, pos: Position) -> Option<CompletionList> {
        T::provide_completion(ctx, pos)
    }
    fn provide_completion_item_resolve(label: String, kind: Option<u32>, data: Option<String>) -> Option<CompletionList> {
        T::provide_completion_item_resolve(label, kind, data)
    }
    fn provide_hover(ctx: DocumentContext, pos: Position) -> Option<HoverResult> {
        T::provide_hover(ctx, pos)
    }
    fn provide_definition(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        T::provide_definition(ctx, pos)
    }
    fn provide_type_definition(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        T::provide_type_definition(ctx, pos)
    }
    fn provide_implementation(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        T::provide_implementation(ctx, pos)
    }
    fn provide_declaration(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        T::provide_declaration(ctx, pos)
    }
    fn provide_references(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        T::provide_references(ctx, pos)
    }
    fn provide_document_symbols(ctx: DocumentContext) -> Vec<DocumentSymbol> {
        T::provide_document_symbols(ctx)
    }
    fn provide_workspace_symbols(query: String) -> Vec<DocumentSymbol> {
        T::provide_workspace_symbols(query)
    }
    fn provide_workspace_symbol_resolve(symbol_name: String, container_name: Option<String>) -> Option<DocumentSymbol> {
        T::provide_workspace_symbol_resolve(symbol_name, container_name)
    }
    fn provide_code_actions(ctx: DocumentContext, range: Range, diagnostics: Vec<Diagnostic>) -> Vec<CodeAction> {
        T::provide_code_actions(ctx, range, diagnostics)
    }
    fn provide_code_action_resolve(title: String, kind: Option<String>, data: Option<String>) -> Option<CodeAction> {
        T::provide_code_action_resolve(title, kind, data)
    }
    fn provide_code_lenses(ctx: DocumentContext) -> Vec<CodeLens> {
        T::provide_code_lenses(ctx)
    }
    fn provide_code_lens_resolve(range: Range, command_id: Option<String>, data: Option<String>) -> Option<CodeLens> {
        T::provide_code_lens_resolve(range, command_id, data)
    }
    fn provide_formatting(ctx: DocumentContext, tab_size: u32, insert_spaces: bool) -> Vec<TextEdit> {
        T::provide_formatting(ctx, tab_size, insert_spaces)
    }
    fn provide_range_formatting(ctx: DocumentContext, range: Range, tab_size: u32, insert_spaces: bool) -> Vec<TextEdit> {
        T::provide_range_formatting(ctx, range, tab_size, insert_spaces)
    }
    fn provide_on_type_formatting(
        ctx: DocumentContext,
        pos: Position,
        ch: String,
        tab_size: u32,
        insert_spaces: bool,
    ) -> Vec<TextEdit> {
        T::provide_on_type_formatting(ctx, pos, ch, tab_size, insert_spaces)
    }
    fn provide_signature_help(ctx: DocumentContext, pos: Position) -> Option<SignatureHelpResult> {
        T::provide_signature_help(ctx, pos)
    }
    fn provide_document_highlights(ctx: DocumentContext, pos: Position) -> Vec<DocumentHighlight> {
        T::provide_document_highlights(ctx, pos)
    }
    fn provide_rename(ctx: DocumentContext, pos: Position, new_name: String) -> Option<RenameResult> {
        T::provide_rename(ctx, pos, new_name)
    }
    fn prepare_rename(ctx: DocumentContext, pos: Position) -> Option<RenameLocation> {
        T::prepare_rename(ctx, pos)
    }
    fn provide_folding_ranges(ctx: DocumentContext) -> Vec<FoldingRange> {
        T::provide_folding_ranges(ctx)
    }
    fn provide_inlay_hints(ctx: DocumentContext, range: Range) -> Vec<InlayHint> {
        T::provide_inlay_hints(ctx, range)
    }
    fn provide_inlay_hint_resolve(position: Position, label: String, kind: Option<u32>) -> Option<InlayHint> {
        T::provide_inlay_hint_resolve(position, label, kind)
    }
    fn provide_document_links(ctx: DocumentContext) -> Vec<DocumentLink> {
        T::provide_document_links(ctx)
    }
    fn provide_document_link_resolve(range: Range, target: Option<String>) -> Option<DocumentLink> {
        T::provide_document_link_resolve(range, target)
    }
    fn provide_selection_ranges(ctx: DocumentContext, positions: Vec<Position>) -> Vec<SelectionRange> {
        T::provide_selection_ranges(ctx, positions)
    }
    fn provide_semantic_tokens(ctx: DocumentContext) -> Option<SemanticTokens> {
        T::provide_semantic_tokens(ctx)
    }
    fn provide_semantic_tokens_range(ctx: DocumentContext, range: Range) -> Option<SemanticTokens> {
        T::provide_semantic_tokens_range(ctx, range)
    }
    fn provide_semantic_tokens_delta(ctx: DocumentContext, previous_result_id: String) -> Option<SemanticTokens> {
        T::provide_semantic_tokens_delta(ctx, previous_result_id)
    }
    fn provide_document_colors(ctx: DocumentContext) -> Vec<ColorInfo> {
        T::provide_document_colors(ctx)
    }
    fn provide_color_presentation(ctx: DocumentContext, color: ColorInfo, range: Range) -> Vec<TextEdit> {
        T::provide_color_presentation(ctx, color, range)
    }
    fn provide_call_hierarchy_incoming(ctx: DocumentContext, pos: Position) -> Vec<DocumentSymbol> {
        T::provide_call_hierarchy_incoming(ctx, pos)
    }
    fn provide_call_hierarchy_outgoing(ctx: DocumentContext, pos: Position) -> Vec<DocumentSymbol> {
        T::provide_call_hierarchy_outgoing(ctx, pos)
    }
    fn provide_type_hierarchy_subtypes(ctx: DocumentContext, pos: Position) -> Vec<DocumentSymbol> {
        T::provide_type_hierarchy_subtypes(ctx, pos)
    }
    fn provide_type_hierarchy_supertypes(ctx: DocumentContext, pos: Position) -> Vec<DocumentSymbol> {
        T::provide_type_hierarchy_supertypes(ctx, pos)
    }
    fn provide_linked_editing_ranges(ctx: DocumentContext, pos: Position) -> Vec<Range> {
        T::provide_linked_editing_ranges(ctx, pos)
    }

    fn execute_command(command_id: String, args: String) -> Result<String, String> {
        T::execute_command(command_id, args)
    }

    fn on_file_event(events: Vec<FileEvent>) {
        T::on_file_event(events)
    }
    fn on_document_opened(ctx: DocumentContext) {
        T::on_document_opened(ctx)
    }
    fn on_document_closed(ctx: DocumentContext) {
        T::on_document_closed(ctx)
    }
    fn on_document_changed(ctx: DocumentContext, changes: Vec<TextEdit>) {
        T::on_document_changed(ctx, changes)
    }
    fn on_document_saved(ctx: DocumentContext, reason: u32) {
        T::on_document_saved(ctx, reason)
    }
    fn on_document_will_save(ctx: DocumentContext, reason: u32) -> Vec<TextEdit> {
        T::on_document_will_save(ctx, reason)
    }
    fn on_document_language_changed(uri: String, old_language_id: String, new_language_id: String) {
        T::on_document_language_changed(uri, old_language_id, new_language_id)
    }

    fn on_configuration_changed(section: String) {
        T::on_configuration_changed(section)
    }
    fn on_workspace_folders_changed(added: Vec<String>, removed: Vec<String>) {
        T::on_workspace_folders_changed(added, removed)
    }
    fn on_files_created(uris: Vec<String>) {
        T::on_files_created(uris)
    }
    fn on_files_renamed(old_uris: Vec<String>, new_uris: Vec<String>) {
        T::on_files_renamed(old_uris, new_uris)
    }
    fn on_files_deleted(uris: Vec<String>) {
        T::on_files_deleted(uris)
    }
    fn on_files_will_create(uris: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> {
        T::on_files_will_create(uris)
    }
    fn on_files_will_rename(old_uris: Vec<String>, new_uris: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> {
        T::on_files_will_rename(old_uris, new_uris)
    }
    fn on_files_will_delete(uris: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> {
        T::on_files_will_delete(uris)
    }

    fn on_active_editor_changed(uri: Option<String>) {
        T::on_active_editor_changed(uri)
    }
    fn on_visible_editors_changed(uris: Vec<String>) {
        T::on_visible_editors_changed(uris)
    }
    fn on_editor_selections_changed(uri: String, selections: Vec<Range>) {
        T::on_editor_selections_changed(uri, selections)
    }
    fn on_editor_scroll_changed(uri: String, visible_ranges: Vec<Range>) {
        T::on_editor_scroll_changed(uri, visible_ranges)
    }
    fn on_editor_view_column_changed(uri: String, view_column: u32) {
        T::on_editor_view_column_changed(uri, view_column)
    }

    fn get_tree_children(view_id: String, element_id: Option<String>) -> Vec<TreeItem> {
        T::get_tree_children(view_id, element_id)
    }
    fn get_tree_item(view_id: String, element_id: String) -> Option<TreeItem> {
        T::get_tree_item(view_id, element_id)
    }
    fn on_tree_item_activated(view_id: String, element_id: String) {
        T::on_tree_item_activated(view_id, element_id)
    }
    fn on_tree_visibility_changed(view_id: String, visible: bool) {
        T::on_tree_visibility_changed(view_id, visible)
    }

    fn provide_tasks(filter_type: Option<String>) -> Vec<TaskExecution> {
        T::provide_tasks(filter_type)
    }
    fn resolve_task(task_id: String, task_type: String) -> Option<TaskExecution> {
        T::resolve_task(task_id, task_type)
    }
    fn on_task_started(execution: TaskExecution) {
        T::on_task_started(execution)
    }
    fn on_task_ended(execution: TaskExecution, exit_code: Option<i32>) {
        T::on_task_ended(execution, exit_code)
    }
    fn on_task_process_started(execution: TaskExecution, pid: u32) {
        T::on_task_process_started(execution, pid)
    }
    fn on_task_process_ended(execution: TaskExecution, exit_code: Option<i32>) {
        T::on_task_process_ended(execution, exit_code)
    }

    fn create_debug_adapter_descriptor(
        debug_type: String,
        executable: String,
        args: Vec<String>,
    ) -> Result<String, String> {
        T::create_debug_adapter_descriptor(debug_type, executable, args)
    }
    fn on_debug_session_started(session_id: String, session_name: String, debug_type: String) {
        T::on_debug_session_started(session_id, session_name, debug_type)
    }
    fn on_debug_session_stopped(session_id: String) {
        T::on_debug_session_stopped(session_id)
    }
    fn on_debug_breakpoints_changed(added: Vec<String>, removed: Vec<String>, changed: Vec<String>) {
        T::on_debug_breakpoints_changed(added, removed, changed)
    }

    fn provide_notebook_serializer_deserialize(
        notebook_type: String,
        data: Vec<u8>,
    ) -> Result<Vec<NotebookCell>, String> {
        T::provide_notebook_serializer_deserialize(notebook_type, data)
    }
    fn provide_notebook_serializer_serialize(
        notebook_type: String,
        cells: Vec<NotebookCell>,
    ) -> Result<Vec<u8>, String> {
        T::provide_notebook_serializer_serialize(notebook_type, cells)
    }
    fn provide_notebook_kernel_execute_all(
        notebook_uri: String,
        cells: Vec<NotebookCell>,
    ) -> Vec<NotebookCellOutput> {
        T::provide_notebook_kernel_execute_all(notebook_uri, cells)
    }
    fn provide_notebook_kernel_execute_cell(
        notebook_uri: String,
        cell_index: u32,
        cell: NotebookCell,
    ) -> NotebookCellOutput {
        T::provide_notebook_kernel_execute_cell(notebook_uri, cell_index, cell)
    }
    fn provide_notebook_kernel_interrupt(notebook_uri: String) {
        T::provide_notebook_kernel_interrupt(notebook_uri)
    }

    fn provide_tests_resolve_children(controller_id: String, item_id: Option<String>) -> Vec<TestItem> {
        T::provide_tests_resolve_children(controller_id, item_id)
    }
    fn provide_tests_run(
        controller_id: String,
        run_id: String,
        items_to_run: Vec<String>,
        items_to_exclude: Vec<String>,
    ) {
        T::provide_tests_run(controller_id, run_id, items_to_run, items_to_exclude)
    }
    fn provide_tests_debug(
        controller_id: String,
        run_id: String,
        items_to_run: Vec<String>,
        items_to_exclude: Vec<String>,
    ) {
        T::provide_tests_debug(controller_id, run_id, items_to_run, items_to_exclude)
    }
    fn provide_tests_cancel_run(controller_id: String, run_id: String) {
        T::provide_tests_cancel_run(controller_id, run_id)
    }

    fn custom_editor_open(editor_type: String, uri: String, view_column: u32) -> Result<String, String> {
        T::custom_editor_open(editor_type, uri, view_column)
    }
    fn custom_editor_update(editor_id: String, changes: Vec<TextEdit>) -> Result<(), String> {
        T::custom_editor_update(editor_id, changes)
    }
    fn custom_editor_save(editor_id: String) -> Result<(), String> {
        T::custom_editor_save(editor_id)
    }
    fn custom_editor_save_as(editor_id: String, destination_uri: String) -> Result<(), String> {
        T::custom_editor_save_as(editor_id, destination_uri)
    }
    fn custom_editor_revert(editor_id: String) -> Result<(), String> {
        T::custom_editor_revert(editor_id)
    }
    fn custom_editor_dispose(editor_id: String) {
        T::custom_editor_dispose(editor_id)
    }

    fn webview_receive_message(panel_id: String, message: String) {
        T::webview_receive_message(panel_id, message)
    }
    fn on_webview_disposed(panel_id: String) {
        T::on_webview_disposed(panel_id)
    }
    fn on_webview_visibility_changed(panel_id: String, visible: bool) {
        T::on_webview_visibility_changed(panel_id, visible)
    }
}

/// Prelude module — import everything you need with `use sidex_extension_sdk::prelude::*;`
pub mod prelude {
    pub use super::sidex::extension::common_types::*;
    pub use super::sidex::extension::host_api as host;
    pub use super::SidexExtension;
}

/// Macro to export your extension implementation. Call this once at the
/// top level of your crate with your struct that implements `SidexExtension`.
#[macro_export]
macro_rules! export_extension {
    ($ty:ident) => {
        ::sidex_extension_sdk::export!($ty with_types_in ::sidex_extension_sdk);
    };
}
