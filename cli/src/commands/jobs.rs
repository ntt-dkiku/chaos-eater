use std::thread;
use std::time::Duration;

use serde_json::json;

use crate::client::ChaosEaterClient;
use crate::output::{
    output, output_error, render_job_created, render_job_info, render_job_list,
    render_job_response,
};
use crate::stream::stream_job;

pub fn run_job(
    client: &ChaosEaterClient,
    format: &str,
    project_path: Option<&str>,
    input_data: Option<&str>,
    kube_context: &str,
    model_name: &str,
    temperature: f64,
    seed: i64,
    project_name: &str,
    namespace: &str,
    max_retries: i64,
    max_steadystates: i64,
    ce_instructions: Option<&str>,
    execution_mode: &str,
    approval_agents: &str,
    no_clean_before: bool,
    no_clean_after: bool,
    follow: bool,
) {
    if project_path.is_none() && input_data.is_none() {
        output_error(
            "Provide either --project-path or --input-data.",
            format,
            2,
        );
    }

    let agents: Vec<String> = approval_agents
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let mut request = json!({
        "model_name": model_name,
        "temperature": temperature,
        "seed": seed,
        "kube_context": kube_context,
        "project_name": project_name,
        "namespace": namespace,
        "max_retries": max_retries,
        "max_num_steadystates": max_steadystates,
        "execution_mode": execution_mode,
        "approval_agents": agents,
        "clean_cluster_before_run": !no_clean_before,
        "clean_cluster_after_run": !no_clean_after,
    });

    if let Some(pp) = project_path {
        request["project_path"] = json!(pp);
    }
    if let Some(id) = input_data {
        match serde_json::from_str::<serde_json::Value>(id) {
            Ok(v) => request["input_data"] = v,
            Err(e) => output_error(&format!("Invalid JSON in --input-data: {e}"), format, 2),
        }
    }
    if let Some(inst) = ce_instructions {
        request["ce_instructions"] = json!(inst);
    }

    match client.create_job(&request) {
        Ok(data) => {
            output(&data, format, render_job_created);
            if follow {
                if let Some(job_id) = data.get("job_id").and_then(|v| v.as_str()) {
                    let ws_base = client.ws_url();
                    let rt = tokio::runtime::Runtime::new().unwrap();
                    if let Err(e) =
                        rt.block_on(stream_job(&ws_base, job_id, format, false))
                    {
                        output_error(&e, format, 3);
                    }
                }
            }
        }
        Err(e) => output_error(&e.message, format, e.code),
    }
}

pub fn list(client: &ChaosEaterClient, format: &str, status: Option<&str>) {
    match client.list_jobs(status) {
        Ok(data) => output(&data, format, render_job_list),
        Err(e) => output_error(&e.message, format, e.code),
    }
}

pub fn status(client: &ChaosEaterClient, format: &str, job_id: &str) {
    match client.get_job(job_id) {
        Ok(data) => output(&data, format, render_job_info),
        Err(e) => output_error(&e.message, format, e.code),
    }
}

pub fn cancel(client: &ChaosEaterClient, format: &str, job_id: &str) {
    match client.cancel_job(job_id) {
        Ok(data) => output(&data, format, render_job_response),
        Err(e) => output_error(&e.message, format, e.code),
    }
}

pub fn pause(client: &ChaosEaterClient, format: &str, job_id: &str) {
    match client.pause_job(job_id) {
        Ok(data) => output(&data, format, render_job_response),
        Err(e) => output_error(&e.message, format, e.code),
    }
}

pub fn resume(client: &ChaosEaterClient, format: &str, job_id: &str, feedback: Option<&str>) {
    match client.resume_job(job_id, feedback) {
        Ok(data) => output(&data, format, render_job_response),
        Err(e) => output_error(&e.message, format, e.code),
    }
}

pub fn wait(
    client: &ChaosEaterClient,
    format: &str,
    job_id: &str,
    poll_interval: f64,
    timeout: Option<f64>,
) {
    let start = std::time::Instant::now();
    let terminal = ["completed", "failed", "cancelled"];
    loop {
        match client.get_job(job_id) {
            Ok(data) => {
                let s = data
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                if terminal.contains(&s) {
                    output(&data, format, render_job_info);
                    if s != "completed" {
                        std::process::exit(4);
                    }
                    return;
                }
            }
            Err(e) => output_error(&e.message, format, e.code),
        }
        if let Some(t) = timeout {
            if start.elapsed().as_secs_f64() > t {
                output_error(&format!("Timeout waiting for job {job_id}"), format, 4);
            }
        }
        thread::sleep(Duration::from_secs_f64(poll_interval));
    }
}
