//! Menu titles in the app's five languages.
//!
//! The menu takes its titles from the frontend's own locale files
//! (`src/i18n/locales/<lang>/common.json`, embedded at compile time), so the
//! menu and the UI cannot name a command two ways, and `pnpm run
//! i18n:validate` keeps the five in step.

use std::collections::HashMap;
use std::sync::OnceLock;

/// The app's languages, as the frontend names them.
pub const LANGUAGES: [&str; 5] = ["en", "ko", "ja", "zh-CN", "zh-TW"];

const LOCALE_FILES: [(&str, &str); 5] = [
    (
        "en",
        include_str!("../../../src/i18n/locales/en/common.json"),
    ),
    (
        "ko",
        include_str!("../../../src/i18n/locales/ko/common.json"),
    ),
    (
        "ja",
        include_str!("../../../src/i18n/locales/ja/common.json"),
    ),
    (
        "zh-CN",
        include_str!("../../../src/i18n/locales/zh-CN/common.json"),
    ),
    (
        "zh-TW",
        include_str!("../../../src/i18n/locales/zh-TW/common.json"),
    ),
];

type Table = HashMap<String, String>;

fn tables() -> &'static HashMap<&'static str, Table> {
    static TABLES: OnceLock<HashMap<&'static str, Table>> = OnceLock::new();
    TABLES.get_or_init(|| {
        LOCALE_FILES
            .iter()
            .map(|(lang, json)| {
                let table: Table = serde_json::from_str(json).unwrap_or_else(|error| {
                    log::error!("menu labels: {lang}/common.json does not parse: {error}");
                    Table::new()
                });
                (*lang, table)
            })
            .collect()
    })
}

/// The app language for a language tag (`ko-KR`, `zh_Hant_TW`, `ja`...), as
/// the frontend's `toSupportedLanguage` maps it: Chinese with a TW/HK/MO
/// region or the Hant script is Traditional, other Chinese Simplified, an
/// unsupported language English.
pub fn resolve_language(tag: &str) -> &'static str {
    let lower = tag.trim().to_lowercase();
    let mut parts = lower.split(['-', '_']);
    let primary = parts.next().unwrap_or_default();
    if primary == "zh" {
        // Only script/region subtags count; a singleton starts an extension.
        let traditional = parts
            .take_while(|part| part.len() != 1)
            .any(|part| matches!(part, "tw" | "hk" | "mo" | "hant"));
        return if traditional { "zh-TW" } else { "zh-CN" };
    }
    LANGUAGES
        .iter()
        .find(|lang| **lang == primary)
        .copied()
        .unwrap_or("en")
}

/// Titles in one language, falling back to English for a missing key.
#[derive(Debug, Clone, Copy)]
pub struct Labels {
    language: &'static str,
}

impl Labels {
    pub fn new(language_tag: &str) -> Labels {
        Labels {
            language: resolve_language(language_tag),
        }
    }

    pub fn language(&self) -> &'static str {
        self.language
    }

    fn raw(&self, key: &str) -> Option<&'static str> {
        let tables = tables();
        tables
            .get(self.language)
            .and_then(|table| table.get(key))
            .or_else(|| tables.get("en").and_then(|table| table.get(key)))
            .map(String::as_str)
    }

    /// The title for `key`, `{{appName}}` filled in. A missing key shows as
    /// the key itself, as i18next does, rather than an empty item.
    pub fn get(&self, key: &str) -> String {
        let text = self.raw(key).unwrap_or(key);
        if text.contains("{{appName}}") {
            text.replace("{{appName}}", &self.app_name())
        } else {
            text.to_string()
        }
    }

    pub fn has(&self, key: &str) -> bool {
        tables()
            .get(self.language)
            .is_some_and(|table| table.contains_key(key))
    }

    pub fn app_name(&self) -> String {
        self.raw("common.appName")
            .unwrap_or("Claude Code History Viewer")
            .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_language_tags_like_the_frontend() {
        assert_eq!(resolve_language("ko-KR"), "ko");
        assert_eq!(resolve_language("ja_JP"), "ja");
        assert_eq!(resolve_language("zh-Hant"), "zh-TW");
        assert_eq!(resolve_language("zh-HK"), "zh-TW");
        assert_eq!(resolve_language("zh_Hant_TW"), "zh-TW");
        assert_eq!(resolve_language("zh-Hans-CN"), "zh-CN");
        assert_eq!(resolve_language("zh"), "zh-CN");
        assert_eq!(resolve_language("zh-u-nu-hant"), "zh-CN");
        assert_eq!(resolve_language("fr-FR"), "en");
        assert_eq!(resolve_language(""), "en");
        assert_eq!(resolve_language("zh-TW"), "zh-TW");
    }

    #[test]
    fn every_locale_file_parses() {
        for lang in LANGUAGES {
            let table = tables().get(lang).expect("table");
            assert!(table.len() > 100, "{lang}/common.json has its keys");
        }
    }

    #[test]
    fn fills_in_the_app_name() {
        let en = Labels::new("en");
        assert_eq!(
            en.get("common.menu.quit"),
            format!("Quit {}", en.app_name())
        );
        let ko = Labels::new("ko");
        assert_eq!(
            ko.get("common.menu.quit"),
            format!("{} 종료", ko.app_name())
        );
    }

    #[test]
    fn falls_back_to_english_then_to_the_key() {
        let ko = Labels::new("ko");
        assert_eq!(ko.get("no.such.key"), "no.such.key");
    }
}
