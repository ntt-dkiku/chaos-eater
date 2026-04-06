use crate::client::ChaosEaterClient;
use crate::output::{output, output_error, render_generic, render_providers_status};

pub fn set_key(client: &ChaosEaterClient, format: &str, provider: &str, api_key: &str) {
    match client.set_api_key(provider, api_key) {
        Ok(data) => output(&data, format, render_generic),
        Err(e) => output_error(&e.message, format, e.code),
    }
}

pub fn get_key(client: &ChaosEaterClient, format: &str) {
    match client.get_api_key() {
        Ok(data) => output(&data, format, render_generic),
        Err(e) => output_error(&e.message, format, e.code),
    }
}

pub fn providers(client: &ChaosEaterClient, format: &str) {
    match client.get_providers_status() {
        Ok(data) => output(&data, format, render_providers_status),
        Err(e) => output_error(&e.message, format, e.code),
    }
}
