use crate::client::ChaosEaterClient;
use crate::output::{output, output_error, render_clusters, render_generic};

pub fn list(client: &ChaosEaterClient, format: &str, session_id: Option<&str>) {
    match client.list_clusters(session_id) {
        Ok(data) => output(&data, format, render_clusters),
        Err(e) => output_error(&e.message, format, e.code),
    }
}

pub fn claim(client: &ChaosEaterClient, format: &str, session_id: &str, preferred: Option<&str>) {
    match client.claim_cluster(session_id, preferred) {
        Ok(data) => output(&data, format, render_generic),
        Err(e) => output_error(&e.message, format, e.code),
    }
}

pub fn release(client: &ChaosEaterClient, format: &str, session_id: &str) {
    match client.release_cluster(session_id) {
        Ok(data) => output(&data, format, render_generic),
        Err(e) => output_error(&e.message, format, e.code),
    }
}

pub fn clean(client: &ChaosEaterClient, format: &str, kube_context: &str, namespace: &str, project_name: &str) {
    match client.clean_cluster(kube_context, namespace, project_name) {
        Ok(data) => output(&data, format, render_generic),
        Err(e) => output_error(&e.message, format, e.code),
    }
}
