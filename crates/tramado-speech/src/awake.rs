// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/speech/awake.rs), MPL-2.0, same author.

//! Keeps the computer awake, and Tramado out of macOS's App Nap, while a recording or a
//! transcription runs. A class recorded or transcribed on battery would otherwise stop when the
//! computer goes to sleep after a few idle minutes, and App Nap slows an app whose window is
//! hidden. Best effort: if the system says no, the work carries on without it.

pub struct Awake(#[allow(dead_code)] imp::Guard);

impl Awake {
    /// Held until dropped. `reason` is what the system's power tools show.
    pub fn hold(reason: &str) -> Self {
        Awake(imp::Guard::new(reason))
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use objc2::rc::Retained;
    use objc2::runtime::{NSObjectProtocol, ProtocolObject};
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};

    pub struct Guard(Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>);

    // SAFETY: NSProcessInfo is thread-safe, and the token is only ever handed back to it.
    unsafe impl Send for Guard {}

    impl Guard {
        pub fn new(reason: &str) -> Self {
            // User-initiated: no App Nap, and no idle sleep (the display may still sleep).
            let token = NSProcessInfo::processInfo().beginActivityWithOptions_reason(
                NSActivityOptions::UserInitiated,
                &NSString::from_str(reason),
            );
            Guard(Some(token))
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            if let Some(token) = self.0.take() {
                // SAFETY: the token came from beginActivity on the same process info.
                unsafe { NSProcessInfo::processInfo().endActivity(&token) };
            }
        }
    }
}

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Power::{
        PowerClearRequest, PowerCreateRequest, PowerRequestSystemRequired, PowerSetRequest,
    };
    use windows_sys::Win32::System::Threading::{
        POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0,
    };

    /// A power request: unlike SetThreadExecutionState it belongs to no thread, so it can be
    /// let go of from wherever the work ends.
    pub struct Guard(HANDLE);

    // SAFETY: a power request handle can be used from any thread.
    unsafe impl Send for Guard {}

    impl Guard {
        pub fn new(reason: &str) -> Self {
            let mut text: Vec<u16> = reason.encode_utf16().chain(Some(0)).collect();
            let context = REASON_CONTEXT {
                Version: 0, // POWER_REQUEST_CONTEXT_VERSION
                Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
                Reason: REASON_CONTEXT_0 {
                    SimpleReasonString: text.as_mut_ptr(),
                },
            };
            // SAFETY: `context` and its string outlive the call, which copies them.
            unsafe {
                let handle = PowerCreateRequest(&context);
                if handle.is_null() || handle == INVALID_HANDLE_VALUE {
                    return Guard(std::ptr::null_mut());
                }
                if PowerSetRequest(handle, PowerRequestSystemRequired) == 0 {
                    CloseHandle(handle);
                    return Guard(std::ptr::null_mut());
                }
                Guard(handle)
            }
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: the handle is ours and set; it is cleared and closed once.
                unsafe {
                    PowerClearRequest(self.0, PowerRequestSystemRequired);
                    CloseHandle(self.0);
                }
            }
        }
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use std::os::fd::{FromRawFd, OwnedFd};

    use gio::glib::{ToVariant, VariantTy};
    use gio::prelude::*;

    /// A logind inhibitor (over the local system bus): held while its file descriptor is open.
    pub struct Guard(#[allow(dead_code)] Option<OwnedFd>);

    impl Guard {
        pub fn new(reason: &str) -> Self {
            Guard(inhibit(reason))
        }
    }

    fn inhibit(reason: &str) -> Option<OwnedFd> {
        let bus = gio::bus_get_sync(gio::BusType::System, gio::Cancellable::NONE).ok()?;
        // Blocking sleep is for the local, active session (polkit); elsewhere, such as over
        // SSH, only idleness can be held off.
        ["sleep:idle", "idle"].into_iter().find_map(|what| {
            let (_, fds) = bus
                .call_with_unix_fd_list_sync(
                    Some("org.freedesktop.login1"),
                    "/org/freedesktop/login1",
                    "org.freedesktop.login1.Manager",
                    "Inhibit",
                    Some(&(what, "Tramado", reason, "block").to_variant()),
                    VariantTy::new("(h)").ok(),
                    gio::DBusCallFlags::NONE,
                    5000,
                    gio::UnixFDList::NONE,
                    gio::Cancellable::NONE,
                )
                .ok()?;
            let fd = fds.get(0).ok()?;
            // SAFETY: UnixFDList::get returns a duplicate that the caller owns.
            Some(unsafe { OwnedFd::from_raw_fd(fd) })
        })
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
mod imp {
    pub struct Guard;

    impl Guard {
        pub fn new(_reason: &str) -> Self {
            Guard
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holding_and_letting_go_never_fails() {
        // Without a system bus (CI, a container) this is the no-op path.
        let a = Awake::hold("Tramado test");
        let b = Awake::hold("Tramado test, twice");
        drop(a);
        drop(b);
    }
}
