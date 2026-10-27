//! Rust language features via rust-analyzer LSP.

use sidex_extension_sdk::prelude::*;
use sidex_language_client::{LspClient, ServerSpec};

pub struct RustLanguageExtension;

const RUST_ANALYZER: ServerSpec = ServerSpec::new("rust-analyzer").with_download_url(
    "https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-{target}.gz",
);

fn serves(language_id: &str) -> bool {
    language_id == "rust"
}

impl SidexExtension for RustLanguageExtension {
    fn get_name() -> String {
        "Rust Language Features".to_string()
    }

    fn get_display_name() -> String {
        "Rust Language Features".to_string()
    }

    fn get_version() -> String {
        "0.1.0".to_string()
    }

    fn get_publisher() -> String {
        "sidex".to_string()
    }

    fn get_activation_events() -> Vec<String> {
        vec!["onLanguage:rust".to_string()]
    }

    fn provide_completion(ctx: DocumentContext, pos: Position) -> Option<CompletionList> {
        if !serves(&ctx.language_id) {
            return None;
        }
        LspClient::new(RUST_ANALYZER, &ctx).completion(pos)
    }

    fn provide_hover(ctx: DocumentContext, pos: Position) -> Option<HoverResult> {
        if !serves(&ctx.language_id) {
            return None;
        }
        LspClient::new(RUST_ANALYZER, &ctx).hover(pos)
    }

    fn provide_definition(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).definition(pos)
    }

    fn provide_type_definition(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).type_definition(pos)
    }

    fn provide_implementation(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).implementation(pos)
    }

    fn provide_declaration(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).declaration(pos)
    }

    fn provide_references(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).references(pos)
    }

    fn provide_document_symbols(ctx: DocumentContext) -> Vec<DocumentSymbol> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).symbols()
    }

    fn provide_formatting(ctx: DocumentContext, tab_size: u32, insert_spaces: bool) -> Vec<TextEdit> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).formatting(tab_size, insert_spaces)
    }

    fn provide_range_formatting(
        ctx: DocumentContext,
        range: Range,
        tab_size: u32,
        insert_spaces: bool,
    ) -> Vec<TextEdit> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).range_formatting(range, tab_size, insert_spaces)
    }

    fn provide_document_highlights(ctx: DocumentContext, pos: Position) -> Vec<DocumentHighlight> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).highlights(pos)
    }

    fn provide_folding_ranges(ctx: DocumentContext) -> Vec<FoldingRange> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).folding_ranges()
    }

    fn provide_selection_ranges(ctx: DocumentContext, positions: Vec<Position>) -> Vec<SelectionRange> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).selection_ranges(positions)
    }

    fn provide_code_actions(
        ctx: DocumentContext,
        range: Range,
        diagnostics: Vec<Diagnostic>,
    ) -> Vec<CodeAction> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).code_actions(range, &diagnostics)
    }

    fn provide_rename(ctx: DocumentContext, pos: Position, new_name: String) -> Option<RenameResult> {
        if !serves(&ctx.language_id) {
            return None;
        }
        LspClient::new(RUST_ANALYZER, &ctx).rename(pos, &new_name)
    }

    fn provide_document_links(ctx: DocumentContext) -> Vec<DocumentLink> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).document_links()
    }

    fn provide_signature_help(ctx: DocumentContext, pos: Position) -> Option<SignatureHelpResult> {
        if !serves(&ctx.language_id) {
            return None;
        }
        LspClient::new(RUST_ANALYZER, &ctx).signature_help(pos)
    }

    fn provide_inlay_hints(ctx: DocumentContext, range: Range) -> Vec<InlayHint> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(RUST_ANALYZER, &ctx).inlay_hints(range)
    }

    fn on_document_opened(ctx: DocumentContext) {
        if !serves(&ctx.language_id) {
            return;
        }
        LspClient::new(RUST_ANALYZER, &ctx).warm_up();
    }

    fn on_file_event(events: Vec<FileEvent>) {
        for event in events {
            if !event.uri.ends_with(".rs") {
                continue;
            }
            let ctx = DocumentContext {
                uri: event.uri.clone(),
                language_id: "rust".to_string(),
                version: 0,
            };
            let diagnostics = LspClient::new(RUST_ANALYZER, &ctx).diagnostics();
            if !diagnostics.is_empty() {
                host::publish_diagnostics(&event.uri, &diagnostics);
            }
        }
    }
}

sidex_extension_sdk::export_extension!(RustLanguageExtension);
