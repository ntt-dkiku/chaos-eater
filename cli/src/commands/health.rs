use crate::client::ChaosEaterClient;
use crate::output::{output, output_error, render_health};

pub fn run(client: &ChaosEaterClient, format: &str) {
    match client.health() {
        Ok(data) => output(&data, format, render_health),
        Err(e) => output_error(&e.message, format, e.code),
    }
}
