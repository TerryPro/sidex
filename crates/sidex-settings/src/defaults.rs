//! Built-in default settings for SideX.
//!
//! The catalog only covers features SideX keeps. Settings for removed IDE
//! features (debug, Git/SCM, notebooks, remote, tasks, tests, chat, update,
//! telemetry, extension marketplace, LSP-style completion/navigation) are
//! intentionally absent so the settings UI and search stay free of dead
//! entries.

use serde_json::{json, Map, Value};

/// Return the complete map of built-in default settings.
pub fn builtin_defaults() -> Value {
    let mut m = Map::new();
    add_file_browsing_defaults(&mut m);
    add_editor_defaults(&mut m);
    add_appearance_defaults(&mut m);
    add_keybinding_defaults(&mut m);
    add_language_defaults(&mut m);
    Value::Object(m)
}

fn ins(m: &mut Map<String, Value>, key: &str, value: Value) {
    m.insert(key.to_owned(), value);
}

// ---------------------------------------------------------------------------
// Files & Browsing
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_lines)]
fn add_file_browsing_defaults(m: &mut Map<String, Value>) {
    // Files
    ins(m, "files.autoSave", json!("off"));
    ins(m, "files.autoSaveDelay", json!(1000));
    ins(m, "files.encoding", json!("utf8"));
    ins(m, "files.eol", json!("auto"));
    ins(m, "files.trimTrailingWhitespace", json!(false));
    ins(m, "files.insertFinalNewline", json!(false));
    ins(m, "files.trimFinalNewlines", json!(false));
    ins(
        m,
        "files.exclude",
        json!({"**/.git": true, "**/.svn": true, "**/.hg": true, "**/CVS": true, "**/.DS_Store": true, "**/Thumbs.db": true}),
    );
    ins(
        m,
        "files.watcherExclude",
        json!({"**/.git/objects/**": true, "**/.git/subtree-cache/**": true, "**/node_modules/**": true, "**/.hg/store/**": true}),
    );
    ins(m, "files.hotExit", json!("onExit"));
    ins(m, "files.defaultLanguage", json!(""));
    ins(m, "files.maxMemoryForLargeFilesMB", json!(4096));
    ins(m, "files.simpleDialog.enable", json!(false));
    ins(m, "files.associations", json!({}));

    // Explorer
    ins(m, "explorer.openEditors.visible", json!(9));
    ins(m, "explorer.autoReveal", json!(true));
    ins(m, "explorer.enableDragAndDrop", json!(true));
    ins(m, "explorer.confirmDragAndDrop", json!(true));
    ins(m, "explorer.confirmDelete", json!(true));
    ins(m, "explorer.sortOrder", json!("default"));
    ins(
        m,
        "explorer.sortOrderLexicographicOptions",
        json!("default"),
    );
    ins(m, "explorer.decorations.colors", json!(true));
    ins(m, "explorer.decorations.badges", json!(true));
    ins(m, "explorer.incrementalNaming", json!("simple"));
    ins(m, "explorer.compactFolders", json!(true));

    // Search
    ins(
        m,
        "search.exclude",
        json!({"**/node_modules": true, "**/bower_components": true, "**/*.code-search": true}),
    );
    ins(m, "search.useIgnoreFiles", json!(true));
    ins(m, "search.useGlobalIgnoreFiles", json!(false));
    ins(m, "search.useParentIgnoreFiles", json!(true));
    ins(m, "search.followSymlinks", json!(true));
    ins(m, "search.smartCase", json!(false));
    ins(m, "search.showLineNumbers", json!(false));
    ins(m, "search.seedOnFocus", json!(false));
    ins(m, "search.seedWithNearestWord", json!(false));
    ins(m, "search.mode", json!("view"));
    ins(m, "search.collapseResults", json!("alwaysExpand"));
    ins(m, "search.searchOnType", json!(true));
    ins(m, "search.searchOnTypeDebouncePeriod", json!(300));
    ins(m, "search.sortOrder", json!("default"));
    ins(m, "search.defaultViewMode", json!("list"));
    ins(m, "search.quickOpen.includeHistory", json!(true));

    // Output
    ins(m, "output.smartScroll.enabled", json!(true));
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_lines)]
fn add_editor_defaults(m: &mut Map<String, Value>) {
    // Font & layout
    ins(m, "editor.fontSize", json!(14));
    ins(
        m,
        "editor.fontFamily",
        json!("Consolas, 'Courier New', monospace"),
    );
    ins(m, "editor.fontWeight", json!("normal"));
    ins(m, "editor.fontLigatures", json!(false));
    ins(m, "editor.lineHeight", json!(0));
    ins(m, "editor.letterSpacing", json!(0));
    ins(m, "editor.padding.top", json!(0));
    ins(m, "editor.padding.bottom", json!(0));
    ins(m, "editor.lineDecorationsWidth", json!(10));
    ins(m, "editor.rulers", json!([]));

    // Indentation
    ins(m, "editor.tabSize", json!(4));
    ins(m, "editor.insertSpaces", json!(true));
    ins(m, "editor.detectIndentation", json!(true));
    ins(m, "editor.trimAutoWhitespace", json!(true));
    ins(m, "editor.autoIndent", json!("full"));

    // Wrapping
    ins(m, "editor.wordWrap", json!("off"));
    ins(m, "editor.wordWrapColumn", json!(80));
    ins(m, "editor.wrappingIndent", json!("same"));
    ins(m, "editor.wrappingStrategy", json!("simple"));

    // Display
    ins(m, "editor.lineNumbers", json!("on"));
    ins(m, "editor.renderWhitespace", json!("selection"));
    ins(m, "editor.renderControlCharacters", json!(true));
    ins(m, "editor.renderLineHighlight", json!("line"));
    ins(m, "editor.scrollBeyondLastLine", json!(true));
    ins(m, "editor.scrollBeyondLastColumn", json!(5));
    ins(m, "editor.roundedSelection", json!(true));
    ins(m, "editor.overviewRulerBorder", json!(true));
    ins(m, "editor.overviewRulerLanes", json!(3));
    ins(m, "editor.glyphMargin", json!(true));

    // Cursor & scrolling
    ins(m, "editor.cursorStyle", json!("line"));
    ins(m, "editor.cursorBlinking", json!("blink"));
    ins(m, "editor.cursorWidth", json!(0));
    ins(m, "editor.cursorSmoothCaretAnimation", json!("off"));
    ins(m, "editor.smoothScrolling", json!(false));
    ins(m, "editor.mouseWheelScrollSensitivity", json!(1));
    ins(m, "editor.fastScrollSensitivity", json!(5));
    ins(m, "editor.mouseWheelZoom", json!(false));

    // Editing behavior
    ins(m, "editor.autoClosingBrackets", json!("languageDefined"));
    ins(m, "editor.autoClosingComments", json!("languageDefined"));
    ins(m, "editor.autoClosingQuotes", json!("languageDefined"));
    ins(m, "editor.autoClosingDelete", json!("auto"));
    ins(m, "editor.autoClosingOvertype", json!("auto"));
    ins(m, "editor.autoSurround", json!("languageDefined"));
    ins(m, "editor.dragAndDrop", json!(true));
    ins(m, "editor.emptySelectionClipboard", json!(true));
    ins(m, "editor.copyWithSyntaxHighlighting", json!(true));
    ins(m, "editor.multiCursorModifier", json!("alt"));
    ins(m, "editor.multiCursorMergeOverlapping", json!(true));
    ins(m, "editor.multiCursorPaste", json!("spread"));
    ins(m, "editor.columnSelection", json!(false));
    ins(m, "editor.links", json!(true));
    ins(m, "editor.selectionHighlight", json!(true));
    ins(m, "editor.occurrencesHighlight", json!("singleFile"));
    ins(
        m,
        "editor.wordSeparators",
        json!("`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?"),
    );

    // Accessibility & large files
    ins(m, "editor.accessibilitySupport", json!("auto"));
    ins(m, "editor.largeFileOptimizations", json!(true));
    ins(m, "editor.maxTokenizationLineLength", json!(20000));

    // Brackets & folding
    ins(m, "editor.matchBrackets", json!("always"));
    ins(m, "editor.bracketPairColorization.enabled", json!(true));
    ins(
        m,
        "editor.bracketPairColorization.independentColorPoolPerBracketType",
        json!(false),
    );
    ins(m, "editor.guides.bracketPairs", json!("active"));
    ins(m, "editor.guides.bracketPairsHorizontal", json!("active"));
    ins(m, "editor.guides.highlightActiveBracketPair", json!(true));
    ins(m, "editor.guides.indentation", json!(true));
    ins(m, "editor.guides.highlightActiveIndentation", json!(true));
    ins(m, "editor.folding", json!(true));
    ins(m, "editor.foldingStrategy", json!("auto"));
    ins(m, "editor.foldingMaximumRegions", json!(5000));
    ins(m, "editor.showFoldingControls", json!("mouseover"));

    // Find
    ins(
        m,
        "editor.find.seedSearchStringFromSelection",
        json!("always"),
    );
    ins(m, "editor.find.autoFindInSelection", json!("never"));
    ins(m, "editor.find.addExtraSpaceOnTop", json!(true));
    ins(m, "editor.find.loop", json!(true));

    // Formatting
    ins(m, "editor.formatOnSave", json!(false));
    ins(m, "editor.formatOnPaste", json!(false));
    ins(m, "editor.formatOnType", json!(false));

    // Unicode highlighting
    ins(
        m,
        "editor.unicodeHighlight.ambiguousCharacters",
        json!(true),
    );
    ins(
        m,
        "editor.unicodeHighlight.invisibleCharacters",
        json!(true),
    );
    ins(
        m,
        "editor.unicodeHighlight.nonBasicASCII",
        json!("inUntrustedWorkspace"),
    );
    ins(
        m,
        "editor.unicodeHighlight.includeComments",
        json!("inUntrustedWorkspace"),
    );

    // Terminal
    ins(m, "terminal.integrated.fontSize", json!(14));
    ins(m, "terminal.integrated.fontFamily", json!(""));
    ins(m, "terminal.integrated.fontWeight", json!("normal"));
    ins(m, "terminal.integrated.fontWeightBold", json!("bold"));
    ins(m, "terminal.integrated.lineHeight", json!(1));
    ins(m, "terminal.integrated.letterSpacing", json!(0));
    ins(m, "terminal.integrated.cursorBlinking", json!(false));
    ins(m, "terminal.integrated.cursorStyle", json!("block"));
    ins(m, "terminal.integrated.cursorWidth", json!(1));
    ins(m, "terminal.integrated.scrollback", json!(1000));
    ins(
        m,
        "terminal.integrated.rightClickBehavior",
        json!("selectWord"),
    );
    ins(m, "terminal.integrated.copyOnSelection", json!(false));
    ins(
        m,
        "terminal.integrated.drawBoldTextInBrightColors",
        json!(true),
    );
    ins(m, "terminal.integrated.fastScrollSensitivity", json!(5));
    ins(
        m,
        "terminal.integrated.mouseWheelScrollSensitivity",
        json!(1),
    );
    ins(m, "terminal.integrated.enableBell", json!(false));
    ins(m, "terminal.integrated.commandsToSkipShell", json!([]));
    ins(m, "terminal.integrated.allowChords", json!(true));
    ins(m, "terminal.integrated.allowMnemonics", json!(false));
    ins(m, "terminal.integrated.inheritEnv", json!(true));
    ins(m, "terminal.integrated.env.windows", json!({}));
    ins(m, "terminal.integrated.showExitAlert", json!(true));
    ins(m, "terminal.integrated.splitCwd", json!("inherited"));
    ins(m, "terminal.integrated.tabs.enabled", json!(true));
    ins(
        m,
        "terminal.integrated.tabs.hideCondition",
        json!("singleTerminal"),
    );
    ins(m, "terminal.integrated.tabs.location", json!("right"));
    ins(m, "terminal.integrated.defaultProfile.windows", Value::Null);
    ins(m, "terminal.integrated.smoothScrolling", json!(false));
    ins(
        m,
        "terminal.integrated.enableMultiLinePasteWarning",
        json!("auto"),
    );
    ins(m, "terminal.integrated.minimumContrastRatio", json!(4.5));
}

// ---------------------------------------------------------------------------
// Theme & Appearance
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_lines)]
fn add_appearance_defaults(m: &mut Map<String, Value>) {
    // Theme
    ins(m, "workbench.colorTheme", json!("Default Dark+"));
    ins(m, "workbench.iconTheme", json!("vs-seti"));
    ins(m, "workbench.productIconTheme", json!("Default"));
    ins(m, "workbench.colorCustomizations", json!({}));

    // Layout
    ins(m, "workbench.startupEditor", json!("welcomePage"));
    ins(m, "workbench.sideBar.location", json!("left"));
    ins(m, "workbench.activityBar.visible", json!(true));
    ins(m, "workbench.activityBar.location", json!("top"));
    ins(m, "workbench.statusBar.visible", json!(true));
    ins(m, "workbench.panel.defaultLocation", json!("bottom"));
    ins(m, "workbench.panel.opensMaximized", json!("never"));
    ins(m, "workbench.layoutControl.enabled", json!(true));
    ins(m, "workbench.layoutControl.type", json!("both"));

    // Editor tabs & groups
    ins(m, "workbench.editor.showTabs", json!("multiple"));
    ins(m, "workbench.editor.tabSizing", json!("fit"));
    ins(m, "workbench.editor.tabCloseButton", json!("right"));
    ins(m, "workbench.editor.enablePreview", json!(true));
    ins(
        m,
        "workbench.editor.enablePreviewFromQuickOpen",
        json!(false),
    );
    ins(m, "workbench.editor.highlightModifiedTabs", json!(false));
    ins(m, "workbench.editor.wrapTabs", json!(false));
    ins(m, "workbench.editor.decorations.badges", json!(true));
    ins(m, "workbench.editor.decorations.colors", json!(true));
    ins(m, "workbench.editor.closeOnFileDelete", json!(false));
    ins(m, "workbench.editor.openPositioning", json!("right"));
    ins(
        m,
        "workbench.editor.openSideBySideDirection",
        json!("right"),
    );
    ins(m, "workbench.editor.revealIfOpen", json!(false));
    ins(m, "workbench.editor.splitOnDragAndDrop", json!(true));
    ins(m, "workbench.editor.splitSizing", json!("distribute"));
    ins(m, "workbench.editor.limit.enabled", json!(false));
    ins(m, "workbench.editor.limit.value", json!(10));
    ins(m, "workbench.editor.limit.perEditorGroup", json!(false));
    ins(m, "workbench.editor.labelFormat", json!("default"));
    ins(m, "workbench.editor.untitled.labelFormat", json!("content"));
    ins(m, "workbench.editor.pinnedTabSizing", json!("normal"));

    // Lists & trees
    ins(m, "workbench.tree.indent", json!(8));
    ins(m, "workbench.tree.renderIndentGuides", json!("onHover"));
    ins(m, "workbench.tree.expandMode", json!("singleClick"));
    ins(m, "workbench.list.smoothScrolling", json!(false));
    ins(m, "workbench.list.openMode", json!("singleClick"));
    ins(m, "workbench.list.multiSelectModifier", json!("ctrlCmd"));

    // Window
    ins(m, "window.zoomLevel", json!(0));
    ins(
        m,
        "window.title",
        json!("${dirty}${activeEditorShort}${separator}${rootName}${separator}${appName}"),
    );
    ins(m, "window.restoreWindows", json!("all"));
    ins(m, "window.newWindowDimensions", json!("default"));
    ins(m, "window.openFilesInNewWindow", json!("off"));
    ins(m, "window.openFoldersInNewWindow", json!("default"));
    ins(m, "window.closeWhenEmpty", json!(false));
    ins(m, "window.titleBarStyle", json!("custom"));
    ins(m, "window.dialogStyle", json!("native"));
    ins(m, "window.menuBarVisibility", json!("classic"));
    ins(m, "window.enableMenuBarMnemonics", json!(true));
    ins(m, "window.autoDetectColorScheme", json!(false));
    ins(m, "window.autoDetectHighContrast", json!(true));
    ins(m, "window.commandCenter", json!(true));
}

// ---------------------------------------------------------------------------
// Keybindings
// ---------------------------------------------------------------------------

fn add_keybinding_defaults(m: &mut Map<String, Value>) {
    ins(m, "keyboard.dispatch", json!("code"));
    ins(m, "keyboard.mapAltGrToCtrlAlt", json!(false));
}

// ---------------------------------------------------------------------------
// Language overrides
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_lines)]
fn add_language_defaults(m: &mut Map<String, Value>) {
    ins(m, "[rust]", json!({ "editor.tabSize": 4 }));
    ins(m, "[typescript]", json!({ "editor.tabSize": 2 }));
    ins(m, "[typescriptreact]", json!({ "editor.tabSize": 2 }));
    ins(m, "[javascript]", json!({ "editor.tabSize": 2 }));
    ins(
        m,
        "[python]",
        json!({
            "editor.tabSize": 4,
            "editor.insertSpaces": true
        }),
    );
    ins(
        m,
        "[go]",
        json!({
            "editor.tabSize": 4,
            "editor.insertSpaces": false
        }),
    );
    ins(m, "[json]", json!({ "editor.tabSize": 2 }));
    ins(m, "[jsonc]", json!({ "editor.tabSize": 2 }));
    ins(
        m,
        "[yaml]",
        json!({
            "editor.tabSize": 2,
            "editor.insertSpaces": true
        }),
    );
    ins(m, "[html]", json!({ "editor.tabSize": 2 }));
    ins(m, "[css]", json!({ "editor.tabSize": 2 }));
    ins(m, "[markdown]", json!({ "editor.wordWrap": "on" }));
    ins(m, "[makefile]", json!({ "editor.insertSpaces": false }));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Settings that belong to features SideX removed must not reappear.
    const REMOVED_KEY_PREFIXES: &[&str] = &[
        "debug.",
        "git.",
        "scm.",
        "notebook.",
        "remote.",
        "tasks.",
        "testing.",
        "chat.",
        "update.",
        "telemetry.",
        "problems.",
        "extensions.",
        "editor.suggest.",
        "editor.quickSuggestions",
        "editor.parameterHints.",
        "editor.hover.",
        "editor.codeLens",
        "editor.gotoLocation.",
        "editor.inlayHints.",
        "editor.lightbulb.",
        "editor.codeActionsOnSave",
        "editor.semanticHighlighting.",
    ];

    #[test]
    fn defaults_is_object() {
        let d = builtin_defaults();
        assert!(d.is_object());
    }

    #[test]
    fn has_editor_font_size() {
        let d = builtin_defaults();
        assert_eq!(d["editor.fontSize"], 14);
    }

    #[test]
    fn has_workbench_theme() {
        let d = builtin_defaults();
        assert_eq!(d["workbench.colorTheme"], "Default Dark+");
    }

    #[test]
    fn has_files_auto_save() {
        let d = builtin_defaults();
        assert_eq!(d["files.autoSave"], "off");
    }

    #[test]
    fn has_terminal_font_size() {
        let d = builtin_defaults();
        assert_eq!(d["terminal.integrated.fontSize"], 14);
    }

    #[test]
    fn has_search_defaults() {
        let d = builtin_defaults();
        assert_eq!(d["search.useIgnoreFiles"], true);
    }

    #[test]
    fn has_window_defaults() {
        let d = builtin_defaults();
        assert_eq!(d["window.zoomLevel"], 0);
    }

    #[test]
    fn has_explorer_defaults() {
        let d = builtin_defaults();
        assert_eq!(d["explorer.confirmDelete"], true);
    }

    #[test]
    fn has_keybinding_defaults() {
        let d = builtin_defaults();
        assert_eq!(d["keyboard.dispatch"], "code");
    }

    #[test]
    fn has_language_overrides() {
        let d = builtin_defaults();
        assert_eq!(d["[rust]"]["editor.tabSize"], 4);
        assert_eq!(d["[python]"]["editor.insertSpaces"], true);
    }

    #[test]
    fn removed_features_have_no_defaults() {
        let d = builtin_defaults();
        let keys: Vec<&String> = d.as_object().unwrap().keys().collect();
        for key in keys {
            for prefix in REMOVED_KEY_PREFIXES {
                assert!(
                    !key.starts_with(prefix),
                    "removed-feature setting leaked into defaults: {key}"
                );
            }
        }
    }

    #[test]
    fn count_defaults() {
        let d = builtin_defaults();
        let count = d.as_object().unwrap().len();
        // Before convergence the catalog held 328 entries. Keep the curated
        // catalog well below that so the settings surface stays small.
        assert!(
            (200..=230).contains(&count),
            "Expected 200-230 curated defaults, got {count}"
        );
    }
}
