//! Limits concurrent CDN/manifest transfers: max 2 users globally, max 1 active stream per user.

use std::collections::HashMap;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use futures_util::Stream;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};

#[derive(Debug, Clone, Copy)]
pub enum BusyKind {
    /// Both global download slots are taken.
    Global,
    /// This user already has an active download.
    User,
}

pub fn retry_after_seconds(kind: BusyKind) -> u32 {
    match kind {
        BusyKind::Global => 30,
        BusyKind::User => 15,
    }
}

pub struct DownloadGovernor {
    global: Arc<Semaphore>,
    per_user: Mutex<HashMap<String, Arc<Semaphore>>>,
}

impl DownloadGovernor {
    pub fn new() -> Self {
        Self {
            global: Arc::new(Semaphore::new(2)),
            per_user: Mutex::new(HashMap::new()),
        }
    }

    /// Try to take one global slot and this user's single slot. Fails fast (no waiting).
    pub async fn try_acquire(
        &self,
        user_id: &str,
    ) -> Result<(OwnedSemaphorePermit, OwnedSemaphorePermit), BusyKind> {
        let user_sem = {
            let mut map = self.per_user.lock().await;
            map.entry(user_id.to_string())
                .or_insert_with(|| Arc::new(Semaphore::new(1)))
                .clone()
        };
        let g = match self.global.clone().try_acquire_owned() {
            Ok(p) => p,
            Err(_) => return Err(BusyKind::Global),
        };
        match user_sem.clone().try_acquire_owned() {
            Ok(p) => Ok((g, p)),
            Err(_) => {
                drop(g);
                Err(BusyKind::User)
            }
        }
    }
}

/// Holds download permits until the inner byte stream completes (`Ready(None)`).
pub struct StreamWithPermits<S> {
    inner: S,
    permits: Option<(OwnedSemaphorePermit, OwnedSemaphorePermit)>,
}

impl<S> StreamWithPermits<S> {
    pub fn new(inner: S, permits: (OwnedSemaphorePermit, OwnedSemaphorePermit)) -> Self {
        Self {
            inner,
            permits: Some(permits),
        }
    }
}

impl<S: Stream + Unpin> Stream for StreamWithPermits<S> {
    type Item = S::Item;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = &mut *self;
        let poll = Pin::new(&mut this.inner).poll_next(cx);
        if let Poll::Ready(None) = &poll {
            this.permits.take();
        }
        poll
    }
}

impl<S> Unpin for StreamWithPermits<S> where S: Unpin {}
