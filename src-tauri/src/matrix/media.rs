use super::*;

impl Session {
    pub(super) async fn media(&self, media: MxMedia) -> Result<String, String> {
        let dir = self.data_directory().join("media");
        let digest = format!("{:x}", Sha256::digest(media.source.as_bytes()));
        let path = dir.join(format!("{}{}", &digest[..32], extension_of(&media.name)));
        if !path.exists() {
            let source = serde_json::from_str(&media.source).map_err(err)?;
            let request = MediaRequestParameters {
                source,
                format: MediaFormat::File,
            };
            // The file is the cache; the SDK's own would hold a second copy.
            let bytes = self
                .client
                .media()
                .get_media_content(&request, false)
                .await
                .map_err(err)?;
            tokio::fs::create_dir_all(&dir).await.map_err(err)?;
            tokio::fs::write(&path, bytes).await.map_err(err)?;
        }
        Ok(path.to_string_lossy().into_owned())
    }
}

pub(super) fn extension_of(name: &str) -> String {
    match Path::new(name).extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()) => {
            format!(".{}", ext.to_ascii_lowercase())
        }
        _ => String::new(),
    }
}

#[tauri::command]
pub async fn mx_media(state: State<'_, Matrix>, media: MxMedia) -> Result<String, String> {
    let session = current(&state)?;
    session.media(media).await
}

#[cfg(test)]
mod tests {
    use super::extension_of;

    #[test]
    fn keeps_short_plain_extensions_only() {
        assert_eq!(extension_of("Photo.JPG"), ".jpg");
        assert_eq!(extension_of("archive.tar.gz"), ".gz");
        assert_eq!(extension_of("notes"), "");
        assert_eq!(extension_of("evil.p$p"), "");
        assert_eq!(extension_of("x.verylongext"), "");
    }
}
