//! Full-fileset manifest generation: filesystem truth under a single package root,
//! relative paths with `/` only in JSON (no absolute paths, no renaming).

use std::fs;
use std::io;
use std::path::{Component, Path};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

/// Supported package kinds; scan behavior is identical for now - discriminant is for the launcher.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PackageType {
    PcGame,
    Rom,
    RomBundle,
    Iso,
    Emulator,
}

impl std::str::FromStr for PackageType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "pc-game" => Ok(Self::PcGame),
            "rom" => Ok(Self::Rom),
            "rom-bundle" => Ok(Self::RomBundle),
            "iso" => Ok(Self::Iso),
            "emulator" => Ok(Self::Emulator),
            other => Err(format!(
                "unknown package type {other:?}; expected pc-game|rom|rom-bundle|iso|emulator"
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub source: String,
    pub generated_at: i64,
    /// Total size of the package (bytes); mirrors `totalBytes` for clients that only read `size`.
    pub size: u64,
    pub total_bytes: u64,
    pub package_type: PackageType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_target: Option<String>,
    pub files: Vec<ManifestFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFile {
    pub path: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
}

/// Build a manifest by walking every file under `package_root_path`.
///
/// `package_root_path` is canonicalized internally so relative paths are computed against a stable
/// root. Each file entry uses a path **relative to that root** only: we take `file_path.strip_prefix(root)`
/// (Rust's path API), then turn the remaining relative [`Path`] into a string with `/` separators
/// by iterating [`Component::Normal`] segments - no renaming of file or folder names.
pub fn scan_package(
    package_id: impl Into<String>,
    package_root_path: &Path,
    package_type: PackageType,
    launch_target: Option<String>,
) -> io::Result<Manifest> {
    if !package_root_path.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "package root does not exist: {}",
                package_root_path.display()
            ),
        ));
    }
    let root = fs::canonicalize(package_root_path)?;
    if !root.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("package root is not a directory: {}", root.display()),
        ));
    }

    let mut files: Vec<ManifestFile> = Vec::new();
    let mut total_bytes: u64 = 0;

    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let rel = path.strip_prefix(&root).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "cannot relativize path against package root: path={} root={}",
                    path.display(),
                    root.display()
                ),
            )
        })?;

        let rel_str = relative_path_to_manifest_string(rel)?;
        let size = entry.metadata()?.len();
        total_bytes = total_bytes.saturating_add(size);
        files.push(ManifestFile {
            path: rel_str,
            size,
            hash: None,
        });
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));

    let ts = unix_timestamp_secs();

    Ok(Manifest {
        id: package_id.into(),
        source: "local-scan".to_string(),
        generated_at: ts,
        size: total_bytes,
        total_bytes,
        package_type,
        launch_target,
        files,
    })
}

/// If there is exactly one `.exe` in the immediate directory (not recursive), return its relative path
/// using `/` (e.g. `game.exe`). Otherwise `None` - avoids guessing wrong binaries.
pub fn suggest_pc_launch_target(package_root: &Path) -> io::Result<Option<String>> {
    let root = if package_root.exists() {
        fs::canonicalize(package_root)?
    } else {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("package root does not exist: {}", package_root.display()),
        ));
    };
    if !root.is_dir() {
        return Ok(None);
    }

    let mut exes: Vec<String> = Vec::new();
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        if !ft.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.to_ascii_lowercase().ends_with(".exe") {
            exes.push(name.into_owned());
        }
    }
    exes.sort();
    if exes.len() == 1 {
        return Ok(Some(relative_path_to_manifest_string(Path::new(&exes[0]))?));
    }
    Ok(None)
}

/// Serialize manifest as pretty JSON and write to `out_path` (parent dirs created if needed).
pub fn write_manifest_json(manifest: &Manifest, out_path: &Path) -> io::Result<()> {
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let buf =
        serde_json::to_vec_pretty(manifest).map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    fs::write(out_path, buf)?;
    Ok(())
}

fn unix_timestamp_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Convert a relative [`Path`] to the manifest string form: only [`Component::Normal`],
/// joined with `/`. Rejects `..` / `.` components so we never emit ambiguous relative paths.
fn relative_path_to_manifest_string(rel: &Path) -> io::Result<String> {
    let mut parts = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(s) => parts.push(s.to_string_lossy().into_owned()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "path cannot be expressed as a clean relative manifest path: {}",
                        rel.display()
                    ),
                ));
            }
        }
    }
    Ok(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_nested_writes_forward_slashes() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("pkg");
        fs::create_dir_all(root.join("Data")).unwrap();
        fs::write(root.join("a.txt"), b"hi").unwrap();
        fs::write(root.join("Data/b.bin"), b"xyz").unwrap();

        let m = scan_package("test-id", &root, PackageType::PcGame, None).unwrap();
        assert_eq!(m.total_bytes, 5);
        assert_eq!(m.files.len(), 2);
        let paths: Vec<&str> = m.files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"a.txt"));
        assert!(paths.contains(&"Data/b.bin"));
    }

    #[test]
    fn rejects_missing_root() {
        let tmp = tempfile::tempdir().unwrap();
        let bad = tmp.path().join("nope");
        let e = scan_package("x", &bad, PackageType::Rom, None).unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::NotFound);
    }
}
