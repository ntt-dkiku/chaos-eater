mod client;
mod commands;
mod output;
mod stream;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "chaos-eater", version, about = "ChaosEater CLI - Automate Kubernetes Chaos Engineering from the terminal")]
struct Cli {
    /// ChaosEater API base URL
    #[arg(long, env = "CE_API_URL", default_value = "http://localhost:8000")]
    api_url: String,

    /// Output format
    #[arg(long, env = "CE_OUTPUT_FORMAT", default_value = "human", value_parser = ["human", "json"])]
    format: String,

    /// HTTP request timeout in seconds
    #[arg(long, env = "CE_TIMEOUT", default_value = "30.0")]
    timeout: f64,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Check if the ChaosEater API server is healthy
    Health,

    /// Create and start a new Chaos Engineering cycle job
    Run {
        /// Server-local path to project folder containing skaffold.yaml
        #[arg(long)]
        project_path: Option<String>,
        /// JSON string of ChaosEaterInput data
        #[arg(long)]
        input_data: Option<String>,
        /// Kubernetes context name
        #[arg(long)]
        kube_context: String,
        /// LLM model identifier
        #[arg(long, default_value = "openai/gpt-4o-2024-08-06")]
        model: String,
        /// LLM temperature
        #[arg(long, default_value = "0.0")]
        temperature: f64,
        /// Random seed
        #[arg(long, default_value = "42")]
        seed: i64,
        /// Project name
        #[arg(long, default_value = "chaos-eater")]
        project_name: String,
        /// Kubernetes namespace
        #[arg(long, default_value = "chaos-eater")]
        namespace: String,
        /// Max experiment retries
        #[arg(long, default_value = "3")]
        max_retries: i64,
        /// Max steady states
        #[arg(long, default_value = "2")]
        max_steadystates: i64,
        /// CE instructions to inject
        #[arg(long)]
        instructions: Option<String>,
        /// Execution mode
        #[arg(long, default_value = "full-auto", value_parser = ["full-auto", "interactive"])]
        mode: String,
        /// Comma-separated agent patterns requiring approval
        #[arg(long, default_value = "")]
        approval_agents: String,
        /// Skip cluster cleanup before run
        #[arg(long)]
        no_clean_before: bool,
        /// Skip cluster cleanup after run
        #[arg(long)]
        no_clean_after: bool,
        /// Stream events after job creation
        #[arg(short, long)]
        follow: bool,
    },

    /// List all jobs
    Jobs {
        /// Filter by job status
        #[arg(long)]
        status: Option<String>,
    },

    /// Get status of a specific job
    Status {
        /// Job ID
        job_id: String,
    },

    /// Cancel a running job
    Cancel {
        /// Job ID
        job_id: String,
    },

    /// Pause a running job
    Pause {
        /// Job ID
        job_id: String,
    },

    /// Resume a paused job
    Resume {
        /// Job ID
        job_id: String,
        /// Feedback message for retry context
        #[arg(long)]
        feedback: Option<String>,
    },

    /// Block until a job reaches a terminal state
    Wait {
        /// Job ID
        job_id: String,
        /// Seconds between status polls
        #[arg(long, default_value = "5.0")]
        poll_interval: f64,
        /// Max seconds to wait
        #[arg(long)]
        timeout: Option<f64>,
    },

    /// Stream real-time events from a running job
    Stream {
        /// Job ID
        job_id: String,
        /// Prompt for approval requests inline
        #[arg(short, long)]
        interactive: bool,
    },

    /// Respond to an interactive approval request
    Approve {
        /// Job ID
        job_id: String,
        /// Approval action
        #[arg(short, long, value_parser = ["approve", "retry", "cancel"])]
        action: String,
        /// Optional message
        #[arg(short, long)]
        message: Option<String>,
    },

    /// Get logs for a job
    Logs {
        /// Job ID
        job_id: String,
    },

    /// Get the final output of a completed job
    Output {
        /// Job ID
        job_id: String,
    },

    /// Download the artifact zip for a job
    Artifact {
        /// Job ID
        job_id: String,
        /// Destination file path
        #[arg(short = 'o', long)]
        dest: Option<String>,
    },

    /// Upload a project zip file to the server
    Upload {
        /// Path to zip file
        zip_path: String,
    },

    /// List available Kubernetes clusters
    Clusters {
        /// Session ID to filter by
        #[arg(long)]
        session_id: Option<String>,
    },

    /// Claim a cluster for a session
    Claim {
        /// Session ID
        session_id: String,
        /// Preferred kube context
        #[arg(long)]
        preferred: Option<String>,
    },

    /// Release a claimed cluster
    Release {
        /// Session ID
        session_id: String,
    },

    /// Clean up a cluster's resources
    Clean {
        /// Kubernetes context
        #[arg(long)]
        kube_context: String,
        /// Namespace
        #[arg(long, default_value = "chaos-eater")]
        namespace: String,
        /// Project name
        #[arg(long, default_value = "chaos-eater")]
        project_name: String,
    },

    /// Manage API keys and provider configuration
    Config {
        #[command(subcommand)]
        command: ConfigCommands,
    },

    /// Set up the ChaosEater environment (sandbox or standard)
    Setup {
        /// Mode: sandbox (Docker-in-Docker) or standard (host-based)
        #[arg(long, default_value = "sandbox", value_parser = ["sandbox", "standard"])]
        mode: String,
    },

    /// Stop the ChaosEater environment
    Stop,

    /// Rebuild and restart services
    Reload,
}

#[derive(Subcommand)]
enum ConfigCommands {
    /// Set an API key for a provider
    SetKey {
        /// Provider name (e.g. openai, anthropic, google)
        provider: String,
        /// API key
        api_key: String,
    },
    /// Get current API key information
    GetKey,
    /// Check which LLM providers are available
    Providers,
}

fn main() {
    let cli = Cli::parse();

    let client = match client::ChaosEaterClient::new(&cli.api_url, cli.timeout) {
        Ok(c) => c,
        Err(e) => output::output_error(&e.message, &cli.format, e.code),
    };

    match cli.command {
        Commands::Health => commands::health::run(&client, &cli.format),

        Commands::Run {
            project_path,
            input_data,
            kube_context,
            model,
            temperature,
            seed,
            project_name,
            namespace,
            max_retries,
            max_steadystates,
            instructions,
            mode,
            approval_agents,
            no_clean_before,
            no_clean_after,
            follow,
        } => commands::jobs::run_job(
            &client,
            &cli.format,
            project_path.as_deref(),
            input_data.as_deref(),
            &kube_context,
            &model,
            temperature,
            seed,
            &project_name,
            &namespace,
            max_retries,
            max_steadystates,
            instructions.as_deref(),
            &mode,
            &approval_agents,
            no_clean_before,
            no_clean_after,
            follow,
        ),

        Commands::Jobs { status } => commands::jobs::list(&client, &cli.format, status.as_deref()),

        Commands::Status { job_id } => commands::jobs::status(&client, &cli.format, &job_id),

        Commands::Cancel { job_id } => commands::jobs::cancel(&client, &cli.format, &job_id),

        Commands::Pause { job_id } => commands::jobs::pause(&client, &cli.format, &job_id),

        Commands::Resume { job_id, feedback } => {
            commands::jobs::resume(&client, &cli.format, &job_id, feedback.as_deref())
        }

        Commands::Wait {
            job_id,
            poll_interval,
            timeout,
        } => commands::jobs::wait(&client, &cli.format, &job_id, poll_interval, timeout),

        Commands::Stream {
            job_id,
            interactive,
        } => commands::stream_cmd::stream(&client, &cli.format, &job_id, interactive),

        Commands::Approve {
            job_id,
            action,
            message,
        } => commands::stream_cmd::approve(
            &client,
            &cli.format,
            &job_id,
            &action,
            message.as_deref(),
        ),

        Commands::Logs { job_id } => commands::data::logs(&client, &cli.format, &job_id),

        Commands::Output { job_id } => commands::data::output_cmd(&client, &cli.format, &job_id),

        Commands::Artifact { job_id, dest } => {
            commands::data::artifact(&client, &cli.format, &job_id, dest.as_deref())
        }

        Commands::Upload { zip_path } => {
            commands::upload::upload(&client, &cli.format, &zip_path)
        }

        Commands::Clusters { session_id } => {
            commands::clusters::list(&client, &cli.format, session_id.as_deref())
        }

        Commands::Claim {
            session_id,
            preferred,
        } => commands::clusters::claim(&client, &cli.format, &session_id, preferred.as_deref()),

        Commands::Release { session_id } => {
            commands::clusters::release(&client, &cli.format, &session_id)
        }

        Commands::Clean {
            kube_context,
            namespace,
            project_name,
        } => commands::clusters::clean(
            &client,
            &cli.format,
            &kube_context,
            &namespace,
            &project_name,
        ),

        Commands::Config { command } => match command {
            ConfigCommands::SetKey { provider, api_key } => {
                commands::config::set_key(&client, &cli.format, &provider, &api_key)
            }
            ConfigCommands::GetKey => commands::config::get_key(&client, &cli.format),
            ConfigCommands::Providers => commands::config::providers(&client, &cli.format),
        },

        // Environment management (no API client needed)
        Commands::Setup { mode } => commands::sandbox::setup(&cli.format, &mode),
        Commands::Stop => commands::sandbox::stop(&cli.format),
        Commands::Reload => commands::sandbox::reload(&cli.format),
    }
}
