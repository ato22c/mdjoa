mod commands;

use commands::{
    backlog::{backlog_generate_task, backlog_plan_task, open_dashboard_window},
    bookmarks::{get_bookmarks, toggle_bookmark},
    claude_assets::scan_claude_assets,
    context::scan_context_files,
    default_app::{
        is_default_markdown_app, register_default_app_capabilities, set_default_markdown_app,
    },
    favorites::{clear_favorites, get_favorites, reorder_favorites, set_favorites, toggle_favorite},
    file::{
        create_untitled_file, delete_file_if_empty, file_exists, file_meta, list_dir,
        path_is_dir, read_file, remove_untitled_file, rename_path, toggle_task, trash_path,
        write_file,
    },
    log::{write_log, get_log_path},
    pandoc::{convert_docx, pandoc_delete, pandoc_download, pandoc_status},
    recent::{add_recent_file, clear_recent_files, get_recent_files, RecentFile},
    remote::open_remote_md,
    search::search_in_folder,
    settings::{load_settings, save_settings},
    translate::{cancel_translate, claude_status, run_claude, TranslateCache, TranslateProc},
    updater::{check_for_updates_now, install_pending_update},
    wikilink::{resolve_wikilink, scan_backlinks},
    window::{get_window_file, open_in_new_window, WindowFiles},
};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

/// Stores the file path that was opened before the webview was ready.
/// Populated by RunEvent::Opened (macOS Finder) or single-instance argv.
/// The frontend retrieves and clears it once via get_pending_open.
pub struct PendingOpen(pub Mutex<Option<String>>);

#[tauri::command]
fn get_pending_open(state: State<PendingOpen>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// OS 인쇄 패널 열기(→ "PDF로 저장"). macOS WKWebView는 JS의 window.print()를
/// 무시하므로, 프런트의 PDF 내보내기는 이 커맨드를 거쳐 네이티브 인쇄를 호출한다.
/// (Windows WebView2에서도 동일하게 동작.)
#[tauri::command]
fn print_document(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// Payload emitted to the frontend when a "최근 항목" menu entry is chosen.
#[derive(Clone, serde::Serialize)]
struct RecentOpen {
    path: String,
    is_dir: bool,
}

/// Native-menu labels supplied by the frontend (single source of truth for
/// translations). Default = Korean, used only for the initial menu at startup
/// before the frontend mounts and calls rebuild_menu with resolved labels.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct MenuLabels {
    about: String,
    settings: String,
    // Only read inside the #[cfg(target_os = "macos")] app-menu block below —
    // on Windows/Linux this field is deserialized/defaulted but never read,
    // which would otherwise trip the dead_code lint on non-macOS builds.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    app_menu: String,
    new_file: String,
    open_file: String,
    open_folder: String,
    save_as: String,
    recent_title: String,
    recent_empty: String,
    clear_recent: String,
    file_menu: String,
    edit_menu: String,
    toggle_sidebar: String,
    toggle_outline: String,
    search: String,
    zoom_in: String,
    zoom_out: String,
    zoom_reset: String,
    toggle_edit: String,
    focus_mode: String,
    theme_system: String,
    theme_dark: String,
    theme_light: String,
    theme_menu: String,
    view_menu: String,
    manual: String,
    help_menu: String,
}

impl Default for MenuLabels {
    fn default() -> Self {
        Self {
            about: "MD좋아 정보".into(),
            settings: "설정…".into(),
            app_menu: "MD좋아".into(),
            new_file: "새 문서… (Ctrl+N)".into(),
            open_file: "파일 열기… (Ctrl+O)".into(),
            open_folder: "폴더 열기… (Ctrl+Shift+O)".into(),
            save_as: "다른 이름으로 저장… (Ctrl+Shift+S)".into(),
            recent_title: "최근 항목".into(),
            recent_empty: "(없음)".into(),
            clear_recent: "최근 항목 지우기".into(),
            file_menu: "파일".into(),
            edit_menu: "편집".into(),
            toggle_sidebar: "사이드바 (Ctrl+B)".into(),
            toggle_outline: "목차".into(),
            search: "검색 (Ctrl+F)".into(),
            zoom_in: "확대 (Ctrl+=)".into(),
            zoom_out: "축소 (Ctrl+-)".into(),
            zoom_reset: "실제 크기 (Ctrl+0)".into(),
            toggle_edit: "편집·보기 모드 전환 (Ctrl+E)".into(),
            focus_mode: "집중 모드 (Ctrl+Shift+Enter)".into(),
            theme_system: "시스템".into(),
            theme_dark: "다크".into(),
            theme_light: "라이트".into(),
            theme_menu: "테마 변경".into(),
            view_menu: "보기".into(),
            manual: "사용자 매뉴얼".into(),
            help_menu: "도움말".into(),
        }
    }
}

/// Builds the native application menu. Called at startup and again whenever the
/// recent-items list changes (via the `rebuild_menu` command) so the "최근 항목"
/// submenu stays in sync. Menu clicks are handled by the global `on_menu_event`
/// handler, which survives `set_menu`, so it is wired up once on the builder.
fn build_app_menu<R: Runtime>(
    app: &AppHandle<R>,
    recents: &[RecentFile],
    labels: &MenuLabels,
) -> tauri::Result<Menu<R>> {
    // Settings + About are shared actions. On macOS they live in the application
    // menu; on Windows/Linux (which have no app menu) they go into the File menu
    // below. One definition each — only their placement differs per OS.
    let about = MenuItemBuilder::with_id("about", &labels.about).build(app)?;
    let settings = MenuItemBuilder::with_id("settings", &labels.settings)
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    // macOS application menu (first submenu; its title shows the app name). The
    // services/hide/show-all items are macOS-only conventions, so this submenu is
    // built only on macOS — Windows/Linux surface the same actions in File.
    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(app, &labels.app_menu)
        .item(&about)
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // File menu.
    let new_file = MenuItemBuilder::with_id("new-file", &labels.new_file).build(app)?;
    let open_file = MenuItemBuilder::with_id("open-file", &labels.open_file).build(app)?;
    let open_folder = MenuItemBuilder::with_id("open-folder", &labels.open_folder).build(app)?;
    let save_as = MenuItemBuilder::with_id("save-as", &labels.save_as).build(app)?;

    // "최근 항목" submenu — built dynamically from the recents list. Each item's
    // id encodes is_dir + path as `recent::<is_dir>::<path>` (path is last so a
    // path containing "::" survives split_once).
    let mut recent_builder = SubmenuBuilder::new(app, &labels.recent_title);
    if recents.is_empty() {
        let empty = MenuItemBuilder::with_id("recent-empty", &labels.recent_empty)
            .enabled(false)
            .build(app)?;
        recent_builder = recent_builder.item(&empty);
    } else {
        for rf in recents {
            let id = format!("recent::{}::{}", rf.is_dir, rf.path);
            let label = if rf.is_dir {
                format!("📁 {}", rf.name)
            } else {
                rf.name.clone()
            };
            let item = MenuItemBuilder::with_id(id, label).build(app)?;
            recent_builder = recent_builder.item(&item);
        }
        let clear = MenuItemBuilder::with_id("clear-recent", &labels.clear_recent).build(app)?;
        recent_builder = recent_builder.separator().item(&clear);
    }
    let recent_menu = recent_builder.build()?;

    let mut file_builder = SubmenuBuilder::new(app, &labels.file_menu)
        .item(&new_file)
        .item(&open_file)
        .item(&open_folder)
        .separator()
        .item(&save_as)
        .item(&recent_menu)
        .separator();
    #[cfg(target_os = "macos")]
    {
        file_builder = file_builder.close_window();
    }
    // Windows/Linux have no app menu, so Settings/Quit belong here. About lives
    // in the Help menu below (standard placement), so it is not duplicated here.
    #[cfg(not(target_os = "macos"))]
    {
        file_builder = file_builder.item(&settings).separator().quit();
    }
    let file_menu = file_builder.build()?;

    // Edit menu — predefined items so the viewer's text can be selected/copied.
    let edit_menu = SubmenuBuilder::new(app, &labels.edit_menu)
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // View menu. Accelerators are owned by the frontend keydown handler (AppShell.tsx)
    // and are NOT registered here to prevent double-firing on any platform.
    let toggle_sidebar = MenuItemBuilder::with_id("toggle-sidebar", &labels.toggle_sidebar).build(app)?;
    let toggle_outline = MenuItemBuilder::with_id("toggle-outline", &labels.toggle_outline).build(app)?;
    let search = MenuItemBuilder::with_id("search", &labels.search).build(app)?;
    let zoom_in = MenuItemBuilder::with_id("zoom-in", &labels.zoom_in).build(app)?;
    let zoom_out = MenuItemBuilder::with_id("zoom-out", &labels.zoom_out).build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("zoom-reset", &labels.zoom_reset).build(app)?;
    let toggle_edit = MenuItemBuilder::with_id("toggle-edit", &labels.toggle_edit).build(app)?;
    let focus_mode = MenuItemBuilder::with_id("focus-mode", &labels.focus_mode).build(app)?;
    // Theme: a submenu with direct choices (시스템/다크/라이트) — same behavior as
    // the right-click menu, not a cycle. Each item sets the theme directly.
    let theme_system = MenuItemBuilder::with_id("theme-system", &labels.theme_system).build(app)?;
    let theme_dark = MenuItemBuilder::with_id("theme-dark", &labels.theme_dark).build(app)?;
    let theme_light = MenuItemBuilder::with_id("theme-light", &labels.theme_light).build(app)?;
    let theme_menu = SubmenuBuilder::new(app, &labels.theme_menu)
        .item(&theme_system)
        .item(&theme_dark)
        .item(&theme_light)
        .build()?;
    let view_menu = SubmenuBuilder::new(app, &labels.view_menu)
        .item(&toggle_sidebar)
        .item(&toggle_outline)
        .item(&search)
        .separator()
        .item(&toggle_edit)
        .item(&focus_mode)
        .separator()
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .separator()
        .item(&theme_menu)
        .build()?;

    // Help menu — opens the bundled user manual (handled on the frontend via the
    // existing file-open path) and reuses the existing About action.
    let manual = MenuItemBuilder::with_id("open-manual", &labels.manual).build(app)?;
    let help_menu = SubmenuBuilder::new(app, &labels.help_menu)
        .item(&manual)
        .separator()
        .item(&about)
        .build()?;

    #[cfg(target_os = "macos")]
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &help_menu])
        .build()?;
    #[cfg(not(target_os = "macos"))]
    let menu = MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &view_menu, &help_menu])
        .build()?;
    Ok(menu)
}

/// Rebuilds the native menu from the current recents list and installs it.
/// Called by the frontend whenever the recents list changes.
#[tauri::command]
fn rebuild_menu(app: AppHandle, labels: MenuLabels) -> Result<(), String> {
    let recents = get_recent_files();
    let menu = build_app_menu(&app, &recents, &labels).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

/// Translates a native menu click into a `menu:*` event for the frontend, which
/// reuses the existing store actions (open dialogs, settings, zoom, …).
fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let simple = match id {
        "about" => Some("menu:about"),
        "settings" => Some("menu:settings"),
        "new-file" => Some("menu:new-file"),
        "save-as" => Some("menu:save-as"),
        "open-file" => Some("menu:open-file"),
        "open-folder" => Some("menu:open-folder"),
        "clear-recent" => Some("menu:clear-recent"),
        "toggle-sidebar" => Some("menu:toggle-sidebar"),
        "toggle-outline" => Some("menu:toggle-outline"),
        "search" => Some("menu:search"),
        "zoom-in" => Some("menu:zoom-in"),
        "zoom-out" => Some("menu:zoom-out"),
        "zoom-reset" => Some("menu:zoom-reset"),
        "toggle-edit" => Some("menu:toggle-edit"),
        "focus-mode" => Some("menu:focus-mode"),
        "theme-system" => Some("menu:theme-system"),
        "theme-dark" => Some("menu:theme-dark"),
        "theme-light" => Some("menu:theme-light"),
        "open-manual" => Some("menu:open-manual"),
        _ => None,
    };
    if let Some(event) = simple {
        app.emit(event, ()).ok();
        return;
    }
    if let Some(rest) = id.strip_prefix("recent::") {
        // rest = "<is_dir>::<path>"
        if let Some((is_dir_s, path)) = rest.split_once("::") {
            app.emit(
                "menu:open-recent",
                RecentOpen {
                    path: path.to_string(),
                    is_dir: is_dir_s == "true",
                },
            )
            .ok();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Record uncaught Rust panics to the log file (best-effort, keeps stderr).
    commands::log::install_panic_hook();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_single_instance::init(|app, argv, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    // 최소화 상태에서는 set_focus만으로 창이 복원되지 않는다.
                    window.unminimize().ok();
                    window.set_focus().ok();
                }
                if let Some(path) = argv.get(1) {
                    let path = path.clone();
                    // Store in state first (in case webview isn't ready),
                    // then also try to emit directly (works when already running).
                    if let Some(state) = app.try_state::<PendingOpen>() {
                        *state.0.lock().unwrap() = Some(path.clone());
                    }
                    app.emit("open-file", path).ok();
                }
            }),
        )
        .manage(PendingOpen(Mutex::new(None)))
        .manage(WindowFiles::default())
        .manage(TranslateProc::default())
        .manage(TranslateCache::default())
        .setup(|_app| {
            // Windows: 커스텀 타이틀바를 위해 네이티브 데코레이션 제거.
            // setup 훅에서 호출해야 창이 표시되기 전에 적용됨.
            #[cfg(target_os = "windows")]
            if let Some(window) = _app.get_webview_window("main") {
                let _ = window.set_decorations(false);
            }
            // Windows: Explorer 더블클릭으로 앱이 최초 실행될 때 argv[1]에 파일 경로가 온다.
            // single-instance init 콜백은 앱이 이미 실행 중일 때만 호출되므로,
            // 첫 인스턴스는 여기서 직접 argv를 읽어 PendingOpen에 저장해야 한다.
            // macOS는 RunEvent::Opened로 처리하므로 Windows 전용.
            #[cfg(target_os = "windows")]
            {
                let args: Vec<String> = std::env::args().collect();
                if let Some(path) = args.get(1) {
                    if !path.starts_with('-') {
                        *_app.state::<PendingOpen>().0.lock().unwrap() = Some(path.clone());
                    }
                }
            }
            // Auto update —Windows에서만, 그리고 설정에서 켠
            // 경우에만 백그라운드 루프를 시작한다(CLAUDE.md 네트워크 원칙 예외 4).
            #[cfg(target_os = "windows")]
            {
                let enabled = commands::settings::load_settings().update_check_enabled;
                let handle = _app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    commands::updater::start_background_checks(handle, enabled).await;
                });
            }
            Ok(())
        })
        .menu(|handle| build_app_menu(handle, &get_recent_files(), &MenuLabels::default()))
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            read_file,
            file_exists,
            file_meta,
            list_dir,
            path_is_dir,
            print_document,
            load_settings,
            save_settings,
            get_recent_files,
            add_recent_file,
            clear_recent_files,
            write_log,
            get_log_path,
            get_pending_open,
            get_favorites,
            toggle_favorite,
            reorder_favorites,
            clear_favorites,
            set_favorites,
            get_bookmarks,
            toggle_bookmark,
            pandoc_status,
            pandoc_download,
            pandoc_delete,
            convert_docx,
            search_in_folder,
            scan_context_files,
            scan_claude_assets,
            toggle_task,
            write_file,
            rename_path,
            trash_path,
            delete_file_if_empty,
            create_untitled_file,
            remove_untitled_file,
            rebuild_menu,
            resolve_wikilink,
            scan_backlinks,
            open_in_new_window,
            get_window_file,
            claude_status,
            run_claude,
            cancel_translate,
            backlog_generate_task,
            backlog_plan_task,
            open_dashboard_window,
            open_remote_md,
            set_default_markdown_app,
            is_default_markdown_app,
            register_default_app_capabilities,
            check_for_updates_now,
            install_pending_update,
        ])
        .build(tauri::generate_context!())
        .expect("error building application");

    // tauri.conf.json(Windows)/tauri.macos.conf.json(macOS)에서 decorations 설정.

    app.run(|app, event| {
        // macOS: Finder double-click / "Open With" fires RunEvent::Opened.
        // This fires whether the app is freshly launched OR already running.
        // When freshly launched, the webview isn't ready yet, so we store
        // the path in PendingOpen state — the frontend picks it up on init.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            if let Some(window) = app.get_webview_window("main") {
                // 최소화(Dock) 상태에서는 set_focus만으로 창이 복원되지 않는다.
                window.unminimize().ok();
                window.set_focus().ok();
            }
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path_str = path.to_string_lossy().to_string();
                    // Store for frontend to pick up after init
                    if let Some(state) = app.try_state::<PendingOpen>() {
                        *state.0.lock().unwrap() = Some(path_str.clone());
                    }
                    // Also emit directly (works when app is already running)
                    app.emit("open-file", path_str).ok();
                }
            }
        }
    });
}
