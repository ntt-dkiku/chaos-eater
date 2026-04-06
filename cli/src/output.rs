use colored::Colorize;
use comfy_table::{Cell, Table};
use serde_json::Value;

/// Print JSON or human output depending on format.
pub fn output(data: &Value, format: &str, human_fn: impl FnOnce(&Value)) {
    if format == "json" {
        println!("{}", serde_json::to_string_pretty(data).unwrap_or_default());
    } else {
        human_fn(data);
    }
}

/// Print one NDJSON line (for streaming).
pub fn output_ndjson(data: &Value) {
    println!("{}", serde_json::to_string(data).unwrap_or_default());
}

/// Print error and exit.
pub fn output_error(msg: &str, format: &str, code: i32) -> ! {
    if format == "json" {
        eprintln!(
            "{}",
            serde_json::json!({"error": msg, "code": code})
        );
    } else {
        eprintln!("{} {msg}", "Error:".red());
    }
    std::process::exit(code);
}

// -----------------------------------------------------------------
// Human renderers
// -----------------------------------------------------------------

fn status_colored(status: &str) -> String {
    match status {
        "pending" => status.yellow().to_string(),
        "running" => status.blue().to_string(),
        "paused" => status.magenta().to_string(),
        "completed" => status.green().to_string(),
        "failed" => status.red().to_string(),
        "cancelled" => status.dimmed().to_string(),
        _ => status.to_string(),
    }
}

pub fn render_health(data: &Value) {
    let ts = data
        .get("timestamp")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    println!("{} {ts}", "Healthy".green());
}

pub fn render_job_created(data: &Value) {
    let id = data.get("job_id").and_then(|v| v.as_str()).unwrap_or("?");
    println!("{} {id}", "Job created".green());
    if let Some(wd) = data.get("work_dir").and_then(|v| v.as_str()) {
        println!("  work_dir: {wd}");
    }
}

pub fn render_job_info(data: &Value) {
    let id = data.get("job_id").and_then(|v| v.as_str()).unwrap_or("?");
    let status = data.get("status").and_then(|v| v.as_str()).unwrap_or("?");
    println!("Job {id}  {}", status_colored(status));
    for key in &[
        "progress",
        "current_phase",
        "current_agent",
        "error",
        "work_dir",
    ] {
        if let Some(val) = data.get(*key).and_then(|v| v.as_str()) {
            if !val.is_empty() {
                println!("  {key}: {val}");
            }
        }
    }
}

pub fn render_job_list(data: &Value) {
    let jobs = match data.as_array() {
        Some(a) if a.is_empty() => {
            println!("{}", "No jobs found.".dimmed());
            return;
        }
        Some(a) => a,
        None => {
            render_generic(data);
            return;
        }
    };

    let mut table = Table::new();
    table.set_header(vec!["Job ID", "Status", "Phase", "Created"]);
    for j in jobs {
        let id = j.get("job_id").and_then(|v| v.as_str()).unwrap_or("?");
        let status = j.get("status").and_then(|v| v.as_str()).unwrap_or("?");
        let phase = j
            .get("current_phase")
            .and_then(|v| v.as_str())
            .unwrap_or("-");
        let created = j
            .get("created_at")
            .and_then(|v| v.as_str())
            .map(|s| if s.len() > 19 { &s[..19] } else { s })
            .unwrap_or("-");
        table.add_row(vec![
            Cell::new(id),
            Cell::new(status_colored(status)),
            Cell::new(phase),
            Cell::new(created),
        ]);
    }
    println!("{table}");
}

pub fn render_job_response(data: &Value) {
    let status = data.get("status").and_then(|v| v.as_str()).unwrap_or("?");
    let msg = data.get("message").and_then(|v| v.as_str()).unwrap_or("");
    println!("{} {msg}", status_colored(status));
    if let Some(id) = data.get("job_id").and_then(|v| v.as_str()) {
        println!("  job_id: {id}");
    }
}

pub fn render_upload(data: &Value) {
    let path = data
        .get("project_path")
        .or_else(|| data.get("path"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    println!("{} {path}", "Uploaded".green());
}

pub fn render_clusters(data: &Value) {
    match data.as_array() {
        Some(arr) if arr.is_empty() => println!("{}", "No clusters found.".dimmed()),
        Some(arr) => {
            for c in arr {
                if let Some(ctx) = c.get("context").and_then(|v| v.as_str()) {
                    println!("  {ctx}");
                } else if let Some(s) = c.as_str() {
                    println!("  {s}");
                } else {
                    println!("  {c}");
                }
            }
        }
        None => render_generic(data),
    }
}

pub fn render_providers_status(data: &Value) {
    if let Some(obj) = data.as_object() {
        for (provider, status) in obj {
            let available = status.as_bool().unwrap_or(false);
            if available {
                println!("  {}: {}", provider.green(), "available".green());
            } else {
                println!("  {}: {}", provider.red(), "unavailable".red());
            }
        }
    } else {
        render_generic(data);
    }
}

pub fn render_generic(data: &Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(data).unwrap_or_default()
    );
}
