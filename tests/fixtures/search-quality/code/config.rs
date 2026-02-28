use std::env;

pub const DEFAULT_TIMEOUT_MS: u64 = 5000;
pub static DEFAULT_LOG_LEVEL: &str = "info";

pub enum ConfigError {
    MissingVar(String),
    InvalidValue(String),
}

pub struct Config {
    pub api_key: String,
    pub base_url: String,
    pub timeout_ms: u64,
    pub log_level: String,
    pub debug: bool,
}

impl Config {
    pub fn from_env() -> Result<Config, ConfigError> {
        let api_key = env::var("API_KEY")
            .map_err(|_| ConfigError::MissingVar("API_KEY".to_string()))?;
        let base_url = env::var("BASE_URL")
            .unwrap_or_else(|_| "https://api.example.com".to_string());
        let timeout_ms = env::var("TIMEOUT_MS")
            .unwrap_or_else(|_| DEFAULT_TIMEOUT_MS.to_string())
            .parse::<u64>()
            .map_err(|e| ConfigError::InvalidValue(format!("TIMEOUT_MS: {}", e)))?;
        Ok(Config {
            api_key,
            base_url,
            timeout_ms,
            log_level: env::var("LOG_LEVEL").unwrap_or_else(|_| DEFAULT_LOG_LEVEL.to_string()),
            debug: env::var("DEBUG").unwrap_or_default() == "true",
        })
    }

    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.api_key.is_empty() {
            return Err(ConfigError::InvalidValue("API_KEY cannot be empty".to_string()));
        }
        if self.timeout_ms == 0 {
            return Err(ConfigError::InvalidValue("TIMEOUT_MS must be > 0".to_string()));
        }
        Ok(())
    }

    fn parse_log_level(level: &str) -> &str {
        match level {
            "debug" | "info" | "warn" | "error" => level,
            _ => DEFAULT_LOG_LEVEL,
        }
    }
}
