use regex::Regex;
use serde::Serialize;
use sidex_syntax::highlight::{HighlightConfig, Highlighter, SyntaxHighlighter, TokenScope};
use sidex_syntax::language::{builtin_language_configurations, LanguageConfiguration};
use std::path::Path;
use std::sync::OnceLock;

static LANGUAGE_CONFIGS: OnceLock<Vec<LanguageConfiguration>> = OnceLock::new();

fn configs() -> &'static [LanguageConfiguration] {
    LANGUAGE_CONFIGS.get_or_init(builtin_language_configurations)
}

#[derive(Debug, Serialize)]
pub struct LanguageInfo {
    pub id: String,
    pub name: String,
    pub extensions: Vec<String>,
    pub filenames: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct AutoClosePair {
    pub open: String,
    pub close: String,
    pub not_in: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct LanguageConfigResponse {
    pub line_comment: Option<String>,
    pub block_comment: Option<(String, String)>,
    pub brackets: Vec<(String, String)>,
    pub auto_closing_pairs: Vec<AutoClosePair>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntaxToken {
    pub line: u32,
    pub start: u32,
    pub length: u32,
    pub scope: TokenScope,
}

#[allow(clippy::unnecessary_wraps)]
#[tauri::command]
pub fn syntax_get_languages() -> Result<Vec<LanguageInfo>, String> {
    let langs = configs()
        .iter()
        .map(|cfg| LanguageInfo {
            id: cfg.id.clone(),
            name: cfg.name.clone(),
            extensions: cfg.extensions.clone(),
            filenames: cfg.filenames.clone(),
        })
        .collect();
    Ok(langs)
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn syntax_detect_language(filename: String) -> Result<String, String> {
    detect_by_path(&filename).ok_or_else(|| format!("No language detected for '{filename}'"))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
#[allow(clippy::unnecessary_wraps)]
pub fn syntax_detect_from_content(
    filename: Option<String>,
    content: Option<String>,
    supported: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let candidate = filename
        .as_deref()
        .and_then(detect_by_path)
        .or_else(|| content.as_deref().and_then(detect_by_first_line));

    Ok(candidate.filter(|lang| {
        supported
            .as_ref()
            .is_none_or(|allowed| allowed.iter().any(|l| l == lang))
    }))
}

fn detect_by_path(filename: &str) -> Option<String> {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"));
    let fname = Path::new(filename)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("");

    for cfg in configs() {
        if let Some(ref ext) = ext {
            if cfg.extensions.iter().any(|e| e == ext) {
                return Some(cfg.id.clone());
            }
        }
        if cfg.filenames.iter().any(|f| f == fname) {
            return Some(cfg.id.clone());
        }
    }
    None
}

fn detect_by_first_line(content: &str) -> Option<String> {
    let first = content.lines().next()?.trim_end();
    if first.is_empty() {
        return None;
    }
    for cfg in configs() {
        if let Some(pattern) = cfg.first_line_pattern.as_deref() {
            if let Ok(re) = regex::Regex::new(pattern) {
                if re.is_match(first) {
                    return Some(cfg.id.clone());
                }
            }
        }
    }
    None
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn syntax_get_language_config(language_id: String) -> Result<LanguageConfigResponse, String> {
    let cfg = configs()
        .iter()
        .find(|c| c.id == language_id)
        .ok_or_else(|| format!("Unknown language ID '{language_id}'"))?;

    Ok(LanguageConfigResponse {
        line_comment: cfg.comments.line_comment.clone(),
        block_comment: cfg.comments.block_comment.clone(),
        brackets: cfg.brackets.clone(),
        auto_closing_pairs: cfg
            .auto_closing_pairs
            .iter()
            .map(|p| AutoClosePair {
                open: p.open.clone(),
                close: p.close.clone(),
                not_in: p.not_in.clone(),
            })
            .collect(),
    })
}

/// Minimal bundled tree-sitter highlight query for Rust.
const RUST_HIGHLIGHT_QUERY: &str = r#"
(line_comment) @comment
(block_comment) @comment
(string_literal) @string
(raw_string_literal) @string
(char_literal) @string
(integer_literal) @number
(float_literal) @number
(boolean_literal) @constant.builtin
"self" @variable.builtin
(primitive_type) @type.builtin
(type_identifier) @type
(field_identifier) @property
(function_item name: (identifier) @function)
(call_expression function: (identifier) @function.call)
(macro_invocation macro: (identifier) @function.macro)
(attribute_item) @attribute
[
  "as" "async" "await" "break" "const" "continue" "crate" "dyn" "else" "enum"
  "extern" "fn" "for" "if" "impl" "in" "let" "loop" "match" "mod" "move" "mut"
  "pub" "ref" "return" "static" "struct" "trait" "type" "unsafe" "use" "where" "while"
] @keyword
"#;

fn rust_highlight_config() -> Option<&'static HighlightConfig> {
    static CONFIG: OnceLock<Option<HighlightConfig>> = OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let language: tree_sitter::Language = tree_sitter_rust::LANGUAGE.into();
            HighlightConfig::new(language, RUST_HIGHLIGHT_QUERY).ok()
        })
        .as_ref()
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn syntax_tokenize(language: String, source: String) -> Result<Vec<SyntaxToken>, String> {
    let config = match language.as_str() {
        "rust" => rust_highlight_config().ok_or("rust highlight config unavailable")?,
        _ => return Ok(Vec::new()),
    };

    let mut highlighter = Highlighter::new();
    let events = highlighter
        .highlight(config, &source, None)
        .map_err(|e| e.to_string())?;

    let capture_names: Vec<String> = config.capture_names().to_vec();
    let rendered = SyntaxHighlighter::from_events(&language, &events, &source, &capture_names);

    let mut tokens: Vec<SyntaxToken> = Vec::new();
    for line in &rendered.tokens {
        for token in &line.tokens {
            tokens.push(SyntaxToken {
                line: line.line,
                start: token.start,
                length: token.length,
                scope: token.scope,
            });
        }
    }
    Ok(tokens)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMateLineTokens {
    pub line: u32,
    pub tokens: Vec<TextMateToken>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMateToken {
    pub start: u32,
    pub end: u32,
    pub scopes: Vec<String>,
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn textmate_tokenize_lines(
    grammar_json: String,
    source: String,
) -> Result<Vec<TextMateLineTokens>, String> {
    let grammar = sidex_syntax::textmate::TextMateGrammar::from_json(&grammar_json)
        .map_err(|e| format!("parse grammar: {e}"))?;
    let tokenizer = sidex_syntax::textmate::TextMateTokenizer::new(&grammar);
    let mut state = sidex_syntax::textmate::TokenizerState::default();

    let mut out = Vec::with_capacity(source.lines().count());
    for (idx, line) in source.lines().enumerate() {
        let tokens = tokenizer
            .tokenize_line(line, &mut state)
            .into_iter()
            .map(|t| TextMateToken {
                start: u32::try_from(t.start).unwrap_or(u32::MAX),
                end: u32::try_from(t.end).unwrap_or(u32::MAX),
                scopes: t.scopes,
            })
            .collect::<Vec<_>>();
        out.push(TextMateLineTokens {
            line: u32::try_from(idx).unwrap_or(u32::MAX),
            tokens,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Lightweight outline and folding (no language servers)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineRange {
    pub start_line: u32,
    pub start_column: u32,
    pub end_line: u32,
    pub end_column: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineSymbol {
    pub name: String,
    pub detail: String,
    pub kind: u32,
    pub range: LineRange,
    pub selection_range: LineRange,
    pub children: Vec<OutlineSymbol>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidexFoldingRange {
    pub start: u32,
    pub end: u32,
    pub kind: Option<String>,
}

struct RawSymbol {
    name: String,
    detail: String,
    kind: u32,
    line: u32,
    indent: u32,
    name_start_column: u32,
    name_end_column: u32,
}

struct OutlineNode {
    symbol: RawSymbol,
    children: Vec<usize>,
    end_line: u32,
}

fn indentation(line: &str) -> u32 {
    line.chars()
        .take_while(|c| c.is_whitespace())
        .map(|c| if c == '\t' { 4 } else { 1 })
        .sum()
}

fn symbol_patterns(language: &str) -> Vec<(Regex, u32, &'static str)> {
    let mut patterns: Vec<(Regex, u32, &'static str)> = Vec::new();
    let mut add = |pattern: &str, kind: u32, detail: &'static str| {
        if let Ok(regex) = Regex::new(pattern) {
            patterns.push((regex, kind, detail));
        }
    };

    match language {
        "rust" => {
            add(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)", 11, "fn");
            add(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|union)\s+([A-Za-z_][A-Za-z0-9_]*)", 22, "struct");
            add(r"^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)", 9, "enum");
            add(r"^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_][A-Za-z0-9_]*)", 10, "trait");
            add(r"^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)", 1, "mod");
            add(r"^\s*(?:pub(?:\([^)]*\))?\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)", 13, "const");
            add(r"^\s*(?:pub(?:\([^)]*\))?\s+)?static\s+([A-Za-z_][A-Za-z0-9_]*)", 13, "static");
            add(r"^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)", 25, "type");
        }
        "python" => {
            add(r"^(\s*)(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)", 11, "def");
            add(r"^(\s*)class\s+([A-Za-z_][A-Za-z0-9_]*)", 4, "class");
        }
        "go" => {
            add(r"^(\s*)func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)", 11, "func");
            add(r"^(\s*)type\s+([A-Za-z_][A-Za-z0-9_]*)", 22, "type");
            add(r"^(\s*)const\s+([A-Za-z_][A-Za-z0-9_]*)", 13, "const");
            add(r"^(\s*)var\s+([A-Za-z_][A-Za-z0-9_]*)", 12, "var");
        }
        "typescript" | "typescriptreact" | "javascript" | "javascriptreact" => {
            add(r"^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)", 11, "function");
            add(r"^(\s*)(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)", 4, "class");
            add(r"^(\s*)(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)", 10, "interface");
            add(r"^(\s*)(?:export\s+)?type\s+([A-Za-z_$][\w$]*)", 25, "type");
            add(r"^(\s*)(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)", 9, "enum");
            add(r"^(\s*)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)", 12, "variable");
        }
        "c" | "cpp" | "objective-c" | "objective-cpp" => {
            add(r"^(\s*)(?:class|struct)\s+([A-Za-z_][A-Za-z0-9_]*)", 4, "class");
            add(r"^(\s*)enum\s+([A-Za-z_][A-Za-z0-9_]*)", 9, "enum");
            add(r"^(\s*)namespace\s+([A-Za-z_][A-Za-z0-9_]*)", 2, "namespace");
            add(
                r"^(\s*)(?:[A-Za-z_][\w:<>,*&\s]*\s+)+([A-Za-z_~][\w:~]*)\s*\([^;]*\)\s*(?:const|override|noexcept)?\s*\{?",
                11,
                "function",
            );
        }
        "java" | "csharp" => {
            add(r"^(\s*)(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial|record)\s+)*(?:class|struct)\s+([A-Za-z_][A-Za-z0-9_]*)", 4, "class");
            add(r"^(\s*)(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial)\s+)*interface\s+([A-Za-z_][A-Za-z0-9_]*)", 10, "interface");
            add(r"^(\s*)(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial)\s+)*enum\s+([A-Za-z_][A-Za-z0-9_]*)", 9, "enum");
            add(
                r"^(\s*)(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial|override|virtual|async)\s+)+[A-Za-z_][\w<>\[\],.]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(",
                5,
                "method",
            );
        }
        _ => {}
    }

    patterns
}

fn extract_markdown_symbols(source: &str) -> Vec<RawSymbol> {
    let mut symbols = Vec::new();
    for (index, line) in source.lines().enumerate() {
        let trimmed = line.trim_start();
        if !trimmed.starts_with('#') {
            continue;
        }
        let level = trimmed.chars().take_while(|c| *c == '#').count();
        if level == 0 || level > 6 {
            continue;
        }
        let name = trimmed[level..].trim();
        if name.is_empty() {
            continue;
        }
        let line_number = u32::try_from(index + 1).unwrap_or(u32::MAX);
        let indent = u32::try_from(level * 2).unwrap_or(u32::MAX);
        symbols.push(RawSymbol {
            name: name.to_string(),
            detail: format!("H{level}"),
            kind: 14,
            line: line_number,
            indent,
            name_start_column: 1,
            name_end_column: u32::try_from(line.chars().count() + 1).unwrap_or(u32::MAX),
        });
    }
    symbols
}

fn extract_symbols(language: &str, source: &str) -> Vec<RawSymbol> {
    if language == "markdown" {
        return extract_markdown_symbols(source);
    }

    let patterns = symbol_patterns(language);
    if patterns.is_empty() {
        return Vec::new();
    }

    let mut symbols = Vec::new();
    for (index, line) in source.lines().enumerate() {
        let Some((regex, kind, detail)) = patterns
            .iter()
            .find(|(regex, _, _)| regex.is_match(line))
        else {
            continue;
        };
        let Some(captures) = regex.captures(line) else {
            continue;
        };
        let name_group = captures.len().saturating_sub(1);
        let Some(name_match) = captures.get(name_group) else {
            continue;
        };

        let name = name_match.as_str().trim();
        if name.is_empty() {
            continue;
        }

        let indent = indentation(line);

        let name_start_column =
            u32::try_from(line[..name_match.start()].chars().count() + 1).unwrap_or(u32::MAX);
        let name_end_column = name_start_column
            .saturating_add(u32::try_from(name.chars().count()).unwrap_or(0));

        symbols.push(RawSymbol {
            name: name.to_string(),
            detail: (*detail).to_string(),
            kind: *kind,
            line: u32::try_from(index + 1).unwrap_or(u32::MAX),
            indent,
            name_start_column,
            name_end_column,
        });
    }
    symbols
}

fn build_outline(symbols: Vec<RawSymbol>, source: &str) -> Vec<OutlineSymbol> {
    if symbols.is_empty() {
        return Vec::new();
    }

    let line_lengths: Vec<u32> = source
        .lines()
        .map(|line| u32::try_from(line.chars().count()).unwrap_or(u32::MAX))
        .collect();
    let total_lines = u32::try_from(line_lengths.len()).unwrap_or(u32::MAX).max(1);

    let mut nodes: Vec<OutlineNode> = Vec::with_capacity(symbols.len());
    let mut roots: Vec<usize> = Vec::new();
    let mut stack: Vec<(u32, usize)> = Vec::new();

    for symbol in symbols {
        while stack.last().is_some_and(|(indent, _)| *indent >= symbol.indent) {
            if let Some((_, node_index)) = stack.pop() {
                nodes[node_index].end_line = symbol.line.saturating_sub(1);
            }
        }

        let index = nodes.len();
        nodes.push(OutlineNode {
            symbol,
            children: Vec::new(),
            end_line: total_lines,
        });

        if let Some((_, parent_index)) = stack.last() {
            nodes[*parent_index].children.push(index);
        } else {
            roots.push(index);
        }
        let indent = nodes[index].symbol.indent;
        stack.push((indent, index));
    }

    while let Some((_, node_index)) = stack.pop() {
        nodes[node_index].end_line = total_lines;
    }

    roots
        .into_iter()
        .map(|index| build_outline_symbol(&nodes, index, &line_lengths))
        .collect()
}

fn build_outline_symbol(
    nodes: &[OutlineNode],
    index: usize,
    line_lengths: &[u32],
) -> OutlineSymbol {
    let node = &nodes[index];
    let end_line = node.end_line.max(node.symbol.line);
    let end_column = line_lengths
        .get(usize::try_from(end_line.saturating_sub(1)).unwrap_or(0))
        .map_or(1, |length| length.saturating_add(1));

    OutlineSymbol {
        name: node.symbol.name.clone(),
        detail: node.symbol.detail.clone(),
        kind: node.symbol.kind,
        range: LineRange {
            start_line: node.symbol.line,
            start_column: node.symbol.name_start_column,
            end_line,
            end_column,
        },
        selection_range: LineRange {
            start_line: node.symbol.line,
            start_column: node.symbol.name_start_column,
            end_line: node.symbol.line,
            end_column: node.symbol.name_end_column,
        },
        children: node
            .children
            .iter()
            .map(|child| build_outline_symbol(nodes, *child, line_lengths))
            .collect(),
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn syntax_get_document_symbols(
    language: String,
    source: String,
) -> Result<Vec<OutlineSymbol>, String> {
    Ok(build_outline(extract_symbols(&language, &source), &source))
}

fn markdown_folding_ranges(source: &str) -> Vec<SidexFoldingRange> {
    let mut headings: Vec<(u32, u32)> = Vec::new();
    for (index, line) in source.lines().enumerate() {
        let trimmed = line.trim_start();
        let level = trimmed.chars().take_while(|c| *c == '#').count();
        if level == 0 || level > 6 || trimmed.chars().nth(level) != Some(' ') {
            continue;
        }
        headings.push((u32::try_from(index + 1).unwrap_or(u32::MAX), u32::try_from(level).unwrap_or(0)));
    }

    let total_lines = u32::try_from(source.lines().count()).unwrap_or(u32::MAX);
    let mut ranges = Vec::new();
    for (index, (line, level)) in headings.iter().enumerate() {
        let mut end = total_lines;
        for (next_line, next_level) in headings.iter().skip(index + 1) {
            if *next_level <= *level {
                end = next_line.saturating_sub(1);
                break;
            }
        }
        if end > *line {
            ranges.push(SidexFoldingRange {
                start: *line,
                end,
                kind: Some("region".to_string()),
            });
        }
    }
    ranges
}

fn brace_folding_ranges(source: &str) -> Vec<SidexFoldingRange> {
    let mut ranges = Vec::new();
    let mut stack: Vec<u32> = Vec::new();

    for (index, line) in source.lines().enumerate() {
        let line_number = u32::try_from(index + 1).unwrap_or(u32::MAX);
        let mut in_string: Option<char> = None;
        let mut escaped = false;

        for character in line.chars() {
            if escaped {
                escaped = false;
                continue;
            }
            if character == '\\' {
                escaped = true;
                continue;
            }
            if let Some(quote) = in_string {
                if character == quote {
                    in_string = None;
                }
                continue;
            }
            if character == '"' || character == '\'' || character == '`' {
                in_string = Some(character);
                continue;
            }
            match character {
                '{' => stack.push(line_number),
                '}' => {
                    if let Some(start) = stack.pop() {
                        if line_number > start {
                            ranges.push(SidexFoldingRange {
                                start,
                                end: line_number,
                                kind: None,
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }

    ranges
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn syntax_get_folding_ranges(
    language: String,
    source: String,
) -> Result<Vec<SidexFoldingRange>, String> {
    if language == "markdown" {
        return Ok(markdown_folding_ranges(&source));
    }
    if matches!(
        language.as_str(),
        "python" | "yaml" | "makefile" | "ini" | "properties"
    ) {
        return Ok(Vec::new());
    }
    Ok(brace_folding_ranges(&source))
}
