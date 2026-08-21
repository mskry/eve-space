use serde::Deserialize;

/// SDE localized text fields are `{ "en": "...", "de": "...", ... }` maps.
/// This app has no i18n requirement, so only English is kept.
#[derive(Deserialize, Default)]
pub struct LocalizedText {
    en: Option<String>,
}

impl LocalizedText {
    pub fn into_text(self) -> String {
        self.en.unwrap_or_default()
    }
}
