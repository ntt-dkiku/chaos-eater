use reqwest::blocking::{Client, Response};
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

pub struct ChaosEaterClient {
    client: Client,
    base_url: String,
}

#[derive(Debug)]
pub struct CliError {
    pub message: String,
    pub code: i32,
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl ChaosEaterClient {
    pub fn new(base_url: &str, timeout: f64) -> Result<Self, CliError> {
        let client = Client::builder()
            .timeout(Duration::from_secs_f64(timeout))
            .build()
            .map_err(|e| CliError {
                message: format!("Failed to create HTTP client: {e}"),
                code: 1,
            })?;
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
        })
    }

    pub fn ws_url(&self) -> String {
        self.base_url
            .replace("http://", "ws://")
            .replace("https://", "wss://")
    }

    fn handle_response(&self, resp: Response) -> Result<Value, CliError> {
        let status = resp.status();
        if status.is_client_error() || status.is_server_error() {
            let body = resp.text().unwrap_or_default();
            let detail = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| v.get("detail").map(|d| d.to_string()))
                .unwrap_or(body);
            return Err(CliError {
                message: format!("API error {status}: {detail}"),
                code: 1,
            });
        }
        resp.json::<Value>().map_err(|e| CliError {
            message: format!("Failed to parse response: {e}"),
            code: 1,
        })
    }

    fn get(&self, path: &str) -> Result<Value, CliError> {
        let resp = self
            .client
            .get(format!("{}{path}", self.base_url))
            .send()
            .map_err(|e| conn_error(&self.base_url, e))?;
        self.handle_response(resp)
    }

    fn get_with_params(&self, path: &str, params: &[(&str, &str)]) -> Result<Value, CliError> {
        let resp = self
            .client
            .get(format!("{}{path}", self.base_url))
            .query(params)
            .send()
            .map_err(|e| conn_error(&self.base_url, e))?;
        self.handle_response(resp)
    }

    fn post(&self, path: &str, body: Option<&Value>) -> Result<Value, CliError> {
        let mut req = self.client.post(format!("{}{path}", self.base_url));
        if let Some(b) = body {
            req = req.json(b);
        }
        let resp = req.send().map_err(|e| conn_error(&self.base_url, e))?;
        self.handle_response(resp)
    }

    #[allow(dead_code)]
    fn put(&self, path: &str, body: &Value) -> Result<Value, CliError> {
        let resp = self
            .client
            .put(format!("{}{path}", self.base_url))
            .json(body)
            .send()
            .map_err(|e| conn_error(&self.base_url, e))?;
        self.handle_response(resp)
    }

    fn delete(&self, path: &str) -> Result<Value, CliError> {
        let resp = self
            .client
            .delete(format!("{}{path}", self.base_url))
            .send()
            .map_err(|e| conn_error(&self.base_url, e))?;
        self.handle_response(resp)
    }

    fn get_bytes(&self, path: &str) -> Result<Vec<u8>, CliError> {
        let resp = self
            .client
            .get(format!("{}{path}", self.base_url))
            .send()
            .map_err(|e| conn_error(&self.base_url, e))?;
        let status = resp.status();
        if status.is_client_error() || status.is_server_error() {
            return Err(CliError {
                message: format!("API error {status}"),
                code: 1,
            });
        }
        resp.bytes()
            .map(|b| b.to_vec())
            .map_err(|e| CliError {
                message: format!("Failed to read response: {e}"),
                code: 1,
            })
    }

    // -- Health --
    pub fn health(&self) -> Result<Value, CliError> {
        self.get("/health")
    }

    // -- Jobs --
    pub fn create_job(&self, request: &Value) -> Result<Value, CliError> {
        self.post("/jobs", Some(request))
    }

    pub fn list_jobs(&self, status: Option<&str>) -> Result<Value, CliError> {
        match status {
            Some(s) => self.get_with_params("/jobs", &[("status", s)]),
            None => self.get("/jobs"),
        }
    }

    pub fn get_job(&self, job_id: &str) -> Result<Value, CliError> {
        self.get(&format!("/jobs/{job_id}"))
    }

    pub fn cancel_job(&self, job_id: &str) -> Result<Value, CliError> {
        self.delete(&format!("/jobs/{job_id}"))
    }

    pub fn pause_job(&self, job_id: &str) -> Result<Value, CliError> {
        self.post(&format!("/jobs/{job_id}/pause"), None)
    }

    pub fn resume_job(&self, job_id: &str, feedback: Option<&str>) -> Result<Value, CliError> {
        let body = feedback.map(|f| serde_json::json!({"feedback": f}));
        self.post(&format!("/jobs/{job_id}/resume"), body.as_ref())
    }

    pub fn approve(
        &self,
        job_id: &str,
        action: &str,
        message: Option<&str>,
    ) -> Result<Value, CliError> {
        let mut body = serde_json::json!({"action": action});
        if let Some(m) = message {
            body["message"] = Value::String(m.to_string());
        }
        self.post(&format!("/jobs/{job_id}/approval"), Some(&body))
    }

    #[allow(dead_code)]
    pub fn update_settings(&self, job_id: &str, settings: &Value) -> Result<Value, CliError> {
        self.put(&format!("/jobs/{job_id}/settings"), settings)
    }

    #[allow(dead_code)]
    pub fn purge_job(&self, job_id: &str) -> Result<Value, CliError> {
        self.delete(&format!("/jobs/{job_id}/purge"))
    }

    // -- Data --
    pub fn get_logs(&self, job_id: &str) -> Result<Value, CliError> {
        self.get(&format!("/jobs/{job_id}/logs"))
    }

    pub fn get_output(&self, job_id: &str) -> Result<Value, CliError> {
        self.get(&format!("/jobs/{job_id}/output"))
    }

    pub fn download_artifact(&self, job_id: &str, dest: &str) -> Result<String, CliError> {
        let bytes = self.get_bytes(&format!("/jobs/{job_id}/artifact"))?;
        std::fs::write(dest, &bytes).map_err(|e| CliError {
            message: format!("Failed to write file: {e}"),
            code: 1,
        })?;
        Ok(dest.to_string())
    }

    // -- Upload --
    pub fn upload(&self, zip_path: &str) -> Result<Value, CliError> {
        let path = Path::new(zip_path);
        if !path.exists() {
            return Err(CliError {
                message: format!("File not found: {zip_path}"),
                code: 1,
            });
        }
        let file_bytes = std::fs::read(path).map_err(|e| CliError {
            message: format!("Failed to read file: {e}"),
            code: 1,
        })?;
        let file_name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let part = reqwest::blocking::multipart::Part::bytes(file_bytes)
            .file_name(file_name)
            .mime_str("application/zip")
            .unwrap();
        let form = reqwest::blocking::multipart::Form::new().part("file", part);
        let resp = self
            .client
            .post(format!("{}/upload", self.base_url))
            .multipart(form)
            .send()
            .map_err(|e| conn_error(&self.base_url, e))?;
        self.handle_response(resp)
    }

    // -- Clusters --
    pub fn list_clusters(&self, session_id: Option<&str>) -> Result<Value, CliError> {
        match session_id {
            Some(s) => self.get_with_params("/clusters", &[("session_id", s)]),
            None => self.get("/clusters"),
        }
    }

    pub fn claim_cluster(
        &self,
        session_id: &str,
        preferred: Option<&str>,
    ) -> Result<Value, CliError> {
        let mut body = serde_json::json!({"session_id": session_id});
        if let Some(p) = preferred {
            body["preferred_context"] = Value::String(p.to_string());
        }
        self.post("/clusters/claim", Some(&body))
    }

    pub fn release_cluster(&self, session_id: &str) -> Result<Value, CliError> {
        self.post(
            "/clusters/release",
            Some(&serde_json::json!({"session_id": session_id})),
        )
    }

    pub fn clean_cluster(
        &self,
        kube_context: &str,
        namespace: &str,
        project_name: &str,
    ) -> Result<Value, CliError> {
        self.post(
            "/clusters/clean",
            Some(&serde_json::json!({
                "kube_context": kube_context,
                "namespace": namespace,
                "project_name": project_name,
            })),
        )
    }

    // -- Config --
    pub fn set_api_key(&self, provider: &str, api_key: &str) -> Result<Value, CliError> {
        self.post(
            "/config/api-key",
            Some(&serde_json::json!({"provider": provider, "api_key": api_key})),
        )
    }

    pub fn get_api_key(&self) -> Result<Value, CliError> {
        self.get("/config/api-key")
    }

    pub fn get_providers_status(&self) -> Result<Value, CliError> {
        self.get("/providers/status")
    }
}

fn conn_error(base_url: &str, e: reqwest::Error) -> CliError {
    if e.is_connect() {
        CliError {
            message: format!(
                "Cannot connect to ChaosEater API at {base_url}. Is the backend running?"
            ),
            code: 3,
        }
    } else if e.is_timeout() {
        CliError {
            message: "Request timed out.".to_string(),
            code: 3,
        }
    } else {
        CliError {
            message: format!("Request failed: {e}"),
            code: 1,
        }
    }
}
