//! Python language features via pyright LSP.

use sidex_extension_sdk::prelude::*;
use sidex_language_client::{LspClient, ServerSpec};

pub struct PythonLanguageExtension;

const PYRIGHT: ServerSpec = ServerSpec::new("pyright-langserver").with_args(&["--stdio"]);

fn serves(language_id: &str) -> bool {
    language_id == "python"
}

impl SidexExtension for PythonLanguageExtension {
    fn get_name() -> String {
        "Python Language Features".to_string()
    }

    fn get_display_name() -> String {
        "Python Language Features".to_string()
    }

    fn get_version() -> String {
        "0.1.0".to_string()
    }

    fn get_publisher() -> String {
        "sidex".to_string()
    }

    fn get_activation_events() -> Vec<String> {
        vec!["onLanguage:python".to_string()]
    }

    fn provide_completion(ctx: DocumentContext, pos: Position) -> Option<CompletionList> {
        if !serves(&ctx.language_id) {
            return None;
        }
        LspClient::new(PYRIGHT, &ctx).completion(pos)
    }

    fn provide_hover(ctx: DocumentContext, pos: Position) -> Option<HoverResult> {
        if !serves(&ctx.language_id) {
            return None;
        }
        LspClient::new(PYRIGHT, &ctx).hover(pos)
    }

    fn provide_definition(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(PYRIGHT, &ctx).definition(pos)
    }

    fn provide_type_definition(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(PYRIGHT, &ctx).type_definition(pos)
    }

    fn provide_implementation(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(PYRIGHT, &ctx).implementation(pos)
    }

    fn provide_declaration(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(PYRIGHT, &ctx).declaration(pos)
    }

    fn provide_references(ctx: DocumentContext, pos: Position) -> Vec<Location> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(PYRIGHT, &ctx).references(pos)
    }

    fn provide_document_symbols(ctx: DocumentContext) -> Vec<DocumentSymbol> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(PYRIGHT, &ctx).symbols()
    }

    fn provide_formatting(ctx: DocumentContext, tab_size: u32, insert_spaces: bool) -> Vec<TextEdit> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(PYRIGHT, &ctx).formatting(tab_size, insert_spaces)
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
        LspClient::new(PYRIGHT, &ctx).range_formatting(range, tab_size, insert_spaces)
    }

    fn provide_document_highlights(ctx: DocumentContext, pos: Position) -> Vec<DocumentHighlight> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(PYRIGHT, &ctx).highlights(pos)
    }

    fn provide_folding_ranges(ctx: DocumentContext) -> Vec<FoldingRange> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(PYRIGHT, &ctx).folding_ranges()
    }

    fn provide_selection_ranges(ctx: DocumentContext, positions: Vec<Position>) -> Vec<SelectionRange> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(PYRIGHT, &ctx).selection_ranges(positions)
    }

    fn provide_code_actions(
        ctx: DocumentContext,
        range: Range,
        diagnostics: Vec<Diagnostic>,
    ) -> Vec<CodeAction> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(PYRIGHT, &ctx).code_actions(range, &diagnostics)
    }

    fn provide_rename(ctx: DocumentContext, pos: Position, new_name: String) -> Option<RenameResult> {
        if !serves(&ctx.language_id) {
            return None;
        }
        LspClient::new(PYRIGHT, &ctx).rename(pos, &new_name)
    }

    fn provide_document_links(ctx: DocumentContext) -> Vec<DocumentLink> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(PYRIGHT, &ctx).document_links()
    }

    fn provide_signature_help(ctx: DocumentContext, pos: Position) -> Option<SignatureHelpResult> {
        if !serves(&ctx.language_id) {
            return None;
        }
        LspClient::new(PYRIGHT, &ctx).signature_help(pos)
    }

    fn provide_inlay_hints(ctx: DocumentContext, range: Range) -> Vec<InlayHint> {
        if !serves(&ctx.language_id) {
            return vec![];
        }
        LspClient::new(PYRIGHT, &ctx).inlay_hints(range)
    }

    fn on_document_opened(ctx: DocumentContext) {
        if !serves(&ctx.language_id) {
            return;
        }
        // Starting the server on open lets pyright register the file, which is
        // what makes it push diagnostics.
        LspClient::new(PYRIGHT, &ctx).warm_up();
    }
}

sidex_extension_sdk::export_extension!(PythonLanguageExtension);
