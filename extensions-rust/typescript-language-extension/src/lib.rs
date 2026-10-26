use sidex_extension_sdk::prelude::*;

/// TypeScript/JavaScript language features.
/// Acts as a thin Rust client that routes requests to tsserver (bundled binary).
/// Provides: completion, hover, diagnostics, go-to-definition, document symbols,
/// signature help, code actions, rename, and inlay hints.
pub struct TypeScriptLanguageExtension;

impl SidexExtension for TypeScriptLanguageExtension {
    fn activate() -> Result<(), String> {
        Ok(())
    }

    fn deactivate() {}

    fn get_name() -> String {
        "TypeScript Language Features".to_string()
    }
    fn get_display_name() -> String {
        "TypeScript Language Features".to_string()
    }
    fn get_version() -> String {
        "0.1.0".to_string()
    }
    fn get_publisher() -> String {
        "sidex".to_string()
    }

    fn get_activation_events() -> Vec<String> {
        vec![
            "onLanguage:typescript".to_string(),
            "onLanguage:javascript".to_string(),
            "onLanguage:typescriptreact".to_string(),
            "onLanguage:javascriptreact".to_string(),
        ]
    }

    fn get_commands() -> Vec<CommandDefinition> {
        vec![
            CommandDefinition {
                id: "typescript.restartTsServer".to_string(),
                title: "TypeScript: Restart TS Server".to_string(),
            },
            CommandDefinition {
                id: "typescript.openTsServerLog".to_string(),
                title: "TypeScript: Open TS Server Log".to_string(),
            },
            CommandDefinition {
                id: "typescript.organizeImports".to_string(),
                title: "TypeScript: Organize Imports".to_string(),
            },
            CommandDefinition {
                id: "typescript.fixAll".to_string(),
                title: "TypeScript: Fix All".to_string(),
            },
            CommandDefinition {
                id: "javascript.reloadProjects".to_string(),
                title: "JavaScript: Reload Project".to_string(),
            },
        ]
    }

    fn provide_completion(ctx: DocumentContext, pos: Position) -> Option<CompletionList> {
        if !is_ts_js(&ctx.language_id) {
            return None;
        }
        // tsserver returns null at declaration sites (e.g. typing a new function name),
        // so we fall back to scanning the document for matching words.
        if let Some(result) = tsserver_request("completions", &ctx, Some(pos), None)
            .and_then(|r| parse_ts_completions(&r))
        {
            return Some(result);
        }
        word_completions_from_doc(&ctx, pos)
    }

    fn provide_hover(ctx: DocumentContext, pos: Position) -> Option<HoverResult> {
        if !is_ts_js(&ctx.language_id) {
            return None;
        }
        let result = tsserver_request("quickinfo", &ctx, Some(pos), None)?;
        parse_ts_quickinfo(&result)
    }

    fn provide_definition(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        if !is_ts_js(&ctx.language_id) {
            return vec![];
        }
        tsserver_request("definition", &ctx, Some(pos), None)
            .and_then(|r| parse_ts_locations(&r))
            .unwrap_or_default()
    }

    fn provide_references(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        if !is_ts_js(&ctx.language_id) {
            return vec![];
        }
        tsserver_request("references", &ctx, Some(pos), None)
            .and_then(|r| parse_ts_locations(&r))
            .unwrap_or_default()
    }

    fn provide_document_symbols(ctx: DocumentContext) -> Vec<DocumentSymbol> {
        if !is_ts_js(&ctx.language_id) {
            return vec![];
        }
        tsserver_request("navtree", &ctx, None, None)
            .and_then(|r| parse_ts_symbols(&r))
            .unwrap_or_default()
    }

    fn provide_signature_help(ctx: DocumentContext, pos: Position) -> Option<SignatureHelpResult> {
        if !is_ts_js(&ctx.language_id) {
            return None;
        }
        let result = tsserver_request("signatureHelp", &ctx, Some(pos), None)?;
        parse_ts_signature(&result)
    }

    fn provide_rename(
        ctx: DocumentContext,
        pos: Position,
        new_name: String,
    ) -> Option<RenameResult> {
        if !is_ts_js(&ctx.language_id) {
            return None;
        }
        let extra = format!(r#","newName":"{}""#, new_name.replace('"', "\\\""));
        let result = tsserver_request("rename", &ctx, Some(pos), Some(&extra))?;
        parse_ts_rename(&result)
    }

    fn provide_code_actions(
        ctx: DocumentContext,
        range: Range,
        _diags: Vec<Diagnostic>,
    ) -> Vec<CodeAction> {
        if !is_ts_js(&ctx.language_id) {
            return vec![];
        }
        let extra = format!(
            r#","startLine":{},"startOffset":{},"endLine":{},"endOffset":{}"#,
            range.start.line + 1,
            range.start.character + 1,
            range.end.line + 1,
            range.end.character + 1
        );
        tsserver_request("getCodeFixes", &ctx, None, Some(&extra))
            .and_then(|r| parse_ts_code_actions(&r))
            .unwrap_or_default()
    }

    fn provide_inlay_hints(ctx: DocumentContext, range: Range) -> Vec<InlayHint> {
        if !is_ts_js(&ctx.language_id) {
            return vec![];
        }
        let extra = format!(
            r#","startLine":{},"endLine":{}"#,
            range.start.line + 1,
            range.end.line + 1
        );
        tsserver_request("provideInlayHints", &ctx, None, Some(&extra))
            .and_then(|r| parse_ts_inlay_hints(&r))
            .unwrap_or_default()
    }

    fn on_file_event(events: Vec<FileEvent>) {
        for event in events {
            if is_ts_js_file(&event.uri) {
                let ctx = DocumentContext {
                    uri: event.uri.clone(),
                    language_id: lang_from_uri(&event.uri),
                    version: 0,
                };
                if let Some(result) = tsserver_request("semanticDiagnosticsSync", &ctx, None, None)
                {
                    if let Some(diags) = parse_ts_diagnostics(&result) {
                        host::publish_diagnostics(&event.uri, &diags);
                    }
                }
            }
        }
    }

    fn execute_command(command_id: String, args: String) -> Result<String, String> {
        match command_id.as_str() {
            "typescript.restartTsServer" => {
                let _ = host::execute_command("__sidex.restartTsServer", &args);
                Ok("restarted".to_string())
            }
            "typescript.organizeImports" => Ok(r#"{"action":"organizeImports"}"#.to_string()),
            _ => Err(format!("unknown: {command_id}")),
        }
    }

    fn get_semantic_tokens_legend() -> Option<SemanticTokensLegend> {
        None
    }
    fn provide_type_definition(_: DocumentContext, _: Position) -> Vec<Location> {
        vec![]
    }
    fn provide_implementation(_: DocumentContext, _: Position) -> Vec<Location> {
        vec![]
    }
    fn provide_declaration(_: DocumentContext, _: Position) -> Vec<Location> {
        vec![]
    }
    fn provide_document_highlights(_: DocumentContext, _: Position) -> Vec<DocumentHighlight> {
        vec![]
    }
    fn prepare_rename(_: DocumentContext, _: Position) -> Option<RenameLocation> {
        None
    }
    fn provide_code_lenses(_: DocumentContext) -> Vec<CodeLens> {
        vec![]
    }
    fn provide_formatting(_: DocumentContext, _: u32, _: bool) -> Vec<TextEdit> {
        vec![]
    }
    fn provide_range_formatting(_: DocumentContext, _: Range, _: u32, _: bool) -> Vec<TextEdit> {
        vec![]
    }
    fn provide_folding_ranges(_: DocumentContext) -> Vec<FoldingRange> {
        vec![]
    }
    fn provide_document_links(_: DocumentContext) -> Vec<DocumentLink> {
        vec![]
    }
    fn provide_selection_ranges(_: DocumentContext, _: Vec<Position>) -> Vec<SelectionRange> {
        vec![]
    }
    fn provide_semantic_tokens(_: DocumentContext) -> Option<SemanticTokens> {
        None
    }
    fn provide_document_colors(_: DocumentContext) -> Vec<ColorInfo> {
        vec![]
    }
    fn provide_workspace_symbols(_: String) -> Vec<DocumentSymbol> {
        vec![]
    }
    fn on_configuration_changed(_: String) {}
    fn get_tree_children(_: String, _: Option<String>) -> Vec<TreeItem> {
        vec![]
    }
    fn get_languages() -> Vec<String> { vec![] }
    fn get_task_types() -> Vec<TaskDefinition> { vec![] }
    fn get_debug_types() -> Vec<String> { vec![] }
    fn get_view_ids() -> Vec<String> { vec![] }
    fn get_notebook_types() -> Vec<String> { vec![] }
    fn get_custom_editor_types() -> Vec<String> { vec![] }
    fn provide_completion_item_resolve(_: String, _: Option<u32>, _: Option<String>) -> Option<CompletionList> { None }
    fn provide_workspace_symbol_resolve(_: String, _: Option<String>) -> Option<DocumentSymbol> { None }
    fn provide_code_action_resolve(_: String, _: Option<String>, _: Option<String>) -> Option<CodeAction> { None }
    fn provide_code_lens_resolve(_: Range, _: Option<String>, _: Option<String>) -> Option<CodeLens> { None }
    fn provide_on_type_formatting(_: DocumentContext, _: Position, _: String, _: u32, _: bool) -> Vec<TextEdit> { vec![] }
    fn provide_inlay_hint_resolve(_: Position, _: String, _: Option<u32>) -> Option<InlayHint> { None }
    fn provide_document_link_resolve(_: Range, _: Option<String>) -> Option<DocumentLink> { None }
    fn provide_semantic_tokens_range(_: DocumentContext, _: Range) -> Option<SemanticTokens> { None }
    fn provide_semantic_tokens_delta(_: DocumentContext, _: String) -> Option<SemanticTokens> { None }
    fn provide_color_presentation(_: DocumentContext, _: ColorInfo, _: Range) -> Vec<TextEdit> { vec![] }
    fn provide_call_hierarchy_incoming(_: DocumentContext, _: Position) -> Vec<DocumentSymbol> { vec![] }
    fn provide_call_hierarchy_outgoing(_: DocumentContext, _: Position) -> Vec<DocumentSymbol> { vec![] }
    fn provide_type_hierarchy_subtypes(_: DocumentContext, _: Position) -> Vec<DocumentSymbol> { vec![] }
    fn provide_type_hierarchy_supertypes(_: DocumentContext, _: Position) -> Vec<DocumentSymbol> { vec![] }
    fn provide_linked_editing_ranges(_: DocumentContext, _: Position) -> Vec<Range> { vec![] }
    fn on_document_opened(_: DocumentContext) {}
    fn on_document_closed(_: DocumentContext) {}
    fn on_document_changed(_: DocumentContext, _: Vec<TextEdit>) {}
    fn on_document_saved(_: DocumentContext, _: u32) {}
    fn on_document_will_save(_: DocumentContext, _: u32) -> Vec<TextEdit> { vec![] }
    fn on_document_language_changed(_: String, _: String, _: String) {}
    fn on_workspace_folders_changed(_: Vec<String>, _: Vec<String>) {}
    fn on_files_created(_: Vec<String>) {}
    fn on_files_renamed(_: Vec<String>, _: Vec<String>) {}
    fn on_files_deleted(_: Vec<String>) {}
    fn on_files_will_create(_: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> { None }
    fn on_files_will_rename(_: Vec<String>, _: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> { None }
    fn on_files_will_delete(_: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> { None }
    fn on_active_editor_changed(_: Option<String>) {}
    fn on_visible_editors_changed(_: Vec<String>) {}
    fn on_editor_selections_changed(_: String, _: Vec<Range>) {}
    fn on_editor_scroll_changed(_: String, _: Vec<Range>) {}
    fn on_editor_view_column_changed(_: String, _: u32) {}
    fn get_tree_item(_: String, _: String) -> Option<TreeItem> { None }
    fn on_tree_item_activated(_: String, _: String) {}
    fn on_tree_visibility_changed(_: String, _: bool) {}
    fn provide_tasks(_: Option<String>) -> Vec<TaskExecution> { vec![] }
    fn resolve_task(_: String, _: String) -> Option<TaskExecution> { None }
    fn on_task_started(_: TaskExecution) {}
    fn on_task_ended(_: TaskExecution, _: Option<i32>) {}
    fn on_task_process_started(_: TaskExecution, _: u32) {}
    fn on_task_process_ended(_: TaskExecution, _: Option<i32>) {}
    fn create_debug_adapter_descriptor(_: String, _: String, _: Vec<String>) -> Result<String, String> { Err("not supported".into()) }
    fn on_debug_session_started(_: String, _: String, _: String) {}
    fn on_debug_session_stopped(_: String) {}
    fn on_debug_breakpoints_changed(_: Vec<String>, _: Vec<String>, _: Vec<String>) {}
    fn provide_notebook_serializer_deserialize(_: String, _: Vec<u8>) -> Result<Vec<NotebookCell>, String> { Err("not supported".into()) }
    fn provide_notebook_serializer_serialize(_: String, _: Vec<NotebookCell>) -> Result<Vec<u8>, String> { Err("not supported".into()) }
    fn provide_notebook_kernel_execute_all(_: String, _: Vec<NotebookCell>) -> Vec<NotebookCellOutput> { vec![] }
    fn provide_notebook_kernel_execute_cell(_: String, _: u32, _: NotebookCell) -> NotebookCellOutput { NotebookCellOutput { items: vec![] } }
    fn provide_notebook_kernel_interrupt(_: String) {}
    fn provide_tests_resolve_children(_: String, _: Option<String>) -> Vec<TestItem> { vec![] }
    fn provide_tests_run(_: String, _: String, _: Vec<String>, _: Vec<String>) {}
    fn provide_tests_debug(_: String, _: String, _: Vec<String>, _: Vec<String>) {}
    fn provide_tests_cancel_run(_: String, _: String) {}
    fn custom_editor_open(_: String, _: String, _: u32) -> Result<String, String> { Err("not supported".into()) }
    fn custom_editor_update(_: String, _: Vec<TextEdit>) -> Result<(), String> { Err("not supported".into()) }
    fn custom_editor_save(_: String) -> Result<(), String> { Err("not supported".into()) }
    fn custom_editor_save_as(_: String, _: String) -> Result<(), String> { Err("not supported".into()) }
    fn custom_editor_revert(_: String) -> Result<(), String> { Err("not supported".into()) }
    fn custom_editor_dispose(_: String) {}
    fn webview_receive_message(_: String, _: String) {}
    fn on_webview_disposed(_: String) {}
    fn on_webview_visibility_changed(_: String, _: bool) {}
}

fn is_ts_js(lang: &str) -> bool {
    matches!(
        lang,
        "typescript" | "javascript" | "typescriptreact" | "javascriptreact"
    )
}

fn is_ts_js_file(uri: &str) -> bool {
    uri.ends_with(".ts")
        || uri.ends_with(".tsx")
        || uri.ends_with(".js")
        || uri.ends_with(".jsx")
        || uri.ends_with(".mts")
        || uri.ends_with(".mjs")
}

fn lang_from_uri(uri: &str) -> String {
    if uri.ends_with(".tsx") || uri.ends_with(".jsx") {
        return "typescriptreact".to_string();
    }
    if uri.ends_with(".ts") || uri.ends_with(".mts") {
        return "typescript".to_string();
    }
    "javascript".to_string()
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && bytes.get(index + 1).is_some_and(u8::is_ascii_hexdigit)
            && bytes.get(index + 2).is_some_and(u8::is_ascii_hexdigit)
        {
            if let Ok(value) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// tsserver works with plain OS paths, while the workbench passes `file:///f%3A/...` URIs.
fn uri_to_file_path(uri: &str) -> String {
    let raw = uri.strip_prefix("file://").unwrap_or(uri);
    let decoded = percent_decode(raw);
    let bytes = decoded.as_bytes();
    if bytes.len() >= 3 && bytes[0] == b'/' && bytes[2] == b':' {
        return decoded[1..].to_string();
    }
    decoded
}

/// Builds the URI form the workbench uses for a file on disk.
fn file_uri_from_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let mut encoded = String::with_capacity(normalized.len() + 8);
    for (index, ch) in normalized.chars().enumerate() {
        if ch == ':' && index == 1 {
            encoded.push_str("%3A");
        } else {
            encoded.push(ch);
        }
    }
    format!("file:///{encoded}")
}

/// TypeScript sources are written with `.js` import specifiers that tsserver resolves
/// literally when no project is loaded. Fall back to the matching `.ts` file on disk.
fn existing_source_file(path: &str) -> String {
    if host::stat_file(&file_uri_from_path(path)).is_ok() {
        return path.to_string();
    }
    let alternatives = [
        (".js", ".ts"),
        (".jsx", ".tsx"),
        (".mjs", ".mts"),
        (".cjs", ".cts"),
    ];
    for (extension, replacement) in alternatives {
        if let Some(stem) = path.strip_suffix(extension) {
            let candidate = format!("{stem}{replacement}");
            if host::stat_file(&file_uri_from_path(&candidate)).is_ok() {
                return candidate;
            }
        }
    }
    path.to_string()
}

/// Scans document text and returns words matching the prefix at the cursor.
/// Used as a fallback when tsserver returns no completions (e.g. at declaration sites).
fn word_completions_from_doc(ctx: &DocumentContext, pos: Position) -> Option<CompletionList> {
    let text = host::get_document_text(&ctx.uri)?;
    let lines: Vec<&str> = text.lines().collect();
    let line_idx = pos.line as usize;
    if line_idx >= lines.len() {
        return None;
    }
    let line = lines[line_idx];
    let col = (pos.character as usize).min(line.len());

    let before = &line[..col];
    let prefix_start = before
        .rfind(|c: char| !c.is_alphanumeric() && c != '_' && c != '$')
        .map(|i| i + 1)
        .unwrap_or(0);
    let prefix = &before[prefix_start..];

    if prefix.len() < 2 {
        return None;
    }

    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::new();
    let word_re_iter = text.split(|c: char| !c.is_alphanumeric() && c != '_' && c != '$');

    for word in word_re_iter {
        if word.len() > prefix.len() && word.starts_with(prefix) && !seen.contains(word) {
            seen.insert(word.to_string());
            items.push(CompletionItem {
                label: word.to_string(),
                kind: Some(0), // Text
                detail: None,
                documentation: None,
                insert_text: Some(word.to_string()),
                sort_text: Some(format!("9{word}")), // rank after tsserver results
                filter_text: None,
            });
            if items.len() >= 50 {
                break;
            }
        }
    }

    if items.is_empty() {
        None
    } else {
        Some(CompletionList {
            items,
            is_incomplete: false,
        })
    }
}

fn tsserver_request(
    command: &str,
    ctx: &DocumentContext,
    pos: Option<Position>,
    extra: Option<&str>,
) -> Option<String> {
    let file = uri_to_file_path(&ctx.uri);
    let pos_str = pos
        .map(|p| format!(r#","line":{},"offset":{}"#, p.line + 1, p.character + 1))
        .unwrap_or_default();
    let extra_str = extra.unwrap_or("");
    let payload = format!(
        r#"{{"command":"{command}","arguments":{{"file":"{}"{pos_str}{extra_str}}}}}"#,
        file.replace('"', "\\\"")
    );

    host::execute_command("__sidex.tsserver", &payload).ok()
}

fn parse_ts_completions(json: &str) -> Option<CompletionList> {
    let body_start = json.find("\"entries\":")?;
    let arr_start = json[body_start..].find('[')? + body_start;
    let mut items = Vec::new();
    let mut pos = arr_start + 1;
    let chars: Vec<char> = json.chars().collect();

    while pos < chars.len() {
        while pos < chars.len() && chars[pos].is_whitespace() {
            pos += 1;
        }
        if pos >= chars.len() || chars[pos] == ']' {
            break;
        }
        if chars[pos] == '{' {
            let (obj, next) = extract_json_object(&chars, pos);
            if let Some(name) = extract_field(&chars, &obj, "name") {
                let kind_str = extract_field(&chars, &obj, "kind").unwrap_or_default();
                let kind = ts_kind_to_completion_kind(&kind_str);
                items.push(CompletionItem {
                    label: name.clone(),
                    kind: Some(kind),
                    detail: extract_field(&chars, &obj, "kindModifiers"),
                    documentation: None,
                    insert_text: Some(name),
                    sort_text: extract_field(&chars, &obj, "sortText"),
                    filter_text: None,
                });
            }
            pos = next;
        } else {
            pos += 1;
        }
        while pos < chars.len() && (chars[pos] == ',' || chars[pos].is_whitespace()) {
            pos += 1;
        }
    }

    if items.is_empty() {
        return None;
    }
    Some(CompletionList {
        items,
        is_incomplete: false,
    })
}

fn parse_ts_quickinfo(json: &str) -> Option<HoverResult> {
    let display = extract_field_from_str(json, "displayString")?;
    let doc = extract_field_from_str(json, "documentation").unwrap_or_default();
    let mut contents = vec![format!("```typescript\n{display}\n```")];
    if !doc.is_empty() {
        contents.push(doc);
    }
    Some(HoverResult {
        contents,
        range: None,
    })
}

fn parse_ts_locations(json: &str) -> Option<Vec<Location>> {
    let mut locs = Vec::new();
    let mut search = json;
    while let Some(file_pos) = search.find("\"file\":") {
        let after = &search[file_pos + 7..];
        let file = extract_string_value(after)?;
        let start_line = extract_field_from_str(&search[file_pos..], "line")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(1)
            .saturating_sub(1);
        let start_col = extract_field_from_str(&search[file_pos..], "offset")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(1)
            .saturating_sub(1);
        locs.push(Location {
            uri: file_uri_from_path(&existing_source_file(&file)),
            range: Range {
                start: Position {
                    line: start_line,
                    character: start_col,
                },
                end: Position {
                    line: start_line,
                    character: start_col,
                },
            },
        });
        search = &search[file_pos + 7..];
    }
    if locs.is_empty() {
        None
    } else {
        Some(locs)
    }
}

/// Returns the raw body of the JSON array stored under `key`.
fn find_array_body<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let start = json.find(&format!("\"{key}\":"))?;
    let rest = &json[start..];
    let open = rest.find('[')?;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, ch) in rest[open..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&rest[open + 1..open + offset]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Returns the raw body of the JSON object stored under `key`.
fn find_object_body<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let start = json.find(&format!("\"{key}\":"))?;
    let rest = &json[start..];
    let open = rest.find('{')?;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, ch) in rest[open..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&rest[open + 1..open + offset]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Splits an array body into the top level object literals it contains.
fn object_list(body: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut depth = 0i32;
    let mut start = None;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, ch) in body.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => {
                if depth == 0 {
                    start = Some(offset);
                }
                depth += 1;
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    if let Some(begin) = start.take() {
                        items.push(body[begin..=offset].to_string());
                    }
                }
            }
            _ => {}
        }
    }
    items
}

fn span_positions(span: &str) -> Option<(Position, Position)> {
    let read = |part: &str| -> Option<Position> {
        let line = extract_field_from_str(part, "line")?.parse::<u32>().ok()?;
        let offset = extract_field_from_str(part, "offset")?.parse::<u32>().ok()?;
        Some(Position {
            line: line.saturating_sub(1),
            character: offset.saturating_sub(1),
        })
    };
    let start = read(find_object_body(span, "start")?)?;
    let end = read(find_object_body(span, "end")?)?;
    Some((start, end))
}

/// Parses one `navtree` item into a flat symbol. Nested `childItems` of classes,
/// interfaces, enums and namespaces are emitted afterwards with an increased depth.
fn parse_ts_item(item: &str, depth: u32) -> Option<DocumentSymbol> {
    let name = extract_field_from_str(item, "text")?;
    let kind = ts_kind_to_symbol_kind(&extract_field_from_str(item, "kind").unwrap_or_default());

    let range = find_array_body(item, "spans")
        .and_then(|body| object_list(body).into_iter().next())
        .and_then(|span| span_positions(&span))
        .map(|(start, end)| Range { start, end });

    let selection = find_object_body(item, "nameSpan")
        .and_then(|body| span_positions(body))
        .map(|(start, end)| Range { start, end })
        .or_else(|| range.clone());

    let empty = Range {
        start: Position { line: 0, character: 0 },
        end: Position { line: 0, character: 0 },
    };

    Some(DocumentSymbol {
        name,
        detail: None,
        kind,
        range: range.unwrap_or_else(|| empty.clone()),
        selection_range: selection.unwrap_or(empty),
        depth,
    })
}

/// Only namespaces, classes, interfaces and enums contribute children; the items
/// inside function bodies (local variables, anonymous functions) are noise in an
/// outline, and VS Code hides them as well.
fn ts_kind_has_children(kind: &str) -> bool {
    matches!(
        kind,
        "module" | "namespace" | "class" | "interface" | "enum" | "object literal"
    )
}

fn collect_ts_item(item: &str, depth: u32, out: &mut Vec<DocumentSymbol>) {
    let kind = extract_field_from_str(item, "kind").unwrap_or_default();
    // Import bindings are not symbols in VS Code's outline.
    if kind == "alias" {
        return;
    }
    if let Some(symbol) = parse_ts_item(item, depth) {
        out.push(symbol);
    }
    if ts_kind_has_children(&kind) {
        if let Some(body) = find_array_body(item, "childItems") {
            for child in object_list(body) {
                collect_ts_item(&child, depth + 1, out);
            }
        }
    }
}

fn parse_ts_symbols(json: &str) -> Option<Vec<DocumentSymbol>> {
    let body = find_array_body(json, "childItems")?;
    let mut symbols = Vec::new();
    for item in object_list(body) {
        collect_ts_item(&item, 0, &mut symbols);
    }
    if symbols.is_empty() {
        None
    } else {
        Some(symbols)
    }
}

fn parse_ts_signature(json: &str) -> Option<SignatureHelpResult> {
    let label = extract_field_from_str(json, "prefixDisplayParts").unwrap_or_default();
    let doc = extract_field_from_str(json, "documentation").unwrap_or_default();
    let active_sig = extract_field_from_str(json, "selectedItemIndex")
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    let active_param = extract_field_from_str(json, "argumentIndex")
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    Some(SignatureHelpResult {
        signatures: vec![SignatureInfo {
            label,
            documentation: if doc.is_empty() { None } else { Some(doc) },
            parameters: vec![],
        }],
        active_signature: active_sig,
        active_parameter: active_param,
    })
}

fn parse_ts_rename(json: &str) -> Option<RenameResult> {
    let mut edits = Vec::new();
    let mut search = json;
    while let Some(file_pos) = search.find("\"fileName\":") {
        let file = extract_string_value(&search[file_pos + 11..])?;
        let new_text = extract_field_from_str(&search[file_pos..], "newText").unwrap_or_default();
        let line = extract_field_from_str(&search[file_pos..], "line")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(1)
            .saturating_sub(1);
        let start_col = extract_field_from_str(&search[file_pos..], "offset")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(1)
            .saturating_sub(1);
        let end_col = start_col
            + extract_field_from_str(&search[file_pos..], "length")
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(1);
        edits.push(ResourceTextEdit {
            uri: file_uri_from_path(&existing_source_file(&file)),
            edits: vec![TextEdit {
                range: Range {
                    start: Position {
                        line,
                        character: start_col,
                    },
                    end: Position {
                        line,
                        character: end_col,
                    },
                },
                new_text,
            }],
        });
        search = &search[file_pos + 11..];
    }
    if edits.is_empty() {
        return None;
    }
    Some(RenameResult { edits })
}

fn parse_ts_code_actions(json: &str) -> Option<Vec<CodeAction>> {
    let mut actions = Vec::new();
    let mut search = json;
    while let Some(desc_pos) = search.find("\"description\":") {
        if let Some(title) = extract_string_value(&search[desc_pos + 14..]) {
            actions.push(CodeAction {
                title,
                kind: Some("quickfix".to_string()),
                diagnostics: vec![],
                is_preferred: false,
                edit: None,
            });
            search = &search[desc_pos + 14..];
        } else {
            break;
        }
    }
    if actions.is_empty() {
        None
    } else {
        Some(actions)
    }
}

fn parse_ts_diagnostics(json: &str) -> Option<Vec<Diagnostic>> {
    let mut diags = Vec::new();
    let mut search = json;
    while let Some(msg_pos) = search.find("\"messageText\":") {
        if let Some(message) = extract_string_value(&search[msg_pos + 14..]) {
            let line = extract_field_from_str(&search[msg_pos..], "line")
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(1)
                .saturating_sub(1);
            let col = extract_field_from_str(&search[msg_pos..], "offset")
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(1)
                .saturating_sub(1);
            let end_col = col
                + extract_field_from_str(&search[msg_pos..], "length")
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(1);
            let category =
                extract_field_from_str(&search[msg_pos..], "category").unwrap_or_default();
            let severity = match category.as_str() {
                "error" => DiagnosticSeverity::Error,
                "warning" => DiagnosticSeverity::Warning,
                "suggestion" => DiagnosticSeverity::Hint,
                _ => DiagnosticSeverity::Information,
            };
            let code = extract_field_from_str(&search[msg_pos..], "code");
            diags.push(Diagnostic {
                range: Range {
                    start: Position {
                        line,
                        character: col,
                    },
                    end: Position {
                        line,
                        character: end_col,
                    },
                },
                message,
                severity,
                source: Some("ts".to_string()),
                code,
            });
            search = &search[msg_pos + 14..];
        } else {
            break;
        }
    }
    if diags.is_empty() {
        None
    } else {
        Some(diags)
    }
}

fn parse_ts_inlay_hints(json: &str) -> Option<Vec<InlayHint>> {
    let mut hints = Vec::new();
    let mut search = json;
    while let Some(text_pos) = search.find("\"text\":") {
        if let Some(text) = extract_string_value(&search[text_pos + 7..]) {
            let line = extract_field_from_str(&search[text_pos..], "line")
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(1)
                .saturating_sub(1);
            let col = extract_field_from_str(&search[text_pos..], "offset")
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(1)
                .saturating_sub(1);
            hints.push(InlayHint {
                position: Position {
                    line,
                    character: col,
                },
                label: text,
                kind: None,
                padding_left: true,
                padding_right: false,
            });
            search = &search[text_pos + 7..];
        } else {
            break;
        }
    }
    if hints.is_empty() {
        None
    } else {
        Some(hints)
    }
}

fn extract_field_from_str(json: &str, field: &str) -> Option<String> {
    let key = format!("\"{}\":", field);
    let start = json.find(&key)? + key.len();
    let rest = json[start..].trim_start();
    if rest.starts_with('"') {
        extract_string_value(rest)
    } else {
        let end = rest
            .find(|c: char| c == ',' || c == '}' || c == ']' || c == '\n')
            .unwrap_or(rest.len());
        Some(rest[..end].trim().to_string())
    }
}

fn extract_string_value(s: &str) -> Option<String> {
    let s = s.trim_start();
    if !s.starts_with('"') {
        return None;
    }
    let mut chars = s[1..].chars();
    let mut out = String::new();
    let mut escaped = false;
    loop {
        match chars.next()? {
            '\\' if !escaped => escaped = true,
            '"' if !escaped => break,
            c => {
                out.push(c);
                escaped = false;
            }
        }
    }
    Some(out)
}

fn extract_field(_chars: &[char], obj_json: &str, field: &str) -> Option<String> {
    extract_field_from_str(obj_json, field)
}

fn extract_json_object(chars: &[char], start: usize) -> (String, usize) {
    let mut depth = 0i32;
    let mut end = start;
    for i in start..chars.len() {
        if chars[i] == '{' {
            depth += 1;
        }
        if chars[i] == '}' {
            depth -= 1;
            if depth == 0 {
                end = i + 1;
                break;
            }
        }
    }
    let s: String = chars[start..end].iter().collect();
    (s, end)
}

fn ts_kind_to_completion_kind(kind: &str) -> u32 {
    match kind {
        "function" | "local function" => 2,
        "method" => 1,
        "constructor" => 3,
        "field" | "property" => 9,
        "variable" | "local var" => 5,
        "class" => 6,
        "interface" => 7,
        "module" | "namespace" => 8,
        "keyword" => 13,
        "type" | "alias" => 24,
        "enum" => 12,
        "enum member" => 19,
        "const" => 20,
        "parameter" => 5,
        _ => 0,
    }
}

fn ts_kind_to_symbol_kind(kind: &str) -> u32 {
    match kind {
        "function" => 11,
        "method" => 5,
        "constructor" => 8,
        "property" => 6,
        "variable" | "const" | "let" => 12,
        "class" => 4,
        "interface" => 10,
        "module" | "namespace" => 2,
        "type" => 24,
        "enum" => 9,
        "enum member" => 21,
        _ => 12,
    }
}

sidex_extension_sdk::export_extension!(TypeScriptLanguageExtension);
