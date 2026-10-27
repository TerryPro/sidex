//! Shared language-server client for SideX language extensions.
//!
//! Every language extension used to carry its own copy of the LSP plumbing:
//! build the `__sidex.lsp` payload, slice the JSON-RPC response apart, convert
//! it into SDK types. This crate holds that once. An extension now only keeps
//! its server description, the languages it serves and one-line provider
//! bodies.
//!
//! ```ignore
//! const CLANGD: ServerSpec = ServerSpec::new("clangd");
//!
//! fn provide_hover(ctx: DocumentContext, pos: Position) -> Option<HoverResult> {
//!     LspClient::new(CLANGD, &ctx).hover(pos)
//! }
//! ```

mod json;

use sidex_extension_sdk::prelude::*;

/// Everything the host needs to launch one language server.
#[derive(Clone, Copy)]
pub struct ServerSpec {
    pub name: &'static str,
    pub cmd: &'static str,
    pub args: &'static [&'static str],
    pub download_url: Option<&'static str>,
}

impl ServerSpec {
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            cmd: name,
            args: &[],
            download_url: None,
        }
    }

    /// The executable differs from the server id (e.g. pyright-langserver).
    pub const fn with_cmd(mut self, cmd: &'static str) -> Self {
        self.cmd = cmd;
        self
    }

    pub const fn with_args(mut self, args: &'static [&'static str]) -> Self {
        self.args = args;
        self
    }

    /// Lets the host download the server binary when it is not installed.
    pub const fn with_download_url(mut self, url: &'static str) -> Self {
        self.download_url = Some(url);
        self
    }
}

/// One request/response round trip against the server bound to a document.
pub struct LspClient<'a> {
    server: ServerSpec,
    ctx: &'a DocumentContext,
}

impl<'a> LspClient<'a> {
    pub fn new(server: ServerSpec, ctx: &'a DocumentContext) -> Self {
        Self { server, ctx }
    }

    pub fn context(&self) -> &'a DocumentContext {
        self.ctx
    }

    /// Sends a raw LSP method and returns the response body.
    pub fn request(&self, method: &str, position: Option<Position>, extra: &str) -> Option<String> {
        host::execute_command("__sidex.lsp", &self.payload(method, position, extra)).ok()
    }

    /// Starts the server so it can register the document and start pushing
    /// diagnostics. The response is intentionally ignored.
    pub fn warm_up(&self) {
        let _ = self.request("textDocument/diagnostic", None, "");
    }

    pub fn completion(&self, position: Position) -> Option<CompletionList> {
        self.request("textDocument/completion", Some(position), "")
            .and_then(|response| parse_completion(&response))
            .or_else(|| word_completions(self.ctx, position))
    }

    pub fn hover(&self, position: Position) -> Option<HoverResult> {
        let response = self.request("textDocument/hover", Some(position), "")?;
        parse_hover(&response)
    }

    pub fn definition(&self, position: Position) -> Vec<Location> {
        self.locations("textDocument/definition", position, "")
    }

    pub fn type_definition(&self, position: Position) -> Vec<Location> {
        self.locations("textDocument/typeDefinition", position, "")
    }

    pub fn implementation(&self, position: Position) -> Vec<Location> {
        self.locations("textDocument/implementation", position, "")
    }

    pub fn declaration(&self, position: Position) -> Vec<Location> {
        self.locations("textDocument/declaration", position, "")
    }

    pub fn references(&self, position: Position) -> Vec<Location> {
        self.locations("textDocument/references", position, r#","context":{"includeDeclaration":true}"#)
    }

    fn locations(&self, method: &str, position: Position, extra: &str) -> Vec<Location> {
        self.request(method, Some(position), extra)
            .map(|response| parse_locations(&response))
            .unwrap_or_default()
    }

    pub fn symbols(&self) -> Vec<DocumentSymbol> {
        self.request("textDocument/documentSymbol", None, "")
            .map(|response| parse_symbols(&response))
            .unwrap_or_default()
    }

    pub fn formatting(&self, tab_size: u32, insert_spaces: bool) -> Vec<TextEdit> {
        let extra = format!(
            r#","options":{{"tabSize":{tab_size},"insertSpaces":{insert_spaces}}}"#
        );
        self.request("textDocument/formatting", None, &extra)
            .map(|response| parse_text_edits(&response))
            .unwrap_or_default()
    }

    pub fn range_formatting(&self, range: Range, tab_size: u32, insert_spaces: bool) -> Vec<TextEdit> {
        let extra = format!(
            r#","range":{},"options":{{"tabSize":{tab_size},"insertSpaces":{insert_spaces}}}"#,
            range_json(&range)
        );
        self.request("textDocument/rangeFormatting", None, &extra)
            .map(|response| parse_text_edits(&response))
            .unwrap_or_default()
    }

    pub fn highlights(&self, position: Position) -> Vec<DocumentHighlight> {
        self.request("textDocument/documentHighlight", Some(position), "")
            .map(|response| parse_highlights(&response))
            .unwrap_or_default()
    }

    pub fn folding_ranges(&self) -> Vec<FoldingRange> {
        self.request("textDocument/foldingRange", None, "")
            .map(|response| parse_folding_ranges(&response))
            .unwrap_or_default()
    }

    pub fn selection_ranges(&self, positions: Vec<Position>) -> Vec<SelectionRange> {
        if positions.is_empty() {
            return Vec::new();
        }
        let list: Vec<String> = positions
            .iter()
            .map(|position| format!(r#"{{"line":{},"character":{}}}"#, position.line, position.character))
            .collect();
        let extra = format!(r#","positions":[{}]"#, list.join(","));
        self.request("textDocument/selectionRange", None, &extra)
            .map(|response| parse_selection_ranges(&response))
            .unwrap_or_default()
    }

    pub fn code_actions(&self, range: Range, diagnostics: &[Diagnostic]) -> Vec<CodeAction> {
        let serialized: Vec<String> = diagnostics.iter().map(diagnostic_json).collect();
        let extra = format!(
            r#","range":{},"context":{{"diagnostics":[{}]}}"#,
            range_json(&range),
            serialized.join(",")
        );
        self.request("textDocument/codeAction", None, &extra)
            .map(|response| parse_code_actions(&response))
            .unwrap_or_default()
    }

    pub fn rename(&self, position: Position, new_name: &str) -> Option<RenameResult> {
        let extra = format!(r#","newName":"{}""#, json::escape(new_name));
        let response = self.request("textDocument/rename", Some(position), &extra)?;
        let edits = parse_workspace_edit(&response)?;
        if edits.is_empty() {
            None
        } else {
            Some(RenameResult { edits })
        }
    }

    pub fn document_links(&self) -> Vec<DocumentLink> {
        self.request("textDocument/documentLink", None, "")
            .map(|response| parse_document_links(&response))
            .unwrap_or_default()
    }

    pub fn signature_help(&self, position: Position) -> Option<SignatureHelpResult> {
        let response = self.request("textDocument/signatureHelp", Some(position), "")?;
        parse_signature_help(&response)
    }

    pub fn inlay_hints(&self, range: Range) -> Vec<InlayHint> {
        let extra = format!(r#","range":{}"#, range_json(&range));
        self.request("textDocument/inlayHint", None, &extra)
            .map(|response| parse_inlay_hints(&response))
            .unwrap_or_default()
    }

    /// Pulls diagnostics for the current document. Servers that only push
    /// diagnostics return an empty list here, which is fine.
    pub fn diagnostics(&self) -> Vec<Diagnostic> {
        self.request("textDocument/diagnostic", None, "")
            .map(|response| parse_diagnostics(&response))
            .unwrap_or_default()
    }

    fn payload(&self, method: &str, position: Option<Position>, extra: &str) -> String {
        let name = json::escape(self.server.name);
        let cmd = json::escape(self.server.cmd);
        let uri = json::escape(&self.ctx.uri);

        let args = if self.server.args.is_empty() {
            String::new()
        } else {
            let list: Vec<String> = self
                .server
                .args
                .iter()
                .map(|arg| format!("\"{}\"", json::escape(arg)))
                .collect();
            format!(r#","args":[{}]"#, list.join(","))
        };

        let download = self
            .server
            .download_url
            .map(|url| format!(r#","downloadUrl":"{}""#, json::escape(url)))
            .unwrap_or_default();

        let pos = position
            .map(|position| format!(r#","position":{{"line":{},"character":{}}}"#, position.line, position.character))
            .unwrap_or_default();

        format!(
            r#"{{"server":"{name}","cmd":"{cmd}"{args}{download},"method":"{method}","params":{{"textDocument":{{"uri":"{uri}"}}{pos}{extra}}}}}"#
        )
    }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/// Returns the `result` value of a JSON-RPC response.
fn result_value(response: &str) -> Option<&str> {
    let start = json::value_after(response, "result")?;
    json::take_token(start)
}

fn parse_completion(response: &str) -> Option<CompletionList> {
    let result = result_value(response)?;
    // `result` is either the list itself or an object holding `items`.
    let list = if result.starts_with('{') {
        json::take_value(result, "items")?
    } else {
        result
    };

    let mut items = Vec::new();
    for item in json::array_items(list) {
        if !item.starts_with('{') {
            continue;
        }
        let Some(label) = json::string_field(item, "label") else {
            continue;
        };
        let insert_text = json::string_field(item, "insertText")
            .or_else(|| {
                json::take_value(item, "textEdit")
                    .and_then(|edit| json::string_field(edit, "newText"))
            })
            .unwrap_or_else(|| label.clone());

        items.push(CompletionItem {
            label,
            kind: json::u32_field(item, "kind").map(editor_completion_kind),
            detail: json::string_field(item, "detail"),
            documentation: documentation(item),
            insert_text: Some(insert_text),
            sort_text: json::string_field(item, "sortText"),
            filter_text: json::string_field(item, "filterText"),
        });

        if items.len() >= 200 {
            break;
        }
    }

    if items.is_empty() {
        return None;
    }

    Some(CompletionList {
        items,
        is_incomplete: response.contains("\"isIncomplete\":true"),
    })
}

/// `documentation` is either a string or a markup object.
fn documentation(item: &str) -> Option<String> {
    let value = json::take_value(item, "documentation")?;
    if value.starts_with('"') {
        json::string_token(value)
    } else {
        json::string_field(value, "value")
    }
}

fn parse_hover(response: &str) -> Option<HoverResult> {
    let result = result_value(response)?;
    if result == "null" {
        return None;
    }

    let contents = json::take_value(result, "contents")?;
    let mut values = Vec::new();
    match contents.as_bytes().first()? {
        b'"' => {
            if let Some(text) = json::string_token(contents) {
                values.push(text);
            }
        }
        b'[' => {
            for entry in json::array_items(contents) {
                if entry.starts_with('"') {
                    if let Some(text) = json::string_token(entry) {
                        values.push(text);
                    }
                } else if let Some(text) = json::string_field(entry, "value") {
                    values.push(text);
                }
            }
        }
        _ => {
            if let Some(text) = json::string_field(contents, "value") {
                values.push(text);
            }
        }
    }

    if values.is_empty() {
        return None;
    }

    Some(HoverResult {
        contents: values,
        // Servers usually omit the hover range; the editor then falls back to
        // the word under the cursor, matching VS Code behaviour.
        range: None,
    })
}

fn parse_locations(response: &str) -> Vec<Location> {
    let Some(result) = result_value(response) else {
        return Vec::new();
    };

    // `textDocument/definition` may answer with one location or an array.
    let entries = if result.starts_with('{') {
        vec![result]
    } else {
        json::array_items(result)
    };

    let mut locations = Vec::new();
    for entry in entries {
        if !entry.starts_with('{') {
            continue;
        }
        let Some(uri) = json::string_field(entry, "uri") else {
            continue;
        };
        let Some(range) = json::take_value(entry, "range").and_then(parse_range) else {
            continue;
        };
        locations.push(Location { uri, range });
    }
    locations
}

fn parse_symbols(response: &str) -> Vec<DocumentSymbol> {
    let Some(result) = result_value(response) else {
        return Vec::new();
    };

    let mut symbols = Vec::new();
    for entry in json::array_items(result) {
        if !entry.starts_with('{') {
            continue;
        }
        let Some(name) = json::string_field(entry, "name") else {
            continue;
        };
        let range = json::take_value(entry, "range")
            .and_then(parse_range)
            .or_else(|| {
                json::take_value(entry, "location")
                    .and_then(|location| json::take_value(location, "range"))
                    .and_then(parse_range)
            });
        let Some(range) = range else {
            continue;
        };
        let selection_range = json::take_value(entry, "selectionRange")
            .and_then(parse_range)
            .unwrap_or(range);

        symbols.push(DocumentSymbol {
            name,
            detail: json::string_field(entry, "detail"),
            kind: json::u32_field(entry, "kind").map(editor_symbol_kind).unwrap_or(11),
            range,
            selection_range,
            depth: 0,
        });
    }
    symbols
}

fn parse_text_edits(response: &str) -> Vec<TextEdit> {
    let Some(result) = result_value(response) else {
        return Vec::new();
    };

    let mut edits = Vec::new();
    for entry in json::array_items(result) {
        if !entry.starts_with('{') {
            continue;
        }
        let Some(new_text) = json::string_field(entry, "newText") else {
            continue;
        };
        let range = json::take_value(entry, "range")
            .and_then(parse_range)
            .or_else(|| json::take_value(entry, "insert").and_then(parse_range));
        let Some(range) = range else {
            continue;
        };
        edits.push(TextEdit { range, new_text });
    }
    edits
}

fn parse_highlights(response: &str) -> Vec<DocumentHighlight> {
    let Some(result) = result_value(response) else {
        return Vec::new();
    };

    let mut highlights = Vec::new();
    for entry in json::array_items(result) {
        let Some(range) = json::take_value(entry, "range").and_then(parse_range) else {
            continue;
        };
        // LSP: Text=1, Read=2, Write=3; the editor counts from zero.
        let kind = json::u32_field(entry, "kind").unwrap_or(1).saturating_sub(1);
        highlights.push(DocumentHighlight { range, kind });
    }
    highlights
}

fn parse_folding_ranges(response: &str) -> Vec<FoldingRange> {
    let Some(result) = result_value(response) else {
        return Vec::new();
    };

    let mut ranges = Vec::new();
    for entry in json::array_items(result) {
        if !entry.starts_with('{') {
            continue;
        }
        let start_line = json::u32_field(entry, "startLine").unwrap_or(0);
        let end_line = json::u32_field(entry, "endLine").unwrap_or(start_line);
        ranges.push(FoldingRange {
            start_line,
            end_line,
            kind: None,
        });
    }
    ranges
}

fn parse_selection_ranges(response: &str) -> Vec<SelectionRange> {
    let Some(result) = result_value(response) else {
        return Vec::new();
    };

    let mut ranges = Vec::new();
    for entry in json::array_items(result) {
        let mut current = entry;
        loop {
            let Some(range) = json::take_value(current, "range").and_then(parse_range) else {
                break;
            };
            ranges.push(SelectionRange { range });
            match json::take_value(current, "parent") {
                Some(parent) if parent.starts_with('{') => current = parent,
                _ => break,
            }
        }
    }
    ranges
}

fn parse_code_actions(response: &str) -> Vec<CodeAction> {
    let Some(result) = result_value(response) else {
        return Vec::new();
    };

    let mut actions = Vec::new();
    for entry in json::array_items(result) {
        if !entry.starts_with('{') {
            continue;
        }
        let Some(title) = json::string_field(entry, "title") else {
            continue;
        };
        actions.push(CodeAction {
            title,
            kind: json::string_field(entry, "kind"),
            diagnostics: Vec::new(),
            is_preferred: json::bool_field(entry, "isPreferred"),
            edit: json::take_value(entry, "edit").and_then(parse_workspace_edit_value),
        });
    }
    actions
}

fn parse_document_links(response: &str) -> Vec<DocumentLink> {
    let Some(result) = result_value(response) else {
        return Vec::new();
    };

    let mut links = Vec::new();
    for entry in json::array_items(result) {
        let Some(range) = json::take_value(entry, "range").and_then(parse_range) else {
            continue;
        };
        let target = json::string_field(entry, "target");
        if target.is_none() {
            continue;
        }
        links.push(DocumentLink { range, target });
    }
    links
}

fn parse_position(value: &str) -> Option<Position> {
    if !value.starts_with('{') {
        return None;
    }
    Some(Position {
        line: json::u32_field(value, "line")?,
        character: json::u32_field(value, "character").unwrap_or(0),
    })
}

fn parse_signature_help(response: &str) -> Option<SignatureHelpResult> {
    let result = result_value(response)?;
    if !result.starts_with('{') {
        return None;
    }

    let signatures_value = json::take_value(result, "signatures")?;
    let mut signatures = Vec::new();
    for signature in json::array_items(signatures_value) {
        if !signature.starts_with('{') {
            continue;
        }
        let Some(label) = json::string_field(signature, "label") else {
            continue;
        };

        let mut parameters = Vec::new();
        if let Some(list) = json::take_value(signature, "parameters") {
            for parameter in json::array_items(list) {
                if !parameter.starts_with('{') {
                    continue;
                }
                parameters.push(ParameterInfo {
                    label: parameter_label(parameter, &label),
                    documentation: documentation(parameter),
                });
            }
        }

        signatures.push(SignatureInfo {
            documentation: documentation(signature),
            label,
            parameters,
        });
    }

    if signatures.is_empty() {
        return None;
    }

    Some(SignatureHelpResult {
        signatures,
        active_signature: json::u32_field(result, "activeSignature").unwrap_or(0),
        active_parameter: json::u32_field(result, "activeParameter").unwrap_or(0),
    })
}

/// `label` is either a string or a `[start, end]` offset pair into the signature.
fn parameter_label(parameter: &str, signature_label: &str) -> String {
    let Some(value) = json::value_after(parameter, "label") else {
        return String::new();
    };
    if value.starts_with('"') {
        return json::string_token(value).unwrap_or_default();
    }

    let Some(array) = json::take_array(value) else {
        return String::new();
    };
    let items = json::array_items(array);
    let start: usize = items.first().and_then(|item| item.parse().ok()).unwrap_or(0);
    let end: usize = items
        .get(1)
        .and_then(|item| item.parse().ok())
        .unwrap_or(start);

    let chars: Vec<char> = signature_label.chars().collect();
    if start < end && end <= chars.len() {
        chars[start..end].iter().collect()
    } else {
        String::new()
    }
}

fn parse_inlay_hints(response: &str) -> Vec<InlayHint> {
    let Some(result) = result_value(response) else {
        return Vec::new();
    };

    let mut hints = Vec::new();
    for entry in json::array_items(result) {
        if !entry.starts_with('{') {
            continue;
        }
        let Some(position) = json::take_value(entry, "position").and_then(parse_position) else {
            continue;
        };
        hints.push(InlayHint {
            position,
            label: inlay_label(entry),
            kind: json::u32_field(entry, "kind"),
            padding_left: json::bool_field(entry, "paddingLeft"),
            padding_right: json::bool_field(entry, "paddingRight"),
        });
    }
    hints
}

/// Inlay labels are either a string or an array of `{ value }` parts.
fn inlay_label(entry: &str) -> String {
    let Some(value) = json::value_after(entry, "label") else {
        return String::new();
    };
    if value.starts_with('"') {
        return json::string_token(value).unwrap_or_default();
    }

    let mut parts = Vec::new();
    if let Some(array) = json::take_array(value) {
        for part in json::array_items(array) {
            if part.starts_with('"') {
                if let Some(text) = json::string_token(part) {
                    parts.push(text);
                }
            } else if let Some(text) = json::string_field(part, "value") {
                parts.push(text);
            }
        }
    }
    parts.join("")
}

fn parse_diagnostics(response: &str) -> Vec<Diagnostic> {
    // Pull diagnostics answer with `{ "items": [...] }`; push diagnostics arrive
    // as `{ "diagnostics": [...] }`. Accept either.
    let Some(result) = result_value(response) else {
        return Vec::new();
    };
    let items = json::take_value(result, "items")
        .or_else(|| json::take_value(result, "diagnostics"))
        .unwrap_or(result);

    let mut diagnostics = Vec::new();
    for entry in json::array_items(items) {
        if !entry.starts_with('{') {
            continue;
        }
        let Some(message) = json::string_field(entry, "message") else {
            continue;
        };
        let Some(range) = json::take_value(entry, "range").and_then(parse_range) else {
            continue;
        };
        diagnostics.push(Diagnostic {
            range,
            message,
            severity: match json::u32_field(entry, "severity").unwrap_or(1) {
                2 => DiagnosticSeverity::Warning,
                3 => DiagnosticSeverity::Information,
                4 => DiagnosticSeverity::Hint,
                _ => DiagnosticSeverity::Error,
            },
            source: json::string_field(entry, "source"),
            code: json::take_value(entry, "code").and_then(|value| {
                if value.starts_with('"') {
                    json::string_token(value)
                } else if value == "null" || value.is_empty() {
                    None
                } else {
                    Some(value.to_string())
                }
            }),
        });
    }
    diagnostics
}

/// Rename answers carry the workspace edit as the `result` value.
fn parse_workspace_edit(response: &str) -> Option<Vec<ResourceTextEdit>> {
    workspace_edits(result_value(response)?)
}

fn parse_workspace_edit_value(edit: &str) -> Option<WorkspaceEdit> {
    let edits = workspace_edits(edit)?;
    Some(WorkspaceEdit { edits })
}

fn workspace_edits(edit: &str) -> Option<Vec<ResourceTextEdit>> {
    if !edit.starts_with('{') {
        return None;
    }

    // `changes` maps a document URI to its edits. `documentChanges` (used for
    // file creation/rename) is not supported by the host API yet.
    let changes = json::take_value(edit, "changes")?;
    if !changes.starts_with('{') {
        return None;
    }

    let mut result = Vec::new();
    let mut rest = &changes[1..changes.len().saturating_sub(1)];
    loop {
        rest = rest.trim_start();
        if !rest.starts_with('"') {
            break;
        }
        let Some(key) = json::take_token(rest) else {
            break;
        };
        let Some(uri) = json::string_token(key) else {
            break;
        };
        rest = rest[key.len()..].trim_start();
        rest = rest.strip_prefix(':').unwrap_or(rest).trim_start();

        let Some(array) = json::take_array(rest) else {
            break;
        };
        rest = &rest[array.len()..];

        let edits: Vec<TextEdit> = json::array_items(array)
            .into_iter()
            .filter_map(|entry| {
                let new_text = json::string_field(entry, "newText")?;
                let range = json::take_value(entry, "range").and_then(parse_range)?;
                Some(TextEdit { range, new_text })
            })
            .collect();

        if !edits.is_empty() {
            result.push(ResourceTextEdit { uri, edits });
        }

        rest = rest.trim_start();
        rest = rest.strip_prefix(',').unwrap_or(rest);
    }

    Some(result)
}

fn parse_range(value: &str) -> Option<Range> {
    if !value.starts_with('{') {
        return None;
    }
    let start = json::take_value(value, "start")?;
    let end = json::take_value(value, "end")?;
    Some(Range {
        start: Position {
            line: json::u32_field(start, "line")?,
            character: json::u32_field(start, "character").unwrap_or(0),
        },
        end: Position {
            line: json::u32_field(end, "line")?,
            character: json::u32_field(end, "character").unwrap_or(0),
        },
    })
}

fn range_json(range: &Range) -> String {
    format!(
        r#"{{"start":{{"line":{},"character":{}}},"end":{{"line":{},"character":{}}}}}"#,
        range.start.line, range.start.character, range.end.line, range.end.character
    )
}

fn diagnostic_json(diagnostic: &Diagnostic) -> String {
    let severity = match diagnostic.severity {
        DiagnosticSeverity::Error => 1,
        DiagnosticSeverity::Warning => 2,
        DiagnosticSeverity::Information => 3,
        DiagnosticSeverity::Hint => 4,
    };
    let code = diagnostic
        .code
        .as_ref()
        .map(|code| format!(r#","code":"{}""#, json::escape(code)))
        .unwrap_or_default();
    let source = diagnostic
        .source
        .as_ref()
        .map(|source| format!(r#","source":"{}""#, json::escape(source)))
        .unwrap_or_default();
    format!(
        r#"{{"range":{},"message":"{}","severity":{severity}{code}{source}}}"#,
        range_json(&diagnostic.range),
        json::escape(&diagnostic.message)
    )
}

/// LSP completion kinds are 1-based and ordered differently from the editor's.
fn editor_completion_kind(lsp: u32) -> u32 {
    match lsp {
        1 => 18,  // Text
        2 => 0,   // Method
        3 => 1,   // Function
        4 => 2,   // Constructor
        5 => 3,   // Field
        6 => 4,   // Variable
        7 => 5,   // Class
        8 => 7,   // Interface
        9 => 8,   // Module
        10 => 9,  // Property
        11 => 12, // Unit
        12 => 13, // Value
        13 => 15, // Enum
        14 => 17, // Keyword
        15 => 18, // Snippet
        16 => 19, // Color
        17 => 20, // File
        18 => 21, // Reference
        19 => 23, // Folder
        20 => 16, // EnumMember
        21 => 14, // Constant
        22 => 6,  // Struct
        23 => 10, // Event
        24 => 11, // Operator
        25 => 24, // TypeParameter
        _ => 18,
    }
}

fn editor_symbol_kind(lsp: u32) -> u32 {
    // The editor symbol kinds are the LSP ones shifted down by one.
    lsp.saturating_sub(1).min(25)
}

/// Last resort when no server answers: match words already present in the file.
fn word_completions(ctx: &DocumentContext, position: Position) -> Option<CompletionList> {
    let text = host::get_document_text(&ctx.uri).or_else(|| host::read_file(&ctx.uri).ok())?;
    let line = text.lines().nth(position.line as usize)?;
    let column = (position.character as usize).min(line.len());
    let before = &line[..column];
    let start = before
        .rfind(|ch: char| !ch.is_alphanumeric() && ch != '_')
        .map(|index| index + 1)
        .unwrap_or(0);
    let prefix = &before[start..];
    if prefix.len() < 2 {
        return None;
    }

    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::new();
    for word in text.split(|ch: char| !ch.is_alphanumeric() && ch != '_') {
        if word.len() > prefix.len() && word.starts_with(prefix) && seen.insert(word) {
            items.push(CompletionItem {
                label: word.to_string(),
                kind: Some(editor_completion_kind(6)),
                detail: None,
                documentation: None,
                insert_text: Some(word.to_string()),
                sort_text: Some(format!("9{word}")),
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
