// Native host for the Heraldry Creator UI. Mirrors the dev server API (dev/api-plugin.ts):
// read-only file access limited to the game, workshop and Paradox user folders, the local
// Claude Code CLI, and the library file.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::ipc::Response;

const CK3_APP_ID: &str = "1158310";

#[derive(Serialize, Clone)]
struct Paths {
    game: String,
    workshop: String,
    user: String,
    #[serde(rename = "gameVersion")]
    game_version: String,
}

#[derive(Serialize)]
struct DirEntry {
    name: String,
    #[serde(rename = "isDir")]
    is_dir: bool,
}

/// Allowed folders, identified by (device, inode) on Unix so that bind mounts and symlinks of the
/// same folder (e.g. /home vs /var/home inside a distrobox) are recognised; by canonical path elsewhere.
struct Roots(Vec<FileId>);

#[derive(PartialEq)]
enum FileId {
    #[cfg(unix)]
    Inode(u64, u64),
    #[allow(dead_code)]
    Path(PathBuf),
}

fn file_id(p: &Path) -> Option<FileId> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let m = std::fs::metadata(p).ok()?;
        Some(FileId::Inode(m.dev(), m.ino()))
    }
    #[cfg(not(unix))]
    {
        std::fs::canonicalize(p).ok().map(FileId::Path)
    }
}

fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".local/share/Steam"));
        roots.push(home.join(".steam/steam"));
        roots.push(home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"));
        roots.push(home.join("Library/Application Support/Steam"));
    }
    roots.push(PathBuf::from("C:/Program Files (x86)/Steam"));
    roots.push(PathBuf::from("C:/Program Files/Steam"));
    roots.into_iter().filter(|p| p.join("steamapps").is_dir()).collect()
}

/// All Steam library folders listed in libraryfolders.vdf (games can live on other drives).
fn steam_libraries(root: &Path) -> Vec<PathBuf> {
    let mut libs = vec![root.to_path_buf()];
    if let Ok(vdf) = std::fs::read_to_string(root.join("steamapps/libraryfolders.vdf")) {
        for line in vdf.lines() {
            let parts: Vec<&str> = line.split('"').collect();
            // Lines look like:  "path"		"/mnt/games/SteamLibrary"
            if parts.len() >= 4 && parts[1] == "path" {
                libs.push(PathBuf::from(parts[3].replace("\\\\", "\\")));
            }
        }
    }
    libs
}

fn detect_paths() -> Paths {
    let mut game = PathBuf::new();
    let mut workshop = PathBuf::new();
    'outer: for root in steam_roots() {
        for lib in steam_libraries(&root) {
            let g = lib.join("steamapps/common/Crusader Kings III/game");
            if g.is_dir() {
                game = g;
                workshop = lib.join("steamapps/workshop/content").join(CK3_APP_ID);
                break 'outer;
            }
        }
    }
    let user = if cfg!(target_os = "linux") {
        dirs::data_dir().unwrap_or_default().join("Paradox Interactive/Crusader Kings III")
    } else {
        dirs::document_dir().unwrap_or_default().join("Paradox Interactive/Crusader Kings III")
    };
    // launcher/launcher-settings.json next to game/ holds the installed version.
    let game_version = std::fs::read_to_string(game.join("../launcher/launcher-settings.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v["rawVersion"].as_str().map(String::from))
        .unwrap_or_default();
    let s = |p: PathBuf| p.to_string_lossy().into_owned();
    Paths { game: s(game), workshop: s(workshop), user: s(user), game_version }
}

fn checked(roots: &Roots, path: &str) -> Result<PathBuf, String> {
    // Canonicalise first so ".." and symlinks cannot escape, then walk up to find an allowed root.
    let p = std::fs::canonicalize(path).map_err(|_| "not found".to_string())?;
    let inside = p.ancestors().any(|a| file_id(a).is_some_and(|id| roots.0.contains(&id)));
    if inside { Ok(p) } else { Err("forbidden".into()) }
}

#[tauri::command]
fn default_paths(paths: tauri::State<Paths>) -> Paths {
    paths.inner().clone()
}

#[tauri::command]
fn fs_list(roots: tauri::State<Roots>, path: String) -> Vec<DirEntry> {
    let Ok(p) = checked(&roots, &path) else { return vec![] };
    let Ok(entries) = std::fs::read_dir(p) else { return vec![] };
    entries
        .flatten()
        .map(|e| DirEntry {
            name: e.file_name().to_string_lossy().into_owned(),
            // Follow symlinks like Node's readdir + stat would for directories.
            is_dir: e.path().is_dir(),
        })
        .collect()
}

#[tauri::command]
fn fs_read(roots: tauri::State<Roots>, path: String) -> Result<Response, String> {
    let p = checked(&roots, &path)?;
    std::fs::read(p).map(Response::new).map_err(|e| e.to_string())
}

fn library_file() -> PathBuf {
    // Shared with the browser dev server so both see the same saved arms.
    dirs::data_dir().unwrap_or_default().join("ck3-heraldry-creator/library.json")
}

/// Only a missing file means "empty"; any other read error is reported, so a later save cannot
/// overwrite a library that merely failed to load.
#[tauri::command]
fn library_load() -> Result<String, String> {
    match std::fs::read_to_string(library_file()) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("[]".into()),
        Err(e) => Err(format!("cannot read {}: {e}", library_file().display())),
    }
}

/// Writes to a temporary file first and renames it, so a crash never leaves a half-written library.
fn write_atomic(file: &Path, data: &str) -> Result<(), String> {
    std::fs::create_dir_all(file.parent().ok_or("bad path")?).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())
}

#[tauri::command]
fn library_save(json: String) -> Result<(), String> {
    write_atomic(&library_file(), &json)
}

fn cache_file(key: &str) -> Option<PathBuf> {
    let safe: String = key.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    (!safe.is_empty()).then(|| dirs::cache_dir().unwrap_or_default().join("ck3-heraldry-creator").join(format!("{safe}.json")))
}

#[tauri::command]
fn cache_get(key: String) -> Option<String> {
    std::fs::read_to_string(cache_file(&key)?).ok()
}

#[tauri::command]
fn cache_set(key: String, value: String) -> Result<(), String> {
    write_atomic(&cache_file(&key).ok_or("bad key")?, &value)
}

// --- Bring-your-own-key providers ---------------------------------------------------------
// Keys live in the OS keychain; the page can set or delete them but never read them.
// Requests are only sent to the provider's own API host, with the auth header added here.

const KEYRING_SERVICE: &str = "ck3-heraldry-creator";

struct ProviderRule {
    id: &'static str,
    url: &'static str,
    auth: Option<fn(&str) -> (String, String)>,
}

const PROVIDER_RULES: &[ProviderRule] = &[
    ProviderRule { id: "anthropic", url: r"^https://api\.anthropic\.com/", auth: Some(|k| ("x-api-key".into(), k.into())) },
    ProviderRule { id: "openai", url: r"^https://api\.openai\.com/", auth: Some(|k| ("authorization".into(), format!("Bearer {k}"))) },
    ProviderRule { id: "openrouter", url: r"^https://openrouter\.ai/api/", auth: Some(|k| ("authorization".into(), format!("Bearer {k}"))) },
    ProviderRule { id: "gemini", url: r"^https://generativelanguage\.googleapis\.com/", auth: Some(|k| ("x-goog-api-key".into(), k.into())) },
    ProviderRule { id: "ollama", url: r"^http://(localhost|127\.0\.0\.1)(:\d+)?/", auth: None },
];

fn rule(provider: &str) -> Result<&'static ProviderRule, String> {
    PROVIDER_RULES.iter().find(|r| r.id == provider).ok_or_else(|| format!("unknown provider {provider}"))
}

fn keyring_entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, provider).map_err(|e| e.to_string())
}

#[tauri::command]
fn keys_status() -> std::collections::HashMap<String, bool> {
    PROVIDER_RULES
        .iter()
        .filter(|r| r.auth.is_some())
        .map(|r| (r.id.to_string(), keyring_entry(r.id).and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok()))
        .collect()
}

#[tauri::command]
fn key_set(provider: String, key: String) -> Result<(), String> {
    if rule(&provider)?.auth.is_none() {
        return Err("this provider needs no key".into());
    }
    keyring_entry(&provider)?.set_password(key.trim()).map_err(|e| format!("keychain: {e}"))
}

#[tauri::command]
fn key_delete(provider: String) -> Result<(), String> {
    match keyring_entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Serialize)]
struct HostResponse {
    status: u16,
    headers: std::collections::HashMap<String, String>,
    body: String,
}

#[tauri::command]
async fn host_fetch(
    provider: String,
    url: String,
    method: String,
    headers: std::collections::HashMap<String, String>,
    body: Option<String>,
) -> Result<HostResponse, String> {
    let rule = rule(&provider)?;
    if !regex_lite::Regex::new(rule.url).unwrap().is_match(&url) {
        return Err(format!("URL not allowed for {provider}"));
    }
    // No redirects: a redirect to another host would carry the key header along.
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())?;
    let mut req = match method.as_str() {
        "GET" => client.get(&url),
        _ => client.post(&url),
    };
    for (k, v) in &headers {
        let lower = k.to_lowercase();
        if !["x-api-key", "authorization", "x-goog-api-key", "host", "content-length"].contains(&lower.as_str()) {
            req = req.header(k, v);
        }
    }
    if let Some(auth) = rule.auth {
        let key = keyring_entry(&provider)?
            .get_password()
            .map_err(|_| format!("No API key saved for {provider}"))?;
        let (h, v) = auth(&key);
        req = req.header(h, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_string())))
        .collect();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(HostResponse { status, headers, body })
}

#[derive(Deserialize)]
struct ClaudeImage {
    #[serde(rename = "mediaType")]
    media_type: String,
    base64: String,
}

#[derive(Deserialize)]
struct ClaudeRequest {
    system: String,
    prompt: String,
    schema: serde_json::Value,
    images: Option<Vec<ClaudeImage>>,
    /// Model alias or id from Settings; checked by `safe_model` before it becomes an argument.
    model: Option<String>,
    /// "low", "medium" or "high".
    effort: Option<String>,
}

/// Letters, digits and `._:-[]`, not starting with `-`, so a value can never act as a CLI flag.
fn safe_model(m: &str) -> bool {
    !m.is_empty()
        && m.len() <= 100
        && m.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && m.chars().all(|c| c.is_ascii_alphanumeric() || "._:-[]".contains(c))
}

/// Desktop launchers often start apps with a minimal PATH, so also look in the usual install places.
fn find_claude() -> Option<PathBuf> {
    let name = if cfg!(windows) { "claude.exe" } else { "claude" };
    let mut candidates: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).map(|d| d.join(name)).collect())
        .unwrap_or_default();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin").join(name));
        candidates.push(home.join(".claude/local").join(name));
    }
    candidates.into_iter().find(|p| p.is_file())
}

#[tauri::command]
fn claude_available() -> bool {
    find_claude().is_some()
}

/// Same limit as the dev server's provider: a run that hangs must not keep the UI busy forever.
const CLAUDE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// Runs `claude -p` with tools disabled and returns `structured_output`. Arguments are fixed here,
/// not taken from the page, so the UI can only ask for a JSON answer.
#[tauri::command]
async fn claude_json(request: ClaudeRequest) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let claude = find_claude().ok_or("Claude Code CLI not found")?;
        let streaming = request.images.as_ref().is_some_and(|i| !i.is_empty());
        let mut cmd = Command::new(claude);
        if let Some(model) = request.model.as_deref() {
            if !safe_model(model) {
                return Err(format!("invalid model name \"{model}\""));
            }
            cmd.args(["--model", model]);
        }
        if let Some(effort) = request.effort.as_deref() {
            if !["low", "medium", "high"].contains(&effort) {
                return Err(format!("invalid effort \"{effort}\""));
            }
            cmd.args(["--effort", effort]);
        }
        cmd.arg("-p");
        if streaming {
            cmd.args(["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]);
        } else {
            cmd.args(["--output-format", "json"]);
        }
        cmd.args(["--json-schema", &request.schema.to_string()])
            .args(["--system-prompt", &request.system])
            .args(["--tools", ""])
            .arg("--no-session-persistence")
            // Run outside any project so no CLAUDE.md is picked up.
            .current_dir(std::env::temp_dir())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // A GUI app on Windows would otherwise open a console window for every run.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("cannot start claude: {e}"))?;
        let input = if streaming {
            let mut content: Vec<serde_json::Value> = request
                .images
                .unwrap_or_default()
                .into_iter()
                .map(|i| serde_json::json!({"type": "image", "source": {"type": "base64", "media_type": i.media_type, "data": i.base64}}))
                .collect();
            content.push(serde_json::json!({"type": "text", "text": request.prompt}));
            serde_json::json!({"type": "user", "message": {"role": "user", "content": content}}).to_string() + "\n"
        } else {
            request.prompt
        };
        // Write the prompt from a thread so a large prompt cannot block while the CLI's output pipe fills up.
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        std::thread::spawn(move || stdin.write_all(input.as_bytes()));
        // Kill the CLI if it runs too long; wait_with_output then returns what it printed.
        let pid = child.id();
        let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
        let watchdog = std::thread::spawn(move || {
            if done_rx.recv_timeout(CLAUDE_TIMEOUT).is_err() {
                kill(pid);
                return true;
            }
            false
        });
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let _ = done_tx.send(());
        if watchdog.join().unwrap_or(false) {
            return Err("claude CLI timed out after 5 minutes".into());
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        // stream-json prints one event per line; the result is the last one.
        let line = if streaming { stdout.trim().lines().last().unwrap_or("") } else { stdout.as_ref() };
        let result: serde_json::Value = serde_json::from_str(line).map_err(|_| {
            let err = String::from_utf8_lossy(&out.stderr);
            format!("claude exited with {}: {}", out.status, if err.is_empty() { &stdout } else { &err }.chars().take(500).collect::<String>())
        })?;
        if result["is_error"].as_bool() == Some(true) || result.get("structured_output").is_none() {
            return Err(result["result"].as_str().unwrap_or("no structured output").to_string());
        }
        Ok(result["structured_output"].clone())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn kill(pid: u32) {
    #[cfg(unix)]
    let _ = Command::new("kill").arg(pid.to_string()).status();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).creation_flags(0x0800_0000).status();
    }
}

/// Read-only query to A Wiki of Ice and Fire's MediaWiki API (canon checks in Inspiration). The address
/// is fixed and only these parameters are forwarded; the site's crawler guard needs a real User-Agent.
const WIKI_PARAMS: [&str; 12] = [
    "action", "prop", "inprop", "exintro", "explaintext", "exlimit", "redirects", "titles", "list", "srsearch", "srlimit", "formatversion",
];

#[tauri::command]
async fn awoiaf_query(params: std::collections::HashMap<String, String>) -> Result<String, String> {
    if params.get("action").map(String::as_str) != Some("query") || params.keys().any(|k| !WIKI_PARAMS.contains(&k.as_str())) {
        return Err("wiki query not allowed".into());
    }
    let res = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?
        .get("https://awoiaf.westeros.org/api.php")
        .query(&params)
        .query(&[("format", "json")])
        .header(
            "User-Agent",
            "HeraldryCreator/0.1 (CK3 AGOT coat of arms tool; https://github.com/jaynoe/ck3-heraldry-creator)",
        )
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("AWOIAF answered {}", res.status()));
    }
    res.text().await.map_err(|e| e.to_string())
}

/// Which release bundle is running, named like the Build options of the test report form.
#[tauri::command]
fn build_kind() -> Option<&'static str> {
    if cfg!(windows) {
        return Some("Windows · .msi / .exe");
    }
    if std::env::var_os("APPIMAGE").is_some() {
        return Some("Linux · AppImage");
    }
    // .deb and .rpm install into /usr; the distribution tells them apart.
    let exe = std::env::current_exe().ok()?;
    if !exe.starts_with("/usr") {
        return None;
    }
    if Path::new("/etc/debian_version").exists() {
        Some("Linux · .deb")
    } else if Path::new("/etc/redhat-release").exists() || Path::new("/etc/fedora-release").exists() {
        Some("Linux · .rpm")
    } else {
        None
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let paths = detect_paths();
    let roots = Roots([&paths.game, &paths.workshop, &paths.user].iter().filter_map(|p| file_id(Path::new(p))).collect());
    tauri::Builder::default()
        // Opens AWOIAF source links and the test report form; the capability only allows those URLs.
        .plugin(tauri_plugin_opener::init())
        // Updates: signed bundles from the latest GitHub release (endpoint and public key in tauri.conf.json).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(paths)
        .manage(roots)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            default_paths,
            fs_list,
            fs_read,
            library_load,
            library_save,
            cache_get,
            cache_set,
            keys_status,
            key_set,
            key_delete,
            host_fetch,
            claude_available,
            claude_json,
            awoiaf_query,
            build_kind
        ])
        .run(tauri::generate_context!())
        .expect("error while running Heraldry Creator");
}
