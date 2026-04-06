use colored::Colorize;
use futures_util::StreamExt;
use serde_json::Value;
use tokio_tungstenite::connect_async;

use crate::output::output_ndjson;

/// Stream events from a running job, rendering to terminal or NDJSON.
pub async fn stream_job(
    ws_base: &str,
    job_id: &str,
    format: &str,
    interactive: bool,
) -> Result<(), String> {
    let url = format!("{ws_base}/jobs/{job_id}/stream");
    let (ws, _) = connect_async(&url)
        .await
        .map_err(|e| format!("WebSocket connection failed: {e}"))?;
    let (_, mut read) = ws.split();

    while let Some(msg) = read.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(e) => {
                eprintln!("{}", format!("WebSocket error: {e}").red());
                break;
            }
        };

        if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
            let event: Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if format == "json" {
                output_ndjson(&event);
            } else {
                render_stream_event(&event, interactive);
            }

            // Check terminal conditions
            if let Some(status) = event.get("status").and_then(|v| v.as_str()) {
                if matches!(status, "completed" | "failed" | "cancelled") {
                    break;
                }
            }
            let inner = event.get("event").unwrap_or(&event);
            if inner.get("type").and_then(|v| v.as_str()) == Some("done") {
                break;
            }
        }
    }
    Ok(())
}

fn render_stream_event(event: &Value, _interactive: bool) {
    let inner = event.get("event").unwrap_or(event);
    let etype = inner
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match etype {
        "write" => {
            let text = inner.get("text").and_then(|v| v.as_str()).unwrap_or("");
            if text.starts_with('#') {
                let header = text.trim_start_matches('#').trim();
                println!("\n{}", header.cyan().bold());
            } else {
                println!("{text}");
            }
        }
        "subheader" => {
            let text = inner.get("text").and_then(|v| v.as_str()).unwrap_or("");
            let width = 60;
            let pad = if text.len() < width - 4 {
                width - text.len() - 2
            } else {
                2
            };
            let line = "─".repeat(pad / 2);
            println!("{}", format!("{line} {text} {line}").cyan().bold());
        }
        "code" => {
            let code = inner.get("code").and_then(|v| v.as_str()).unwrap_or("");
            if let Some(fname) = inner.get("filename").and_then(|v| v.as_str()) {
                if !fname.is_empty() {
                    println!("{}", format!("[{fname}]").dimmed());
                }
            }
            println!("{code}");
        }
        "partial" => {
            let chunk = inner
                .get("partial")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let is_final = inner.get("final").and_then(|v| v.as_bool()).unwrap_or(false);
            // For terminal streaming, just print the chunk. In frame mode it replaces.
            // Simple approach: always print (works well for delta mode, acceptable for frame).
            if is_final {
                println!("{chunk}");
            } else {
                print!("\r{chunk}");
            }
        }
        "iframe" => {
            let url = inner.get("url").and_then(|v| v.as_str()).unwrap_or("");
            println!("{}", format!("[Link: {url}]").cyan());
        }
        "tag" => {
            let text = inner.get("text").and_then(|v| v.as_str()).unwrap_or("");
            println!("{}", format!("[{text}]").green());
        }
        "status" => {
            let text = inner
                .get("text")
                .or_else(|| inner.get("status"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            println!("{}", text.bold());
        }
        "error" => {
            let text = inner
                .get("text")
                .or_else(|| inner.get("error"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            eprintln!("{}", format!("Error: {text}").red());
        }
        "warning" => {
            let text = inner
                .get("text")
                .or_else(|| inner.get("warning"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            eprintln!("{}", format!("Warning: {text}").yellow());
        }
        "done" => {
            println!("{}", "Done.".green());
        }
        "approval_request" => {
            let agent = inner
                .get("agent")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            println!(
                "{}",
                format!("── Approval required: {agent} ──").yellow()
            );
        }
        "stats" | "" => {
            // Progress update from job poller
            if let Some(status) = event.get("status").and_then(|v| v.as_str()) {
                let progress = event
                    .get("progress")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                println!("{status} {progress}");
            }
        }
        _ => {} // ignore unknown
    }
}
