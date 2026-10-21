//! Native Claude accepted-row evidence, independent of numeric normalization.
use super::{ClaudeMessage, TokenUsageRecording};

/// Empty folds are identities, not public absent/unknown observations.
#[derive(Debug, Default, Clone, Copy)]
pub(super) struct TokenRecordingEvidence(u8);

const ACCEPTED: u8 = 1;
const NUMERIC: u8 = 2;
const MISSING: u8 = 4;
const UNKNOWN: u8 = 8;

impl TokenRecordingEvidence {
    pub(super) fn observe(&mut self, message: &ClaudeMessage) {
        let fields = message.usage.as_ref().map_or([false; 5], |usage| {
            [
                usage.input_tokens.is_some(),
                usage.output_tokens.is_some(),
                usage.cache_creation_input_tokens.is_some(),
                usage.cache_read_input_tokens.is_some(),
                usage.reasoning_tokens.is_some(),
            ]
        });
        self.0 |= ACCEPTED;
        if fields.iter().any(|present| *present) {
            self.0 |= NUMERIC;
        }
        if fields.iter().any(|present| !present) {
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
