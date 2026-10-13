fn main() {
    // Register cfg flags set by cargo-llvm-cov so rustc doesn't warn about unknown cfgs.
    println!("cargo::rustc-check-cfg=cfg(coverage)");
    println!("cargo::rustc-check-cfg=cfg(coverage_nightly)");

    tauri_build::build();

    // tauri-build embeds a Windows application manifest (requesting comctl32 v6,
    // required by `muda` for TaskDialogIndirect) into binaries only, via
    // `cargo:rustc-link-arg-bins`. Test harnesses link the library themselves
    // without that manifest, so they abort at startup with
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139). Linking the same resource for
    // every target makes `cargo test` work on Windows.
    #[cfg(target_os = "windows")]
    if let Ok(out_dir) = std::env::var("OUT_DIR") {
        if let Ok(entries) = std::fs::read_dir(&out_dir) {
            for entry in entries.flatten() {
                if entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("libresource")
                {
                    println!("cargo:rustc-link-arg={}", entry.path().display());
                }
            }
        }
    }
}
