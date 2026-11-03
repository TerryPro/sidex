//! CSV 自定义编辑器：把 `.csv` 渲染成可编辑表格。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use sidex_extension_sdk::host;
use sidex_extension_sdk::prelude::*;

const VIEW_TYPE: &str = "sidex.csv.preview";

struct CsvDocument {
	uri: String,
	rows: Vec<Vec<String>>,
}

fn documents() -> &'static Mutex<HashMap<String, CsvDocument>> {
	static DOCUMENTS: OnceLock<Mutex<HashMap<String, CsvDocument>>> = OnceLock::new();
	DOCUMENTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn handles() -> &'static Mutex<HashMap<String, String>> {
	static HANDLES: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
	HANDLES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_editor_id() -> String {
	static COUNTER: Mutex<u64> = Mutex::new(0);
	let mut counter = COUNTER.lock().unwrap();
	*counter += 1;
	format!("csv-editor-{}", *counter)
}

fn parse_csv(text: &str) -> Vec<Vec<String>> {
	let mut rows: Vec<Vec<String>> = text
		.lines()
		.filter(|line| !line.trim().is_empty())
		.map(|line| line.split(',').map(|cell| cell.trim().to_string()).collect())
		.collect();

	let width = rows.iter().map(Vec::len).max().unwrap_or(0);
	for row in &mut rows {
		row.resize(width, String::new());
	}
	rows
}

fn serialize_csv(rows: &[Vec<String>]) -> String {
	let mut out = String::new();
	for row in rows {
		out.push_str(&row.join(","));
		out.push('\n');
	}
	out
}

fn render_html(handle: u64, rows: &[Vec<String>]) -> Result<String, String> {
	let extension_path = host::get_extension_path().replace('\\', "/");
	if extension_path.is_empty() {
		return Err("extension path is unavailable".to_string());
	}

	let template = host::read_file(&format!("file:///{extension_path}/web/index.html"))
		.map_err(|error| error.to_string())?;
	let asset_base = host::webview_as_webview_uri(handle, &format!("{extension_path}/web"));
	let data = serde_json::to_string(rows)
		.unwrap_or_else(|_| "[]".to_string())
		.replace("</", "<\\/");

	Ok(template
		.replace("__SIDEX_ASSET_BASE__", &asset_base)
		.replace("__SIDEX_ROWS_JSON__", &data))
}

pub struct CsvEditorExtension;

impl SidexExtension for CsvEditorExtension {
	fn activate() -> Result<(), String> {
		host::register_custom_editor(VIEW_TYPE).map_err(|error| error.to_string())?;
		host::register_command("sidex.csv.openTable");
		host::register_command("sidex.csv.openText");
		Ok(())
	}

	fn deactivate() {}

	fn get_name() -> String {
		"csv-editor".to_string()
	}

	fn get_display_name() -> String {
		"CSV 表格编辑器".to_string()
	}

	fn get_version() -> String {
		"0.1.0".to_string()
	}

	fn get_publisher() -> String {
		"sidex".to_string()
	}

	fn get_activation_events() -> Vec<String> {
		vec!["onStartupFinished".to_string()]
	}

	fn custom_editor_open(
		_editor_type: String,
		uri: String,
		_view_column: u32,
	) -> Result<String, String> {
		let text = host::read_file(&uri).map_err(|error| error.to_string())?;
		let rows = parse_csv(&text);

		let editor_id = next_editor_id();
		let handle = host::create_webview(VIEW_TYPE, &uri).map_err(|error| error.to_string())?;
		let html = render_html(handle, &rows)?;
		host::webview_set_html(handle, &html);

		handles()
			.lock()
			.unwrap()
			.insert(handle.to_string(), editor_id.clone());
		documents()
			.lock()
			.unwrap()
			.insert(editor_id.clone(), CsvDocument { uri, rows });

		Ok(editor_id)
	}

	fn custom_editor_save(editor_id: String) -> Result<(), String> {
		let docs = documents().lock().unwrap();
		let Some(document) = docs.get(&editor_id) else {
			return Ok(());
		};
		host::write_file(&document.uri, &serialize_csv(&document.rows))
			.map_err(|error| error.to_string())
	}

	fn webview_receive_message(panel_id: String, message: String) {
		let editor_id = handles().lock().unwrap().get(&panel_id).cloned();
		let Some(editor_id) = editor_id else {
			return;
		};

		let Ok(payload) = serde_json::from_str::<serde_json::Value>(&message) else {
			return;
		};
		if payload.get("type").and_then(|value| value.as_str()) != Some("edit") {
			return;
		}

		let row = payload.get("row").and_then(|value| value.as_u64()).unwrap_or(0) as usize;
		let column = payload.get("col").and_then(|value| value.as_u64()).unwrap_or(0) as usize;
		let value = payload
			.get("value")
			.and_then(|value| value.as_str())
			.unwrap_or_default()
			.to_string();

		let mut docs = documents().lock().unwrap();
		let Some(document) = docs.get_mut(&editor_id) else {
			return;
		};
		if let Some(cells) = document.rows.get_mut(row) {
			if column < cells.len() {
				cells[column] = value;
			}
		}
		let content = serialize_csv(&document.rows);
		let uri = document.uri.clone();
		drop(docs);

		let _ = host::write_file(&uri, &content);
	}

	fn execute_command(command_id: String, _args: String) -> Result<String, String> {
		let target = match command_id.as_str() {
			"sidex.csv.openTable" => "sidex.customEditor.openMatchingEditor",
			"sidex.csv.openText" => "sidex.customEditor.openAsText",
			other => return Err(format!("unknown command: {other}")),
		};

		host::execute_built_in_command(target, "").map_err(|error| error.to_string())?;
		Ok("{}".to_string())
	}
}

sidex_extension_sdk::export_extension!(CsvEditorExtension);
