use crate::client::ChaosEaterClient;
use crate::output::{output, output_error, render_job_response};
use crate::stream::stream_job;

pub fn stream(client: &ChaosEaterClient, format: &str, job_id: &str, interactive: bool) {
    let ws_base = client.ws_url();
    let rt = tokio::runtime::Runtime::new().unwrap();
    if let Err(e) = rt.block_on(stream_job(&ws_base, job_id, format, interactive)) {
        output_error(&e, format, 3);
    }
}

pub fn approve(
    client: &ChaosEaterClient,
    format: &str,
    job_id: &str,
    action: &str,
    message: Option<&str>,
) {
    match client.approve(job_id, action, message) {
        Ok(data) => output(&data, format, render_job_response),
        Err(e) => output_error(&e.message, format, e.code),
    }
}
