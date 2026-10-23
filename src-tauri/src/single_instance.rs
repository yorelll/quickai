//! Single-instance enforcement for QuickAI.
//!
//! Two copies of QuickAI each own a global low-level keyboard hook and an
//! overlay window, so one physical double-tap would be handled independently
//! twice. This module makes a second copy hand the launch over to the running
//! instance and exit **before** a Tauri app is built, so it never registers a
//! hook, a tray icon or a window of its own.
//!
//! This is hardening, not the fix for any summon-key behaviour: it makes a
//! dual-instance environment impossible, so a trace can only ever contain one
//! app's decisions.
//!
//! # Mechanism
//!
//! Two session-scoped kernel objects:
//!
//! - a **named mutex** is the lock. `CreateMutexW` followed by `GetLastError`
//!   is atomic: of two processes starting at the same instant, exactly one
//!   creates the object and the other is told `ERROR_ALREADY_EXISTS`. There is
//!   no check-then-create race to lose.
//! - a **named auto-reset event** is the hand-over channel. The first instance
//!   waits on it from a dedicated thread; a second instance signals it, closes
//!   its own handles and exits.
//!
//! Both processes create the event *before* the mutex, so a loser is guaranteed
//! to hold a handle it can signal even when it loses the mutex race by
//! microseconds. A signal delivered before the first instance's waiter thread
//! starts is retained by the event object (it stays signalled until a wait
//! consumes it), so a very early second launch is not lost.
//!
//! # Lifetime
//!
//! The mutex handle is deliberately never closed. The lock is the kernel
//! object's *existence*, and the kernel destroys a process's handles when the
//! process ends — normal exit, `ExitProcess`, or a crash. That is exactly the
//! lifetime required, and unlike a lock file it can never be left stale.
//!
//! The names live in the `Local\` namespace, so the lock is per interactive
//! session: two users logged into the same machine each get their own QuickAI
//! (and their own hooks and overlays), which is correct.
//!
//! # Relaunch hand-over
//!
//! `quit_and_relaunch` starts the replacement process while this one still
//! holds the mutex and is about to exit. [`mark_relaunch`] sets an environment
//! marker that the child inherits; [`acquire`] then takes the existing objects
//! over instead of forwarding to (and exiting behind) the dying parent.

use windows::core::HSTRING;
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE, WAIT_OBJECT_0,
};
use windows::Win32::System::Threading::{
    CreateEventW, CreateMutexW, SetEvent, WaitForSingleObject, INFINITE,
};

/// Session-scoped mutex name. Deliberately independent of the app version: any
/// version that implements the guard must collide with every other one.
const INSTANCE_MUTEX: &str = "Local\\QuickAI.SingleInstance.com.yorelll.quickai";
/// Session-scoped auto-reset event a second instance signals to summon the
/// first instance's overlay.
const INSTANCE_EVENT: &str = "Local\\QuickAI.SingleInstance.com.yorelll.quickai.activate";
/// Environment marker for the `AppHandle::restart()` hand-over (see the module
/// docs). Never visible to a normal launch.
const RELAUNCH_ENV: &str = "QUICKAI_RELAUNCH";

/// Which side of the lock this process is on.
#[derive(Debug, PartialEq, Eq)]
enum Role {
    Primary,
    Secondary,
}

/// Pure decision for [`acquire_named`].
///
/// A relaunch marker wins over an existing mutex: the holder is the parent
/// that spawned this process and is exiting, not a second user-visible copy.
fn role_for(already_exists: bool, relaunching: bool) -> Role {
    if already_exists && !relaunching {
        Role::Secondary
    } else {
        Role::Primary
    }
}

/// A kernel handle passed to the waiter thread as a plain integer. Kernel
/// handles are process-wide and `WaitForSingleObject` is safe from any thread;
/// the raw `HANDLE` type is `!Send` only because it wraps a pointer.
struct SendHandle(usize);

impl From<HANDLE> for SendHandle {
    fn from(handle: HANDLE) -> Self {
        Self(handle.0 as usize)
    }
}

impl SendHandle {
    fn handle(&self) -> HANDLE {
        HANDLE(self.0 as *mut core::ffi::c_void)
    }
}

/// Keeps the instance lock alive. Held until the process exits.
pub struct PrimaryGuard {
    /// The mutex handle. Never closed on purpose — see the module docs. It is
    /// only kept alive, hence the underscore: dropping the struct must not be
    /// mistaken for releasing the lock.
    _mutex: Option<HANDLE>,
    /// The activation event a secondary signals, if it could be created.
    event: Option<HANDLE>,
}

// SAFETY: both fields are process-wide kernel handles, and the guard is moved
// exactly once — into the setup closure, which then moves the event into its
// waiter thread. Kernel handles are not thread-affine, and the only operations
// performed on them (`WaitForSingleObject`, `SetEvent`, `CloseHandle`) are
// thread-safe Win32 calls. This impl exists only because `HANDLE` wraps a raw
// pointer, which Rust conservatively marks `!Send`.
unsafe impl Send for PrimaryGuard {}

/// Tries to become the single QuickAI instance.
///
/// Returns `Some` when this process owns the lock. Returns `None` when another
/// copy owns it: the activation has already been forwarded to that copy, and
/// the caller must exit without building a Tauri app.
pub fn acquire() -> Option<PrimaryGuard> {
    acquire_named(INSTANCE_MUTEX, INSTANCE_EVENT)
}

fn acquire_named(mutex_name: &str, event_name: &str) -> Option<PrimaryGuard> {
    // Create the event first. A process that turns out to be secondary must
    // already own a handle it can signal, even if it loses the mutex race.
    let event_name = HSTRING::from(event_name);
    let event = match unsafe { CreateEventW(None, false, false, &event_name) } {
        Ok(handle) => Some(handle),
        Err(error) => {
            crate::diag!("quickai: [instance] could not create the activation event: {error}");
            None
        }
    };

    let mutex_name = HSTRING::from(mutex_name);
    let (mutex, already_exists) = match unsafe { CreateMutexW(None, false, &mutex_name) } {
        Ok(handle) => {
            // Read immediately: `CreateMutexW` reports a pre-existing object
            // through the thread's last-error value, which any later Win32
            // call would overwrite. Nothing runs between the call and here.
            let exists = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
            (Some(handle), exists)
        }
        Err(error) => {
            crate::diag!("quickai: [instance] could not create the instance mutex: {error}");
            (None, false)
        }
    };
    let already_exists = already_exists && mutex.is_some();

    if role_for(already_exists, take_relaunch_marker()) == Role::Secondary {
        forward(event);
        close(mutex);
        return None;
    }

    if mutex.is_none() {
        crate::diag!(
            "quickai: [instance] running without single-instance protection (mutex unavailable)"
        );
    }
    crate::diag!("quickai: [instance] primary pid={}", std::process::id());
    Some(PrimaryGuard {
        _mutex: mutex,
        event,
    })
}

impl PrimaryGuard {
    /// Starts the thread that serves forwarded launches.
    ///
    /// `on_activate` runs on the waiter thread; the caller is responsible for
    /// marshalling onto the UI thread. Every signal opens or raises the
    /// overlay, exactly like a tray left click.
    pub fn listen<F>(self, on_activate: F)
    where
        F: Fn() + Send + 'static,
    {
        let event = self.event;
        // `self` is dropped when this function returns, but dropping a `HANDLE`
        // does **not** close it: the lock is the kernel object's existence, and
        // only process exit releases it (see the module docs). Never add a
        // `Drop` impl that closes `_mutex` — that would release the lock the
        // moment `run()` hands the guard to this listener.
        let Some(event) = event else {
            crate::diag!(
                "quickai: [instance] no activation event; forwarded launches are disabled"
            );
            return;
        };
        let event = SendHandle::from(event);

        std::thread::spawn(move || {
            let handle = event.handle();
            loop {
                let result = unsafe { WaitForSingleObject(handle, INFINITE) };
                if result != WAIT_OBJECT_0 {
                    crate::diag!(
                        "quickai: [instance] activation wait ended ({result:?}); no more forwarding"
                    );
                    break;
                }
                on_activate();
            }
        });
    }
}

/// Signals the running instance and logs what happened. The caller exits
/// either way: never registering a second hook matters more than a successful
/// hand-over.
fn forward(event: Option<HANDLE>) {
    let Some(event) = event else {
        crate::diag!(
            "quickai: [instance] another QuickAI is running but the activation event is unavailable; exiting"
        );
        return;
    };
    match unsafe { SetEvent(event) } {
        Ok(()) => {
            crate::diag!(
                "quickai: [instance] forwarded activation to the running instance; exiting"
            )
        }
        Err(error) => {
            crate::diag!("quickai: [instance] could not signal the running instance: {error}")
        }
    }
    // This process is about to exit, but releasing its handle immediately means
    // the object cannot outlive the primary if the primary crashes first.
    close(Some(event));
}

fn close(handle: Option<HANDLE>) {
    if let Some(handle) = handle {
        let _ = unsafe { CloseHandle(handle) };
    }
}

/// Reads and clears the relaunch marker. Clearing it keeps the marker out of
/// any process this one spawns later (agent commands, relaunches).
fn take_relaunch_marker() -> bool {
    let marked = std::env::var_os(RELAUNCH_ENV).is_some();
    if marked {
        std::env::remove_var(RELAUNCH_ENV);
    }
    marked
}

/// Marks the child spawned by `AppHandle::restart()` as this instance's
/// successor. Must be called immediately before `restart()`; the child inherits
/// the environment.
pub fn mark_relaunch() {
    std::env::set_var(RELAUNCH_ENV, "1");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    #[test]
    fn a_relaunch_marker_overrides_an_existing_mutex() {
        assert_eq!(role_for(false, false), Role::Primary);
        // A normal launch with the mutex held is a second copy.
        assert_eq!(role_for(true, false), Role::Secondary);
        assert_eq!(role_for(false, true), Role::Primary);
        // The dying parent still holds the mutex; its successor takes over.
        assert_eq!(role_for(true, true), Role::Primary);
    }

    /// Same-process proof that the mutex is the authority: the second acquire
    /// for a name sees `ERROR_ALREADY_EXISTS` and refuses.
    ///
    /// The name is unique per process and call so the test is hermetic — it
    /// must not collide with a QuickAI the developer happens to be running.
    #[test]
    fn a_second_acquire_for_the_same_name_is_secondary() {
        static SEQ: AtomicU32 = AtomicU32::new(0);
        let seq = SEQ.fetch_add(1, Ordering::SeqCst);
        let base = format!("Local\\QuickAI.Test.{}.{seq}", std::process::id());
        let mutex = format!("{base}.mutex");
        let event = format!("{base}.event");

        let first = acquire_named(&mutex, &event);
        assert!(first.is_some(), "the first acquire must own the instance");

        let second = acquire_named(&mutex, &event);
        assert!(
            second.is_none(),
            "the second acquire must see the existing mutex and refuse"
        );
    }
}
