use crate::client::ChaosEaterClient;
use crate::output::{output, output_error, render_upload};

pub fn upload(client: &ChaosEaterClient, format: &str, zip_path: &str) {
    match client.upload(zip_path) {
        Ok(data) => output(&data, format, render_upload),
        Err(e) => output_error(&e.message, format, e.code),
    }
}
