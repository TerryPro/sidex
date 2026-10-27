//! Markdown language features for SideX: document outline, heading folding and
//! clickable links. Runs entirely in WASM 鈥?no language server process needed.

use sidex_extension_sdk::prelude::*;

pub struct MarkdownLanguageExtension;

#[derive(Clone, Copy)]
struct Heading {
    level: usize,
    /// zero based line index
    line: usize,
    /// byte offset of the text inside the line
    start: usize,
    /// byte offset where the text ends
    end: usize,
}

fn pos(line: usize, character: u32) -> Position {
    Position {
        line: line as u32,
        character,
    }
}

/// VS Code columns count UTF-16 code units, Rust indices count UTF-8 bytes.
fn utf16_col(line: &str, byte_idx: usize) -> u32 {
    line[..byte_idx]
        .chars()
        .map(|c| c.len_utf16() as u32)
        .sum()
}

fn is_fence(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with("```") || trimmed.starts_with("~~~")
}

fn parse_headings(lines: &[&str]) -> Vec<Heading> {
    let mut fenced = vec![false; lines.len()];
    let mut in_fence = false;
    for (index, line) in lines.iter().enumerate() {
        if is_fence(line) {
            fenced[index] = true;
            in_fence = !in_fence;
        } else {
            fenced[index] = in_fence;
        }
    }

    let mut headings = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        if fenced[index] || lines[index].starts_with("    ") {
            index += 1;
            continue;
        }

        let line = lines[index];
        let trimmed = line.trim_start();
        let hashes = trimmed.chars().take_while(|c| *c == '#').count();
        if (1..=6).contains(&hashes) {
            let rest = &trimmed[hashes..];
            if rest.starts_with(' ') {
                let text = rest.trim().trim_end_matches('#').trim_end();
                if !text.is_empty() {
                    let indent = line.len() - trimmed.len();
                    let start = indent + hashes + 1;
                    headings.push(Heading {
                        level: hashes,
                        line: index,
                        start,
                        end: start + text.len(),
                    });
                }
            }
            index += 1;
            continue;
        }

        // Setext heading: a text line underlined with === (level 1) or --- (level 2).
        if index + 1 < lines.len() && !fenced[index + 1] {
            let underline = lines[index + 1].trim();
            let level = if !underline.is_empty() && underline.chars().all(|c| c == '=') {
                1
            } else if !underline.is_empty() && underline.chars().all(|c| c == '-') {
                2
            } else {
                0
            };
            let text = line.trim();
            let is_paragraph = !text.is_empty()
                && !text.starts_with('-')
                && !text.starts_with('*')
                && !text.starts_with('>')
                && !text.starts_with('|');
            if level > 0 && is_paragraph {
                let indent = line.len() - trimmed.len();
                headings.push(Heading {
                    level,
                    line: index,
                    start: indent,
                    end: indent + text.len(),
                });
                index += 2;
                continue;
            }
        }

        index += 1;
    }
    headings
}

fn heading_folds(lines: &[&str], headings: &[Heading]) -> Vec<FoldingRange> {
    let mut folds = Vec::new();
    for (index, heading) in headings.iter().enumerate() {
        let mut end = lines.len().saturating_sub(1);
        for next in &headings[index + 1..] {
            if next.level <= heading.level {
                end = next.line.saturating_sub(1);
                break;
            }
        }
        if end > heading.line {
            folds.push(FoldingRange {
                start_line: heading.line as u32,
                end_line: end as u32,
                kind: None,
            });
        }
    }
    folds
}

fn fence_folds(lines: &[&str]) -> Vec<FoldingRange> {
    let mut folds = Vec::new();
    let mut open: Option<usize> = None;
    for (index, line) in lines.iter().enumerate() {
        if !is_fence(line) {
            continue;
        }
        match open {
            None => open = Some(index),
            Some(start) => {
                if index > start + 1 {
                    folds.push(FoldingRange {
                        start_line: start as u32,
                        end_line: index as u32,
                        kind: None,
                    });
                }
                open = None;
            }
        }
    }
    folds
}

/// Strips `<...>` brackets and an optional link title from a link destination.
fn clean_target(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix('<') {
        if let Some(end) = rest.find('>') {
            return rest[..end].trim().to_string();
        }
    }
    match trimmed.find(char::is_whitespace) {
        Some(index) => trimmed[..index].trim().to_string(),
        None => trimmed.to_string(),
    }
}

fn normalize_uri_path(uri: &str) -> String {
    let Some(scheme_end) = uri.find("://") else {
        return uri.to_string();
    };
    let rest = &uri[scheme_end + 3..];
    let Some(slash) = rest.find('/') else {
        return uri.to_string();
    };
    let prefix = format!("{}{}", &uri[..scheme_end + 3], &rest[..slash]);
    let mut segments: Vec<&str> = Vec::new();
    for segment in rest[slash..].split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            other => segments.push(other),
        }
    }
    format!("{prefix}/{}", segments.join("/"))
}

fn resolve_target(document_uri: &str, target: &str) -> String {
    if target.is_empty() {
        return document_uri.to_string();
    }
    if target.starts_with('#') {
        return format!("{document_uri}{target}");
    }
    let lower = target.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("data:")
        || lower.starts_with("vscode-")
    {
        return target.to_string();
    }

    let (path, fragment) = match target.find('#') {
        Some(index) => (&target[..index], Some(&target[index..])),
        None => (target, None),
    };
    let joined = if path.starts_with('/') {
        // Root relative to the document's origin, e.g. file:///f%3A/...
        match document_uri.find("://") {
            Some(scheme_end) => {
                let rest = &document_uri[scheme_end + 3..];
                match rest.find('/') {
                    Some(slash) => {
                        format!("{}{path}", &document_uri[..scheme_end + 3 + slash])
                    }
                    None => format!("{document_uri}{path}"),
                }
            }
            None => format!("{document_uri}{path}"),
        }
    } else {
        let base = document_uri.rsplit_once('/').map_or(document_uri, |(base, _)| base);
        format!("{base}/{path}")
    };
    let normalized = normalize_uri_path(&joined);
    match fragment {
        Some(fragment) => format!("{normalized}{fragment}"),
        None => normalized,
    }
}

struct ParsedLink {
    start: usize,
    end: usize,
    target: String,
}

/// Finds inline links and images in a single line, skipping fenced/inline code.
fn parse_links(line: &str) -> Vec<ParsedLink> {
    let bytes = line.as_bytes();
    let mut links = Vec::new();
    let mut index = 0;
    let mut in_code = false;
    while index < bytes.len() {
        if bytes[index] == b'`' {
            in_code = !in_code;
            index += 1;
            continue;
        }
        if in_code || bytes[index] != b'[' {
            index += 1;
            continue;
        }

        let mut closing = index + 1;
        while closing < bytes.len() && bytes[closing] != b']' && bytes[closing] != b'[' {
            closing += 1;
        }
        if closing + 1 >= bytes.len() || bytes[closing] != b']' || bytes[closing + 1] != b'(' {
            index += 1;
            continue;
        }

        let mut cursor = closing + 2;
        let mut depth = 1;
        while cursor < bytes.len() {
            match bytes[cursor] {
                b'(' => depth += 1,
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                _ => {}
            }
            cursor += 1;
        }
        if cursor >= bytes.len() {
            break;
        }

        let target = clean_target(&line[closing + 2..cursor]);
        if !target.is_empty() {
            links.push(ParsedLink {
                start: index,
                end: cursor + 1,
                target,
            });
        }
        index = cursor + 1;
    }
    links
}

fn document_links(uri: &str, text: &str) -> Vec<DocumentLink> {
    let mut links = Vec::new();
    let mut in_fence = false;
    for (line_index, line) in text.lines().enumerate() {
        if is_fence(line) {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        for link in parse_links(line) {
            let start = utf16_col(line, link.start);
            let end = utf16_col(line, link.end);
            links.push(DocumentLink {
                range: Range {
                    start: pos(line_index, start),
                    end: pos(line_index, end),
                },
                target: Some(resolve_target(uri, &link.target)),
            });
        }
    }
    let lines: Vec<&str> = text.lines().collect();
    for definition in parse_definitions(&lines) {
        let line = lines[definition.line];
        links.push(DocumentLink {
            range: Range {
                start: pos(definition.line, utf16_col(line, definition.target_start)),
                end: pos(definition.line, utf16_col(line, definition.target_end)),
            },
            target: Some(resolve_target(uri, &definition.target)),
        });
    }
    links
}

fn utf16_to_char_index(line: &str, utf16: usize) -> usize {
    let mut units = 0;
    for (index, ch) in line.char_indices() {
        if units >= utf16 {
            return index;
        }
        units += ch.len_utf16();
    }
    line.len()
}

fn resolve_dir(document_uri: &str, dir_part: &str) -> String {
    if dir_part.is_empty() {
        document_uri
            .rsplit_once('/')
            .map_or(document_uri.to_string(), |(dir, _)| dir.to_string())
    } else {
        resolve_target(document_uri, dir_part.trim_end_matches('/'))
    }
}

fn link_completions(ctx: &DocumentContext, line: &str, character: usize) -> Option<CompletionList> {
    let before = &line[..utf16_to_char_index(line, character)];
    let open = before.rfind("](")?;
    let typed = &before[open + 2..];
    if typed.contains(char::is_whitespace) {
        return None;
    }

    let (dir_part, partial) = match typed.rfind('/') {
        Some(index) => (&typed[..=index], &typed[index + 1..]),
        None => ("", typed),
    };
    let entries = host::list_dir_with_types(&resolve_dir(&ctx.uri, dir_part)).ok()?;
    let partial = partial.to_ascii_lowercase();

    let mut items = Vec::new();
    for (name, kind) in entries {
        if name.starts_with('.') && !partial.starts_with('.') {
            continue;
        }
        if !partial.is_empty() && !name.to_ascii_lowercase().starts_with(&partial) {
            continue;
        }
        let is_dir = kind == 2;
        let label = if is_dir { format!("{name}/") } else { name.clone() };
        items.push(CompletionItem {
            label: label.clone(),
            kind: Some(if is_dir { 19 } else { 16 }), // Folder / File
            detail: if is_dir { Some("鐩綍".to_string()) } else { None },
            documentation: None,
            insert_text: Some(label),
            sort_text: Some(format!("{}{name}", if is_dir { "0" } else { "1" })),
            filter_text: Some(name),
        });
    }

    if items.is_empty() {
        return None;
    }
    Some(CompletionList {
        items,
        is_incomplete: false,
    })
}

/// Flags relative links and images whose target does not exist on disk.
fn publish_link_diagnostics(ctx: &DocumentContext) {
    let Some(text) = host::get_document_text(&ctx.uri) else {
        return;
    };

    let mut diagnostics = Vec::new();
    let mut in_fence = false;
    for (line_index, line) in text.lines().enumerate() {
        if is_fence(line) {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        for link in parse_links(line) {
            let target = resolve_target(&ctx.uri, &link.target);
            let lower = target.to_ascii_lowercase();
            if lower.starts_with("http://")
                || lower.starts_with("https://")
                || lower.starts_with("mailto:")
                || lower.starts_with("data:")
                || lower.starts_with("vscode-")
            {
                continue;
            }
            let path = match target.find('#') {
                Some(index) => &target[..index],
                None => &target[..],
            };
            if path.is_empty() || path == ctx.uri {
                continue;
            }
            if host::stat_file(path).is_err() {
                diagnostics.push(Diagnostic {
                    range: Range {
                        start: pos(line_index, utf16_col(line, link.start)),
                        end: pos(line_index, utf16_col(line, link.end)),
                    },
                    message: format!("閾炬帴鐩爣涓嶅瓨鍦細{path}"),
                    severity: DiagnosticSeverity::Warning,
                    source: Some("markdown".to_string()),
                    code: Some("link-check".to_string()),
                });
            }
        }
    }

    host::publish_diagnostics(&ctx.uri, &diagnostics);
}

struct LinkDefinition {
    label: String,
    line: usize,
    target: String,
    start: usize,
    end: usize,
    target_start: usize,
    target_end: usize,
}

fn parse_definitions(lines: &[&str]) -> Vec<LinkDefinition> {
    let mut definitions = Vec::new();
    let mut in_fence = false;
    for (index, line) in lines.iter().enumerate() {
        if is_fence(line) {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let trimmed = line.trim_start();
        if !trimmed.starts_with('[') {
            continue;
        }
        let Some(close) = trimmed.find("]:") else {
            continue;
        };
        let label = &trimmed[1..close];
        if label.is_empty() || label.contains(']') {
            continue;
        }
        let rest = &trimmed[close + 2..];
        let leading = rest.len() - rest.trim_start().len();
        let target = clean_target(rest);
        if target.is_empty() {
            continue;
        }
        let indent = line.len() - trimmed.len();
        let target_start = indent + close + 2 + leading;
        definitions.push(LinkDefinition {
            label: label.to_ascii_lowercase(),
            line: index,
            target,
            start: indent,
            end: indent + close + 2,
            target_start,
            target_end: target_start + target_len(rest),
        });
    }
    definitions
}

/// Byte length of the destination token (excluding a trailing title).
fn target_len(rest: &str) -> usize {
    let rest = rest.trim();
    if let Some(inner) = rest.strip_prefix('<') {
        return inner.find('>').map_or(rest.len(), |end| end + 2);
    }
    match rest.find(char::is_whitespace) {
        Some(index) => index,
        None => rest.len(),
    }
}

/// Returns the reference label when the cursor sits inside a `[text]` group.
fn reference_at(line: &str, character: usize) -> Option<String> {
    let position = utf16_to_char_index(line, character);
    let bytes = line.as_bytes();

    let mut open = None;
    let mut index = position;
    while index > 0 {
        index -= 1;
        match bytes[index] {
            b'[' => {
                open = Some(index);
                break;
            }
            b']' => return None,
            _ => {}
        }
    }
    let open = open?;

    let mut close = None;
    let mut cursor = open + 1;
    while cursor < bytes.len() {
        match bytes[cursor] {
            b']' => {
                close = Some(cursor);
                break;
            }
            b'[' => return None,
            _ => {}
        }
        cursor += 1;
    }
    let close = close?;

    // Explicit label: [text][label]
    if close + 1 < bytes.len() && bytes[close + 1] == b'[' {
        let mut end = None;
        let mut cursor = close + 2;
        while cursor < bytes.len() {
            if bytes[cursor] == b']' {
                end = Some(cursor);
                break;
            }
            cursor += 1;
        }
        if let Some(end) = end {
            let label = &line[close + 2..end];
            if !label.is_empty() {
                return Some(label.to_string());
            }
        }
    }

    // Shortcut reference: [label]
    let label = &line[open + 1..close];
    if label.is_empty() {
        None
    } else {
        Some(label.to_string())
    }
}

impl SidexExtension for MarkdownLanguageExtension {
    fn activate() -> Result<(), String> {
        Ok(())
    }

    fn deactivate() {}

    fn get_name() -> String {
        "Markdown Language Features".to_string()
    }
    fn get_display_name() -> String {
        "Markdown Language Features".to_string()
    }
    fn get_version() -> String {
        "0.1.0".to_string()
    }
    fn get_publisher() -> String {
        "sidex".to_string()
    }

    fn get_activation_events() -> Vec<String> {
        vec!["onLanguage:markdown".to_string()]
    }


    fn provide_document_symbols(ctx: DocumentContext) -> Vec<DocumentSymbol> {
        if ctx.language_id != "markdown" {
            return vec![];
        }
        let Some(text) = host::get_document_text(&ctx.uri) else {
            return vec![];
        };
        let lines: Vec<&str> = text.lines().collect();
        parse_headings(&lines)
            .into_iter()
            .map(|heading| {
                let line = lines[heading.line];
                let selection_start = utf16_col(line, heading.start);
                let selection_end = utf16_col(line, heading.end);
                DocumentSymbol {
                    name: line[heading.start..heading.end].to_string(),
                    detail: Some(format!("H{}", heading.level)),
                    kind: 14, // SymbolKind.String, same as VS Code's markdown outline
                    range: Range {
                        start: pos(heading.line, 0),
                        end: pos(heading.line, utf16_col(line, line.len())),
                    },
                    selection_range: Range {
                        start: pos(heading.line, selection_start),
                        end: pos(heading.line, selection_end),
                    },
                    depth: heading.level.saturating_sub(1) as u32,
                }
            })
            .collect()
    }

    fn provide_folding_ranges(ctx: DocumentContext) -> Vec<FoldingRange> {
        if ctx.language_id != "markdown" {
            return vec![];
        }
        let Some(text) = host::get_document_text(&ctx.uri) else {
            return vec![];
        };
        let lines: Vec<&str> = text.lines().collect();
        let headings = parse_headings(&lines);
        let mut folds = heading_folds(&lines, &headings);
        folds.extend(fence_folds(&lines));
        folds
    }

    fn provide_document_links(ctx: DocumentContext) -> Vec<DocumentLink> {
        if ctx.language_id != "markdown" {
            return vec![];
        }
        let Some(text) = host::get_document_text(&ctx.uri) else {
            return vec![];
        };
        document_links(&ctx.uri, &text)
    }

    fn provide_completion(ctx: DocumentContext, pos: Position) -> Option<CompletionList> {
        if ctx.language_id != "markdown" {
            return None;
        }
        let text = host::get_document_text(&ctx.uri)?;
        let line = text.lines().nth(pos.line as usize)?;
        link_completions(&ctx, line, pos.character as usize)
    }


    fn provide_definition(ctx: DocumentContext, position: Position) -> Vec<Location> {
        if ctx.language_id != "markdown" {
            return vec![];
        }
        let Some(text) = host::get_document_text(&ctx.uri) else {
            return vec![];
        };
        let lines: Vec<&str> = text.lines().collect();
        let Some(line) = lines.get(position.line as usize) else {
            return vec![];
        };
        let Some(label) = reference_at(line, position.character as usize) else {
            return vec![];
        };
        let label = label.to_ascii_lowercase();
        for definition in parse_definitions(&lines) {
            if definition.label == label {
                let def_line = lines[definition.line];
                return vec![Location {
                    uri: ctx.uri.clone(),
                    range: Range {
                        start: pos(definition.line, utf16_col(def_line, definition.start)),
                        end: pos(definition.line, utf16_col(def_line, definition.end)),
                    },
                }];
            }
        }
        vec![]
    }



    fn execute_command(id: String, _args: String) -> Result<String, String> {
        Err(format!("unknown: {id}"))
    }

    fn on_file_event(_: Vec<FileEvent>) {}
    fn on_configuration_changed(_: String) {}
    fn on_document_opened(ctx: DocumentContext) {
        publish_link_diagnostics(&ctx);
    }
    fn on_document_closed(ctx: DocumentContext) {
        host::clear_diagnostics(&ctx.uri);
    }
    fn on_document_changed(ctx: DocumentContext, _: Vec<TextEdit>) {
        publish_link_diagnostics(&ctx);
    }
    fn on_document_saved(ctx: DocumentContext, _: u32) {
        publish_link_diagnostics(&ctx);
    }
    fn on_document_language_changed(_: String, _: String, _: String) {}
    fn on_workspace_folders_changed(_: Vec<String>, _: Vec<String>) {}
    fn on_files_created(_: Vec<String>) {}
    fn on_files_renamed(_: Vec<String>, _: Vec<String>) {}
    fn on_files_deleted(_: Vec<String>) {}
    fn on_active_editor_changed(_: Option<String>) {}
    fn on_visible_editors_changed(_: Vec<String>) {}
    fn on_editor_selections_changed(_: String, _: Vec<Range>) {}
    fn on_editor_scroll_changed(_: String, _: Vec<Range>) {}
    fn on_editor_view_column_changed(_: String, _: u32) {}
    fn on_tree_item_activated(_: String, _: String) {}
    fn on_tree_visibility_changed(_: String, _: bool) {}
    fn on_task_started(_: TaskExecution) {}
    fn on_task_ended(_: TaskExecution, _: Option<i32>) {}
    fn on_task_process_started(_: TaskExecution, _: u32) {}
    fn on_task_process_ended(_: TaskExecution, _: Option<i32>) {}
    fn on_debug_session_started(_: String, _: String, _: String) {}
    fn on_debug_session_stopped(_: String) {}
    fn on_debug_breakpoints_changed(_: Vec<String>, _: Vec<String>, _: Vec<String>) {}
    fn provide_notebook_kernel_interrupt(_: String) {}
    fn provide_tests_run(_: String, _: String, _: Vec<String>, _: Vec<String>) {}
    fn provide_tests_debug(_: String, _: String, _: Vec<String>, _: Vec<String>) {}
    fn provide_tests_cancel_run(_: String, _: String) {}
    fn custom_editor_dispose(_: String) {}
    fn webview_receive_message(_: String, _: String) {}
    fn on_webview_disposed(_: String) {}
    fn on_webview_visibility_changed(_: String, _: bool) {}
}

sidex_extension_sdk::export_extension!(MarkdownLanguageExtension);
