//! Tiny JSON scanners.
//!
//! The host hands language-server responses over as raw JSON strings, so these
//! helpers slice out the pieces the client needs. They are string aware, which
//! matters because documents and messages routinely contain `{` or `}`.

/// Finds `"key"` and returns the offset of the colon that follows it.
fn find_key(json: &str, key: &str) -> Option<usize> {
    let pattern = format!("\"{key}\"");
    let key_pos = json.find(&pattern)?;
    let after = &json[key_pos + pattern.len()..];
    let colon = after.find(':')?;
    Some(key_pos + pattern.len() + colon)
}

/// Returns everything after `"key":` (trimmed), or `None` when the key is absent.
pub fn value_after<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let colon = find_key(json, key)?;
    Some(json[colon + 1..].trim_start())
}

/// Returns the complete value that follows `"key":`.
pub fn take_value<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let start = value_after(json, key)?;
    take_token(start)
}

/// Returns the next JSON value at the start of `input`.
pub fn take_token(input: &str) -> Option<&str> {
    let bytes = input.as_bytes();
    match bytes.first()? {
        b'{' => take_enclosed(input, b'{', b'}'),
        b'[' => take_enclosed(input, b'[', b']'),
        b'"' => take_string(input),
        _ => {
            let end = input
                .find(|c: char| c == ',' || c == '}' || c == ']' || c.is_whitespace())
                .unwrap_or(input.len());
            Some(input[..end].trim_end())
        }
    }
}

/// Returns the array that starts at `input`, honouring strings and nesting.
pub fn take_array(input: &str) -> Option<&str> {
    take_enclosed(input, b'[', b']')
}

fn take_string(input: &str) -> Option<&str> {
    let bytes = input.as_bytes();
    if bytes.first() != Some(&b'"') {
        return None;
    }
    let mut escaped = false;
    for (index, &byte) in bytes.iter().enumerate().skip(1) {
        if escaped {
            escaped = false;
            continue;
        }
        match byte {
            b'\\' => escaped = true,
            b'"' => return Some(&input[..=index]),
            _ => {}
        }
    }
    None
}

fn take_enclosed(input: &str, open: u8, close: u8) -> Option<&str> {
    let bytes = input.as_bytes();
    if bytes.first() != Some(&open) {
        return None;
    }
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (index, &byte) in bytes.iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b if b == open => depth += 1,
            b if b == close => {
                depth -= 1;
                if depth == 0 {
                    return Some(&input[..=index]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Splits the elements of a JSON array into their raw slices.
pub fn array_items(array: &str) -> Vec<&str> {
    let Some(inner) = take_array(array) else {
        return Vec::new();
    };
    let inner = &inner[1..inner.len().saturating_sub(1)];

    let mut items = Vec::new();
    let mut rest = inner.trim_start();
    while !rest.is_empty() {
        let Some(item) = take_token(rest) else {
            break;
        };
        if !item.is_empty() {
            items.push(item);
        }
        rest = &rest[item.len()..];
        rest = rest.trim_start();
        rest = rest.strip_prefix(',').unwrap_or(rest).trim_start();
    }
    items
}

/// Decodes a JSON string token (`"..."`), unescaping the common sequences.
pub fn string_token(input: &str) -> Option<String> {
    let token = take_string(input.trim_start())?;
    let body = &token[1..token.len() - 1];

    let mut out = String::with_capacity(body.len());
    let mut chars = body.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next()? {
            'n' => out.push('\n'),
            'r' => out.push('\r'),
            't' => out.push('\t'),
            'b' => out.push('\u{0008}'),
            'f' => out.push('\u{000c}'),
            '"' => out.push('"'),
            '\\' => out.push('\\'),
            '/' => out.push('/'),
            'u' => {
                let mut hex = String::new();
                for _ in 0..4 {
                    hex.push(chars.next()?);
                }
                if let Ok(code) = u32::from_str_radix(&hex, 16) {
                    if let Some(ch) = char::from_u32(code) {
                        out.push(ch);
                    }
                }
            }
            other => out.push(other),
        }
    }
    Some(out)
}

/// Reads a string field.
pub fn string_field(json: &str, key: &str) -> Option<String> {
    string_token(value_after(json, key)?)
}

/// Reads an integer field.
pub fn u32_field(json: &str, key: &str) -> Option<u32> {
    take_value(json, key)?.parse().ok()
}

/// Reads a boolean field.
pub fn bool_field(json: &str, key: &str) -> bool {
    take_value(json, key).is_some_and(|value| value == "true")
}

/// Escapes user supplied text so it can be embedded inside a JSON string.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other => out.push(other),
        }
    }
    out
}
