//! Native Claude accepted-row evidence, independent of numeric normalization.
use super::{
    apply_usage_fields_from_value, usage_u32, ClaudeMessage, TokenUsage, TokenUsageRecording,
};
use serde_json::Value;

/// Empty folds are identities, not public absent/unknown observations.
#[derive(Debug, Default, Clone, Copy)]
pub(super) struct TokenRecordingEvidence(u8);

const ACCEPTED: u8 = 1;
const NUMERIC: u8 = 2;
const MISSING: u8 = 4;
const UNKNOWN: u8 = 8;

/// The denominator is Claude's five classes, not a provider capability table.
/// `numeric` includes a single explicit TTL even when its aggregate is incomplete.
#[derive(Default)]
struct RowEvidence {
    covered: [bool; 5],
    numeric: bool,
}

impl RowEvidence {
    fn from_usage(usage: &TokenUsage) -> Self {
        let (five, hour) = usage.cache_creation.as_ref().map_or((None, None), |cache| {
            (
                cache.ephemeral_5m_input_tokens,
                cache.ephemeral_1h_input_tokens,
            )
        });
        let covered = [
            usage.input_tokens.is_some(),
            usage.output_tokens.is_some(),
            usage.cache_creation_input_tokens.is_some() || (five.is_some() && hour.is_some()),
            usage.cache_read_input_tokens.is_some(),
            usage.reasoning_tokens.is_some(),
        ];
        Self {
            numeric: covered.iter().any(|present| *present)
                || five.is_some()
                || hour.is_some()
                || usage.cache_creation_input_tokens_5m.is_some()
                || usage.cache_creation_input_tokens_1h.is_some(),
            covered,
        }
    }

    fn apply_json(&mut self, value: &Value) {
        // Reuse exactly the numeric parser's aliases/conversion without letting
        // its nested-empty-object default synthesize aggregate evidence.
        let mut flat = value.clone();
        if let Some(object) = flat.as_object_mut() {
            object.remove("cache_creation");
        }
        let mut usage = TokenUsage::default();
        apply_usage_fields_from_value(&flat, &mut usage);
        let mut next = Self::from_usage(&usage);
        if let Some(cache) = value.get("cache_creation") {
            let five = usage_u32(
                cache,
                &["ephemeral_5m_input_tokens", "ephemeral5mInputTokens"],
            );
            let hour = usage_u32(
                cache,
                &["ephemeral_1h_input_tokens", "ephemeral1hInputTokens"],
            );
            next.covered[2] |= five.is_some() && hour.is_some();
            next.numeric |= five.is_some() || hour.is_some();
        }
        for (covered, next) in self.covered.iter_mut().zip(next.covered) {
            *covered |= next;
        }
        self.numeric |= next.numeric;
    }

    fn from_message(message: &ClaudeMessage) -> Self {
        // A direct empty usage suppresses fallbacks in extract_token_usage too.
        if let Some(usage) = &message.usage {
            return Self::from_usage(usage);
        }
        let mut row = Self::default();
        if let Some(usage) = message
            .content
            .as_ref()
            .and_then(|value| value.get("usage"))
        {
            row.apply_json(usage);
        }
        if let Some(tool) = &message.tool_use_result {
            if let Some(usage) = tool.get("usage") {
                row.apply_json(usage);
            }
            if !row.covered[0] && !row.covered[1] && usage_u32(tool, &["totalTokens"]).is_some() {
                row.covered[usize::from(message.message_type == "assistant")] = true;
                row.numeric = true;
            }
        }
        row
    }
}

impl TokenRecordingEvidence {
    pub(super) fn observe(&mut self, message: &ClaudeMessage) {
        let row = RowEvidence::from_message(message);
        self.0 |= ACCEPTED;
        if row.numeric {
            self.0 |= NUMERIC;
        }
        if row.covered.iter().any(|present| !present) {
            self.0 |= MISSING;
        }
    }

    pub(super) fn finish(self) -> TokenUsageRecording {
        if self.0 & UNKNOWN != 0 || self.0 & ACCEPTED == 0 {
            TokenUsageRecording::Unknown
        } else if self.0 & NUMERIC == 0 {
            TokenUsageRecording::Absent
        } else if self.0 & MISSING != 0 {
            TokenUsageRecording::Partial
        } else {
            TokenUsageRecording::Recorded
        }
    }
}
