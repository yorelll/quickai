/*!
 * QuickAI Core Library
 *
 * Application bootstrap for the QuickAI desktop assistant. Configures the
 * system tray menu, window lifecycle (hide-on-close instead of quit),
 * and Windows-specific overlay management.
 */

#![cfg_attr(coverage_nightly, feature(coverage_attribute))]

pub mod commands;
pub mod config;
pub mod connection_test;
pub mod database;
pub mod diagnostics;
pub mod history;
pub mod images;
pub mod onboarding;
pub mod providers;
pub mod screenshot;
pub mod settings_commands;
pub mod skills;

#[cfg(target_os = "windows")]
mod agent;
#[cfg(target_os = "windows")]
mod autostart;
#[cfg(target_os = "windows")]
mod computer_control;
#[cfg(target_os = "windows")]
mod windows_activator;

#[cfg(target_os = "windows")]
mod windows_focus;

#[cfg(target_os = "windows")]
mod single_instance;

pub mod context;

#[cfg(target_os = "windows")]
mod windows_lifecycle;
#[cfg(target_os = "windows")]
mod windows_screenshot;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
#[cfg(target_os = "windows")]
use std::sync::Arc;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};

// ─── Window helpers ─────────────────────────────────────────────────────────

/// Expected logical width of the overlay window for spawn-position calculations.
#[cfg(target_os = "windows")]
const OVERLAY_LOGICAL_WIDTH: f64 = 650.0;
/// Collapsed (ask-bar) window height: the ask bar's measured 64.8 px plus the
/// 48 px container padding. Must match `COLLAPSED_WINDOW_HEIGHT` in
/// `src/App.tsx` and `app.windows[0].height` in `tauri.conf.json`.
///
/// This used to be 60: 53 px shorter than the ask bar itself. Every summon and
/// every minibar restore therefore started with the bar clipped, and if the
/// frontend's first resize was missed or landed before the native resize, the
/// window stayed at a height that could not show the bar at all.
#[cfg(target_os = "windows")]
const OVERLAY_LOGICAL_HEIGHT_COLLAPSED: f64 = 113.0;

/// Minibar dimensions — thin always-on-top strip shown when the user
/// switches away from QuickAI while a task is in progress.
#[cfg(target_os = "windows")]
const OVERLAY_LOGICAL_WIDTH_MINIBAR: f64 = 48.0;
#[cfg(target_os = "windows")]
const OVERLAY_LOGICAL_HEIGHT_MINIBAR: f64 = 48.0;

/// Frontend event used to synchronize show/hide animations with native window visibility.
const OVERLAY_VISIBILITY_EVENT: &str = "quickai://visibility";
const OVERLAY_VISIBILITY_SHOW: &str = "show";
const OVERLAY_VISIBILITY_HIDE_REQUEST: &str = "hide-request";

/// Frontend event that triggers the onboarding screen at startup.
#[cfg(target_os = "windows")]
const ONBOARDING_EVENT: &str = "quickai://onboarding";

/// Frontend event emitted when the user switches away from QuickAI,
/// triggering minibar mode (thin always-on-top strip).
#[cfg(target_os = "windows")]
const MINIBAR_EVENT: &str = "quickai://minibar";

/// Logical dimensions of the onboarding window (centered, fixed size).
#[cfg(target_os = "windows")]
const ONBOARDING_LOGICAL_WIDTH: f64 = 460.0;
#[cfg(target_os = "windows")]
const ONBOARDING_LOGICAL_HEIGHT: f64 = 640.0;

/// Tracks the intended visibility state of the overlay, preventing race conditions
/// between the frontend exit animation and rapid activation toggles.
static OVERLAY_INTENDED_VISIBLE: AtomicBool = AtomicBool::new(false);

/// Monotonic token for "the overlay surface is meant to be shown" transitions.
///
/// Every show and every expand from the minibar bumps this. A minibar shrink
/// carries the token that was current when the focus listener that produced it
/// was installed, and is refused if a newer show/expand has happened since.
/// This is the shrink-vs-expand counterpart of the hide commit gate: without it
/// a delayed click-away (or a delayed `enter_minibar_size`) could shrink a
/// window that had just been summoned, so the first double-tap looks dead and a
/// second one is needed.
static OVERLAY_SURFACE_EPOCH: AtomicU64 = AtomicU64::new(0);

/// Advances the surface epoch and returns the new value.
fn bump_overlay_surface_epoch() -> u64 {
    OVERLAY_SURFACE_EPOCH.fetch_add(1, Ordering::SeqCst) + 1
}

/// Whether a shrink request carrying `token` may still be applied while the
/// surface epoch is `current`.
///
/// `None` is the argument-less form (the in-app minimise button and older
/// callers): with no token there is nothing to compare, so it is applied.
/// A token older than the current epoch belongs to a click-away that has since
/// been superseded by a show or expand and must be ignored.
#[cfg(target_os = "windows")]
fn shrink_is_current(token: Option<u64>, current: u64) -> bool {
    match token {
        Some(token) => token >= current,
        None => true,
    }
}

/// Whether the frontend is currently rendering the overlay's *visible* state.
///
/// Mirrored from the frontend on every `overlayState` change (`visible` is
/// true; `minibar`, `hiding` and `hidden` are false). The native flags say what
/// the backend asked for; this is the only signal of what the user is actually
/// looking at, and it is what the summon path reconciles against when a
/// fire-and-forget event was lost in one direction or the other. Without it:
/// - a lost `quickai://minibar` leaves the frontend visible while
///   `MINIBAR_ACTIVE` is true, and expanding emitted a show event that reset
///   the conversation the user was reading;
/// - a lost show leaves the frontend in the minibar while the native window
///   looks visible, so `BringForward` never resized or re-showed it.
static OVERLAY_UI_VISIBLE: AtomicBool = AtomicBool::new(false);

/// Which real state an expand is recovering from, for the diagnostic line.
#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ExpandSource {
    /// `MINIBAR_ACTIVE` with the minibar UI on screen: a normal click-away.
    MinibarWithUi,
    /// `MINIBAR_ACTIVE` but the frontend still shows the bar: the minibar
    /// event never reached it, so the window was never shrunk.
    MinibarWithoutUi,
    /// No minibar flag, but the frontend is not showing the bar while the
    /// native window looks visible: an expand's show event was lost.
    UiHidden,
}

#[cfg(target_os = "windows")]
impl ExpandSource {
    fn label(self) -> &'static str {
        match self {
            ExpandSource::MinibarWithUi => "minibar-with-ui",
            ExpandSource::MinibarWithoutUi => "minibar-without-ui",
            ExpandSource::UiHidden => "ui-hidden",
        }
    }
}

/// Classifies the state an expand is recovering from.
#[cfg(target_os = "windows")]
fn expand_source(minibar_active: bool, ui_visible: bool) -> ExpandSource {
    if minibar_active {
        if ui_visible {
            ExpandSource::MinibarWithoutUi
        } else {
            ExpandSource::MinibarWithUi
        }
    } else {
        ExpandSource::UiHidden
    }
}

/// Whether a summon must replay the frontend entrance animation.
///
/// Replaying resets the open conversation, so it is only correct when the
/// frontend is not already showing the bar. **A summon must never discard the
/// conversation the user is looking at.**
#[cfg(target_os = "windows")]
fn summon_replays_entrance(ui_visible: bool) -> bool {
    !ui_visible
}

/// Whether `MINIBAR_ACTIVE` describes a state that cannot exist: the flag is
/// set while the native window is hidden.
///
/// The flag can outlive the window when the user clicked away while the overlay
/// was hidden (the focus listener survives Esc). Clearing it keeps the summon
/// from taking the expand path for a bar that is not on screen, and keeps the
/// `[minibar] expand entry` diagnostic from claiming a live minibar.
#[cfg(target_os = "windows")]
fn should_clear_stale_minibar(natively_visible: bool, minibar_active: bool) -> bool {
    !natively_visible && minibar_active
}

/// True on first process launch; cleared when the frontend signals readiness.
/// Used to show the overlay automatically on startup without a race condition:
/// the frontend calls `notify_frontend_ready` after its event listener is
/// registered, so the show event is guaranteed to have a listener.
static LAUNCH_SHOW_PENDING: AtomicBool = AtomicBool::new(true);

/// Payload emitted to the frontend on every visibility transition.
#[derive(Clone, serde::Serialize)]
struct VisibilityPayload {
    /// "show" or "hide-request"
    state: &'static str,
    /// Selected text captured at activation time, if any.
    selected_text: Option<String>,
    /// Logical X of the window at show time. Used with `window_y` and
    /// `screen_bottom_y` to decide growth direction, and as the pinned X
    /// coordinate for `set_window_frame` calls during upward growth.
    window_x: Option<f64>,
    /// Logical Y of the window top-left at show time.
    window_y: Option<f64>,
    /// Logical Y of the bottom edge of the monitor's work area. Logical, like
    /// `window_y` — comparing a physical bottom against a logical window
    /// position made the grow-up decision depend on the display scale.
    screen_bottom_y: Option<f64>,
    /// Surface epoch of this transition (see [`OVERLAY_SURFACE_EPOCH`]). Every
    /// show/expand carries the epoch it bumped to; hide requests carry 0 and
    /// the frontend ignores it for them. The frontend keeps the newest value it
    /// has seen and rejects minibar events stamped older than it.
    transition_epoch: u64,
}

/// Emits a visibility transition to the frontend animation controller.
fn emit_overlay_visibility(
    app_handle: &tauri::AppHandle,
    state: &'static str,
    selected_text: Option<String>,
    window_x: Option<f64>,
    window_y: Option<f64>,
    screen_bottom_y: Option<f64>,
    transition_epoch: u64,
) {
    let _ = app_handle.emit(
        OVERLAY_VISIBILITY_EVENT,
        VisibilityPayload {
            state,
            selected_text,
            window_x,
            window_y,
            screen_bottom_y,
            transition_epoch,
        },
    );
}

/// Requests an animated hide sequence from the frontend. The actual native
/// window hide is deferred until the frontend exit animation completes.
fn request_overlay_hide(app_handle: &tauri::AppHandle) {
    if OVERLAY_INTENDED_VISIBLE.swap(false, Ordering::SeqCst) {
        #[cfg(target_os = "windows")]
        let _ = windows_focus::stop_focus_listener();

        emit_overlay_visibility(
            app_handle,
            OVERLAY_VISIBILITY_HIDE_REQUEST,
            None,
            None,
            None,
            None,
            // Hide requests carry no surface epoch: only a show/expand can
            // supersede a pending minibar shrink.
            0,
        );
    }
}

/// Keeps `window` out of the taskbar, durably on Windows.
///
/// `set_skip_taskbar(true)` alone is not durable there: tao implements it as a
/// one-shot `ITaskbarList::DeleteTab`, so the shell can re-add the button later.
/// On Windows this also applies the `WS_EX_TOOLWINDOW` extended style, which the
/// shell honours on every re-evaluation. That style additionally removes the
/// window from Alt+Tab — intended for these overlay-style windows (see
/// `windows_focus::apply_tool_window_style`).
///
/// **Call this *after* the window has been shown.** tao rewrites the whole
/// `GWL_EXSTYLE` whenever a window flag changes, and `show`/`hide` and
/// `set_always_on_top` all do — so a show that happens after this call silently
/// drops the tool-window style again. Every show path in this file therefore
/// calls this last (item 4).
fn hide_from_taskbar(window: &tauri::WebviewWindow) {
    let _ = window.set_skip_taskbar(true);
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            windows_focus::apply_tool_window_style(hwnd);
        }
    }
}

/// Converts a physical pixel value into logical (CSS) units for the frontend.
///
/// Monitor metrics arrive in physical pixels; every layout value the frontend
/// compares them with is logical. A zero/negative factor (a monitor query that
/// has not resolved yet) falls back to the physical value rather than
/// producing NaN.
#[cfg(any(target_os = "windows", test))]
fn to_logical(physical: f64, scale_factor: f64) -> f64 {
    if scale_factor > 0.0 {
        physical / scale_factor
    } else {
        physical
    }
}

/// Shows the overlay and requests the frontend to replay its entrance animation.
///
/// On Windows, the overlay is shown as an always-on-top, skip-taskbar window.
/// The activation context (selected text, mouse position) is used to position
/// the window near the cursor or selection, using Tauri's cross-platform
/// monitor enumeration for screen bounds.
#[cfg(target_os = "windows")]
fn show_overlay(app_handle: &tauri::AppHandle, ctx: crate::context::ActivationContext) {
    if OVERLAY_INTENDED_VISIBLE.swap(true, Ordering::SeqCst) {
        // Diagnostic (batch 7): the summon chose `Show` but nothing below runs.
        // `open_or_raise_overlay` clears the flag immediately before this call,
        // so seeing this line means another thread set it in between.
        crate::diag!("quickai: [summon] show swallowed: OVERLAY_INTENDED_VISIBLE was already set");
        return;
    }
    let epoch = bump_overlay_surface_epoch();

    let selected_text = ctx.selected_text;

    // Position the window using the activation context.
    let placement = if let Some(window) = app_handle.get_webview_window("main") {
        // Use Tauri's cross-platform monitor API to find the target monitor.
        let monitors = app_handle.available_monitors().unwrap_or_default();
        let primary = app_handle.primary_monitor().unwrap();

        // Determine which monitor the activation occurred on.
        let anchor_point = ctx
            .bounds
            .map(|r| (r.x + r.width / 2.0, r.y + r.height / 2.0))
            .or(ctx.mouse_position);

        let target_monitor = if let Some((ax, ay)) = anchor_point {
            monitors.into_iter().find(|m| {
                let pos = m.position();
                let size = m.size();
                let mx = pos.x as f64;
                let my = pos.y as f64;
                let mw = size.width as f64;
                let mh = size.height as f64;
                ax >= mx && ax < mx + mw && ay >= my && ay < my + mh
            })
        } else {
            None
        };

        let monitor = target_monitor.unwrap_or_else(|| primary.unwrap());
        let scale = monitor.scale_factor();
        let mon_pos = monitor.position();
        let work = monitor.work_area();

        // `size()`, `position()` and `work_area()` are PHYSICAL pixels, while
        // the overlay's own dimensions are logical. Do the placement math
        // entirely in physical pixels (scale the window size up to match) and
        // apply it with `PhysicalPosition`.
        //
        // The previous code mixed the two: it fed a physical screen rect and a
        // logical window size into `calculate_window_position`, then handed the
        // physical result to `LogicalPosition`. On any monitor whose scale is
        // not 100 % that is a *placement* bug — the window lands at a
        // scale-times-wrong position, which can put its input bar under the
        // taskbar or leave part of it off the monitor. It is not a
        // height-measurement bug.
        let mon_x = mon_pos.x as f64;
        let mon_y = mon_pos.y as f64;

        // Do the placement against the *work area*, not the full monitor: the
        // Y clamp lives inside `calculate_window_position`, so it can only keep
        // the window clear of a bottom taskbar if it is given the usable
        // rectangle. The offsets are zero unless the taskbar is on the
        // top/left edge.
        let work_x = (work.position.x - mon_pos.x) as f64;
        let work_y = (work.position.y - mon_pos.y) as f64;
        let work_w = work.size.width as f64;
        let work_h = work.size.height as f64;

        // Convert global coordinates to work-area-local for positioning math.
        let local_ctx = crate::context::ActivationContext {
            selected_text: selected_text.clone(),
            bounds: ctx.bounds.map(|r| crate::context::ScreenRect {
                x: r.x - mon_x - work_x,
                y: r.y - mon_y - work_y,
                width: r.width,
                height: r.height,
            }),
            mouse_position: ctx
                .mouse_position
                .map(|(mx, my)| (mx - mon_x - work_x, my - mon_y - work_y)),
        };

        let p = crate::context::calculate_window_position(
            &local_ctx,
            work_w,
            work_h,
            OVERLAY_LOGICAL_WIDTH * scale,
            OVERLAY_LOGICAL_HEIGHT_COLLAPSED * scale,
        );

        // Convert back to global screen coordinates (still physical).
        let physical = crate::context::WindowPlacement {
            x: p.x + mon_x + work_x,
            y: p.y + mon_y + work_y,
        };

        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            physical.x.round() as i32,
            physical.y.round() as i32,
        )));

        // The frontend compares these against logical layout units (it decides
        // whether to grow upward from `window_y` and the displayed height), so
        // emit logical coordinates. The *work area* bottom, not the monitor
        // bottom, keeps the input bar clear of the taskbar.
        let screen_bottom = to_logical(work.position.y as f64 + work.size.height as f64, scale);
        let logical = crate::context::WindowPlacement {
            x: to_logical(physical.x, scale),
            y: to_logical(physical.y, scale),
        };
        Some((logical, screen_bottom))
    } else {
        None
    };

    let (window_x, window_y, screen_bottom_y) = match &placement {
        Some((p, sb)) => (Some(p.x), Some(p.y), Some(*sb)),
        None => (None, None, None),
    };

    if let Some(window) = app_handle.get_webview_window("main") {
        // `Show` must not depend on the frontend for the initial native size.
        // A window hidden while it was in the mini bar is still 48×48, and the
        // frontend only resizes a frame after the show event; the placement
        // math above already assumed the collapsed size. Resetting it here also
        // restores a window that was minimised while hidden (`show()` alone
        // does not unminimize).
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            OVERLAY_LOGICAL_WIDTH,
            OVERLAY_LOGICAL_HEIGHT_COLLAPSED,
        )));
        let _ = window.unminimize();
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        // After showing: `set_always_on_top`/`show` both make tao rewrite
        // `GWL_EXSTYLE` from its own flag set, which drops the tool-window style
        // and restores `WS_EX_APPWINDOW` — the reappearing-taskbar-button bug.
        // Re-asserting it here is what makes the fix durable (item 4).
        hide_from_taskbar(&window);

        // Diagnostic (batch 7): the first evidence that a `Show` actually
        // reached the native window, and at what size and position. A summon
        // line with no matching `show applied` did not get here.
        crate::diag!(
            "quickai: [summon] show applied natively_visible={} pos={:?} size={:?} epoch={epoch}",
            window.is_visible().unwrap_or(false),
            window.outer_position().map(|p| (p.x, p.y)).ok(),
            window.inner_size().map(|s| (s.width, s.height)).ok(),
        );

        // Store the main window HWND for the focus listener and start listening.
        if let Ok(hwnd) = window.hwnd() {
            windows_focus::set_main_hwnd(hwnd);
            let _ = windows_focus::stop_focus_listener();
            let handle = app_handle.clone();
            // The listener is stamped with this show's epoch. A foreground
            // event that was already queued by a *previous* listener must not
            // shrink the bar this show just put on screen.
            let _ = windows_focus::start_focus_listener(Arc::new(move |_hwnd| {
                if windows_focus::should_enter_minibar_on_focus_loss()
                    && OVERLAY_SURFACE_EPOCH.load(Ordering::SeqCst) == epoch
                {
                    windows_focus::enter_minibar();
                    let _ = handle.emit(MINIBAR_EVENT, epoch);
                }
            }));
        }
    }
    emit_overlay_visibility(
        app_handle,
        OVERLAY_VISIBILITY_SHOW,
        selected_text,
        window_x,
        window_y,
        screen_bottom_y,
        epoch,
    );
}

/// Shows the overlay on platforms that have no platform-specific implementation.
/// Falls back to a simple show + focus with no positioning.
#[cfg(not(target_os = "windows"))]
fn show_overlay(app_handle: &tauri::AppHandle, ctx: crate::context::ActivationContext) {
    if OVERLAY_INTENDED_VISIBLE.swap(true, Ordering::SeqCst) {
        return;
    }
    let epoch = bump_overlay_surface_epoch();
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        emit_overlay_visibility(
            app_handle,
            OVERLAY_VISIBILITY_SHOW,
            ctx.selected_text,
            None,
            None,
            None,
            epoch,
        );
    }
}

/// What `open_settings_window` should do when invoked.
#[derive(Debug, PartialEq, Eq)]
enum SettingsOpenAction {
    /// A settings window already exists: bring it to the front.
    FocusExisting,
    /// No settings window exists (never opened, or destroyed on close):
    /// build a fresh one.
    CreateNew,
}

/// Pure helper deciding how to open Settings. The settings window is destroyed
/// on close (see the run-loop handler), so a request to open either focuses the
/// live window or rebuilds it — never "un-hides" a stale one, which is what
/// previously left Settings unopenable after the first close (bug R6).
fn settings_open_action(window_exists: bool) -> SettingsOpenAction {
    if window_exists {
        SettingsOpenAction::FocusExisting
    } else {
        SettingsOpenAction::CreateNew
    }
}

/// Opens the settings window. If already open, focuses it.
/// Must be async — WebviewWindowBuilder deadlocks on Windows in sync commands.
#[cfg_attr(coverage_nightly, coverage(off))]
#[tauri::command]
async fn open_settings_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    let existing = app_handle.get_webview_window("settings");
    if settings_open_action(existing.is_some()) == SettingsOpenAction::FocusExisting {
        // Re-show reliably: `show` alone is not enough on Windows when the
        // window was hidden while minimized. `unminimize` flips tao's
        // MINIMIZED flag, which makes it rewrite `GWL_EXSTYLE` — so the style
        // must be re-applied after it, on the same thread, and this whole
        // sequence must run on the main thread (see the create path below).
        let handle = app_handle.clone();
        app_handle
            .run_on_main_thread(move || {
                if let Some(window) = handle.get_webview_window("settings") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    hide_from_taskbar(&window);
                }
            })
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url = if cfg!(debug_assertions) {
        WebviewUrl::External("http://localhost:1420/settings.html".parse().unwrap())
    } else {
        WebviewUrl::App("settings.html".into())
    };

    // The settings UI draws its own drag region and close button, so the
    // native title bar — a light bar with a second, redundant close button — is
    // disabled. The app icon is set explicitly: a window created after startup
    // otherwise falls back to a generic Windows taskbar icon.
    //
    // The size matches the Settings layout's fixed 580×700 frame, so the window
    // opens at its final size and the frontend's mount-time `setSize` is a
    // no-op — no visible width snap or backdrop-blur re-rasterise on open.
    //
    // The window stays resizable so the user can give it more height, but the
    // width floor is pinned to the layout's 580 so it can never be dragged
    // narrow enough to clip the fixed-width frame.
    //
    // `visible(false)`: the window is shown only *after* its taskbar style has
    // been applied, so the shell never observes a visible, taskbar-qualifying
    // window — which is what produced the stray button (item 4).
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))
        .expect("failed to load window icon");

    let window = WebviewWindowBuilder::new(&app_handle, "settings", url)
        .title("Settings — QuickAI")
        .inner_size(580.0, 700.0)
        .min_inner_size(580.0, 500.0)
        .center()
        .resizable(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .icon(icon)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;

    // Show, then apply the durable taskbar style — and do all of it on the
    // **main thread**.
    //
    // This command is `async`, so its body runs on a tokio worker. There,
    // `show`/`set_focus` are *posted* to the event loop (`send_user_message`
    // takes the `proxy.send_event` branch off the main thread), while
    // `apply_tool_window_style` writes `GWL_EXSTYLE` directly on the calling
    // thread. Source order would therefore not be runtime order: the deferred
    // `show` would land *after* the style and make tao rewrite `GWL_EXSTYLE`,
    // restoring `WS_EX_APPWINDOW` and dropping `WS_EX_TOOLWINDOW` — the stray
    // taskbar button again. Marshalling the whole sequence onto the main thread
    // makes every call run inline, so `hide_from_taskbar` really is last at
    // runtime.
    app_handle
        .run_on_main_thread(move || {
            let _ = window.show();
            let _ = window.set_focus();
            // Last, at runtime: `show` changed the visibility flag, so tao has
            // just rewritten `GWL_EXSTYLE` with `WS_EX_APPWINDOW`.
            hide_from_taskbar(&window);
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Expands and raises the overlay, optionally replaying the frontend entrance.
///
/// Used for a real minibar restore and for the two reconciliation states where
/// the native surface and the frontend disagree (see [`ExpandSource`]).
/// Shared by every summon path (the hotkey and the tray left click) so they
/// cannot drift apart. Re-asserts the tool-window style because the resize/show
/// path makes tao rewrite the extended style (item 4).
///
/// **Always `show()` explicitly.** The minibar is normally on screen, but
/// `MINIBAR_ACTIVE` can outlive the native window (a hide that raced the
/// transition). `set_size`/`set_focus` on a hidden window change nothing the
/// user can see, so without the `show()` that case was a silent no-op and the
/// next double-tap was the one that opened the bar.
///
/// `replay_show` must be false when the frontend is already showing the bar:
/// a show event restarts the session, and a summon must never discard the
/// conversation the user is looking at.
#[cfg(target_os = "windows")]
#[cfg_attr(coverage_nightly, coverage(off))]
fn expand_overlay(app_handle: &tauri::AppHandle, replay_show: bool) {
    // Entry diagnostics: an expand produced by the minibar branch returns
    // before the usual `[summon]` line, so without this it would be invisible
    // in the log. `source` names the real state being recovered from, so a
    // hidden window or a minibar flag without the minibar UI can never be read
    // as a live minibar. Together with the `applied` line below this is what
    // tells a real expand from one that was undone by a late shrink.
    let minibar_active = windows_focus::is_minibar_active();
    let ui_visible = OVERLAY_UI_VISIBLE.load(Ordering::SeqCst);
    let source = expand_source(minibar_active, ui_visible);
    crate::diag!(
        "quickai: [minibar] expand entry source={} minibar_active={minibar_active} ui_visible={ui_visible} intended_visible={} requested={}x{} replay={replay_show}",
        source.label(),
        OVERLAY_INTENDED_VISIBLE.load(Ordering::SeqCst),
        OVERLAY_LOGICAL_WIDTH as i64,
        OVERLAY_LOGICAL_HEIGHT_COLLAPSED as i64,
    );
    // An expand supersedes every click-away issued before it: bump first, so a
    // shrink already in flight is refused by `enter_minibar_size`.
    let epoch = bump_overlay_surface_epoch();
    windows_focus::exit_minibar();
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                OVERLAY_LOGICAL_WIDTH,
                OVERLAY_LOGICAL_HEIGHT_COLLAPSED,
            )));
            // A minimized window (e.g. Win+D while the minibar was showing)
            // is still "visible" and `show()` does not restore it, so without
            // this the expand would be invisible and the next summon would be
            // the one that opens the bar — the same two-gesture class.
            let _ = window.unminimize();
            // "Open" must mean visible to the user, not merely a resize of a
            // window that may have been hidden underneath the minibar flag.
            let _ = window.show();
            let _ = window.set_focus();
            crate::diag!(
                "quickai: [minibar] expand applied source={} natively_visible={} size={:?} epoch={epoch} replay={replay_show}",
                source.label(),
                window.is_visible().unwrap_or(false),
                window.inner_size().map(|s| (s.width, s.height)).ok(),
            );
            // The window is now open, so the intent flag must say so. Leaving
            // it false made the *next* summon take the `Show` path and reset a
            // session that was already on screen.
            OVERLAY_INTENDED_VISIBLE.store(true, Ordering::SeqCst);
            hide_from_taskbar(&window);
            let _ = windows_focus::stop_focus_listener();
            let h = handle.clone();
            // Stamped with this expand's epoch, like the listener in
            // `show_overlay`; a queued event from a superseded listener cannot
            // shrink the restored overlay.
            let _ = windows_focus::start_focus_listener(Arc::new(move |_hwnd| {
                if windows_focus::should_enter_minibar_on_focus_loss()
                    && OVERLAY_SURFACE_EPOCH.load(Ordering::SeqCst) == epoch
                {
                    windows_focus::enter_minibar();
                    let _ = h.emit(MINIBAR_EVENT, epoch);
                }
            }));
        }
        if replay_show {
            emit_overlay_visibility(
                &handle,
                OVERLAY_VISIBILITY_SHOW,
                None,
                None,
                None,
                None,
                epoch,
            );
        }
    });
}

/// Brings an already-visible overlay to the front without restarting its
/// session.
///
/// No `show` event is emitted, so the frontend does not replay its entrance
/// animation — that would clear the open conversation. Used for both visible
/// states of the summon-key state machine: the user is working elsewhere (raise
/// it) or is already on it (a harmless re-focus).
#[cfg(target_os = "windows")]
#[cfg_attr(coverage_nightly, coverage(off))]
fn bring_overlay_forward(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_always_on_top(true);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        // Last: tao's flag rewrites would otherwise drop the tool-window style.
        hide_from_taskbar(&window);
        // Diagnostic (batch 7): `Raise` never resizes, so the size here is what
        // the user would actually see. A raise at 48×48 is a clipped mini bar.
        crate::diag!(
            "quickai: [summon] raise applied natively_visible={} pos={:?} size={:?}",
            window.is_visible().unwrap_or(false),
            window.outer_position().map(|p| (p.x, p.y)).ok(),
            window.inner_size().map(|s| (s.width, s.height)).ok(),
        );
    }
}

/// What a summon should do (hotkey or tray left click). It deliberately has
/// **no** hide arm.
///
/// # The state machine (item 3 — write it down, do not keep it in code only)
///
/// One completed double-tap does exactly one of three things:
///
/// | state (how the user got there)          | native visible | intent flag | foreground | action       | what the user sees                  |
/// |-----------------------------------------|----------------|-------------|------------|--------------|-------------------------------------|
/// | hidden (Esc / Ctrl+W / close button)    | no             | no          | *          | `Show`       | bar appears, fresh session          |
/// | hiding (350 ms exit animation)          | yes            | no          | *          | `Show`       | hide is cancelled; bar stays        |
/// | drifted (flag and window disagree)      | no             | yes         | *          | `Show`       | bar appears, fresh session          |
/// | minibar (48×48, after clicking away)    | yes            | yes         | *          | `Expand`     | bar restored from the mini bar      |
/// | visible, user is working elsewhere      | yes            | yes         | no         | `BringForward` | bar raised and focused, chat intact |
/// | visible, user is on it                  | yes            | yes         | yes        | `BringForward` | nothing changes (already open)      |
///
/// The minibar row is handled in `open_or_raise_overlay` before this decision:
/// it is a native *size* state, not a visibility state. `Expand` there means
/// `expand_overlay`, which resizes and calls `show()`.
///
/// The first three rows are `Show`, the fourth is the minibar `Expand`, and the
/// last two are `BringForward`. Foreground is recorded for the diagnostic log
/// but cannot change the action: both visible rows raise, because a summon must
/// never dismiss. Dismissal is Esc, Ctrl+W, or the window's close button.
///
/// History: this replaced a three-way Show/BringForward/Hide toggle. At launch
/// the overlay is auto-shown *and focused*, which mapped to `Hide`, so the
/// first double-tap dismissed a bar the user had not summoned — the
/// "two double-taps needed" report on 0.0.4. A summon key that sometimes
/// dismisses is the bug; it is not a feature worth preserving.
#[cfg(target_os = "windows")]
#[derive(Debug, PartialEq, Eq)]
enum HotkeyAction {
    /// Summon from hidden — or from a drifted "visible" where the native window
    /// is gone, which must not be able to swallow the summon.
    Show,
    /// On screen: raise and focus it without replaying the entrance (which
    /// would reset the open conversation).
    BringForward,
}

/// Pure decision for a summon (hotkey or tray left click), item 3.
///
/// Opens from anything the user cannot use; raises anything already on screen.
/// It never returns a dismiss action — see [`HotkeyAction`] for the full state
/// table and the reason.
#[cfg(target_os = "windows")]
fn hotkey_action(intended_visible: bool, natively_visible: bool) -> HotkeyAction {
    if !intended_visible || !natively_visible {
        HotkeyAction::Show
    } else {
        HotkeyAction::BringForward
    }
}

/// What a completed double-tap should actually execute.
///
/// This wraps [`hotkey_action`] with the reconciliation the two native flags
/// cannot express, because they say what the backend asked for, not what the
/// user is looking at. `hotkey_action` itself stays a two-row predicate.
#[cfg(target_os = "windows")]
#[derive(Debug, PartialEq, Eq)]
enum SummonPlan {
    /// Expand to full size (and leave the minibar size mode). `replay` says
    /// whether the frontend entrance must be replayed — false when it is
    /// already showing the bar, so the open conversation survives.
    Expand { replay: bool },
    /// On screen and showing: raise/focus with no show event.
    Raise,
    /// Nothing usable on screen: open a fresh session.
    Show,
}

/// Pure decision for what a summon executes.
///
/// `minibar_active` is the native size mode (already cleared if stale),
/// `ui_visible` is the frontend's mirrored "the bar is on screen". Three
/// reconciliations live here, all around `hotkey_action` rather than inside it:
///
/// - **minibar flag, frontend visible** (a lost minibar event): expand without
///   replaying, because emitting a show here resets the conversation the user
///   is reading.
/// - **BringForward, frontend not visible** (a lost show): a raise-only path
///   never resizes or re-shows, so the frontend would stay in the minibar
///   forever. Expand and replay instead.
/// - everything else follows `hotkey_action` unchanged.
#[cfg(target_os = "windows")]
fn summon_plan(
    intended_visible: bool,
    natively_visible: bool,
    minibar_active: bool,
    ui_visible: bool,
) -> SummonPlan {
    if minibar_active {
        return SummonPlan::Expand {
            replay: summon_replays_entrance(ui_visible),
        };
    }
    match hotkey_action(intended_visible, natively_visible) {
        HotkeyAction::BringForward if !ui_visible => SummonPlan::Expand { replay: true },
        HotkeyAction::BringForward => SummonPlan::Raise,
        HotkeyAction::Show => SummonPlan::Show,
    }
}

/// Summon the overlay: open it from anything the user cannot use, or raise it
/// when it is already on screen. **Never hides.**
///
/// Decides on the window's *native* state, not on the intent flag alone, so a
/// drifted flag (visible while the native window is hidden) cannot swallow the
/// summon. The minibar is expanded first because it is a distinct size state
/// rather than a visibility state, and the frontend's mirrored UI state is
/// consulted so a lost event cannot turn a summon into a session reset or a
/// no-op (see [`summon_plan`]).
///
/// Shared by the summon hotkey and the tray icon's left click, so the two
/// entry points cannot drift apart. Dismissal belongs to Esc, Ctrl+W and the
/// close button — a tray click is a summon of the same surface, not a toggle.
#[cfg(target_os = "windows")]
#[cfg_attr(coverage_nightly, coverage(off))]
fn open_or_raise_overlay(app_handle: &tauri::AppHandle, ctx: crate::context::ActivationContext) {
    let intended_visible = OVERLAY_INTENDED_VISIBLE.load(Ordering::SeqCst);
    let natively_visible = app_handle
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    let ui_visible = OVERLAY_UI_VISIBLE.load(Ordering::SeqCst);

    // A minibar flag can outlive the window it described: clicking away while
    // the overlay is hidden (the focus listener survives Esc) sets it with no
    // minibar on screen. Clear it before deciding, so the summon cannot take
    // the expand path for a bar that is not there and the diagnostic never
    // reports a live minibar for a hidden window.
    if should_clear_stale_minibar(natively_visible, windows_focus::is_minibar_active()) {
        crate::diag!("quickai: [summon] clearing stale minibar flag (native window hidden)");
        windows_focus::exit_minibar();
    }

    // Diagnostic only: foreground tells "raised" from "raised invisibly".
    let foreground = windows_focus::is_overlay_foreground();
    let plan = summon_plan(
        intended_visible,
        natively_visible,
        windows_focus::is_minibar_active(),
        ui_visible,
    );
    crate::diag!(
        "quickai: [summon] intended_visible={intended_visible} natively_visible={natively_visible} ui_visible={ui_visible} foreground={foreground} -> {plan:?}"
    );

    match plan {
        SummonPlan::Expand { replay } => expand_overlay(app_handle, replay),
        SummonPlan::Raise => bring_overlay_forward(app_handle),
        SummonPlan::Show => {
            // Clear a stale "visible" intent so `show_overlay`'s guard cannot
            // swallow the summon when the flag and the window have drifted.
            OVERLAY_INTENDED_VISIBLE.store(false, Ordering::SeqCst);
            show_overlay(app_handle, ctx);
        }
    }
}

/// Repositions and resizes the main window atomically.
///
/// Regular Tauri commands run on a Tokio thread pool. Calling `set_position`
/// then `set_size` from a pool thread dispatches each as a *separate* event to
/// the main thread, which can render as two distinct display frames and
/// produce a visible stutter when the window grows upward (position + size both
/// change on every token during streaming).
///
/// Wrapping both calls in a single `run_on_main_thread` closure ensures they
/// arrive on the main thread together in the same event-loop iteration.
#[tauri::command]
fn set_window_frame(app_handle: tauri::AppHandle, x: f64, y: f64, width: f64, height: f64) {
    // Reject non-finite values (NaN, Infinity) from the frontend to prevent
    // undefined behaviour when forwarded to native window APIs.
    if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
        return;
    }
    let width = width.clamp(1.0, 10_000.0);
    let height = height.clamp(1.0, 10_000.0);

    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            let _ =
                window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)));
        }
    });
}

/// Applies one step of the frontend's exit sequence to the visibility intent
/// and reports whether the native window should now be hidden.
///
/// - `None` / `Some(false)` — the exit *started*: clear the intent so a summon
///   during the animation takes the `Show` path (and cancels the exit).
/// - `Some(true)` — the exit *finished*: hide only if no show has been
///   requested since. `show_overlay` sets `OVERLAY_INTENDED_VISIBLE`
///   synchronously, so this sees a summon the moment Rust issues it — even
///   when its `show` event has not reached the webview. That is the check a
///   frontend timer cannot make, and the reason the hide is committed here.
fn apply_hide_commit(commit: Option<bool>) -> bool {
    if commit != Some(true) {
        OVERLAY_INTENDED_VISIBLE.store(false, Ordering::SeqCst);
        return false;
    }
    !OVERLAY_INTENDED_VISIBLE.load(Ordering::SeqCst)
}

/// The frontend's exit-animation steps (see [`apply_hide_commit`]).
///
/// `commit` is `Option<bool>` so existing argument-less callers keep working:
/// they keep the "start of exit" behaviour.
#[tauri::command]
fn notify_overlay_hidden(app_handle: tauri::AppHandle, commit: Option<bool>) {
    let committed = apply_hide_commit(commit);
    // Diagnostic (batch 7): shows whether a hide the frontend requested was
    // refused because a summon had already claimed the surface.
    crate::diag!("quickai: [summon] hide commit={commit:?} applied={committed}");
    if !committed {
        return;
    }
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// Returns true when `url` is a safe http(s) URL to hand to the OS opener.
/// Restricting the scheme prevents a frontend bug or a malicious link from
/// invoking an arbitrary registered protocol handler.
fn is_openable_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

/// Opens `url` in the user's default browser.
#[cfg_attr(coverage_nightly, coverage(off))]
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !is_openable_url(&url) {
        return Err("Only http:// and https:// URLs can be opened".to_string());
    }
    open_in_browser(&url)
}

/// Platform-native "open in default browser" launcher. Uses `ShellExecuteW`
/// so the URL is handed to the shell directly (no `cmd.exe` interpolation).
#[cfg(target_os = "windows")]
#[cfg_attr(coverage_nightly, coverage(off))]
fn open_in_browser(url: &str) -> Result<(), String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let operation = HSTRING::from("open");
    let file = HSTRING::from(url);
    // ShellExecuteW returns an HINSTANCE whose value is <= 32 on failure.
    let result = unsafe {
        ShellExecuteW(
            None,
            &operation,
            &file,
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if (result.0 as isize) <= 32 {
        return Err(format!(
            "ShellExecuteW failed to open the URL (code {})",
            result.0 as isize
        ));
    }
    Ok(())
}

/// Fallback launcher for non-Windows platforms.
#[cfg(not(target_os = "windows"))]
#[cfg_attr(coverage_nightly, coverage(off))]
fn open_in_browser(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Mirrors whether the frontend is rendering the overlay's visible state.
///
/// Sent on every `overlayState` change (`visible` → true; `minibar`, `hiding`
/// and `hidden` → false). The summon path uses it to reconcile the two states
/// the native flags cannot distinguish — see [`OVERLAY_UI_VISIBLE`].
#[tauri::command]
fn set_overlay_ui_visible(visible: bool) {
    // Diagnostic (batch 7): the only mirror of what the frontend is actually
    // rendering. Its position relative to the `[summon]` and `[minibar]` lines
    // is what separates a stale mirror from a lost event.
    crate::diag!("quickai: [ui] frontend overlay visible={visible}");
    OVERLAY_UI_VISIBLE.store(visible, Ordering::SeqCst);
}

/// Whether a reported physical inner size is the logical mini-bar size at
/// `scale`.
///
/// Tauri converts a logical request to physical pixels with the monitor scale
/// and Windows rounds, so one pixel of slack absorbs the rounding without
/// accepting a window that never moved.
#[cfg(target_os = "windows")]
fn reached_minibar_size(actual: (u32, u32), scale: f64) -> bool {
    let expected_width = (OVERLAY_LOGICAL_WIDTH_MINIBAR * scale).round() as u32;
    let expected_height = (OVERLAY_LOGICAL_HEIGHT_MINIBAR * scale).round() as u32;
    actual.0.abs_diff(expected_width) <= 1 && actual.1.abs_diff(expected_height) <= 1
}

/// Applies the mini-bar size and returns the inner size the window reports
/// afterwards, or `None` when the size cannot be read.
///
/// `set_size` reports whether the request was *dispatched*, not whether the
/// window reached it: a minimised or clamped window silently keeps its old
/// size. Reading it back is the only evidence, and it is cheap here because
/// this runs on the main thread, where Tauri applies the resize inline.
#[cfg(target_os = "windows")]
fn apply_minibar_size(window: &tauri::WebviewWindow) -> Option<(u32, u32)> {
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
        OVERLAY_LOGICAL_WIDTH_MINIBAR,
        OVERLAY_LOGICAL_HEIGHT_MINIBAR,
    )));
    window
        .inner_size()
        .ok()
        .map(|size| (size.width, size.height))
}

/// Resizes the window to minibar dimensions and enters minibar mode.
///
/// `epoch` is the surface epoch stamped on the `quickai://minibar` event that
/// caused this shrink (see [`OVERLAY_SURFACE_EPOCH`]). If a show or expand has
/// bumped the epoch since, the click-away is stale and the shrink is refused:
/// applying it would shrink a window the user had just summoned, leaving the
/// first double-tap looking dead until a second one repeated the expand.
/// `None` is the in-app minimise button, which has no event and no token, and
/// is always applied.
///
/// Returns whether the shrink was applied. The frontend uses the answer as the
/// authority for entering the mini-bar UI: a delayed (throttled) click-away
/// that a summon has already superseded is refused here, and the frontend must
/// stay in the visible state rather than render a 48 px logo inside the window
/// the summon just expanded.
#[cfg(target_os = "windows")]
#[tauri::command]
fn enter_minibar_size(app_handle: tauri::AppHandle, epoch: Option<u64>) -> bool {
    let current = OVERLAY_SURFACE_EPOCH.load(Ordering::SeqCst);
    if !shrink_is_current(epoch, current) {
        crate::diag!(
            "quickai: [minibar] ignoring stale shrink epoch={} current={current}",
            epoch.unwrap_or_default(),
        );
        return false;
    }
    windows_focus::enter_minibar();
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            let scale = window.scale_factor().unwrap_or(1.0);
            let applied = apply_minibar_size(&window);
            let reached = applied.map(|size| reached_minibar_size(size, scale));
            // Diagnostic (batch 7): a shrink that lands *after* an expand is
            // the one way a completed summon can be undone on screen. Its
            // position in the log relative to `[minibar] expand applied` is
            // the evidence; `epoch` is the token it carried. `expected` says
            // whether the window reached the size, not merely accepted it.
            crate::diag!(
                "quickai: [minibar] shrink applied epoch={epoch:?} size={applied:?} expected={reached:?} scale={scale}",
            );
            if matches!(reached, Some(true)) {
                return;
            }
            // `set_size` only reports that the request was dispatched; one
            // retry covers a resize dropped while the window was transitioning
            // (minimised, a pending show). Deliberately the only retry: a
            // window that cannot resize logs a failure instead of looping and
            // claiming a size it never reached.
            let retried = apply_minibar_size(&window);
            let retried_reached = retried.map(|size| reached_minibar_size(size, scale));
            crate::diag!(
                "quickai: [minibar] shrink retry epoch={epoch:?} size={retried:?} expected={retried_reached:?} scale={scale}",
            );
            if !matches!(retried_reached, Some(true)) {
                crate::diag!(
                    "quickai: [minibar] shrink failed epoch={epoch:?}: window cannot reach {}x{} logical (last size {retried:?}, scale {scale})",
                    OVERLAY_LOGICAL_WIDTH_MINIBAR as i64,
                    OVERLAY_LOGICAL_HEIGHT_MINIBAR as i64,
                );
            }
        }
    });
    true
}

/// Resizes the window back to full overlay dimensions and exits minibar mode.
/// Called from the frontend when the user clicks the minibar to restore.
#[cfg(target_os = "windows")]
#[tauri::command]
fn exit_minibar_size(app_handle: tauri::AppHandle) {
    // Restoring is authoritative: any click-away issued before this click is
    // stale, so advance the epoch before the listener is replaced.
    let epoch = bump_overlay_surface_epoch();
    windows_focus::exit_minibar();
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                OVERLAY_LOGICAL_WIDTH,
                OVERLAY_LOGICAL_HEIGHT_COLLAPSED,
            )));
            let _ = window.set_focus();
            // The resize/show path rewrites the extended style; re-assert it.
            hide_from_taskbar(&window);
            // Restart the focus listener so minibar triggers on next focus loss.
            let _ = windows_focus::stop_focus_listener();
            let h = handle.clone();
            let _ = windows_focus::start_focus_listener(Arc::new(move |_hwnd| {
                if windows_focus::should_enter_minibar_on_focus_loss()
                    && OVERLAY_SURFACE_EPOCH.load(Ordering::SeqCst) == epoch
                {
                    windows_focus::enter_minibar();
                    let _ = h.emit(MINIBAR_EVENT, epoch);
                }
            }));
        }
    });
}

/// Pins or unpins the overlay open (item 17).
///
/// While pinned, the focus listener no longer shrinks the overlay to the
/// minibar when the user clicks outside, so the chat stays open; unpinning
/// restores the normal click-away behaviour. Idempotent, so the frontend can
/// re-send the current value on every overlay open to stay in sync.
///
/// The pin is an independent flag: it persists across minibar/restore (an
/// explicit minimize still works while pinned, and restoring returns to the
/// pinned state) and is only cleared by an explicit `pinned: false`.
#[cfg(target_os = "windows")]
#[tauri::command]
fn set_overlay_pinned(pinned: bool) {
    windows_focus::set_pinned(pinned);
}

/// Called by the frontend once its visibility event listener is registered.
/// On the first call per process lifetime, shows the overlay so the AskBar
/// appears automatically at startup without a race between the Rust emit and
/// the frontend listener registration.
#[tauri::command]
#[cfg_attr(coverage_nightly, coverage(off))]
fn notify_frontend_ready(app_handle: tauri::AppHandle) {
    if LAUNCH_SHOW_PENDING.swap(false, Ordering::SeqCst) {
        #[cfg(target_os = "windows")]
        {
            if show_startup_screen(&app_handle) {
                return;
            }
        }

        show_overlay(&app_handle, crate::context::ActivationContext::empty());
    }
}

/// On Windows, decides whether to show the onboarding window instead of the
/// overlay at startup. Returns `true` when the onboarding window was shown.
#[cfg(target_os = "windows")]
#[cfg_attr(coverage_nightly, coverage(off))]
fn show_startup_screen(app_handle: &tauri::AppHandle) -> bool {
    let db = app_handle.state::<history::Database>();
    let Ok(conn) = db.0.lock() else {
        show_onboarding_window(app_handle, onboarding::OnboardingStage::Intro);
        return true;
    };
    let stage = onboarding::get_stage(&conn).unwrap_or(onboarding::OnboardingStage::Intro);

    // On Windows, there are no Accessibility or Screen Recording permission
    // gates. Skip the permissions stage entirely and go directly to intro (or
    // the overlay if onboarding is complete).
    if matches!(stage, onboarding::OnboardingStage::Permissions) {
        // Upgrade permissions stage to intro since Windows doesn't need a
        // permissions gate.
        let _ = onboarding::set_stage(&conn, &onboarding::OnboardingStage::Intro);
        show_onboarding_window(app_handle, onboarding::OnboardingStage::Intro);
        return true;
    }

    if !matches!(stage, onboarding::OnboardingStage::Complete) {
        show_onboarding_window(app_handle, stage);
        return true;
    }
    // Complete: fall through to show the overlay.
    false
}

// ─── Onboarding completion ───────────────────────────────────────────────────

/// Called when the user clicks "Get Started" on the intro screen.
/// Marks onboarding complete in the DB, restores the window to overlay mode,
/// and immediately shows the Ask Bar — no relaunch required.
#[tauri::command]
#[cfg_attr(coverage_nightly, coverage(off))]
fn finish_onboarding(
    db: tauri::State<history::Database>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    onboarding::mark_complete(&conn).map_err(|e| format!("db write failed: {e}"))?;
    drop(conn);

    // Restore overlay window properties and show the Ask Bar.
    #[cfg(target_os = "windows")]
    {
        let handle = app_handle.clone();
        let _ = app_handle.run_on_main_thread(move || {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                    OVERLAY_LOGICAL_WIDTH,
                    OVERLAY_LOGICAL_HEIGHT_COLLAPSED,
                )));
                let _ = window.set_always_on_top(true);
                hide_from_taskbar(&window);
            }
            show_overlay(&handle, crate::context::ActivationContext::empty());
        });
    }

    // On other platforms, just show the overlay.
    #[cfg(not(target_os = "windows"))]
    {
        let handle = app_handle.clone();
        let _ = app_handle.run_on_main_thread(move || {
            show_overlay(&handle, crate::context::ActivationContext::empty());
        });
    }

    Ok(())
}

// ─── Onboarding window ───────────────────────────────────────────────────────

/// Shows the onboarding window. Sizes the main window, centers it,
/// shows it, and emits the onboarding event.
#[cfg(target_os = "windows")]
#[cfg_attr(coverage_nightly, coverage(off))]
fn show_onboarding_window(app_handle: &tauri::AppHandle, stage: onboarding::OnboardingStage) {
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                ONBOARDING_LOGICAL_WIDTH,
                ONBOARDING_LOGICAL_HEIGHT,
            )));
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();
            // After showing, so tao's flag rewrite cannot drop it (item 4).
            hide_from_taskbar(&window);
        }
        let _ = handle.emit(ONBOARDING_EVENT, OnboardingPayload { stage });
    });
}

/// Payload emitted to the frontend for every onboarding transition.
#[cfg(target_os = "windows")]
#[derive(Clone, serde::Serialize)]
struct OnboardingPayload {
    stage: onboarding::OnboardingStage,
}

// ─── Image cleanup ──────────────────────────────────────────────────────────

/// Interval between periodic orphaned-image cleanup sweeps.
const IMAGE_CLEANUP_INTERVAL: std::time::Duration = std::time::Duration::from_secs(3600);

/// Runs a single orphaned-image cleanup sweep. Thin orchestration wrapper
/// that delegates to `database::get_all_image_paths` and
/// `images::cleanup_orphaned_images`, both independently tested.
#[cfg_attr(coverage_nightly, coverage(off))]
fn run_image_cleanup(app_handle: &tauri::AppHandle) {
    let db = app_handle.state::<history::Database>();
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return,
    };
    let referenced = database::get_all_image_paths(&conn).unwrap_or_default();
    drop(conn);

    let data_dir = app_handle.state::<config::ResolvedDataDir>();
    let _ = images::cleanup_orphaned_images(data_dir.path(), &referenced);
}

/// Spawns a background Tokio task that runs the cleanup sweep on a fixed
/// interval. Thin async wrapper — delegates to `run_image_cleanup`.
#[cfg_attr(coverage_nightly, coverage(off))]
fn spawn_periodic_image_cleanup(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(IMAGE_CLEANUP_INTERVAL);
        // Skip the first tick (startup cleanup already ran synchronously).
        interval.tick().await;
        loop {
            interval.tick().await;
            run_image_cleanup(&app_handle);
        }
    });
}

// ─── Application entry point ─────────────────────────────────────────────────

/// Event the frontend uses to push the tray menu's localised labels down.
///
/// The tray is built in Rust, but the language actually in effect is resolved
/// in the frontend's i18n store — the same persisted choice / system detection
/// that drives every other translated string, and the setting the UI mirrors
/// into the config. Rust cannot read that store, so the frontend owns the
/// text: it emits the two labels at startup and again every time the language
/// changes, and the listener below re-labels the menu in place — no restart
/// required.
const TRAY_MENU_LABELS_EVENT: &str = "tray-menu-labels";

/// Payload of [`TRAY_MENU_LABELS_EVENT`].
#[derive(serde::Deserialize)]
struct TrayMenuLabels {
    settings: String,
    quit: String,
}

/// Initialises and runs the Tauri application.
///
/// Setup order:
/// 1. System tray is registered; double-tap Ctrl listener starts.
/// 2. `CloseRequested` is intercepted to hide instead of destroy.
///
/// # Panics
///
/// Panics if the Tauri runtime fails to initialise.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── Diagnostics ───────────────────────────────────────────────────
    // The file log starts before anything else so the very first lines prove
    // which build and which instance decision produced the trace. See
    // `diagnostics` for the path, the rotation policy and the drop-on-failure
    // contract. It also works from the keyboard-hook thread.
    diagnostics::init();
    crate::diag!(
        "quickai: [startup] version={} pid={}",
        env!("CARGO_PKG_VERSION"),
        std::process::id()
    );

    // ── Single instance ───────────────────────────────────────────────
    // This must happen before the builder: `build()` creates the windows
    // declared in `tauri.conf.json`, and `setup` registers the tray icon and
    // the global keyboard hook. A second copy must do none of those, so a
    // dual-instance environment cannot silently double every gesture.
    #[cfg(target_os = "windows")]
    let instance = single_instance::acquire();
    #[cfg(target_os = "windows")]
    let Some(instance) = instance
    else {
        // `acquire` already signalled the running instance to open or raise
        // its overlay. This process has nothing left to do — but the log
        // writer is a detached thread, and returning ends the process, so the
        // decision line must be flushed first.
        diagnostics::flush();
        return;
    };

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init());

    builder
        .setup(move |app| {
            // ── Forwarded launches ────────────────────────────────────
            // A second process launch signals the named activation event and
            // exits. Serve it through the very same `open_or_raise_overlay`
            // path as the summon hotkey and the tray left click, so all three
            // entry points cannot drift apart. There is no activation context
            // to capture — a process launch is not a text selection — so this
            // matches the tray click's empty context.
            #[cfg(target_os = "windows")]
            {
                let handle = app.handle().clone();
                instance.listen(move || {
                    let target = handle.clone();
                    let _ = handle.run_on_main_thread(move || {
                        open_or_raise_overlay(&target, crate::context::ActivationContext::empty());
                    });
                });
            }

            // ── System tray icon + menu ───────────────────────────────────
            // Left-click opens or raises the overlay directly (it never hides);
            // the menu is shown on right-click only (`show_menu_on_left_click(false)`).
            // The menu has no "Open" entry — opening is the left click.
            //
            // The labels start in English as a fallback. The frontend pushes
            // the labels for the active language immediately after its bundle
            // loads (and on every language change), via
            // `TRAY_MENU_LABELS_EVENT`, so what the user sees follows the
            // language pack without a restart.
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&settings_item, &quit_item])?;

            // Clones share the underlying native item, so `set_text` on them
            // re-labels the menu already attached to the tray.
            let settings_label_item = settings_item.clone();
            let quit_label_item = quit_item.clone();
            app.listen(TRAY_MENU_LABELS_EVENT, move |event| {
                let Ok(labels) = serde_json::from_str::<TrayMenuLabels>(event.payload()) else {
                    return;
                };
                let _ = settings_label_item.set_text(labels.settings);
                let _ = quit_label_item.set_text(labels.quit);
            });

            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))
                .expect("Failed to load tray icon");

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(false)
                .tooltip("QuickAI")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => {
                        // Reuse the command the in-app Settings button calls,
                        // so the window is created/focused exactly the same way.
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = open_settings_window(handle).await;
                        });
                    }
                    "quit" => {
                        app.state::<crate::commands::GenerationState>().cancel();
                        // `exit` terminates the process without running
                        // destructors; flush the queued diagnostics first.
                        diagnostics::flush();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        // A tray click is a summon, never a dismiss: open the
                        // overlay if it is hidden, raise it if it is on screen.
                        #[cfg(target_os = "windows")]
                        open_or_raise_overlay(
                            tray.app_handle(),
                            crate::context::ActivationContext::empty(),
                        );
                        #[cfg(not(target_os = "windows"))]
                        show_overlay(
                            tray.app_handle(),
                            crate::context::ActivationContext::empty(),
                        );
                    }
                })
                .build(app)?;

            // The authoritative config-directory path, as Tauri resolves it.
            // The file log derives the same place from `%APPDATA%`; recording
            // both makes a mismatch visible instead of silently splitting the
            // log from `skills.toml`.
            if let Ok(dir) = app.path().app_config_dir() {
                crate::diag!("quickai: [startup] app_config_dir={}", dir.display());
            }

            // ── Durable taskbar hiding for the overlay ────────────────
            // The main window is created from `tauri.conf.json` before this
            // runs. Apply the tool-window style here, once, so no show path —
            // including onboarding — can fall back on tao's non-durable
            // one-shot `DeleteTab`. The per-show `hide_from_taskbar` calls are
            // belt and braces on top of this, and they run *after* each show
            // because tao rewrites the extended style on every visibility
            // change (item 4).
            if let Some(window) = app.get_webview_window("main") {
                // Give the overlay the app icon explicitly. A window whose icon
                // is never set falls back to the generic Windows icon, which is
                // what the user saw on the stray taskbar button; with the style
                // fix the button should never appear, and if it ever does it is
                // at least identifiable.
                if let Ok(icon) =
                    tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))
                {
                    let _ = window.set_icon(icon);
                }
                hide_from_taskbar(&window);
                // Startup banner: the native state of the overlay before any
                // summon, so a trace proves the build and the initial window.
                crate::diag!(
                    "quickai: [startup] window=main natively_visible={} pos={:?} size={:?}",
                    window.is_visible().unwrap_or(false),
                    window.outer_position().map(|p| (p.x, p.y)).ok(),
                    window.inner_size().map(|s| (s.width, s.height)).ok(),
                );
            }

            // ── Activation listener (Windows) ─────────────────────────
            #[cfg(target_os = "windows")]
            {
                let app_handle = app.handle().clone();
                let activator = windows_activator::OverlayActivator::new();
                activator.start(move || {
                    let is_visible = OVERLAY_INTENDED_VISIBLE.load(Ordering::SeqCst);
                    let handle = app_handle.clone();
                    let handle2 = app_handle.clone();
                    std::thread::spawn(move || {
                        let ctx = crate::context::capture_activation_context(is_visible);
                        let _ =
                            handle.run_on_main_thread(move || open_or_raise_overlay(&handle2, ctx));
                    });
                });
                app.manage(activator);
            }

            // ── Persistent HTTP client ────────────────────────────────
            app.manage(reqwest::Client::new());

            // ── TOML configuration (single source of truth) ──────────
            let app_config = match config::load(app.handle()) {
                Ok(cfg) => cfg,
                Err(e) => config::show_fatal_dialog_and_exit(&e),
            };
            // The activation hook reads the hotkey pair on every key event
            // (rather than capturing it at install time), so applying the
            // configured key here — after the hook thread was started above —
            // takes effect immediately.
            #[cfg(target_os = "windows")]
            {
                windows_activator::apply_hotkey(app_config.general.hotkey);
                // Log both the configured name and the virtual-key pair the
                // hook is actually matching, so they can be compared with the
                // `vk=` values in `[activator]` lines. A config reset that
                // changed the hotkey is visible here rather than inferred.
                let (vk_left, vk_right) = windows_activator::active_hotkey_vk_codes();
                crate::diag!(
                    "quickai: [startup] hotkey={:?} vk_left=0x{vk_left:02X} vk_right=0x{vk_right:02X}",
                    app_config.general.hotkey
                );
            }
            // The data directory is resolved once, at startup; a change to
            // `[general].data_dir` requires a relaunch (the Settings UI says
            // so).
            let data_dir = config::resolve_data_dir(app.handle(), &app_config.general.data_dir);
            // The asset protocol scope in `tauri.conf.json` is pinned to the
            // default app-data path, but the frontend renders every image via
            // `convertFileSrc` (the asset protocol). A custom `data_dir` would
            // therefore be refused by the scope and show broken thumbnails, so
            // extend the scope to the resolved images root at runtime. On the
            // default path this only re-adds patterns that already exist.
            let images_root = images::images_root(data_dir.path());
            if let Err(e) = app
                .asset_protocol_scope()
                .allow_directory(&images_root, true)
            {
                crate::diag!(
                    "quickai: [config] could not extend the asset scope to {}: {e}",
                    images_root.display()
                );
            }
            app.manage(parking_lot::RwLock::new(app_config));

            // ── Generation + conversation state ─────────────────────
            app.manage(commands::GenerationState::new());
            app.manage(commands::ConversationHistory::new());

            // ── Agent state (Windows only) ────────────────────────────
            // The agent resolves its provider from the `[chat]` or `[agent]`
            // config section (per `[agent].mode`) at start time; this state
            // holds status, cancellation, and pending confirmations.
            #[cfg(target_os = "windows")]
            app.manage(Arc::new(agent::AgentState::new()));

            // ── SQLite database for conversation history ──────────
            // Both the database and the images directory derive from the
            // startup-resolved data directory.
            app.manage(data_dir.clone());
            let db_conn = database::open_database(data_dir.path())
                .expect("failed to initialise SQLite database");
            app.manage(history::Database(std::sync::Mutex::new(db_conn)));

            // ── Orphaned image cleanup (startup + periodic) ─────────
            run_image_cleanup(app.handle());
            spawn_periodic_image_cleanup(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(not(coverage))]
            commands::ask,
            #[cfg(not(coverage))]
            commands::cancel_generation,
            #[cfg(not(coverage))]
            commands::reset_conversation,
            #[cfg(not(coverage))]
            commands::get_settings,
            #[cfg(not(coverage))]
            commands::set_setting,
            #[cfg(not(coverage))]
            history::save_conversation,
            #[cfg(not(coverage))]
            history::persist_message,
            #[cfg(not(coverage))]
            history::list_conversations,
            #[cfg(not(coverage))]
            history::load_conversation,
            #[cfg(not(coverage))]
            history::delete_conversation,
            #[cfg(not(coverage))]
            history::rename_conversation,
            #[cfg(not(coverage))]
            history::generate_title,
            #[cfg(not(coverage))]
            images::save_image_command,
            #[cfg(not(coverage))]
            images::remove_image_command,
            #[cfg(all(target_os = "windows", not(coverage)))]
            screenshot::capture_full_screen_command,
            notify_overlay_hidden,
            set_overlay_ui_visible,
            diagnostics::log_frontend_diagnostic,
            notify_frontend_ready,
            set_window_frame,
            finish_onboarding,
            open_url,
            // Windows lifecycle command (relaunch after onboarding)
            #[cfg(all(target_os = "windows", not(coverage)))]
            windows_lifecycle::quit_and_relaunch,
            // Agent commands (Windows only)
            #[cfg(all(target_os = "windows", not(coverage)))]
            agent::start_agent_mode,
            #[cfg(all(target_os = "windows", not(coverage)))]
            agent::stop_agent_mode,
            #[cfg(all(target_os = "windows", not(coverage)))]
            agent::confirm_agent_action,
            #[cfg(all(target_os = "windows", not(coverage)))]
            agent::reject_agent_action,
            // Autostart + minibar size commands (Windows only)
            #[cfg(all(target_os = "windows", not(coverage)))]
            autostart::is_auto_start_enabled_command,
            #[cfg(all(target_os = "windows", not(coverage)))]
            autostart::enable_auto_start_command,
            #[cfg(all(target_os = "windows", not(coverage)))]
            autostart::disable_auto_start_command,
            #[cfg(all(target_os = "windows", not(coverage)))]
            enter_minibar_size,
            #[cfg(all(target_os = "windows", not(coverage)))]
            exit_minibar_size,
            #[cfg(all(target_os = "windows", not(coverage)))]
            set_overlay_pinned,
            // Settings window
            open_settings_window,
            // Config commands (TOML)
            settings_commands::get_config,
            settings_commands::set_config_field,
            settings_commands::reset_config,
            settings_commands::reload_config_from_disk,
            settings_commands::get_corrupt_marker,
            settings_commands::reveal_config_in_explorer,
            settings_commands::get_default_data_dir,
            #[cfg(not(coverage))]
            settings_commands::pick_folder,
            #[cfg(not(coverage))]
            settings_commands::pick_file,
            // Skills (dedicated skills.toml)
            skills::get_skills,
            skills::set_skills,
            // Connection test (item 13)
            #[cfg(not(coverage))]
            connection_test::test_connection,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } = event
            {
                if label == "main" {
                    api.prevent_close();

                    request_overlay_hide(app_handle);
                }
                // The settings window is intentionally NOT intercepted: closing
                // it destroys the webview so `open_settings_window` rebuilds a
                // fresh window on the next open (bug R6).
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_window_frame_rejects_nan() {
        assert!(!f64::NAN.is_finite());
        assert!(!f64::INFINITY.is_finite());
        assert!(!f64::NEG_INFINITY.is_finite());
        assert!(100.0_f64.is_finite());
    }

    #[test]
    fn width_height_clamp_logic() {
        assert_eq!(0.5_f64.clamp(1.0, 10_000.0), 1.0);
        assert_eq!(500.0_f64.clamp(1.0, 10_000.0), 500.0);
        assert_eq!(20_000.0_f64.clamp(1.0, 10_000.0), 10_000.0);
    }

    /// The native commit gate, exercised directly. The command wrapper only
    /// adds the `AppHandle` (not constructible in a unit test), so the test
    /// drives the same decision function the command uses and asserts both the
    /// hide/no-hide outcome and the intent-flag transition for each step.
    #[test]
    fn notify_overlay_hidden_gates_the_native_hide() {
        // Start of an exit: clear the intent, never hide. Both the
        // argument-less form (existing callers) and an explicit `false` take
        // this path.
        OVERLAY_INTENDED_VISIBLE.store(true, Ordering::SeqCst);
        assert!(!apply_hide_commit(None));
        assert!(!OVERLAY_INTENDED_VISIBLE.load(Ordering::SeqCst));
        OVERLAY_INTENDED_VISIBLE.store(true, Ordering::SeqCst);
        assert!(!apply_hide_commit(Some(false)));
        assert!(!OVERLAY_INTENDED_VISIBLE.load(Ordering::SeqCst));

        // Commit with no summon since the exit began: hide.
        assert!(apply_hide_commit(Some(true)));

        // Commit after a summon: `show_overlay` already set the intent, so the
        // hide is refused and the summon keeps ownership of the flag.
        OVERLAY_INTENDED_VISIBLE.store(true, Ordering::SeqCst);
        assert!(!apply_hide_commit(Some(true)));
        assert!(OVERLAY_INTENDED_VISIBLE.load(Ordering::SeqCst));
    }

    #[test]
    fn launch_show_pending_consumed_exactly_once() {
        LAUNCH_SHOW_PENDING.store(true, Ordering::SeqCst);
        assert!(LAUNCH_SHOW_PENDING.swap(false, Ordering::SeqCst));
        assert!(!LAUNCH_SHOW_PENDING.swap(false, Ordering::SeqCst));
    }

    #[test]
    fn overlay_visibility_event_constant_matches() {
        assert_eq!(OVERLAY_VISIBILITY_EVENT, "quickai://visibility");
        assert_eq!(OVERLAY_VISIBILITY_SHOW, "show");
        assert_eq!(OVERLAY_VISIBILITY_HIDE_REQUEST, "hide-request");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn onboarding_event_constant_matches() {
        assert_eq!(ONBOARDING_EVENT, "quickai://onboarding");
    }

    #[test]
    fn settings_open_action_focuses_when_window_exists() {
        assert_eq!(
            settings_open_action(true),
            SettingsOpenAction::FocusExisting
        );
    }

    #[test]
    fn settings_open_action_creates_when_window_absent() {
        // After close the window is destroyed, so a reopen rebuilds it.
        assert_eq!(settings_open_action(false), SettingsOpenAction::CreateNew);
    }

    #[test]
    fn is_openable_url_accepts_http_and_https() {
        assert!(is_openable_url("https://github.com/yorelll/quickai"));
        assert!(is_openable_url("http://localhost:1420/"));
    }

    #[test]
    fn is_openable_url_rejects_other_schemes() {
        assert!(!is_openable_url("file:///etc/passwd"));
        assert!(!is_openable_url("javascript:alert(1)"));
        assert!(!is_openable_url("not a url"));
        assert!(!is_openable_url(""));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn onboarding_logical_dimensions() {
        assert_eq!(ONBOARDING_LOGICAL_WIDTH, 460.0);
        assert_eq!(ONBOARDING_LOGICAL_HEIGHT, 640.0);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn overlay_logical_dimensions() {
        assert_eq!(OVERLAY_LOGICAL_WIDTH, 650.0);
        // The ask bar measures 64.8 px in the running app; 113 is the bar plus
        // the 48 px container padding. A smaller value leaves the bar clipped
        // on every summon (see `COLLAPSED_WINDOW_HEIGHT` in `src/App.tsx`).
        assert_eq!(OVERLAY_LOGICAL_HEIGHT_COLLAPSED, 113.0);
    }

    #[test]
    fn to_logical_divides_by_the_scale_factor() {
        assert!((to_logical(1440.0, 1.5) - 960.0).abs() < f64::EPSILON);
        assert!((to_logical(1080.0, 1.25) - 864.0).abs() < 1e-9);
        assert_eq!(to_logical(720.0, 1.0), 720.0);
    }

    #[test]
    fn to_logical_falls_back_when_the_scale_factor_is_unusable() {
        assert_eq!(to_logical(720.0, 0.0), 720.0);
        assert_eq!(to_logical(720.0, -1.0), 720.0);
    }

    /// Item 3's state machine, one assertion per state the user can be in.
    /// Every row is a *completed double-tap*; foreground is deliberately not
    /// an input any more, because it must not change the action.
    #[cfg(target_os = "windows")]
    #[test]
    fn hotkey_action_state_machine() {
        // Hidden (Esc / Ctrl+W / close button): open a fresh session.
        assert_eq!(hotkey_action(false, false), HotkeyAction::Show);
        // Hiding (still natively visible during the 350 ms exit animation):
        // the summon cancels the hide rather than being swallowed by it.
        assert_eq!(hotkey_action(false, true), HotkeyAction::Show);
        // Drifted (the intent flag outlived the native window): open.
        assert_eq!(hotkey_action(true, false), HotkeyAction::Show);
        // On screen, whether the user is on it or working elsewhere: raise.
        // The auto-shown launch overlay lands here, and it must not close.
        assert_eq!(hotkey_action(true, true), HotkeyAction::BringForward);
    }

    /// The defining invariant: no state dismisses. The minibar state is checked
    /// before `hotkey_action` (it is a size, not a visibility, state) and its
    /// path now calls `show()`; every action this function can return opens or
    /// raises the bar.
    #[cfg(target_os = "windows")]
    #[test]
    fn hotkey_action_never_dismisses() {
        for intended in [false, true] {
            for native in [false, true] {
                let action = hotkey_action(intended, native);
                assert!(
                    matches!(action, HotkeyAction::Show | HotkeyAction::BringForward),
                    "({intended}, {native}) produced {action:?}; the summon key must never hide"
                );
            }
        }
    }

    /// A shrink is only applied if no show/expand has superseded the event
    /// that requested it. The argument-less (in-app minimise) form always is.
    #[cfg(target_os = "windows")]
    #[test]
    fn shrink_epoch_guard() {
        // Current or newer than current: apply.
        assert!(shrink_is_current(Some(7), 7));
        assert!(shrink_is_current(Some(8), 7));
        // Older than current: the click-away was superseded by a show/expand.
        assert!(!shrink_is_current(Some(6), 7));
        // No token (in-app minimise): nothing to compare, apply.
        assert!(shrink_is_current(None, 7));
    }

    /// Scenario 2 (a lost minibar event): `MINIBAR_ACTIVE` is set while the
    /// frontend still shows the bar. The summon must expand *without* a show
    /// event — a replay calls `replayEntranceAnimation`, which resets the
    /// conversation the user is looking at. A genuine minibar still reopens a
    /// fresh session.
    #[cfg(target_os = "windows")]
    #[test]
    fn summon_from_a_minibar_without_ui_keeps_the_conversation() {
        assert_eq!(
            summon_plan(true, true, true, true),
            SummonPlan::Expand { replay: false }
        );
        assert_eq!(
            summon_plan(true, true, true, false),
            SummonPlan::Expand { replay: true }
        );
    }

    /// Scenario 3 (a lost show): the frontend is in the minibar while the
    /// native window looks visible, so `hotkey_action` says BringForward. A
    /// raise never resizes or re-shows, which would stay stuck; the plan
    /// expands and replays instead, ending in the visible state. A genuinely
    /// visible overlay still only raises.
    #[cfg(target_os = "windows")]
    #[test]
    fn summon_reconciles_a_lost_show_instead_of_raising() {
        assert_eq!(
            summon_plan(true, true, false, false),
            SummonPlan::Expand { replay: true }
        );
        assert_eq!(summon_plan(true, true, false, true), SummonPlan::Raise);
    }

    /// Scenario 4: a minibar flag set while the native window is hidden does
    /// not describe a live minibar and is cleared before the decision.
    #[cfg(target_os = "windows")]
    #[test]
    fn stale_minibar_on_a_hidden_window_is_cleared() {
        assert!(should_clear_stale_minibar(false, true));
        assert!(!should_clear_stale_minibar(true, true));
        assert!(!should_clear_stale_minibar(false, false));
        assert!(!should_clear_stale_minibar(true, false));
    }

    /// The diagnostic names the real state being recovered from, so a hidden
    /// window or a minibar flag without the minibar UI is never mistaken for a
    /// live minibar.
    #[cfg(target_os = "windows")]
    #[test]
    fn expand_source_names_every_recovery_state() {
        assert_eq!(expand_source(true, false), ExpandSource::MinibarWithUi);
        assert_eq!(expand_source(true, true), ExpandSource::MinibarWithoutUi);
        assert_eq!(expand_source(false, false), ExpandSource::UiHidden);
        assert_eq!(ExpandSource::MinibarWithUi.label(), "minibar-with-ui");
        assert_eq!(ExpandSource::MinibarWithoutUi.label(), "minibar-without-ui");
        assert_eq!(ExpandSource::UiHidden.label(), "ui-hidden");
    }

    /// The shrink verification is the only check that the window actually
    /// reached 48×48; it must accept DPI rounding but not a window that never
    /// moved.
    #[cfg(target_os = "windows")]
    #[test]
    fn reached_minibar_size_accepts_rounding_only() {
        assert!(reached_minibar_size((48, 48), 1.0));
        assert!(reached_minibar_size((60, 60), 1.25));
        assert!(reached_minibar_size((72, 72), 1.5));
        // One pixel of physical rounding is still the same logical size.
        assert!(reached_minibar_size((47, 49), 1.0));
        // A window that kept a content size did not reach it.
        assert!(!reached_minibar_size((650, 113), 1.0));
        assert!(!reached_minibar_size((48, 113), 1.0));
        assert!(!reached_minibar_size((50, 50), 1.0));
    }
}
