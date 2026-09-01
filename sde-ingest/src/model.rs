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

    pub fn into_optional_text(self) -> Option<String> {
        self.en.filter(|text| !text.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::LocalizedText;

    #[test]
    fn optional_english_text_distinguishes_content_from_missing_and_empty_values() {
        let missing: LocalizedText = serde_json::from_str("{}").unwrap();
        let empty: LocalizedText = serde_json::from_str(r#"{"en":""}"#).unwrap();
        let content: LocalizedText =
            serde_json::from_str(r#"{"en":"<b>Raw description</b>"}"#).unwrap();

        assert_eq!(missing.into_optional_text(), None);
        assert_eq!(empty.into_optional_text(), None);
        assert_eq!(
            content.into_optional_text().as_deref(),
            Some("<b>Raw description</b>")
        );
    }
}
