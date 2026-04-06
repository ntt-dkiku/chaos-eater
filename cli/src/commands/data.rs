use crate::client::ChaosEaterClient;
use crate::output::{output, output_error, render_generic};

pub fn logs(client: &ChaosEaterClient, format: &str, job_id: &str) {
    match client.get_logs(job_id) {
        Ok(data) => output(&data, format, render_generic),
        Err(e) => output_error(&e.message, format, e.code),
    }
}

pub fn output_cmd(client: &ChaosEaterClient, format: &str, job_id: &str) {
    match client.get_output(job_id) {
        Ok(data) => output(&data, format, render_generic),
        Err(e) => output_error(&e.message, format, e.code),
    }
}

pub fn artifact(client: &ChaosEaterClient, format: &str, job_id: &str, dest: Option<&str>) {
    let dest = dest
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{job_id}.zip"));
    match client.download_artifact(job_id, &dest) {
        Ok(path) => {
            if format == "json" {
                println!("{}", serde_json::json!({"path": path}));
            } else {
                println!("Downloaded to {path}");
            }
        }
        Err(e) => output_error(&e.message, format, e.code),
    }
}
