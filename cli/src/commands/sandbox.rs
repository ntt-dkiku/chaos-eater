use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use colored::Colorize;

/// Find the project root by looking for Makefile or docker/ directory,
/// walking up from the binary's location or current directory.
fn find_project_root() -> Result<PathBuf, String> {
    // Try CE_PROJECT_DIR env var first
    if let Ok(dir) = env::var("CE_PROJECT_DIR") {
        let p = PathBuf::from(dir);
        if p.join("Makefile").exists() {
            return Ok(p);
        }
    }

    // Walk up from current directory
    let mut dir = env::current_dir().map_err(|e| format!("Cannot get current dir: {e}"))?;
    for _ in 0..10 {
        if dir.join("Makefile").exists() && dir.join("docker").is_dir() {
            return Ok(dir);
        }
        if !dir.pop() {
            break;
        }
    }

    Err(
        "Cannot find ChaosEater project root (Makefile + docker/).\n\
         Run from the project directory or set CE_PROJECT_DIR."
            .to_string(),
    )
}

fn detect_gpu() -> bool {
    Command::new("nvidia-smi")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn detect_ollama_host() -> String {
    if cfg!(target_os = "linux") {
        "172.17.0.1".to_string()
    } else {
        "host.docker.internal".to_string()
    }
}

fn compose_sandbox_args(root: &Path, gpu: bool) -> Vec<String> {
    let mut args = vec![
        "compose".to_string(),
        "-f".to_string(),
        root.join("docker/docker-compose.sandbox.yaml")
            .to_string_lossy()
            .to_string(),
        "-f".to_string(),
        root.join("docker/docker-compose.ollama.yaml")
            .to_string_lossy()
            .to_string(),
    ];
    if gpu {
        let nvidia_file = root.join("docker/docker-compose.ollama.nvidia.yaml");
        if nvidia_file.exists() {
            args.push("-f".to_string());
            args.push(nvidia_file.to_string_lossy().to_string());
        }
    }
    args
}

fn run_cmd(cmd: &str, args: &[String], env_vars: &[(&str, &str)]) -> Result<(), String> {
    let mut command = Command::new(cmd);
    command.args(args);
    for (k, v) in env_vars {
        command.env(k, v);
    }
    let status = command
        .status()
        .map_err(|e| format!("Failed to run {cmd}: {e}"))?;
    if !status.success() {
        return Err(format!("{cmd} exited with {status}"));
    }
    Ok(())
}

pub fn setup(format: &str, mode: &str) {
    let root = match find_project_root() {
        Ok(r) => r,
        Err(e) => {
            crate::output::output_error(&e, format, 1);
        }
    };

    if mode == "standard" {
        setup_standard(&root, format);
    } else {
        setup_sandbox(&root, format);
    }
}

fn setup_sandbox(root: &Path, format: &str) {
    // Write mode file
    let _ = std::fs::write(root.join(".chaoseater-mode"), "sandbox");

    let gpu = detect_gpu();
    let ollama_host = detect_ollama_host();
    let ollama_base = format!("http://{ollama_host}:11434");

    if format != "json" {
        eprintln!("{}", "Starting sandbox containers...".cyan());
    }

    // Step 1: docker compose up -d
    let mut args = compose_sandbox_args(root, gpu);
    args.extend(["up".to_string(), "-d".to_string()]);

    if let Err(e) = run_cmd("docker", &args, &[("OLLAMA_BASE", &ollama_base)]) {
        crate::output::output_error(&e, format, 1);
    }

    if format != "json" {
        eprintln!("{}", "Waiting for container to be ready...".dimmed());
    }
    std::thread::sleep(std::time::Duration::from_secs(3));

    // Step 2: create kind cluster inside sandbox
    if format != "json" {
        eprintln!("{}", "Creating kind cluster...".cyan());
    }

    let mut cluster_args = compose_sandbox_args(root, gpu);
    cluster_args.extend([
        "exec".to_string(),
        "chaos-eater".to_string(),
        "bash".to_string(),
        "-c".to_string(),
        "/app/create_kind_cluster.sh".to_string(),
    ]);

    if let Err(e) = run_cmd("docker", &cluster_args, &[("OLLAMA_BASE", &ollama_base)]) {
        crate::output::output_error(&e, format, 1);
    }

    if format == "json" {
        println!("{}", serde_json::json!({"status": "ready", "mode": "sandbox"}));
    } else {
        eprintln!("{}", "Sandbox is ready.".green());
    }
}

fn setup_standard(root: &Path, format: &str) {
    let _ = std::fs::write(root.join(".chaoseater-mode"), "standard");

    if format != "json" {
        eprintln!("{}", "Setting up standard environment...".cyan());
    }

    // Step 1: create environment
    let script = root.join("create_environment.sh");
    if let Err(e) = run_cmd(script.to_string_lossy().as_ref(), &[], &[]) {
        crate::output::output_error(&e, format, 1);
    }

    // Step 2: create kind cluster
    if format != "json" {
        eprintln!("{}", "Creating kind cluster...".cyan());
    }
    let script = root.join("create_kind_cluster.sh");
    if let Err(e) = run_cmd(
        script.to_string_lossy().as_ref(),
        &["--ollama".to_string()],
        &[],
    ) {
        crate::output::output_error(&e, format, 1);
    }

    if format == "json" {
        println!("{}", serde_json::json!({"status": "ready", "mode": "standard"}));
    } else {
        eprintln!("{}", "Standard environment is ready.".green());
    }
}

pub fn stop(format: &str) {
    let root = match find_project_root() {
        Ok(r) => r,
        Err(e) => crate::output::output_error(&e, format, 1),
    };

    let mode = std::fs::read_to_string(root.join(".chaoseater-mode"))
        .unwrap_or_else(|_| "sandbox".to_string());
    let mode = mode.trim();

    if format != "json" {
        eprintln!("{}", format!("Stopping ({mode} mode)...").cyan());
    }

    let gpu = detect_gpu();
    let ollama_base = format!("http://{}:11434", detect_ollama_host());

    if mode == "sandbox" {
        let mut args = compose_sandbox_args(&root, gpu);
        args.push("down".to_string());
        if let Err(e) = run_cmd("docker", &args, &[("OLLAMA_BASE", &ollama_base)]) {
            crate::output::output_error(&e, format, 1);
        }
    } else {
        let args = vec![
            "compose".to_string(),
            "-f".to_string(),
            root.join("docker/docker-compose.yaml")
                .to_string_lossy()
                .to_string(),
            "down".to_string(),
        ];
        if let Err(e) = run_cmd("docker", &args, &[]) {
            crate::output::output_error(&e, format, 1);
        }
        // Also delete kind cluster
        let _ = run_cmd("kind", &["delete".to_string(), "cluster".to_string(), "--name".to_string(), "chaos-eater-cluster".to_string()], &[]);
    }

    if format == "json" {
        println!("{}", serde_json::json!({"status": "stopped"}));
    } else {
        eprintln!("{}", "Stopped.".green());
    }
}

pub fn reload(format: &str) {
    let root = match find_project_root() {
        Ok(r) => r,
        Err(e) => crate::output::output_error(&e, format, 1),
    };

    let mode = std::fs::read_to_string(root.join(".chaoseater-mode"))
        .unwrap_or_else(|_| "sandbox".to_string());
    let mode = mode.trim();

    if format != "json" {
        eprintln!("{}", format!("Reloading services ({mode} mode)...").cyan());
    }

    let gpu = detect_gpu();
    let ollama_base = format!("http://{}:11434", detect_ollama_host());

    if mode == "sandbox" {
        let mut args = compose_sandbox_args(&root, gpu);
        args.extend([
            "exec".to_string(),
            "chaos-eater".to_string(),
            "bash".to_string(),
            "-c".to_string(),
            "docker compose -f docker/docker-compose.yaml up --build".to_string(),
        ]);
        if let Err(e) = run_cmd("docker", &args, &[("OLLAMA_BASE", &ollama_base)]) {
            crate::output::output_error(&e, format, 1);
        }
    } else {
        let args = vec![
            "compose".to_string(),
            "-f".to_string(),
            root.join("docker/docker-compose.yaml")
                .to_string_lossy()
                .to_string(),
            "up".to_string(),
            "--build".to_string(),
        ];
        if let Err(e) = run_cmd("docker", &args, &[]) {
            crate::output::output_error(&e, format, 1);
        }
    }

    if format == "json" {
        println!("{}", serde_json::json!({"status": "reloaded"}));
    } else {
        eprintln!("{}", "Reloaded.".green());
    }
}
