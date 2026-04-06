//! Integration tests for the chaos-eater CLI binary.
//!
//! These tests spin up a mock HTTP server and invoke the actual binary,
//! verifying exit codes and stdout/stderr output.

use assert_cmd::Command;
use mockito::Server;
use predicates::prelude::*;

fn cli() -> Command {
    Command::cargo_bin("chaos-eater").unwrap()
}

// ------------------------------------------------------------------
// Health
// ------------------------------------------------------------------
#[test]
fn test_health_human() {
    let mut server = Server::new();
    server
        .mock("GET", "/health")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"status":"healthy","timestamp":"2025-01-01T00:00:00"}"#)
        .create();

    cli()
        .args(["--api-url", &server.url(), "health"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Healthy"));
}

#[test]
fn test_health_json() {
    let mut server = Server::new();
    server
        .mock("GET", "/health")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"status":"healthy","timestamp":"2025-01-01T00:00:00"}"#)
        .create();

    let output = cli()
        .args(["--api-url", &server.url(), "--format", "json", "health"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(json["status"], "healthy");
}

#[test]
fn test_health_connection_refused() {
    cli()
        .args(["--api-url", "http://127.0.0.1:1", "--timeout", "1", "health"])
        .assert()
        .failure();
}

// ------------------------------------------------------------------
// Jobs list
// ------------------------------------------------------------------
#[test]
fn test_jobs_empty() {
    let mut server = Server::new();
    server
        .mock("GET", "/jobs")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body("[]")
        .create();

    cli()
        .args(["--api-url", &server.url(), "jobs"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No jobs"));
}

#[test]
fn test_jobs_json() {
    let mut server = Server::new();
    server
        .mock("GET", "/jobs")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"[{"job_id":"abc","status":"running","created_at":"2025-01-01T00:00:00"}]"#)
        .create();

    let output = cli()
        .args(["--api-url", &server.url(), "--format", "json", "jobs"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(json[0]["job_id"], "abc");
}

#[test]
fn test_jobs_with_status_filter() {
    let mut server = Server::new();
    server
        .mock("GET", "/jobs")
        .match_query(mockito::Matcher::UrlEncoded(
            "status".into(),
            "completed".into(),
        ))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body("[]")
        .create();

    cli()
        .args(["--api-url", &server.url(), "jobs", "--status", "completed"])
        .assert()
        .success();
}

// ------------------------------------------------------------------
// Job status
// ------------------------------------------------------------------
#[test]
fn test_status_human() {
    let mut server = Server::new();
    server
        .mock("GET", "/jobs/j-1")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"job_id":"j-1","status":"running","current_phase":"experiment"}"#)
        .create();

    cli()
        .args(["--api-url", &server.url(), "status", "j-1"])
        .assert()
        .success()
        .stdout(predicate::str::contains("j-1"));
}

#[test]
fn test_status_json() {
    let mut server = Server::new();
    server
        .mock("GET", "/jobs/j-1")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"job_id":"j-1","status":"completed"}"#)
        .create();

    let output = cli()
        .args(["--api-url", &server.url(), "--format", "json", "status", "j-1"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(json["status"], "completed");
}

// ------------------------------------------------------------------
// Run
// ------------------------------------------------------------------
#[test]
fn test_run_creates_job() {
    let mut server = Server::new();
    server
        .mock("POST", "/jobs")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"job_id":"new-job","status":"pending","message":"created","work_dir":"sandbox/cycle_1"}"#)
        .create();

    cli()
        .args([
            "--api-url", &server.url(),
            "run",
            "--project-path", "/tmp/test",
            "--kube-context", "kind-ce",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("new-job"));
}

#[test]
fn test_run_json() {
    let mut server = Server::new();
    server
        .mock("POST", "/jobs")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"job_id":"j-2","status":"pending","message":"created"}"#)
        .create();

    let output = cli()
        .args([
            "--api-url", &server.url(),
            "--format", "json",
            "run",
            "--project-path", "/tmp/p",
            "--kube-context", "ctx",
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(json["job_id"], "j-2");
}

#[test]
fn test_run_missing_kube_context() {
    cli()
        .args(["run", "--project-path", "/tmp/test"])
        .assert()
        .failure();
}

// ------------------------------------------------------------------
// Cancel / Pause / Resume
// ------------------------------------------------------------------
#[test]
fn test_cancel() {
    let mut server = Server::new();
    server
        .mock("DELETE", "/jobs/j-1")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"job_id":"j-1","status":"cancelled","message":"Cancelled"}"#)
        .create();

    cli()
        .args(["--api-url", &server.url(), "cancel", "j-1"])
        .assert()
        .success()
        .stdout(predicate::str::contains("cancelled"));
}

#[test]
fn test_pause() {
    let mut server = Server::new();
    server
        .mock("POST", "/jobs/j-1/pause")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"job_id":"j-1","status":"paused","message":"Paused"}"#)
        .create();

    cli()
        .args(["--api-url", &server.url(), "pause", "j-1"])
        .assert()
        .success()
        .stdout(predicate::str::contains("paused"));
}

#[test]
fn test_resume() {
    let mut server = Server::new();
    server
        .mock("POST", "/jobs/j-1/resume")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"job_id":"j-1","status":"running","message":"Resumed"}"#)
        .create();

    cli()
        .args(["--api-url", &server.url(), "resume", "j-1"])
        .assert()
        .success()
        .stdout(predicate::str::contains("running"));
}

#[test]
fn test_resume_with_feedback() {
    let mut server = Server::new();
    server
        .mock("POST", "/jobs/j-1/resume")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"status":"running","message":"Resumed"}"#)
        .create();

    cli()
        .args([
            "--api-url", &server.url(),
            "resume", "j-1",
            "--feedback", "try again",
        ])
        .assert()
        .success();
}

// ------------------------------------------------------------------
// Approve
// ------------------------------------------------------------------
#[test]
fn test_approve() {
    let mut server = Server::new();
    server
        .mock("POST", "/jobs/j-1/approval")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"status":"running","message":"Approved"}"#)
        .create();

    cli()
        .args([
            "--api-url", &server.url(),
            "approve", "j-1",
            "--action", "approve",
        ])
        .assert()
        .success();
}

#[test]
fn test_approve_retry_with_message() {
    let mut server = Server::new();
    server
        .mock("POST", "/jobs/j-1/approval")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"status":"running","message":"Retrying"}"#)
        .create();

    cli()
        .args([
            "--api-url", &server.url(),
            "approve", "j-1",
            "-a", "retry",
            "-m", "fix the plan",
        ])
        .assert()
        .success();
}

// ------------------------------------------------------------------
// Data commands
// ------------------------------------------------------------------
#[test]
fn test_logs_json() {
    let mut server = Server::new();
    server
        .mock("GET", "/jobs/j-1/logs")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"logs":"some data"}"#)
        .create();

    let output = cli()
        .args(["--api-url", &server.url(), "--format", "json", "logs", "j-1"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(json["logs"], "some data");
}

#[test]
fn test_output_json() {
    let mut server = Server::new();
    server
        .mock("GET", "/jobs/j-1/output")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"summary":"test passed"}"#)
        .create();

    let output = cli()
        .args(["--api-url", &server.url(), "--format", "json", "output", "j-1"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(json["summary"], "test passed");
}

#[test]
fn test_artifact_download() {
    let mut server = Server::new();
    server
        .mock("GET", "/jobs/j-1/artifact")
        .with_status(200)
        .with_body(b"PK\x03\x04fake")
        .create();

    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("out.zip");

    cli()
        .args([
            "--api-url", &server.url(),
            "artifact", "j-1",
            "-o", dest.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Downloaded"));

    assert!(dest.exists());
}

// ------------------------------------------------------------------
// Upload
// ------------------------------------------------------------------
#[test]
fn test_upload_nonexistent() {
    cli()
        .args(["upload", "/nonexistent/file.zip"])
        .assert()
        .failure();
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

    let dir = tempfile::tempdir().unwrap();
    let zip = dir.path().join("test.zip");
    std::fs::write(&zip, b"PK\x03\x04fake").unwrap();

    cli()
        .args(["--api-url", &server.url(), "upload", zip.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("Uploaded"));
}

// ------------------------------------------------------------------
// Clusters
// ------------------------------------------------------------------
#[test]
fn test_clusters_list() {
    let mut server = Server::new();
    server
        .mock("GET", "/clusters")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"[{"context":"kind-ce"}]"#)
        .create();

    cli()
        .args(["--api-url", &server.url(), "clusters"])
        .assert()
        .success()
        .stdout(predicate::str::contains("kind-ce"));
}

#[test]
fn test_claim() {
    let mut server = Server::new();
    server
        .mock("POST", "/clusters/claim")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"context":"kind-ce","session_id":"s1"}"#)
        .create();

    cli()
        .args(["--api-url", &server.url(), "--format", "json", "claim", "s1"])
        .assert()
        .success();
}

#[test]
fn test_release() {
    let mut server = Server::new();
    server
        .mock("POST", "/clusters/release")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"released":true}"#)
        .create();

    cli()
        .args(["--api-url", &server.url(), "--format", "json", "release", "s1"])
        .assert()
        .success();
}

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------
#[test]
fn test_config_set_key() {
    let mut server = Server::new();
    server
        .mock("POST", "/config/api-key")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"status":"ok"}"#)
        .create();

    cli()
        .args([
            "--api-url", &server.url(),
            "config", "set-key", "openai", "sk-test",
        ])
        .assert()
        .success();
}

#[test]
fn test_config_get_key() {
    let mut server = Server::new();
    server
        .mock("GET", "/config/api-key")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"provider":"openai","masked":"sk-...test"}"#)
        .create();

    cli()
        .args(["--api-url", &server.url(), "--format", "json", "config", "get-key"])
        .assert()
        .success();
}

#[test]
fn test_config_providers() {
    let mut server = Server::new();
    server
        .mock("GET", "/providers/status")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"openai":true,"anthropic":false}"#)
        .create();

    cli()
        .args(["--api-url", &server.url(), "config", "providers"])
        .assert()
        .success()
        .stdout(predicate::str::contains("openai"));
}

// ------------------------------------------------------------------
// CLI arg validation
// ------------------------------------------------------------------
#[test]
fn test_no_subcommand() {
    cli().assert().failure();
}

#[test]
fn test_invalid_format() {
    cli()
        .args(["--format", "xml", "health"])
        .assert()
        .failure();
}

#[test]
fn test_version() {
    cli()
        .args(["--version"])
        .assert()
        .success()
        .stdout(predicate::str::contains("chaos-eater"));
}

#[test]
fn test_help() {
    cli()
        .args(["--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Kubernetes Chaos Engineering"));
}
