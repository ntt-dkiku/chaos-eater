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

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    fn mock_client(server: &Server) -> ChaosEaterClient {
        ChaosEaterClient::new(&server.url(), 5.0).unwrap()
    }

    // -- Health --
    #[test]
    fn test_health() {
        let mut server = Server::new();
        let m = server
            .mock("GET", "/health")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"status":"healthy","timestamp":"2025-01-01T00:00:00"}"#)
            .create();
        let client = mock_client(&server);
        let result = client.health().unwrap();
        assert_eq!(result["status"], "healthy");
        m.assert();
    }

    #[test]
    fn test_health_server_error() {
        let mut server = Server::new();
        server
            .mock("GET", "/health")
            .with_status(500)
            .with_body(r#"{"detail":"Internal Server Error"}"#)
            .create();
        let client = mock_client(&server);
        let err = client.health().unwrap_err();
        assert!(err.message.contains("500"));
        assert_eq!(err.code, 1);
    }

    #[test]
    fn test_connection_error() {
        // Connect to a port that nothing listens on
        let client = ChaosEaterClient::new("http://127.0.0.1:1", 1.0).unwrap();
        let err = client.health().unwrap_err();
        assert_eq!(err.code, 3);
        assert!(err.message.contains("Cannot connect") || err.message.contains("Request failed"));
    }

    // -- Jobs --
    #[test]
    fn test_create_job() {
        let mut server = Server::new();
        let m = server
            .mock("POST", "/jobs")
            .match_body(Matcher::PartialJsonString(
                r#"{"kube_context":"ctx"}"#.to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"job_id":"j-1","status":"pending","message":"created"}"#)
            .create();
        let client = mock_client(&server);
        let body = serde_json::json!({"kube_context": "ctx", "project_path": "/p"});
        let result = client.create_job(&body).unwrap();
        assert_eq!(result["job_id"], "j-1");
        m.assert();
    }

    #[test]
    fn test_list_jobs_empty() {
        let mut server = Server::new();
        server
            .mock("GET", "/jobs")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body("[]")
            .create();
        let client = mock_client(&server);
        let result = client.list_jobs(None).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 0);
    }

    #[test]
    fn test_list_jobs_with_status_filter() {
        let mut server = Server::new();
        server
            .mock("GET", "/jobs")
            .match_query(Matcher::UrlEncoded("status".into(), "running".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"[{"job_id":"j-1","status":"running"}]"#)
            .create();
        let client = mock_client(&server);
        let result = client.list_jobs(Some("running")).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_get_job() {
        let mut server = Server::new();
        server
            .mock("GET", "/jobs/j-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"job_id":"j-1","status":"running","current_phase":"hypothesis"}"#)
            .create();
        let client = mock_client(&server);
        let result = client.get_job("j-1").unwrap();
        assert_eq!(result["status"], "running");
    }

    #[test]
    fn test_get_job_not_found() {
        let mut server = Server::new();
        server
            .mock("GET", "/jobs/nonexistent")
            .with_status(404)
            .with_body(r#"{"detail":"Job not found"}"#)
            .create();
        let client = mock_client(&server);
        let err = client.get_job("nonexistent").unwrap_err();
        assert!(err.message.contains("404"));
    }

    #[test]
    fn test_cancel_job() {
        let mut server = Server::new();
        server
            .mock("DELETE", "/jobs/j-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"job_id":"j-1","status":"cancelled","message":"ok"}"#)
            .create();
        let client = mock_client(&server);
        let result = client.cancel_job("j-1").unwrap();
        assert_eq!(result["status"], "cancelled");
    }

    #[test]
    fn test_pause_job() {
        let mut server = Server::new();
        server
            .mock("POST", "/jobs/j-1/pause")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"status":"paused"}"#)
            .create();
        let client = mock_client(&server);
        let result = client.pause_job("j-1").unwrap();
        assert_eq!(result["status"], "paused");
    }

    #[test]
    fn test_resume_job_with_feedback() {
        let mut server = Server::new();
        server
            .mock("POST", "/jobs/j-1/resume")
            .match_body(Matcher::PartialJsonString(
                r#"{"feedback":"try again"}"#.to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"status":"running"}"#)
            .create();
        let client = mock_client(&server);
        let result = client.resume_job("j-1", Some("try again")).unwrap();
        assert_eq!(result["status"], "running");
    }

    #[test]
    fn test_resume_job_without_feedback() {
        let mut server = Server::new();
        server
            .mock("POST", "/jobs/j-1/resume")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"status":"running"}"#)
            .create();
        let client = mock_client(&server);
        let result = client.resume_job("j-1", None).unwrap();
        assert_eq!(result["status"], "running");
    }

    #[test]
    fn test_approve() {
        let mut server = Server::new();
        server
            .mock("POST", "/jobs/j-1/approval")
            .match_body(Matcher::PartialJsonString(
                r#"{"action":"approve","message":"looks good"}"#.to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"status":"ok"}"#)
            .create();
        let client = mock_client(&server);
        let result = client
            .approve("j-1", "approve", Some("looks good"))
            .unwrap();
        assert_eq!(result["status"], "ok");
    }

    #[test]
    fn test_approve_without_message() {
        let mut server = Server::new();
        server
            .mock("POST", "/jobs/j-1/approval")
            .match_body(Matcher::PartialJsonString(
                r#"{"action":"retry"}"#.to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"status":"ok"}"#)
            .create();
        let client = mock_client(&server);
        let result = client.approve("j-1", "retry", None).unwrap();
        assert_eq!(result["status"], "ok");
    }

    // -- Data --
    #[test]
    fn test_get_logs() {
        let mut server = Server::new();
        server
            .mock("GET", "/jobs/j-1/logs")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"logs":"some log data"}"#)
            .create();
        let client = mock_client(&server);
        let result = client.get_logs("j-1").unwrap();
        assert_eq!(result["logs"], "some log data");
    }

    #[test]
    fn test_get_output() {
        let mut server = Server::new();
        server
            .mock("GET", "/jobs/j-1/output")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"summary":"test passed"}"#)
            .create();
        let client = mock_client(&server);
        let result = client.get_output("j-1").unwrap();
        assert_eq!(result["summary"], "test passed");
    }

    #[test]
    fn test_download_artifact() {
        let mut server = Server::new();
        server
            .mock("GET", "/jobs/j-1/artifact")
            .with_status(200)
            .with_body(b"PK\x03\x04fake-zip-content")
            .create();
        let client = mock_client(&server);
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.zip");
        let path = client
            .download_artifact("j-1", dest.to_str().unwrap())
            .unwrap();
        assert!(std::path::Path::new(&path).exists());
        let content = std::fs::read(&path).unwrap();
        assert!(content.starts_with(b"PK\x03\x04"));
    }

    // -- Upload --
    #[test]
    fn test_upload_nonexistent() {
        let server = Server::new();
        let client = mock_client(&server);
        let err = client.upload("/nonexistent/file.zip").unwrap_err();
        assert!(err.message.contains("not found"));
    }

    #[test]
    fn test_upload() {
        let mut server = Server::new();
        server
            .mock("POST", "/upload")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"project_path":"/uploads/test"}"#)
            .create();
        let client = mock_client(&server);
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("test.zip");
        std::fs::write(&zip, b"PK\x03\x04fake").unwrap();
        let result = client.upload(zip.to_str().unwrap()).unwrap();
        assert_eq!(result["project_path"], "/uploads/test");
    }

    // -- Clusters --
    #[test]
    fn test_list_clusters() {
        let mut server = Server::new();
        server
            .mock("GET", "/clusters")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"[{"context":"kind-ce"}]"#)
            .create();
        let client = mock_client(&server);
        let result = client.list_clusters(None).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_claim_cluster() {
        let mut server = Server::new();
        server
            .mock("POST", "/clusters/claim")
            .match_body(Matcher::PartialJsonString(
                r#"{"session_id":"s1","preferred_context":"kind-ce"}"#.to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"context":"kind-ce"}"#)
            .create();
        let client = mock_client(&server);
        let result = client.claim_cluster("s1", Some("kind-ce")).unwrap();
        assert_eq!(result["context"], "kind-ce");
    }

    #[test]
    fn test_release_cluster() {
        let mut server = Server::new();
        server
            .mock("POST", "/clusters/release")
            .match_body(Matcher::PartialJsonString(
                r#"{"session_id":"s1"}"#.to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"released":true}"#)
            .create();
        let client = mock_client(&server);
        let result = client.release_cluster("s1").unwrap();
        assert_eq!(result["released"], true);
    }

    #[test]
    fn test_clean_cluster() {
        let mut server = Server::new();
        server
            .mock("POST", "/clusters/clean")
            .match_body(Matcher::PartialJsonString(
                r#"{"kube_context":"ctx","namespace":"ns","project_name":"proj"}"#.to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"cleaned":true}"#)
            .create();
        let client = mock_client(&server);
        let result = client.clean_cluster("ctx", "ns", "proj").unwrap();
        assert_eq!(result["cleaned"], true);
    }

    // -- Config --
    #[test]
    fn test_set_api_key() {
        let mut server = Server::new();
        server
            .mock("POST", "/config/api-key")
            .match_body(Matcher::PartialJsonString(
                r#"{"provider":"openai","api_key":"sk-test"}"#.to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"status":"ok"}"#)
            .create();
        let client = mock_client(&server);
        let result = client.set_api_key("openai", "sk-test").unwrap();
        assert_eq!(result["status"], "ok");
    }

    #[test]
    fn test_get_api_key() {
        let mut server = Server::new();
        server
            .mock("GET", "/config/api-key")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"provider":"openai","masked":"sk-...test"}"#)
            .create();
        let client = mock_client(&server);
        let result = client.get_api_key().unwrap();
        assert_eq!(result["provider"], "openai");
    }

    #[test]
    fn test_get_providers_status() {
        let mut server = Server::new();
        server
            .mock("GET", "/providers/status")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"openai":true,"anthropic":false}"#)
            .create();
        let client = mock_client(&server);
        let result = client.get_providers_status().unwrap();
        assert_eq!(result["openai"], true);
        assert_eq!(result["anthropic"], false);
    }

    // -- ws_url --
    #[test]
    fn test_ws_url() {
        let client = ChaosEaterClient::new("http://localhost:8000", 5.0).unwrap();
        assert_eq!(client.ws_url(), "ws://localhost:8000");

        let client = ChaosEaterClient::new("https://example.com:443/", 5.0).unwrap();
        assert_eq!(client.ws_url(), "wss://example.com:443");
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
