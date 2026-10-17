//! The menu-event journal (plan §4.4), kept free of Tauri types so its rules
//! are unit-tested. The frontend half is `src/commands/menuJournal.ts`.
//!
//! - Every app-command menu event - a click, or an accelerator that reached
//!   the menu - gets the next sequence number of this run (`epoch`), whether
//!   or not a page is listening (startup, a reload), and is emitted live.
//! - It stays in the journal until the frontend acknowledges it (`ack`):
//!   a page that reloads, or a listener that replaces another, pulls every
//!   event it has not run (`snapshot`) and runs them in sequence order.
//! - There is no "ready" state to get wrong: delivery does not depend on
//!   when a page loads or which listener is current, only on the numbers.
//! - The journal is bounded: when full, the oldest event is dropped and the
//!   `floor` (every number at or below it is gone) moves past it, so the
//!   frontend skips it instead of waiting for it.
//! - Ids outside the manifest's menu commands (OS items, unknown ids) are
//!   not recorded.
//! - Every event is stamped with the tab the page last reported in front
//!   (`report_front_tab`, from each `sync_menu_state`) when it is recorded:
//!   the tab the user saw when they chose it (ADR 0001 decision 6). The page
//!   acts on that tab, or on none: an event with no stamp (no page reported
//!   yet in this run) touches no tab.

use super::manifest::Manifest;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;

/// The most unacknowledged events kept; older ones are dropped first.
pub const MAX_RETAINED: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MenuEvent {
    pub seq: u64,
    pub id: String,
    /// The tab in front when it was chosen, as last reported; `null` if none was.
    #[serde(rename = "frontTabId")]
    pub front_tab_id: Option<String>,
}

/// A live `menu-command` event (`LiveMenuEvent` in `menuJournal.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LiveMenuEvent {
    pub epoch: String,
    pub seq: u64,
    pub id: String,
    #[serde(rename = "frontTabId")]
    pub front_tab_id: Option<String>,
}

/// What `menu_journal` returns (`MenuJournalSnapshot` in `menuJournal.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct JournalSnapshot {
    pub epoch: String,
    pub floor: u64,
    pub events: Vec<MenuEvent>,
}

#[derive(Debug)]
struct Inner {
    epoch: String,
    /// The last number given out.
    last_seq: u64,
    /// Every number at or below it is gone (acknowledged or dropped).
    floor: u64,
    retained: VecDeque<MenuEvent>,
    /// The tab the page last reported in front; stamped on each new event.
    front_tab_id: Option<String>,
}

#[derive(Debug)]
pub struct MenuJournal {
    inner: Mutex<Inner>,
}

impl MenuJournal {
    pub fn new(epoch: impl Into<String>) -> MenuJournal {
        MenuJournal {
            inner: Mutex::new(Inner {
                epoch: epoch.into(),
                last_seq: 0,
                floor: 0,
                retained: VecDeque::new(),
                front_tab_id: None,
            }),
        }
    }

    /// A journal for this process: its epoch tells a page that kept its
    /// cursor across an app restart that the numbers started over.
    pub fn for_this_run() -> MenuJournal {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        MenuJournal::new(format!("{}-{nanos}", std::process::id()))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // A panic while holding the lock leaves plain data behind; keep going.
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The page's tab in front (`sync_menu_state`): the stamp of the events
    /// recorded from now on. Kept events keep the stamp they were recorded with.
    pub fn report_front_tab(&self, front_tab_id: Option<String>) {
        self.lock().front_tab_id = front_tab_id;
    }

    /// Number, stamp and keep a menu event; `None` for an id that is not an app command.
    pub fn record(&self, manifest: &Manifest, id: &str) -> Option<LiveMenuEvent> {
        if !manifest.is_menu_command(id) {
            return None;
        }
        let mut inner = self.lock();
        inner.last_seq += 1;
        let seq = inner.last_seq;
        if inner.retained.len() == MAX_RETAINED {
            if let Some(dropped) = inner.retained.pop_front() {
                log::warn!("menu journal full: dropping unacknowledged event {dropped:?}");
                inner.floor = dropped.seq;
            }
        }
        let front_tab_id = inner.front_tab_id.clone();
        inner.retained.push_back(MenuEvent {
            seq,
            id: id.to_string(),
            front_tab_id: front_tab_id.clone(),
        });
        Some(LiveMenuEvent {
            epoch: inner.epoch.clone(),
            seq,
            id: id.to_string(),
            front_tab_id,
        })
    }

    /// Every event not yet acknowledged, oldest first.
    pub fn snapshot(&self) -> JournalSnapshot {
        let inner = self.lock();
        JournalSnapshot {
            epoch: inner.epoch.clone(),
            floor: inner.floor,
            events: inner.retained.iter().cloned().collect(),
        }
    }

    /// Every event up to `seq` ran: drop them. An acknowledgement for another
    /// run (`epoch`) is ignored; one past the last number counts up to it.
    pub fn ack(&self, epoch: &str, seq: u64) {
        let mut inner = self.lock();
        if inner.epoch != epoch {
            return;
        }
        let upto = seq.min(inner.last_seq);
        if upto <= inner.floor {
            return;
        }
        inner.floor = upto;
        while inner
            .retained
            .front()
            .is_some_and(|event| event.seq <= upto)
        {
            inner.retained.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::menu::manifest::manifest;

    fn seqs(snapshot: &JournalSnapshot) -> Vec<(u64, &str)> {
        snapshot
            .events
            .iter()
            .map(|event| (event.seq, event.id.as_str()))
            .collect()
    }

    #[test]
    fn numbers_every_menu_event_in_order_and_keeps_it_until_acknowledged() {
        let journal = MenuJournal::new("e");
        let m = manifest();
        let first = journal.record(m, "tab.new").unwrap();
        let second = journal.record(m, "tab.close").unwrap();
        assert_eq!((first.epoch.as_str(), first.seq), ("e", 1));
        assert_eq!(second.seq, 2);
        let snapshot = journal.snapshot();
        assert_eq!(snapshot.floor, 0);
        assert_eq!(seqs(&snapshot), vec![(1, "tab.new"), (2, "tab.close")]);
        journal.ack("e", 1);
        let snapshot = journal.snapshot();
        assert_eq!(snapshot.floor, 1);
        assert_eq!(seqs(&snapshot), vec![(2, "tab.close")]);
    }

    #[test]
    fn a_reload_or_a_new_listener_pulls_what_was_not_acknowledged() {
        // No "ready" state: events chosen while no page listens are numbered
        // and kept exactly like live ones.
        let journal = MenuJournal::new("e");
        let m = manifest();
        journal.record(m, "tab.new");
        journal.ack("e", 1);
        journal.record(m, "tab.new");
        journal.record(m, "tab.new");
        journal.record(m, "tab.close");
        assert_eq!(
            seqs(&journal.snapshot()),
            vec![(2, "tab.new"), (3, "tab.new"), (4, "tab.close")]
        );
        // Pulling twice (a late reply, a replaced listener) changes nothing.
        assert_eq!(journal.snapshot(), journal.snapshot());
    }

    #[test]
    fn ignores_a_stale_epoch_and_an_old_or_future_acknowledgement() {
        let journal = MenuJournal::new("e");
        let m = manifest();
        journal.record(m, "go.back");
        journal.record(m, "go.forward");
        journal.ack("other-run", 2);
        assert_eq!(journal.snapshot().events.len(), 2);
        journal.ack("e", 2);
        journal.ack("e", 1);
        assert_eq!(journal.snapshot().floor, 2);
        journal.ack("e", 99);
        assert_eq!(journal.snapshot().floor, 2, "never past the last number");
        assert_eq!(journal.record(m, "go.back").unwrap().seq, 3);
    }

    #[test]
    fn records_no_os_item_or_unknown_id() {
        let journal = MenuJournal::new("e");
        let m = manifest();
        assert_eq!(journal.record(m, "edit.copy"), None);
        assert_eq!(journal.record(m, "no.such"), None);
        assert_eq!(journal.snapshot().events, Vec::<MenuEvent>::new());
        assert_eq!(journal.record(m, "palette.open").unwrap().seq, 1);
    }

    #[test]
    fn drops_the_oldest_when_full_and_raises_the_floor_past_it() {
        let journal = MenuJournal::new("e");
        let m = manifest();
        for _ in 0..(MAX_RETAINED + 3) {
            journal.record(m, "go.back");
        }
        let snapshot = journal.snapshot();
        assert_eq!(snapshot.events.len(), MAX_RETAINED);
        assert_eq!(snapshot.floor, 3);
        assert_eq!(snapshot.events.first().map(|e| e.seq), Some(4));
    }

    #[test]
    fn each_run_has_its_own_epoch() {
        let a = MenuJournal::for_this_run();
        std::thread::sleep(std::time::Duration::from_millis(1));
        let b = MenuJournal::for_this_run();
        assert_ne!(a.snapshot().epoch, b.snapshot().epoch);
    }

    #[test]
    fn serializes_as_the_frontend_reads_it() {
        let journal = MenuJournal::new("e");
        journal.report_front_tab(Some("A".into()));
        let live = journal.record(manifest(), "tab.new").unwrap();
        assert_eq!(
            serde_json::to_value(&live).unwrap(),
            serde_json::json!({ "epoch": "e", "seq": 1, "id": "tab.new", "frontTabId": "A" })
        );
        assert_eq!(
            serde_json::to_value(journal.snapshot()).unwrap(),
            serde_json::json!({ "epoch": "e", "floor": 0, "events": [{ "seq": 1, "id": "tab.new", "frontTabId": "A" }] })
        );
    }

    #[test]
    fn stamps_each_event_with_the_front_tab_last_reported_when_it_was_chosen() {
        // WYSIWYG targeting (ADR 0001 decision 6, review-5 F2): the stamp is
        // taken when the event is recorded, never when it is delivered.
        let journal = MenuJournal::new("e");
        let m = manifest();
        journal.report_front_tab(Some("A".into()));
        let first = journal.record(m, "tab.close").unwrap();
        journal.report_front_tab(Some("B".into()));
        let second = journal.record(m, "tab.close").unwrap();
        assert_eq!(first.front_tab_id.as_deref(), Some("A"));
        assert_eq!(second.front_tab_id.as_deref(), Some("B"));
        let snapshot = journal.snapshot();
        let stamps: Vec<Option<&str>> = snapshot
            .events
            .iter()
            .map(|event| event.front_tab_id.as_deref())
            .collect();
        assert_eq!(
            stamps,
            vec![Some("A"), Some("B")],
            "a later report never restamps a kept event"
        );
    }

    #[test]
    fn stamps_nothing_until_a_page_reports_its_front_tab() {
        let journal = MenuJournal::new("e");
        let m = manifest();
        let unknown = journal.record(m, "tab.close").unwrap();
        assert_eq!(unknown.front_tab_id, None);
        assert_eq!(
            serde_json::to_value(&unknown).unwrap()["frontTabId"],
            serde_json::Value::Null,
            "the page reads no stamp as: touch no tab"
        );
        // A page that reports none (no tab known) clears it again.
        journal.report_front_tab(Some("A".into()));
        journal.report_front_tab(None);
        assert_eq!(journal.record(m, "tab.close").unwrap().front_tab_id, None);
    }

    #[test]
    fn a_new_run_stamps_nothing_its_page_has_not_reported() {
        // A new epoch (an app restart) knows no front tab: an id reported to
        // the last run never stamps this run's events.
        let old = MenuJournal::for_this_run();
        old.report_front_tab(Some("A".into()));
        std::thread::sleep(std::time::Duration::from_millis(1));
        let new = MenuJournal::for_this_run();
        let event = new.record(manifest(), "tab.close").unwrap();
        assert_ne!(event.epoch, old.snapshot().epoch);
        assert_eq!(event.front_tab_id, None);
        new.report_front_tab(Some("B".into()));
        assert_eq!(
            new.record(manifest(), "tab.close")
                .unwrap()
                .front_tab_id
                .as_deref(),
            Some("B")
        );
    }
}
