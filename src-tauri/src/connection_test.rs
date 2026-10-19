//! "Test connection" probe for the AI settings screen (batch 4, item 13).
//!
//! The settings UI asks the backend to verify that the configured provider,
//! model, base URL, and API key actually work, and — when they do not — to say
//! *which* part is wrong. This module resolves the same configuration the chat
//! path uses ([`crate::commands::resolve_chat_provider`] /
//! [`crate::commands::resolve_agent_provider`]), sends one minimal request, and
//! classifies the result into a [`TestOutcome`] the frontend renders.
//!
//! ## Why one request is enough, and why it is free
//!
//! Both providers are streaming-only — `stream: true` is hardcoded and there is
//! no plain completion path — but the HTTP status is checked *before* the SSE
//! loop (`providers/openai.rs`, `providers/anthropic.rs`). A transport failure,
//! a 401, a 404, or a 4xx body therefore surface as a classified [`ApiError`]
//! without a single token being generated. For the success case the probe
//! cancels its [`CancellationToken`] up front, so the SSE loop returns on its
//! first poll and the response body is never read — the probe observes only the
//! status line. Either way, no completion is consumed.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

use crate::commands::{ChatMessage, ChatProviderConfig};
use crate::providers::{self, ApiError, Provider};

/// Which configuration section to test. `chat` covers the `[chat]` provider;
/// `agent` resolves `[agent]` — which in the default `same_as_chat` mode is the
/// `[chat]` configuration itself, and in `custom` mode its own.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TestScope {
    Chat,
    Agent,
}

/// The result of a connection probe, as the settings UI receives it.
///
/// Serializes as an internally tagged object: `{"status":"success"}` or
/// `{"status":"failure","code":"…","message":"…"}`. The frontend maps `code`
/// to localized copy exactly as it does for a streamed error.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TestOutcome {
    /// The provider accepted the probe request: address, key, and model are all
    /// usable.
    Success,
    /// The probe failed. `code` is a stable [`ApiError`] code (the frontend
    /// localizes it); `message` is raw detail for logs and copy-paste.
    Failure { code: String, message: String },
}

/// Stable error code: the model or endpoint does not support a capability the
/// request needs (streaming, tools, vision, a parameter). Providers have no
/// dedicated HTTP status for this, so it is sniffed from a `bad_request` body
/// that would otherwise be indistinguishable from a malformed request.
///
/// NOTE: this constant would naturally live beside the other `CODE_*` constants
/// in `providers/mod.rs`; it lives here because that module is owned by another
/// batch-4 task and this file may not edit it.
pub const CODE_UNSUPPORTED_CAPABILITY: &str = "unsupported_capability";

/// The prompt sent by the probe. Its content is irrelevant — only the HTTP
/// status is observed — but a non-empty message keeps every provider's request
/// validation happy.
const PROBE_PROMPT: &str = "ping";

/// Placeholder screen dimensions for the Anthropic request. They only feed the
/// computer-use tool definition, which the probe never requests (`include_tools`
/// is `false`), so their value is inert.
const PROBE_SCREEN_WIDTH: u32 = 1920;
const PROBE_SCREEN_HEIGHT: u32 = 1080;

/// Tests the configured provider and classifies the outcome (item 13).
///
/// Resolves the requested scope's provider, model, base URL, and API key, then
/// probes it. Configuration errors (no key, no model, no base URL) are returned
/// as a classified [`TestOutcome::Failure`]; only an internal failure that has
/// no connection meaning (a poisoned database lock) is an `Err`.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub async fn test_connection(app: AppHandle, scope: TestScope) -> Result<TestOutcome, String> {
    let config = app.state::<parking_lot::RwLock<crate::config::AppConfig>>();
    let db = app.state::<crate::history::Database>();
    let client = app.state::<reqwest::Client>();

    let resolved = {
        let guard = config.read();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        match scope {
            TestScope::Chat => crate::commands::resolve_chat_provider(&guard, &conn),
            TestScope::Agent => crate::commands::resolve_agent_provider(&guard, &conn),
        }
    };

    match resolved {
        Ok(cfg) => Ok(probe_connection(&cfg, client.inner()).await),
        // A missing key / model / base URL is a configuration result, not an
        // internal error: report it through the same classified channel.
        Err(err) => Ok(failure(err)),
    }
}

/// Sends one minimal request to `cfg`'s provider and classifies the result.
///
/// The cancellation token is cancelled before the call, so the provider's SSE
/// loop returns immediately after the HTTP status has been checked and no
/// completion body is read (see the module docs).
pub async fn probe_connection(cfg: &ChatProviderConfig, client: &reqwest::Client) -> TestOutcome {
    let cancel = CancellationToken::new();
    cancel.cancel();

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: PROBE_PROMPT.to_string(),
        images: None,
    }];

    let result = match cfg.provider {
        Provider::Anthropic => {
            providers::anthropic::stream_anthropic_chat(
                &cfg.base_url,
                &cfg.model,
                &cfg.api_key,
                "",
                messages,
                false,
                false,
                PROBE_SCREEN_WIDTH,
                PROBE_SCREEN_HEIGHT,
                client,
                cancel,
                |_| {},
            )
            .await
        }
        Provider::OpenAi | Provider::OpenAiCompatible => {
            providers::openai::stream_openai_chat(
                &cfg.base_url,
                &cfg.model,
                &cfg.api_key,
                messages,
                false,
                false,
                client,
                cancel,
                |_| {},
            )
            .await
        }
    };

    match result {
        // The probe only reaches this arm when the provider returned a success
        // status (every failure — transport or HTTP — returns `Err` first).
        Ok(_) => TestOutcome::Success,
        Err(err) => failure(err),
    }
}

/// Wraps a classified [`ApiError`] as a [`TestOutcome::Failure`], first
/// upgrading a capability rejection to its own code.
fn failure(err: ApiError) -> TestOutcome {
    let err = refine_unsupported_capability(err);
    TestOutcome::Failure {
        code: err.code,
        message: err.message,
    }
}

/// Rewrites a `bad_request` whose body actually describes an unsupported
/// capability into [`CODE_UNSUPPORTED_CAPABILITY`]. Every other code is passed
/// through untouched.
fn refine_unsupported_capability(err: ApiError) -> ApiError {
    if err.code == providers::CODE_BAD_REQUEST && indicates_unsupported_capability(&err.message) {
        ApiError::new(CODE_UNSUPPORTED_CAPABILITY, err.message)
    } else {
        err
    }
}

/// Whether an error body describes the model or endpoint lacking a capability,
/// rather than a malformed request. Matched case-insensitively against the
/// provider detail (which already embeds the response-body snippet).
fn indicates_unsupported_capability(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    const MARKERS: &[&str] = &[
        "does not support",
        "doesn't support",
        "not supported",
        "unsupported",
        "only supported by",
    ];
    MARKERS.iter().any(|marker| lower.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{
        CODE_BAD_REQUEST, CODE_FORBIDDEN, CODE_MISSING_MODEL, CODE_MODEL_NOT_FOUND, CODE_NETWORK,
        CODE_RATE_LIMITED, CODE_SERVER_ERROR, CODE_UNAUTHORIZED, CODE_UNKNOWN,
    };

    fn cfg(provider: Provider, base_url: &str) -> ChatProviderConfig {
        ChatProviderConfig {
            provider,
            model: "test-model".to_string(),
            base_url: base_url.to_string(),
            api_key: "sk-test".to_string(),
        }
    }

    /// The failure code of an outcome, or `None` for success.
    fn code_of(outcome: &TestOutcome) -> Option<&str> {
        match outcome {
            TestOutcome::Failure { code, .. } => Some(code),
            TestOutcome::Success => None,
        }
    }

    /// Runs an OpenAI-path probe against a mock returning `status`/`body`.
    async fn probe_openai_http(status: usize, body: &str) -> TestOutcome {
        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("POST", "/chat/completions")
            .with_status(status)
            .with_body(body)
            .create_async()
            .await;
        probe_connection(
            &cfg(Provider::OpenAi, &server.url()),
            &reqwest::Client::new(),
        )
        .await
    }

    #[tokio::test]
    async fn success_when_provider_accepts_the_probe() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/chat/completions")
            .with_status(200)
            .with_body("data: [DONE]\n\n")
            .create_async()
            .await;
        let outcome = probe_connection(
            &cfg(Provider::OpenAi, &server.url()),
            &reqwest::Client::new(),
        )
        .await;
        // The request must actually reach the endpoint, and no body is read.
        mock.assert_async().await;
        assert_eq!(outcome, TestOutcome::Success);
    }

    #[tokio::test]
    async fn openai_compatible_uses_the_same_path() {
        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("POST", "/chat/completions")
            .with_status(200)
            .create_async()
            .await;
        let outcome = probe_connection(
            &cfg(Provider::OpenAiCompatible, &server.url()),
            &reqwest::Client::new(),
        )
        .await;
        assert_eq!(outcome, TestOutcome::Success);
    }

    #[tokio::test]
    async fn authentication_failure_maps_to_unauthorized() {
        let outcome = probe_openai_http(401, "invalid api key").await;
        assert_eq!(code_of(&outcome), Some(CODE_UNAUTHORIZED));
    }

    #[tokio::test]
    async fn permission_denied_maps_to_forbidden() {
        let outcome = probe_openai_http(403, "not allowed").await;
        assert_eq!(code_of(&outcome), Some(CODE_FORBIDDEN));
    }

    #[tokio::test]
    async fn unknown_model_maps_to_model_not_found() {
        let outcome = probe_openai_http(404, "model not found").await;
        assert_eq!(code_of(&outcome), Some(CODE_MODEL_NOT_FOUND));
    }

    #[tokio::test]
    async fn throttling_maps_to_rate_limited() {
        let outcome = probe_openai_http(429, "slow down").await;
        assert_eq!(code_of(&outcome), Some(CODE_RATE_LIMITED));
    }

    #[tokio::test]
    async fn provider_outage_maps_to_server_error() {
        let outcome = probe_openai_http(500, "boom").await;
        assert_eq!(code_of(&outcome), Some(CODE_SERVER_ERROR));
    }

    #[tokio::test]
    async fn malformed_request_stays_bad_request() {
        // A 400 that is *not* about a capability must not be reclassified.
        let outcome = probe_openai_http(400, "invalid request: malformed JSON payload").await;
        assert_eq!(code_of(&outcome), Some(CODE_BAD_REQUEST));
    }

    #[tokio::test]
    async fn capability_rejection_maps_to_unsupported_capability() {
        let outcome = probe_openai_http(400, "this model does not support image input").await;
        assert_eq!(code_of(&outcome), Some(CODE_UNSUPPORTED_CAPABILITY));
    }

    #[tokio::test]
    async fn unreachable_address_maps_to_network() {
        // An unsupported URL scheme fails at `send()` with no network access.
        let outcome = probe_connection(
            &cfg(Provider::OpenAi, "foo://unsupported-scheme"),
            &reqwest::Client::new(),
        )
        .await;
        assert_eq!(code_of(&outcome), Some(CODE_NETWORK));
    }

    #[tokio::test]
    async fn anthropic_authentication_failure_maps_to_unauthorized() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/messages")
            .with_status(401)
            .with_body("invalid x-api-key")
            .create_async()
            .await;
        let outcome = probe_connection(
            &cfg(Provider::Anthropic, &server.url()),
            &reqwest::Client::new(),
        )
        .await;
        mock.assert_async().await;
        assert_eq!(code_of(&outcome), Some(CODE_UNAUTHORIZED));
    }

    #[tokio::test]
    async fn anthropic_success_when_provider_accepts_the_probe() {
        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("POST", "/v1/messages")
            .with_status(200)
            .create_async()
            .await;
        let outcome = probe_connection(
            &cfg(Provider::Anthropic, &server.url()),
            &reqwest::Client::new(),
        )
        .await;
        assert_eq!(outcome, TestOutcome::Success);
    }

    // ─── Classification helpers ───────────────────────────────────────────────

    #[test]
    fn indicates_unsupported_capability_recognises_capability_phrasings() {
        for body in [
            "This model does not support image input.",
            "The model doesn't support tool use.",
            "stream is not supported for this model",
            "unsupported parameter: reasoning_effort",
            "image_url is only supported by certain models",
        ] {
            assert!(
                indicates_unsupported_capability(body),
                "should detect capability error: {body}"
            );
        }
    }

    #[test]
    fn indicates_unsupported_capability_ignores_generic_bad_requests() {
        for body in [
            "invalid request: malformed JSON payload",
            "missing required field: messages",
            "provider returned HTTP 400",
            "The API key is invalid",
        ] {
            assert!(
                !indicates_unsupported_capability(body),
                "must not misclassify: {body}"
            );
        }
    }

    #[test]
    fn refine_rewrites_only_capability_bad_requests() {
        // bad_request + capability phrasing → new code.
        let rewritten = refine_unsupported_capability(ApiError::new(
            CODE_BAD_REQUEST,
            "this model does not support tools",
        ));
        assert_eq!(rewritten.code, CODE_UNSUPPORTED_CAPABILITY);
        assert_eq!(rewritten.message, "this model does not support tools");

        // bad_request without capability phrasing → unchanged.
        let plain =
            refine_unsupported_capability(ApiError::new(CODE_BAD_REQUEST, "malformed JSON"));
        assert_eq!(plain.code, CODE_BAD_REQUEST);

        // A non-bad_request carrying the phrasing is left alone.
        let other = refine_unsupported_capability(ApiError::new(
            CODE_SERVER_ERROR,
            "upstream does not support this",
        ));
        assert_eq!(other.code, CODE_SERVER_ERROR);
    }

    #[test]
    fn failure_preserves_every_configuration_code() {
        for err in [
            ApiError::missing_api_key("api_key_openai"),
            ApiError::new(CODE_MISSING_MODEL, "no model"),
            ApiError::new(CODE_UNKNOWN, "unclassified"),
        ] {
            let expected = err.code.clone();
            match failure(err) {
                TestOutcome::Failure { code, .. } => assert_eq!(code, expected),
                TestOutcome::Success => panic!("a config error must not be a success"),
            }
        }
    }

    #[test]
    fn failure_of_a_capability_bad_request_uses_the_new_code() {
        match failure(ApiError::new(
            CODE_BAD_REQUEST,
            "this endpoint does not support streaming",
        )) {
            TestOutcome::Failure { code, .. } => assert_eq!(code, CODE_UNSUPPORTED_CAPABILITY),
            TestOutcome::Success => panic!("a bad request must not be a success"),
        }
    }

    // ─── Wire shapes ──────────────────────────────────────────────────────────

    #[test]
    fn test_scope_serializes_as_snake_case() {
        assert_eq!(serde_json::to_string(&TestScope::Chat).unwrap(), "\"chat\"");
        assert_eq!(
            serde_json::to_string(&TestScope::Agent).unwrap(),
            "\"agent\""
        );
        assert_eq!(
            serde_json::from_str::<TestScope>("\"agent\"").unwrap(),
            TestScope::Agent
        );
    }

    #[test]
    fn test_outcome_serializes_with_a_status_tag() {
        assert_eq!(
            serde_json::to_value(TestOutcome::Success).unwrap(),
            serde_json::json!({ "status": "success" })
        );
        let failure = TestOutcome::Failure {
            code: CODE_UNAUTHORIZED.to_string(),
            message: "bad key".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&failure).unwrap(),
            serde_json::json!({
                "status": "failure",
                "code": "unauthorized",
                "message": "bad key",
            })
        );
        assert_eq!(
            serde_json::from_value::<TestOutcome>(serde_json::json!({
                "status": "failure",
                "code": "unauthorized",
                "message": "bad key",
            }))
            .unwrap(),
            failure
        );
    }

    #[test]
    fn unsupported_capability_code_matches_contract() {
        assert_eq!(CODE_UNSUPPORTED_CAPABILITY, "unsupported_capability");
    }
}
