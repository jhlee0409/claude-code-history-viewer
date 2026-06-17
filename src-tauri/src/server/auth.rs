//! `WebUI` authentication primitives.

use argon2::password_hash::SaltString;
use argon2::{Algorithm, Argon2, Params, PasswordHash, PasswordHasher, PasswordVerifier, Version};
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use axum::response::{AppendHeaders, IntoResponse, Response};
use base64::Engine;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const LEGACY_AUTH_COOKIE_NAME: &str = "cchv_auth";
pub const SESSION_COOKIE_NAME: &str = "cchv_session";
pub const CSRF_COOKIE_NAME: &str = "cchv_csrf";
const COOKIE_MAX_AGE_SECONDS: u64 = 60 * 60 * 24 * 7;
const SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(60 * 60 * 12);
const SESSION_ABSOLUTE_TIMEOUT: Duration = Duration::from_secs(60 * 60 * 24 * 7);
const LOGIN_WINDOW: Duration = Duration::from_secs(60 * 15);
const LOGIN_LOCKOUT: Duration = Duration::from_secs(60 * 10);
const MAX_LOGIN_FAILURES: u32 = 5;
/// Hard cap on concurrently tracked sessions; least-recently-seen are evicted
/// past this so a long-running server cannot accumulate sessions without bound.
const MAX_SESSIONS: usize = 256;
/// Fixed rate-limit buckets. There is exactly one valid account, so failed logins
/// are tracked under just these two keys — never under attacker-supplied usernames —
/// which bounds the attempts map and isolates unknown-user spam from the real account.
const ACCOUNT_BUCKET: &str = "account";
const UNKNOWN_BUCKET: &str = "_unknown";

#[derive(Clone)]
pub enum AuthState {
    Disabled,
    Token { token: String, secure_cookies: bool },
    Account(Arc<AccountAuth>),
}

#[derive(Clone)]
pub struct AccountAuth {
    username: String,
    password_hash: String,
    secure_cookies: bool,
    sessions: Arc<Mutex<HashMap<String, SessionRecord>>>,
    attempts: Arc<Mutex<HashMap<String, LoginAttempt>>>,
}

#[derive(Clone)]
struct SessionRecord {
    csrf_token: String,
    created_at: Instant,
    last_seen: Instant,
}

#[derive(Default)]
struct LoginAttempt {
    first_failure: Option<Instant>,
    failures: u32,
    locked_until: Option<Instant>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthLoginRequest {
    pub token: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug)]
pub enum LoginOutcome {
    Disabled,
    Token {
        token: String,
    },
    Account {
        session_id: String,
        csrf_token: String,
    },
}

pub enum AuthenticatedRequest {
    None,
    Token,
    Account { csrf_token: String },
}

impl AuthState {
    pub fn is_enabled(&self) -> bool {
        !matches!(self, Self::Disabled)
    }

    pub fn secure_cookies(&self) -> bool {
        match self {
            Self::Disabled => false,
            Self::Token { secure_cookies, .. } => *secure_cookies,
            Self::Account(account) => account.secure_cookies,
        }
    }

    pub fn login(&self, payload: &AuthLoginRequest) -> Result<LoginOutcome, AuthFailure> {
        match self {
            Self::Disabled => Ok(LoginOutcome::Disabled),
            Self::Token { token, .. } => {
                let Some(candidate) = payload.token.as_deref().map(str::trim) else {
                    return Err(AuthFailure::InvalidCredentials);
                };
                if constant_time_eq(candidate.as_bytes(), token.as_bytes()) {
                    Ok(LoginOutcome::Token {
                        token: candidate.to_string(),
                    })
                } else {
                    Err(AuthFailure::InvalidCredentials)
                }
            }
            Self::Account(account) => account.login(payload),
        }
    }

    pub fn authenticate<B>(&self, request: &Request<B>) -> AuthenticatedRequest {
        match self {
            Self::Disabled => AuthenticatedRequest::None,
            Self::Token { token, .. } => {
                if bearer_token_matches(request.headers(), token)
                    || cookie_token(request.headers(), LEGACY_AUTH_COOKIE_NAME).is_some_and(
                        |candidate| constant_time_eq(candidate.as_bytes(), token.as_bytes()),
                    )
                    || allow_query_token(request)
                        .and_then(|candidate| {
                            constant_time_eq(candidate.as_bytes(), token.as_bytes()).then_some(())
                        })
                        .is_some()
                {
                    AuthenticatedRequest::Token
                } else {
                    AuthenticatedRequest::None
                }
            }
            Self::Account(account) => account
                .authenticate_session(request.headers())
                .map(|csrf_token| AuthenticatedRequest::Account { csrf_token })
                .unwrap_or(AuthenticatedRequest::None),
        }
    }

    pub fn logout(&self, headers: &HeaderMap) {
        if let Self::Account(account) = self {
            if let Some(session_id) = cookie_token(headers, SESSION_COOKIE_NAME) {
                account.remove_session(&session_id);
            }
        }
    }
}

impl AccountAuth {
    pub fn new(username: String, password_hash: String, secure_cookies: bool) -> Self {
        Self {
            username,
            password_hash,
            secure_cookies,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            attempts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn login(&self, payload: &AuthLoginRequest) -> Result<LoginOutcome, AuthFailure> {
        let username = payload.username.as_deref().unwrap_or("").trim();
        let password = payload.password.as_deref().unwrap_or("");

        // Decide the rate-limit bucket from whether the username matched — never from
        // attacker-supplied text. With a single valid account this caps the attempts
        // map at two keys (real account vs shared "_unknown"), so a username-rotating
        // attacker cannot exhaust memory and unknown-user spam cannot lock out the real
        // account. `user_ok` is a constant-time compare and is computed unconditionally.
        let user_ok = constant_time_eq(username.as_bytes(), self.username.as_bytes());
        let attempt_key = if user_ok {
            ACCOUNT_BUCKET
        } else {
            UNKNOWN_BUCKET
        };

        self.check_rate_limit(attempt_key)?;

        // Always run Argon2 regardless of `user_ok` so total response time does not
        // depend on whether the username exists (no enumeration timing oracle).
        let password_ok = verify_argon2id_password(password, &self.password_hash);
        if !(user_ok && password_ok) {
            self.record_failure(attempt_key);
            return Err(AuthFailure::InvalidCredentials);
        }

        self.clear_attempts(attempt_key);
        let session_id = random_token();
        let csrf_token = random_token();
        let now = Instant::now();
        let record = SessionRecord {
            csrf_token: csrf_token.clone(),
            created_at: now,
            last_seen: now,
        };

        if let Ok(mut sessions) = self.sessions.lock() {
            // Drop expired sessions, then enforce the hard cap with least-recently-seen
            // eviction so the map stays bounded on a long-running server.
            sessions.retain(|_, r| {
                now.duration_since(r.created_at) <= SESSION_ABSOLUTE_TIMEOUT
                    && now.duration_since(r.last_seen) <= SESSION_IDLE_TIMEOUT
            });
            while sessions.len() >= MAX_SESSIONS {
                let Some(oldest) = sessions
                    .iter()
                    .min_by_key(|(_, r)| r.last_seen)
                    .map(|(k, _)| k.clone())
                else {
                    break;
                };
                sessions.remove(&oldest);
            }
            sessions.insert(session_id.clone(), record);
        }

        Ok(LoginOutcome::Account {
            session_id,
            csrf_token,
        })
    }

    fn authenticate_session(&self, headers: &HeaderMap) -> Option<String> {
        let session_id = cookie_token(headers, SESSION_COOKIE_NAME)?;
        let now = Instant::now();
        let mut sessions = self.sessions.lock().ok()?;
        let record = sessions.get_mut(&session_id)?;

        if now.duration_since(record.created_at) > SESSION_ABSOLUTE_TIMEOUT
            || now.duration_since(record.last_seen) > SESSION_IDLE_TIMEOUT
        {
            sessions.remove(&session_id);
            return None;
        }

        record.last_seen = now;
        Some(record.csrf_token.clone())
    }

    fn remove_session(&self, session_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(session_id);
        }
    }

    fn check_rate_limit(&self, key: &str) -> Result<(), AuthFailure> {
        let now = Instant::now();
        // Recover from a poisoned lock instead of failing: this runs on the critical
        // path of every login, so treating poison as a hard error would permanently
        // brick authentication for the operator after any panic-while-locked.
        let mut attempts = self
            .attempts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let attempt = attempts.entry(key.to_string()).or_default();

        if let Some(until) = attempt.locked_until {
            if until > now {
                return Err(AuthFailure::RateLimited);
            }
            attempt.locked_until = None;
            attempt.failures = 0;
            attempt.first_failure = None;
        }

        if let Some(first) = attempt.first_failure {
            if now.duration_since(first) > LOGIN_WINDOW {
                attempt.failures = 0;
                attempt.first_failure = None;
            }
        }

        Ok(())
    }

    fn record_failure(&self, key: &str) {
        let now = Instant::now();
        let mut attempts = self
            .attempts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let attempt = attempts.entry(key.to_string()).or_default();
        if attempt.first_failure.is_none() {
            attempt.first_failure = Some(now);
        }
        attempt.failures = attempt.failures.saturating_add(1);
        if attempt.failures >= MAX_LOGIN_FAILURES {
            attempt.locked_until = Some(now + LOGIN_LOCKOUT);
        }
    }

    fn clear_attempts(&self, key: &str) {
        if let Ok(mut attempts) = self.attempts.lock() {
            attempts.remove(key);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthFailure {
    InvalidCredentials,
    RateLimited,
    CsrfRequired,
}

pub fn csrf_valid<B>(request: &Request<B>, csrf_token: &str) -> bool {
    if request.method() == Method::GET || request.method() == Method::HEAD {
        return true;
    }

    request
        .headers()
        .get("x-csrf-token")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|candidate| constant_time_eq(candidate.as_bytes(), csrf_token.as_bytes()))
}

pub fn auth_error_response(failure: AuthFailure) -> Response {
    match failure {
        AuthFailure::InvalidCredentials => StatusCode::UNAUTHORIZED.into_response(),
        AuthFailure::RateLimited => (
            StatusCode::TOO_MANY_REQUESTS,
            axum::Json(serde_json::json!({
                "error": "Too many login attempts. Try again later."
            })),
        )
            .into_response(),
        AuthFailure::CsrfRequired => StatusCode::FORBIDDEN.into_response(),
    }
}

pub fn login_response(outcome: LoginOutcome, secure: bool) -> Response {
    match outcome {
        LoginOutcome::Disabled => clear_auth_cookies_response(secure),
        LoginOutcome::Token { token } => token_cookie_response(&token, secure),
        LoginOutcome::Account {
            session_id,
            csrf_token,
        } => session_cookie_response(&session_id, &csrf_token, secure),
    }
}

pub fn clear_auth_cookies_response(secure: bool) -> Response {
    let secure = secure_attribute(secure);
    (
        StatusCode::NO_CONTENT,
        AppendHeaders([
            (
                header::SET_COOKIE,
                header_value(&format!(
                    "{LEGACY_AUTH_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0{secure}"
                )),
            ),
            (
                header::SET_COOKIE,
                header_value(&format!(
                    "{SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0{secure}"
                )),
            ),
            (
                header::SET_COOKIE,
                header_value(&format!(
                    "{CSRF_COOKIE_NAME}=; SameSite=Strict; Path=/; Max-Age=0{secure}"
                )),
            ),
        ]),
    )
        .into_response()
}

fn token_cookie_response(token: &str, secure: bool) -> Response {
    let encoded = urlencoding::encode(token);
    let secure = secure_attribute(secure);
    (
        StatusCode::NO_CONTENT,
        [(
            header::SET_COOKIE,
            header_value(&format!(
                "{LEGACY_AUTH_COOKIE_NAME}={encoded}; HttpOnly; SameSite=Lax; Path=/; Max-Age={COOKIE_MAX_AGE_SECONDS}{secure}"
            )),
        )],
    )
        .into_response()
}

fn session_cookie_response(session_id: &str, csrf_token: &str, secure: bool) -> Response {
    let session_id = urlencoding::encode(session_id);
    let csrf_token = urlencoding::encode(csrf_token);
    let secure = secure_attribute(secure);
    (
        StatusCode::NO_CONTENT,
        AppendHeaders([
            (
                header::SET_COOKIE,
                header_value(&format!(
                    "{SESSION_COOKIE_NAME}={session_id}; HttpOnly; SameSite=Strict; Path=/; Max-Age={COOKIE_MAX_AGE_SECONDS}{secure}"
                )),
            ),
            (
                header::SET_COOKIE,
                header_value(&format!(
                    "{CSRF_COOKIE_NAME}={csrf_token}; SameSite=Strict; Path=/; Max-Age={COOKIE_MAX_AGE_SECONDS}{secure}"
                )),
            ),
        ]),
    )
        .into_response()
}

fn header_value(value: &str) -> axum::http::HeaderValue {
    axum::http::HeaderValue::from_str(value).unwrap_or_else(|_| {
        axum::http::HeaderValue::from_static(
            "cchv_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        )
    })
}

fn secure_attribute(secure: bool) -> &'static str {
    if secure {
        "; Secure"
    } else {
        ""
    }
}

fn bearer_token_matches(headers: &HeaderMap, expected: &str) -> bool {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|header| header.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .is_some_and(|candidate| constant_time_eq(candidate.as_bytes(), expected.as_bytes()))
}

fn cookie_token(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in cookie_header.split(';') {
        let trimmed = part.trim();
        if let Some(value) = trimmed.strip_prefix(&format!("{name}=")) {
            return Some(urlencoding::decode(value).ok()?.into_owned());
        }
    }
    None
}

fn allow_query_token<B>(request: &Request<B>) -> Option<String> {
    if request.method() != Method::GET {
        return None;
    }
    if !matches!(request.uri().path(), "/api/events" | "/events") {
        return None;
    }

    request.uri().query().and_then(|query| {
        query.split('&').find_map(|pair| {
            let token = pair.strip_prefix("token=")?;
            Some(urlencoding::decode(token).ok()?.into_owned())
        })
    })
}

fn verify_argon2id_password(password: &str, password_hash: &str) -> bool {
    let Ok(parsed_hash) = PasswordHash::new(password_hash) else {
        return false;
    };
    recommended_argon2id()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

pub fn password_hash_is_valid(password_hash: &str) -> bool {
    PasswordHash::new(password_hash)
        .map(|hash| hash.algorithm.as_str() == "argon2id")
        .unwrap_or(false)
}

pub fn hash_password_argon2id(password: &str) -> Result<String, String> {
    let salt_seed = uuid::Uuid::new_v4();
    let salt = SaltString::encode_b64(salt_seed.as_bytes())
        .map_err(|_| "failed to generate password salt".to_string())?;
    recommended_argon2id()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| "failed to hash password".to_string())
}

fn recommended_argon2id() -> Argon2<'static> {
    let params =
        Params::new(19 * 1024, 2, 1, None).expect("static Argon2id parameters should be valid");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

fn random_token() -> String {
    let raw = format!(
        "{}{}",
        uuid::Uuid::new_v4().as_simple(),
        uuid::Uuid::new_v4().as_simple()
    );
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw.as_bytes())
}

/// Constant-time byte comparison to prevent timing side-channel attacks on token validation.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;

    fn test_hash() -> String {
        hash_password_argon2id("correct horse battery staple").unwrap()
    }

    #[test]
    fn account_login_creates_session_and_csrf() {
        let auth = AccountAuth::new("admin".to_string(), test_hash(), true);
        let payload = AuthLoginRequest {
            token: None,
            username: Some("admin".to_string()),
            password: Some("correct horse battery staple".to_string()),
        };

        let outcome = auth.login(&payload).unwrap();
        let LoginOutcome::Account {
            session_id,
            csrf_token,
        } = outcome
        else {
            panic!("expected account login");
        };

        assert!(session_id.len() > 40);
        assert!(csrf_token.len() > 40);
    }

    #[test]
    fn account_login_rejects_wrong_password() {
        let auth = AccountAuth::new("admin".to_string(), test_hash(), true);
        let payload = AuthLoginRequest {
            token: None,
            username: Some("admin".to_string()),
            password: Some("wrong".to_string()),
        };

        assert_eq!(
            auth.login(&payload).unwrap_err(),
            AuthFailure::InvalidCredentials
        );
    }

    #[test]
    fn csrf_header_must_match_session_token() {
        let request = Request::builder()
            .method(Method::POST)
            .uri("/api/save_settings")
            .header("x-csrf-token", "abc")
            .body(Body::empty())
            .unwrap();

        assert!(csrf_valid(&request, "abc"));
        assert!(!csrf_valid(&request, "def"));
    }

    fn bad_login(username: &str) -> AuthLoginRequest {
        AuthLoginRequest {
            token: None,
            username: Some(username.to_string()),
            password: Some("definitely-wrong".to_string()),
        }
    }

    #[test]
    fn unknown_usernames_collapse_to_one_bucket() {
        // A username-rotating attacker must not be able to grow the attempts map:
        // every unknown username shares the "_unknown" bucket, so the map stays tiny.
        let auth = AccountAuth::new("admin".to_string(), test_hash(), false);
        for i in 0..40 {
            let _ = auth.login(&bad_login(&format!("intruder{i}")));
        }
        let attempts = auth.attempts.lock().unwrap();
        assert!(
            attempts.len() <= 2,
            "unknown usernames must share one bucket, got {} keys",
            attempts.len()
        );
        assert!(attempts.contains_key(UNKNOWN_BUCKET));
    }

    #[test]
    fn unknown_username_spam_does_not_lock_real_account() {
        // Spamming unknown usernames locks only the "_unknown" bucket; the real
        // account lives in a separate bucket and must remain able to authenticate.
        let auth = AccountAuth::new("admin".to_string(), test_hash(), false);
        for _ in 0..(MAX_LOGIN_FAILURES + 2) {
            let _ = auth.login(&bad_login("intruder"));
        }
        let good = AuthLoginRequest {
            token: None,
            username: Some("admin".to_string()),
            password: Some("correct horse battery staple".to_string()),
        };
        assert!(
            auth.login(&good).is_ok(),
            "unknown-user lockout must not affect the real account"
        );
    }

    #[test]
    fn login_evicts_oldest_session_when_at_capacity() {
        let auth = AccountAuth::new("admin".to_string(), test_hash(), false);
        {
            let mut sessions = auth.sessions.lock().unwrap();
            let now = Instant::now();
            for i in 0..MAX_SESSIONS {
                sessions.insert(
                    format!("pre-{i}"),
                    SessionRecord {
                        csrf_token: "x".to_string(),
                        created_at: now,
                        last_seen: now,
                    },
                );
            }
        }
        let good = AuthLoginRequest {
            token: None,
            username: Some("admin".to_string()),
            password: Some("correct horse battery staple".to_string()),
        };
        auth.login(&good).unwrap();
        let sessions = auth.sessions.lock().unwrap();
        assert!(
            sessions.len() <= MAX_SESSIONS,
            "sessions map must stay bounded, got {}",
            sessions.len()
        );
    }

    #[test]
    fn account_locks_out_after_max_failures() {
        let auth = AccountAuth::new("admin".to_string(), test_hash(), false);
        let wrong = AuthLoginRequest {
            token: None,
            username: Some("admin".to_string()),
            password: Some("wrong".to_string()),
        };
        for _ in 0..MAX_LOGIN_FAILURES {
            assert_eq!(
                auth.login(&wrong).unwrap_err(),
                AuthFailure::InvalidCredentials
            );
        }
        // Once the threshold is hit the account bucket is locked, so even the correct
        // password is rate-limited — the accepted residual (a correct-username flood
        // can lock out the operator; per-IP limiting is deliberately out of scope here).
        let good = AuthLoginRequest {
            token: None,
            username: Some("admin".to_string()),
            password: Some("correct horse battery staple".to_string()),
        };
        assert_eq!(auth.login(&good).unwrap_err(), AuthFailure::RateLimited);
    }
}
